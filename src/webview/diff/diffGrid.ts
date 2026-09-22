import type { DiffModel } from '../../core/diff';
import { computeByteDiff } from '../../core/diff';
import type { MemorySegment } from '../../core/parser/types';
import { formatCopyCommand } from '../../core/byteTools/copyFormatters';
import { DiffView, type DiffPane, type DiffViewCallbacks } from '../components/diffView/diffView';
import { renderDiffEmptyHtml } from '../components/diffView/diffViewRender';
import {
    BYTES_PER_ROW,
    renderHexViewHtml,
    type HexViewCell,
    type HexViewRange,
    type HexViewRenderInput,
    type HexViewRow,
} from '../components/hexView/hexViewRender';
import {
    applyVirtualScrollLayout,
    calcRowOffset,
    calcScrollLayout,
    calcTotalHeight,
    calcVisibleRange,
    clampWindowTop,
    logicalToPhysicalScroll,
    overscanRowCount,
    physicalToLogicalScroll,
    type VirtualScrollLayout,
    type VirtualScrollState,
} from '../render/virtualScroll';
import { addMatchSpan } from '../render/matchSpans';
import { buildHexCells, type CellDecoration } from '../render/hexCells';
import { buildDiffRows, diffClassForSide, diffKindAt, getSideByte, renderDiffErrorHtml, type DiffRow, type DiffSideData } from './diffModel';
import type { DiffProgressMessage } from './diffMessages';

export type DiffViewMode = 'all' | 'diff';

const FALLBACK_ROW_HEIGHT = 20.8;
const FALLBACK_GAP_HEIGHT = 35.2;
const BUFFER_SIZE = 10;
/** Poll frames of an unchanged driver `scrollTop` before the scroll is treated as settled. */
const SETTLE_FRAMES = 2;

interface DiffGridData {
    rows: DiffRow[];
    a: DiffSideData;
    b: DiffSideData;
    diff: DiffModel;
}

interface DiffGridHooks {
    onSidesSwapped?: (a: DiffSideData, b: DiffSideData) => void;
}

let data: DiffGridData | null = null;
let visibleRows: DiffRow[] = [];
const diffView = new DiffView();

interface ScrollPane {
    state: VirtualScrollState;
    container: HTMLElement;
}

let scrollPaneA: ScrollPane | null = null;
let scrollPaneB: ScrollPane | null = null;
let lastDriver: DiffPane = 'a';
let selection: HexViewRange | null = null;
let selectionPane: DiffPane = 'a';
let selAnchor: number | null = null;
let matchSet: ReadonlySet<number> = new Set();
let activeMatch: HexViewRange | null = null;
let viewMode: DiffViewMode = 'all';
let syncScroll = true;
let syncingScroll = false;
let hooks: DiffGridHooks = {};
let lastRenderKey: string | null = null;
let renderHandle: number | null = null;
let scrollPollHandle: number | null = null;
let pollDriver: DiffPane | null = null;
let lastPolledTop = 0;
let stableFrames = 0;
let paneTopA: number | null = null;
let paneTopB: number | null = null;

function paneScroll(pane: DiffPane): ScrollPane | null {
    return pane === 'a' ? scrollPaneA : scrollPaneB;
}

function setPaneScroll(pane: DiffPane, value: ScrollPane | null): void {
    if (pane === 'a') { scrollPaneA = value; return; }
    scrollPaneB = value;
}

function followerOf(driver: DiffPane): DiffPane {
    return driver === 'a' ? 'b' : 'a';
}

export function setDiffGridHooks(next: DiffGridHooks): void {
    hooks = next;
}

export function mountDiffGrid(): void {
    diffView.setCallbacks(hostCallbacks());
    diffView.mount();
}

function hostCallbacks(): DiffViewCallbacks {
    return {
        onVisibleWindowChange: (pane, top, left) => syncFrom(pane, top, left),
        onCellClick: (pane, addr, shift) => selectCell(pane, addr, shift),
        onSelectionChange: (pane, range) => setSelection(pane, range),
        onAddressRowClick: (pane, rowBase, shift) => selectRow(pane, rowBase, shift),
        onAddressRowDrag: (pane, rows) => selectRowRange(pane, rows),
    };
}

/** Test seam: drop cached grid instances so a fresh document re-attaches listeners. */
export function resetDiffGrid(): void {
    data = null;
    visibleRows = [];
    diffView.reset();
    scrollPaneA = null;
    scrollPaneB = null;
    lastDriver = 'a';
    selection = null;
    selectionPane = 'a';
    selAnchor = null;
    matchSet = new Set();
    activeMatch = null;
    viewMode = 'all';
    syncScroll = true;
    syncingScroll = false;
    cancelPendingRender();
    stopScrollPoll();
    paneTopA = null;
    paneTopB = null;
    lastRenderKey = null;
}

export function setDiffData(a: DiffSideData, b: DiffSideData, diff: DiffModel): void {
    data = { rows: buildDiffRows(a, b), a, b, diff };
    visibleRows = filterRows(data.rows);
    scrollPaneA = null;
    scrollPaneB = null;
    lastDriver = 'a';
    selection = null;
    selectionPane = 'a';
    selAnchor = null;
    matchSet = new Set();
    activeMatch = null;
    viewMode = 'all';
    syncScroll = true;
    cancelPendingRender();
    stopScrollPoll();
    lastRenderKey = null;
    clearDiffError();
    diffView.injectHeaders();
    renderDiffGrid();
}

/** Apply a reloaded pair, keeping the view mode and each pane's anchor address (R5). */
export function applyReload(a: DiffSideData, b: DiffSideData, diff: DiffModel): void {
    const anchors = captureReloadAnchors();
    data = { rows: buildDiffRows(a, b), a, b, diff };
    visibleRows = filterRows(data.rows);
    selection = null;
    selectionPane = 'a';
    selAnchor = null;
    matchSet = new Set();
    activeMatch = null;
    cancelPendingRender();
    stopScrollPoll();
    lastRenderKey = null;
    clearDiffError();
    diffView.injectHeaders();
    renderDiffGrid();
    restoreReloadAnchors(anchors);
    renderDiffGrid();
}

interface ReloadAnchor {
    pane: DiffPane;
    address: number | null;
    offset: number;
}

/** Snapshot the top-address anchor of each pane before the row model is replaced. */
function captureReloadAnchors(): ReloadAnchor[] {
    if (!data) { return []; }
    return (['a', 'b'] as DiffPane[]).flatMap(anchorForPane);
}

function anchorForPane(pane: DiffPane): ReloadAnchor[] {
    const scroll = paneScroll(pane);
    if (!scroll) { return []; }
    const index = rowIndexAtOffset(scroll.state.scrollTop, scroll.state);
    const row = visibleRows[index];
    return [{
        pane,
        address: row ? row.address : null,
        offset: scroll.state.scrollTop - calcRowOffset(index, scroll.state),
    }];
}

function rowIndexAtOffset(offset: number, state: VirtualScrollState): number {
    let lo = 0;
    let hi = visibleRows.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (calcRowOffset(mid, state) <= offset) { lo = mid + 1; } else { hi = mid; }
    }
    return Math.max(0, lo - 1);
}

/** Re-anchor each pane to its old address (nearest row when it is gone), keeping the in-row offset. */
function restoreReloadAnchors(anchors: readonly ReloadAnchor[]): void {
    anchors.forEach(restoreAnchor);
}

function restoreAnchor(anchor: ReloadAnchor): void {
    const scroll = paneScroll(anchor.pane);
    if (!scroll) { return; }
    const logicalTop = anchorLogicalTop(anchor, scroll);
    if (logicalTop === null) { return; }
    scroll.state.scrollTop = logicalTop;
    diffView.setScrollTop(anchor.pane, logicalToPhysicalScroll(logicalTop, scroll.state));
}

function anchorLogicalTop(anchor: ReloadAnchor, scroll: ScrollPane): number | null {
    const index = anchor.address === null ? -1 : nearestRowIndex(anchor.address);
    if (index < 0) { return null; }
    return Math.max(0, calcRowOffset(index, scroll.state) + anchor.offset);
}

/** Index of the row nearest `address` (exact match preferred); -1 only when there are no rows. */
function nearestRowIndex(address: number): number {
    const lo = lowerBoundRow(address);
    if (lo === 0) { return visibleRows.length > 0 ? 0 : -1; }
    if (lo >= visibleRows.length) { return visibleRows.length - 1; }
    return closerRowIndex(lo, address);
}

function lowerBoundRow(address: number): number {
    let lo = 0;
    let hi = visibleRows.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (visibleRows[mid].address < address) { lo = mid + 1; } else { hi = mid; }
    }
    return lo;
}

function closerRowIndex(lo: number, address: number): number {
    const after = visibleRows[lo];
    const before = visibleRows[lo - 1];
    if (after.address === address) { return lo; }
    return address - before.address <= after.address - address ? lo - 1 : lo;
}

// ── View mode ─────────────────────────────────────────────────────

export function getViewMode(): DiffViewMode {
    return viewMode;
}

export function setViewMode(mode: DiffViewMode): void {
    if (mode === viewMode) { return; }
    viewMode = mode;
    visibleRows = filterRows(data?.rows ?? []);
    renderDiffGrid();
}

export function getSyncScroll(): boolean {
    return syncScroll;
}

export function setSyncScroll(on: boolean): void {
    if (on === syncScroll) { return; }
    syncScroll = on;
    stopScrollPoll();
    if (on) { alignFollowerToDriver(); }
    renderDiffGrid();
}

/** Re-enabling sync snaps the follower onto the driver's current position. */
function alignFollowerToDriver(): void {
    const driver = paneScroll(lastDriver);
    const follower = paneScroll(followerOf(lastDriver));
    if (!driver || !follower) { return; }
    follower.state.scrollTop = driver.state.scrollTop;
    diffView.setScrollTop(followerOf(lastDriver), driver.container.scrollTop);
    diffView.setScrollLeft(followerOf(lastDriver), driver.container.scrollLeft);
}

function filterRows(rows: readonly DiffRow[]): DiffRow[] {
    if (viewMode === 'all') { return [...rows]; }
    return rows.filter(row => row.kind === 'data' && rowHasDiff(row));
}

function rowHasDiff(row: DiffRow): boolean {
    if (!data) { return false; }
    for (let col = 0; col < BYTES_PER_ROW; col++) {
        if (diffKindAt(data.diff.runs, row.address + col) !== undefined) { return true; }
    }
    return false;
}

// ── Selection (read-only, mirrored) ───────────────────────────────

function selectCell(side: DiffPane, addr: number, shift: boolean): void {
    const start = shift && selAnchor !== null ? selAnchor : addr;
    if (!shift) { selAnchor = addr; }
    applySelection(side, start, addr);
}

function selectRow(side: DiffPane, rowBase: number, shift: boolean): void {
    const start = shift && selAnchor !== null ? selAnchor : rowBase;
    if (!shift) { selAnchor = rowBase; }
    applySelection(side, start, rowBase + BYTES_PER_ROW - 1);
}

function selectRowRange(side: DiffPane, rows: HexViewRange): void {
    applySelection(side, rows.start, rows.end + BYTES_PER_ROW - 1);
}

function setSelection(side: DiffPane, range: HexViewRange): void {
    selAnchor = range.start;
    applySelection(side, range.start, range.end);
}

function applySelection(side: DiffPane, start: number, end: number): void {
    selection = { start: Math.min(start, end), end: Math.max(start, end) };
    selectionPane = side;
    paintMirroredSelection();
}

/** Repaint the host-owned selection on both panes (read-only mirror). */
function paintMirroredSelection(): void {
    diffView.paintSelection(selection);
}

/** Copy source pane's mapped bytes for the current selection; unmapped addresses are skipped. */
export function copySelectionText(): { text: string; label: string } | null {
    if (!data || !selection) { return null; }
    return copyPayload(mappedBytes(sideForPane(selectionPane), selection));
}

function sideForPane(pane: DiffPane): DiffSideData {
    const sides = data!;
    return pane === 'b' ? sides.b : sides.a;
}

function mappedBytes(side: DiffSideData, range: HexViewRange): number[] {
    const bytes: number[] = [];
    for (let addr = range.start; addr <= range.end; addr++) {
        const value = getSideByte(side, addr);
        if (value !== undefined) { bytes.push(value); }
    }
    return bytes;
}

function copyPayload(bytes: number[]): { text: string; label: string } | null {
    return bytes.length > 0
        ? { text: formatCopyCommand('hex', bytes), label: pluralBytes(bytes.length) }
        : null;
}

function pluralBytes(count: number): string {
    return `${count} byte${count === 1 ? '' : 's'}`;
}

// ── Swap ──────────────────────────────────────────────────────────

/** Swap pane order/labels and recompute the diff for the new base pair, then re-render. */
export function swapSides(): DiffModel | null {
    if (!data) { return null; }
    const a = data.a;
    data.a = data.b;
    data.b = a;
    data.diff = computeByteDiff(memorySegments(data.a), memorySegments(data.b));
    hooks.onSidesSwapped?.(data.a, data.b);
    renderDiffGrid();
    return data.diff;
}

function memorySegments(side: DiffSideData): MemorySegment[] {
    return side.parseResult.segments.map(segment => ({
        startAddress: segment.startAddress,
        data: segment.data as Uint8Array,
    }));
}

// ── Search matches ────────────────────────────────────────────────

export function currentSides(): { a: DiffSideData; b: DiffSideData } | null {
    return data ? { a: data.a, b: data.b } : null;
}

export function setSearchMatches(addrs: readonly number[], active: number, length: number): void {
    const span = Math.max(1, length);
    matchSet = matchSetWithSpans(addrs, span);
    activeMatch = active >= 0 && active < addrs.length
        ? { start: addrs[active], end: addrs[active] + span - 1 }
        : null;
    renderDiffGrid();
}

/** Match-highlight width follows the executed needle span (shared with memoryGrid). */
function matchSetWithSpans(addrs: readonly number[], span: number): ReadonlySet<number> {
    const set = new Set<number>();
    for (const addr of addrs) { addMatchSpan(set, addr, span); }
    return set;
}

// ── Render ────────────────────────────────────────────────────────

function renderDiffGrid(): void {
    const a = currentSlice('a');
    const b = currentSlice('b');
    if (!a || !b) { return; }
    lastRenderKey = sliceKey(a, b);
    drawSlice(a, b);
}

/** Scroll-driven render: coalesced to one frame and skipped when the visible slice is unchanged. */
function renderScrollSlice(): void {
    const a = currentSlice('a');
    const b = currentSlice('b');
    if (!a || !b) { return; }
    renderSlices(a, b, refreshSliceKey(a, b));
}

/** Recompute the slice key; true when the visible slice changed since the last render. */
function refreshSliceKey(a: PaneSlice, b: PaneSlice): boolean {
    const key = sliceKey(a, b);
    if (key === lastRenderKey) { return false; }
    lastRenderKey = key;
    return true;
}

function renderSlices(a: PaneSlice, b: PaneSlice, changed: boolean): void {
    const driver = sliceFor(lastDriver, a, b);
    const follower = sliceFor(followerOf(lastDriver), a, b);
    if (isTrackingFrame(changed)) { trackFollower(driver, follower); return; }
    reconcileSlices(a, b, changed);
}

function sliceFor(pane: DiffPane, a: PaneSlice, b: PaneSlice): PaneSlice {
    return pane === 'a' ? a : b;
}

/** An active poll frame with no slice change: track visually, defer the real writes. */
function isTrackingFrame(changed: boolean): boolean {
    return syncScroll && pollDriver !== null && !changed;
}

function trackFollower(driver: PaneSlice, follower: PaneSlice): void {
    repositionPane(driver, lastDriver);
    applyFollowerVisual(driver, follower);
}

function reconcileSlices(a: PaneSlice, b: PaneSlice, changed: boolean): void {
    const driverPane = lastDriver;
    const followerPane = followerOf(driverPane);
    const driver = sliceFor(driverPane, a, b);
    const follower = sliceFor(followerPane, a, b);
    if (syncScroll) { reconcileFollower(driver, follower); }
    if (changed) { drawSlice(a, b); return; }
    repositionPane(driver, driverPane);
    if (syncScroll) { repositionPane(follower, followerPane); }
}

/** Per-frame visual tracking: shift the follower by the un-reconciled delta (compositor-only). */
function applyFollowerVisual(driver: PaneSlice, follower: PaneSlice): void {
    const delta = driver.container.scrollTop - follower.container.scrollTop;
    follower.rows.style.transform = delta === 0 ? '' : `translateY(${-delta}px)`;
}

/** Real follower step: write the native position and drop the accumulated transform. */
function reconcileFollower(driver: PaneSlice, follower: PaneSlice): void {
    follower.container.scrollTop = driver.container.scrollTop;
    follower.state.scrollTop = driver.state.scrollTop;
    follower.rows.style.transform = '';
}

function lastPaneTop(pane: DiffPane): number | null {
    return pane === 'a' ? paneTopA : paneTopB;
}

function setLastPaneTop(pane: DiffPane, top: number | null): void {
    if (pane === 'a') { paneTopA = top; return; }
    paneTopB = top;
}

function repositionPane(slice: PaneSlice, pane: DiffPane): void {
    const layout = calcScrollLayout(slice.state);
    if (!layout.isCompressed) { return; }
    const wrapper = slice.rows.firstElementChild as HTMLElement | null;
    if (!wrapper) { return; }
    const topSpacer = calcRowOffset(slice.start, slice.state);
    const sliceHeight = calcRowOffset(slice.end, slice.state) - topSpacer;
    const windowTop = clampWindowTop(slice.container.scrollTop + topSpacer - slice.state.scrollTop, layout.physicalHeight, sliceHeight);
    if (lastPaneTop(pane) === windowTop) { return; }
    setLastPaneTop(pane, windowTop);
    wrapper.style.top = `${windowTop}px`;
}

interface PaneSlice {
    rows: HTMLElement;
    state: VirtualScrollState;
    container: HTMLElement;
    start: number;
    end: number;
}

function currentSlice(pane: DiffPane): PaneSlice | null {
    const rows = document.getElementById(rowsId(pane));
    const container = scrollContainer(pane);
    if (!rows || !container || !data) { return null; }
    const state = ensureScrollState(pane, container);
    const [start, end] = calcVisibleRange(state);
    return { rows, state, container, start, end };
}

function rowsId(pane: DiffPane): string {
    return pane === 'a' ? 'diff-rows-a' : 'diff-rows-b';
}

function sliceKey(a: PaneSlice, b: PaneSlice): string {
    // Each pane's containerHeight is part of its scroll-state identity
    // (`isCurrentScrollState`), so a resize must still re-apply the layout.
    return `${a.state.heightVersion}|${a.state.containerHeight}|${b.state.containerHeight}|` +
        `${visibleRows.length}|${viewMode}|${syncScroll}|${a.start}|${a.end}|${b.start}|${b.end}`;
}

function emptyMessage(): string {
    return viewMode === 'diff' ? 'No differences' : 'No data records found.';
}

function renderEmptyGrid(a: PaneSlice, b: PaneSlice, message: string): void {
    const emptyHtml = renderDiffEmptyHtml(message);
    a.rows.innerHTML = emptyHtml;
    b.rows.innerHTML = emptyHtml;
}

function drawSlice(a: PaneSlice, b: PaneSlice): void {
    // A real draw re-derives both wrappers, so no transform may survive it.
    a.rows.style.transform = '';
    b.rows.style.transform = '';
    if (visibleRows.length === 0) { renderEmptyGrid(a, b, emptyMessage()); return; }
    drawPane(a, 'a');
    drawPane(b, 'b');
}

/** Render one pane from its own scroll state and container position. */
function drawPane(slice: PaneSlice, side: DiffPane): void {
    const { state, start, end } = slice;
    const layout = calcScrollLayout(state);
    applyVirtualScrollLayout(slice.rows, layout);
    const topSpacer = calcRowOffset(start, state);
    const bottomSpacer = calcTotalHeight(state) - calcRowOffset(end, state);
    const sliceHeight = calcRowOffset(end, state) - calcRowOffset(start, state);
    const windowTop = clampWindowTop(slice.container.scrollTop + topSpacer - state.scrollTop, layout.physicalHeight, sliceHeight);
    slice.rows.innerHTML = renderHexViewHtml(buildInput(side, start, end, layout, windowTop, topSpacer, bottomSpacer));
    setLastPaneTop(side, layout.isCompressed ? windowTop : null);
}

export function scrollToDiff(range: HexViewRange, options: { selection?: boolean } = {}): void {
    if (!data) { return; }
    applySelectionOption(range, options);
    const rowIndex = findRowIndexForAddress(range.start);
    if (rowIndex < 0) { return; }
    scrollToRow(rowIndex);
}

function applySelectionOption(range: HexViewRange, options: { selection?: boolean }): void {
    if (options.selection === false) { return; }
    selection = range;
    selectionPane = paneForAddress(range.start) ?? paneForAddress(range.end) ?? selectionPane;
    paintMirroredSelection();
}

/** The pane that maps `addr`, so search-driven copy reads a pane that actually owns the bytes. */
function paneForAddress(addr: number): DiffPane | null {
    if (!data) { return null; }
    if (getSideByte(data.a, addr) !== undefined) { return 'a'; }
    if (getSideByte(data.b, addr) !== undefined) { return 'b'; }
    return null;
}

/** Scroll to a row: both panes when sync is on, else only the navigated pane. */
function scrollToRow(rowIndex: number): void {
    if (syncScroll) {
        scrollPaneToRow('a', rowIndex);
        scrollPaneToRow('b', rowIndex);
    } else {
        scrollPaneToRow(selectionPane, rowIndex);
    }
    renderDiffGrid();
}

function scrollPaneToRow(pane: DiffPane, rowIndex: number): void {
    const scroll = paneScroll(pane);
    if (!scroll) { return; }
    const { state } = scroll;
    const desiredTop = Math.max(0, calcRowOffset(rowIndex, state) - state.getRowHeight(rowIndex) * 2);
    const top = Math.min(desiredTop, calcScrollLayout(state).logicalScrollable);
    state.scrollTop = top;
    diffView.setScrollTop(pane, logicalToPhysicalScroll(top, state));
}

export function showDiffError(message: string): void {
    showDiffRoot();
    const body = document.getElementById('diff-body');
    if (body) { body.hidden = true; }
    const errorEl = document.getElementById('diff-error');
    if (!errorEl) { return; }
    errorEl.hidden = false;
    errorEl.innerHTML = renderDiffErrorHtml(message);
}

function clearDiffError(): void {
    const errorEl = document.getElementById('diff-error');
    if (errorEl) { errorEl.hidden = true; }
    const body = document.getElementById('diff-body');
    if (body) { body.hidden = false; }
    showDiffRoot();
}

/** Loading card → grids/error card swap (no-op when the shell lacks the loading card). */
function showDiffRoot(): void {
    const loading = document.getElementById('diff-loading');
    if (loading) { loading.hidden = true; }
    const root = document.getElementById('diff-root');
    if (root) { root.hidden = false; }
}

/** Update the loading card from a host `diffProgress` message (indeterminate bar; progress lives in the text). */
export function applyDiffProgress(message: DiffProgressMessage): void {
    const text = document.querySelector<HTMLElement>('#diff-loading .loading-text');
    if (text) { text.textContent = `Loading ${message.stage} ${progressPercent(message)}%…`; }
}

function progressPercent(message: DiffProgressMessage): number {
    return message.total > 0
        ? Math.max(0, Math.min(100, Math.floor((message.completed / message.total) * 100)))
        : 0;
}

// ── Scroll sync ───────────────────────────────────────────────────

/** Re-slice the driver pane; mirror onto the follower only when sync is on. */
function syncFrom(driver: DiffPane, top: number, left: number): void {
    const driverScroll = activeDriverScroll(driver);
    if (!driverScroll) { return; }
    syncingScroll = true;
    try {
        applyDriverScroll(driver, driverScroll, top, left);
    } finally {
        syncingScroll = false;
    }
}

function activeDriverScroll(driver: DiffPane): ScrollPane | null {
    if (syncingScroll || !data) { return null; }
    return paneScroll(driver);
}

function applyDriverScroll(driver: DiffPane, driverScroll: ScrollPane, top: number, left: number): void {
    const logicalTop = physicalToLogicalScroll(top, driverScroll.state);
    driverScroll.state.scrollTop = logicalTop;
    lastDriver = driver;
    if (syncScroll) {
        mirrorFollowerState(driver, logicalTop);
        mirrorFollowerLeft(driver, left);
        startScrollPoll(driver);
    }
    scheduleRender();
}

/** The follower's logical window tracks the driver every frame; its native position waits for reconcile. */
function mirrorFollowerState(driver: DiffPane, logicalTop: number): void {
    const scroll = paneScroll(followerOf(driver));
    if (scroll) { scroll.state.scrollTop = logicalTop; }
}

function mirrorFollowerLeft(driver: DiffPane, left: number): void {
    diffView.setScrollLeft(followerOf(driver), left);
}

// ── Driver poll (live scrollTop per frame) ────────────────────────
// The driver's native scrollTop is animated by the compositor and `scroll` events
// are coalesced, so the follower is driven from a per-frame read instead.

function startScrollPoll(driver: DiffPane): void {
    if (!syncScroll || scrollPollHandle !== null) { return; }
    pollDriver = driver;
    stableFrames = 0;
    lastPolledTop = paneScroll(driver)?.container.scrollTop ?? 0;
    scrollPollHandle = requestFrame(pollFrame);
}

function pollFrame(): void {
    scrollPollHandle = null;
    const driver = pollDriver;
    if (driver === null) { stopScrollPoll(); return; }
    const scroll = paneScroll(driver);
    if (!scroll) { stopScrollPoll(); return; }
    if (reachedSettle(scroll)) { finalizeFollower(driver); return; }
    drivePollState(driver);
    renderScrollSlice();
    scrollPollHandle = requestFrame(pollFrame);
}

/** Record this frame's driver position; true once it has held for `SETTLE_FRAMES` frames. */
function reachedSettle(scroll: ScrollPane): boolean {
    const physicalTop = scroll.container.scrollTop;
    stableFrames = physicalTop === lastPolledTop ? stableFrames + 1 : 0;
    lastPolledTop = physicalTop;
    return stableFrames >= SETTLE_FRAMES;
}

function drivePollState(driver: DiffPane): void {
    const scroll = paneScroll(driver);
    if (!scroll) { return; }
    const logicalTop = physicalToLogicalScroll(scroll.container.scrollTop, scroll.state);
    scroll.state.scrollTop = logicalTop;
    lastDriver = driver;
    if (syncScroll) { mirrorFollowerState(driver, logicalTop); }
}

/** Settle: stop the poll, then reconcile the follower's real scrollTop and transform. */
function finalizeFollower(driver: DiffPane): void {
    stopScrollPoll();
    drivePollState(driver);
    renderScrollSlice();
}

function stopScrollPoll(): void {
    if (scrollPollHandle !== null) { cancelFrame(scrollPollHandle); }
    scrollPollHandle = null;
    pollDriver = null;
    stableFrames = 0;
}

/** Coalesce scroll-driven re-renders to one per animation frame (the poll owns frames while alive). */
function scheduleRender(): void {
    if (scrollPollHandle !== null || renderHandle !== null) { return; }
    renderHandle = requestFrame(() => {
        renderHandle = null;
        renderScrollSlice();
    });
}

function requestFrame(callback: () => void): number {
    return typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame(callback)
        : (setTimeout(callback, 16) as unknown as number);
}

function cancelPendingRender(): void {
    if (renderHandle === null) { return; }
    cancelFrame(renderHandle);
    renderHandle = null;
}

function cancelFrame(handle: number): void {
    if (typeof cancelAnimationFrame === 'function') { cancelAnimationFrame(handle); return; }
    clearTimeout(handle);
}

/** Test seam: complete any pending scroll frame synchronously, poll included. */
export function flushDiffRender(): void {
    cancelPendingRender();
    finalizeFollower(lastDriver);
}

// ── Render input building ─────────────────────────────────────────

function buildInput(
    side: DiffPane,
    start: number,
    end: number,
    layout: VirtualScrollLayout,
    windowTop: number,
    topSpacer: number,
    bottomSpacer: number,
): HexViewRenderInput {
    const sideData = side === 'a' ? data!.a : data!.b;
    const rows: HexViewRow[] = [];
    for (let i = start; i < end && i < visibleRows.length; i++) {
        rows.push(toHexRow(visibleRows[i], side, sideData));
    }
    return {
        rows,
        topSpacer,
        bottomSpacer,
        compressed: layout.isCompressed,
        containerHeight: layout.physicalHeight,
        windowTop,
        matchSet,
        selection,
        activeMatch,
        showAscii: false,
    };
}

function toHexRow(row: DiffRow, side: DiffPane, sideData: DiffSideData): HexViewRow {
    if (row.kind === 'gap') {
        return { address: row.address, kind: 'gap', cells: [], gap: row.gap };
    }
    return { address: row.address, kind: 'data', cells: buildCells(row.address, side, sideData) };
}

function buildCells(base: number, side: DiffPane, sideData: DiffSideData): HexViewCell[] {
    return buildHexCells(base, BYTES_PER_ROW, addr => getSideByte(sideData, addr), addr => diffDecoration(side, addr));
}

function diffDecoration(side: DiffPane, addr: number): CellDecoration {
    const diffCls = diffClassForSide(side, diffKindAt(data!.diff.runs, addr));
    return { hexCls: diffCls, charCls: diffCls };
}

// ── Virtual-scroll metrics ────────────────────────────────────────

function rowMetrics(): { rowHeight: number; gapHeight: number } {
    const fontSize = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--vscode-editor-font-size'));
    if (Number.isFinite(fontSize) && fontSize > 0) {
        const rowHeight = fontSize * 1.6;
        return { rowHeight, gapHeight: rowHeight * 1.5 + 4 };
    }
    return { rowHeight: FALLBACK_ROW_HEIGHT, gapHeight: FALLBACK_GAP_HEIGHT };
}

interface ScrollStateSeed {
    version: string;
    rowCount: number;
    rowHeight: number;
    gapHeight: number;
}

function ensureScrollState(pane: DiffPane, scrollEl: HTMLElement): VirtualScrollState {
    const { rowHeight, gapHeight } = rowMetrics();
    const version = `${rowHeight.toFixed(3)}:${gapHeight.toFixed(3)}`;
    const rowCount = visibleRows.length;
    const current = paneScroll(pane);
    if (current && isCurrentScrollState(current, scrollEl, version, rowCount)) { return current.state; }

    const state = createScrollState(scrollEl, current, { version, rowCount, rowHeight, gapHeight });
    setPaneScroll(pane, { state, container: scrollEl });
    return state;
}

function createScrollState(scrollEl: HTMLElement, current: ScrollPane | null, seed: ScrollStateSeed): VirtualScrollState {
    return {
        containerHeight: scrollEl.clientHeight,
        scrollTop: carriedLogicalTop(scrollEl, current),
        bufferSize: overscanRowCount(scrollEl.clientHeight, seed.rowHeight, BUFFER_SIZE),
        visibleRowIndices: [0, 0],
        rowCount: seed.rowCount,
        heightVersion: seed.version,
        getRowHeight: index => visibleRows[index]?.kind === 'gap' ? seed.gapHeight : seed.rowHeight,
    };
}

/** Preserve the logical position across a state rebuild for the same container. */
function carriedLogicalTop(scrollEl: HTMLElement, current: ScrollPane | null): number {
    if (!current || current.container !== scrollEl) { return scrollEl.scrollTop; }
    return physicalToLogicalScroll(scrollEl.scrollTop, current.state);
}

function isCurrentScrollState(current: ScrollPane, scrollEl: HTMLElement, version: string, rowCount: number): boolean {
    if (current.container !== scrollEl) { return false; }
    return [
        current.state.heightVersion === version,
        current.state.rowCount === rowCount,
        current.state.containerHeight === scrollEl.clientHeight,
    ].every(Boolean);
}

function findRowIndexForAddress(addr: number): number {
    const base = addr - (addr % BYTES_PER_ROW);
    for (let i = 0; i < visibleRows.length; i++) {
        const row = visibleRows[i];
        if (row.kind === 'data' && row.address === base) { return i; }
    }
    return -1;
}

// ── DOM lookup ────────────────────────────────────────────────────

function scrollContainer(pane: DiffPane): HTMLElement | null {
    const rootId = pane === 'a' ? 'diff-a' : 'diff-b';
    return document.getElementById(rootId)?.querySelector<HTMLElement>('.mem-scroll') ?? null;
}
