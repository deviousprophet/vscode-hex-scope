import type { DiffModel } from '../../core/diff';
import { computeByteDiff } from '../../core/diff';
import type { MemorySegment } from '../../core/parser/types';
import { formatCopyCommand } from '../../core/byteTools/copyFormatters';
import { HexView, type HexViewCallbacks } from '../components/hexView/hexView';
import {
    BYTES_PER_ROW,
    renderHexViewHeader,
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
    physicalToLogicalScroll,
    type VirtualScrollLayout,
    type VirtualScrollState,
} from '../render/virtualScroll';
import { byteClass, esc } from '../utils';
import { buildDiffRows, diffClassForSide, diffKindAt, getSideByte, renderDiffErrorHtml, type DiffRow, type DiffSideData } from './diffModel';
import type { DiffProgressMessage } from './diffMessages';

export type DiffViewMode = 'all' | 'diff';
type DiffPane = 'a' | 'b';

const FALLBACK_ROW_HEIGHT = 20.8;
const FALLBACK_GAP_HEIGHT = 35.2;
const BUFFER_SIZE = 10;
const EMPTY_CELL: HexViewCell = { hex: ' ', char: ' ', cls: 'be' };

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
let viewA: HexView | null = null;
let viewB: HexView | null = null;
let vscroll: VirtualScrollState | null = null;
let vscrollContainer: HTMLElement | null = null;
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

export function setDiffGridHooks(next: DiffGridHooks): void {
    hooks = next;
}

export function mountDiffGrid(): void {
    if (!viewA) {
        viewA = new HexView('#diff-a', callbacksFor('a'));
        viewA.mount();
    }
    if (!viewB) {
        viewB = new HexView('#diff-b', callbacksFor('b'));
        viewB.mount();
    }
}

function callbacksFor(side: DiffPane): HexViewCallbacks {
    return {
        onVisibleWindowChange: (top, left) => syncFrom(side, top, left),
        onCellClick: (addr, shift) => selectCell(side, addr, shift),
        onSelectionChange: range => setSelection(side, range),
        onAddressRowClick: (rowBase, shift) => selectRow(side, rowBase, shift),
        onAddressRowDrag: rows => selectRowRange(side, rows),
    };
}

/** Test seam: drop cached grid instances so a fresh document re-attaches listeners. */
export function resetDiffGrid(): void {
    data = null;
    visibleRows = [];
    viewA = null;
    viewB = null;
    vscroll = null;
    vscrollContainer = null;
    selection = null;
    selectionPane = 'a';
    selAnchor = null;
    matchSet = new Set();
    activeMatch = null;
    viewMode = 'all';
    syncScroll = true;
    syncingScroll = false;
    cancelPendingRender();
    lastRenderKey = null;
}

export function setDiffData(a: DiffSideData, b: DiffSideData, diff: DiffModel): void {
    data = { rows: buildDiffRows(a, b), a, b, diff };
    visibleRows = filterRows(data.rows);
    vscroll = null;
    vscrollContainer = null;
    selection = null;
    selectionPane = 'a';
    selAnchor = null;
    matchSet = new Set();
    activeMatch = null;
    viewMode = 'all';
    syncScroll = true;
    cancelPendingRender();
    lastRenderKey = null;
    clearDiffError();
    renderHeaders();
    renderDiffGrid();
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
    syncScroll = on;
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
    viewA?.paintSelection(selection);
    viewB?.paintSelection(selection);
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

/** Match-highlight width follows the executed needle span (parity with memoryGrid.addMatchSpan). */
function matchSetWithSpans(addrs: readonly number[], span: number): ReadonlySet<number> {
    const set = new Set<number>();
    for (const addr of addrs) {
        for (let i = 0; i < span; i++) { set.add(addr + i); }
    }
    return set;
}

// ── Render ────────────────────────────────────────────────────────

function renderDiffGrid(): void {
    const slice = currentSlice();
    if (!slice) { return; }
    lastRenderKey = sliceKey(slice);
    drawSlice(slice);
}

/** Scroll-driven render: coalesced to one frame and skipped when the visible slice is unchanged. */
function renderScrollSlice(): void {
    const slice = currentSlice();
    if (!slice) { return; }
    const key = sliceKey(slice);
    if (key === lastRenderKey) { return; }
    lastRenderKey = key;
    drawSlice(slice);
}

interface RenderSlice {
    ui: GridContainers;
    state: VirtualScrollState;
    start: number;
    end: number;
}

function currentSlice(): RenderSlice | null {
    const ui = gridContainers();
    if (!ui || !data) { return null; }
    const state = ensureScrollState(ui.scroll);
    const [start, end] = calcVisibleRange(state);
    return { ui, state, start, end };
}

function sliceKey({ state, start, end }: RenderSlice): string {
    // containerHeight is part of the scroll-state identity (`isCurrentScrollState`), so a
    // resize that keeps the row range must still re-apply the physical layout.
    return `${state.heightVersion}|${state.containerHeight}|${visibleRows.length}|${viewMode}|${syncScroll}|${start}|${end}`;
}

function emptyMessage(): string {
    return viewMode === 'diff' ? 'No differences' : 'No data records found.';
}

function renderEmptyGrid(ui: GridContainers, message: string): void {
    const emptyHtml = `<div class="diff-empty">${esc(message)}</div>`;
    ui.a.innerHTML = emptyHtml;
    ui.b.innerHTML = emptyHtml;
}

function drawSlice({ ui, state, start, end }: RenderSlice): void {
    if (visibleRows.length === 0) { renderEmptyGrid(ui, emptyMessage()); return; }
    const layout = calcScrollLayout(state);
    applyVirtualScrollLayout(ui.a, layout);
    applyVirtualScrollLayout(ui.b, layout);
    const topSpacer = calcRowOffset(start, state);
    const bottomSpacer = calcTotalHeight(state) - calcRowOffset(end, state);
    const sliceHeight = calcRowOffset(end, state) - calcRowOffset(start, state);
    const windowTop = clampWindowTop(ui.scroll.scrollTop + topSpacer - state.scrollTop, layout.physicalHeight, sliceHeight);
    ui.a.innerHTML = renderHexViewHtml(buildInput('a', start, end, layout, windowTop, topSpacer, bottomSpacer));
    ui.b.innerHTML = renderHexViewHtml(buildInput('b', start, end, layout, windowTop, topSpacer, bottomSpacer));
}

export function scrollToDiff(range: HexViewRange, options: { selection?: boolean } = {}): void {
    if (!data || !vscroll) { return; }
    const rowIndex = findRowIndexForAddress(range.start);
    if (rowIndex < 0) { return; }
    applySelectionOption(range, options);
    scrollToRow(rowIndex, vscroll);
}

function applySelectionOption(range: HexViewRange, options: { selection?: boolean }): void {
    if (options.selection !== false) { selection = range; }
}

function scrollToRow(rowIndex: number, state: VirtualScrollState): void {
    const desiredTop = Math.max(0, calcRowOffset(rowIndex, state) - state.getRowHeight(rowIndex) * 2);
    const top = Math.min(desiredTop, calcScrollLayout(state).logicalScrollable);
    state.scrollTop = top;
    const physicalTop = logicalToPhysicalScroll(top, state);
    viewA?.setScrollTop(physicalTop);
    viewB?.setScrollTop(physicalTop);
    renderDiffGrid();
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

const DIFF_STAGE_LABEL: Record<DiffProgressMessage['stage'], string> = {
    read: 'Reading files',
    parse: 'Parsing records',
    diff: 'Comparing bytes',
};

/** Update the loading card from a host `diffProgress` message. */
export function applyDiffProgress(message: DiffProgressMessage): void {
    const text = document.querySelector<HTMLElement>('#diff-loading .loading-text');
    if (text) { text.textContent = `${DIFF_STAGE_LABEL[message.stage]} ${progressPercent(message)}%`; }
    const fill = document.getElementById('diff-loading-fill');
    if (fill) { fill.style.width = `${progressPercent(message)}%`; }
}

function progressPercent(message: DiffProgressMessage): number {
    return message.total > 0
        ? Math.max(0, Math.min(100, Math.floor((message.completed / message.total) * 100)))
        : 0;
}

// ── Scroll sync ───────────────────────────────────────────────────

/** Re-slice the driver grid; mirror onto the follower only when sync is on. */
function syncFrom(driver: DiffPane, top: number, left: number): void {
    if (isSyncBlocked()) { return; }
    syncingScroll = true;
    try {
        vscroll!.scrollTop = physicalToLogicalScroll(top, vscroll!);
        scheduleRender();
        if (syncScroll) { mirrorToFollower(driver, top, left); }
    } finally {
        syncingScroll = false;
    }
}

function isSyncBlocked(): boolean {
    return syncingScroll || !data || !vscroll;
}

/** Coalesce scroll-driven re-renders to one per animation frame. */
function scheduleRender(): void {
    if (renderHandle !== null) { return; }
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

/** Test seam: render any pending scroll frame synchronously. */
export function flushDiffRender(): void {
    cancelPendingRender();
    renderScrollSlice();
}

function mirrorToFollower(driver: DiffPane, top: number, left: number): void {
    const follower = followerOf(driver);
    follower?.setScrollTop(top);
    follower?.setScrollLeft(left);
}

function followerOf(driver: DiffPane): HexView | null {
    return driver === 'a' ? viewB : viewA;
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
    const cells: HexViewCell[] = [];
    for (let col = 0; col < BYTES_PER_ROW; col++) {
        const addr = base + col;
        const val = getSideByte(sideData, addr);
        cells.push(val === undefined ? EMPTY_CELL : dataCell(val, side, addr));
    }
    return cells;
}

function dataCell(val: number, side: DiffPane, addr: number): HexViewCell {
    const printable = val >= 0x20 && val < 0x7F;
    const diffCls = diffClassForSide(side, diffKindAt(data!.diff.runs, addr));
    return {
        hex: val.toString(16).toUpperCase().padStart(2, '0'),
        char: printable ? esc(String.fromCharCode(val)) : '',
        cls: byteClass(val) + diffCls,
        charCls: (printable ? 'cp' : 'cd') + diffCls,
        val,
    };
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

function ensureScrollState(scrollEl: HTMLElement): VirtualScrollState {
    const { rowHeight, gapHeight } = rowMetrics();
    const version = `${rowHeight.toFixed(3)}:${gapHeight.toFixed(3)}`;
    const rowCount = visibleRows.length;
    if (isCurrentScrollState(scrollEl, version, rowCount)) { return vscroll!; }

    const logicalTop = vscroll && vscrollContainer === scrollEl
        ? physicalToLogicalScroll(scrollEl.scrollTop, vscroll)
        : scrollEl.scrollTop;
    vscroll = {
        containerHeight: scrollEl.clientHeight,
        scrollTop: logicalTop,
        bufferSize: BUFFER_SIZE,
        visibleRowIndices: [0, 0],
        rowCount,
        heightVersion: version,
        getRowHeight: index => visibleRows[index]?.kind === 'gap' ? gapHeight : rowHeight,
    };
    vscrollContainer = scrollEl;
    return vscroll;
}

function isCurrentScrollState(scrollEl: HTMLElement, version: string, rowCount: number): boolean {
    if (!vscroll || vscrollContainer !== scrollEl) { return false; }
    return [
        vscroll.heightVersion === version,
        vscroll.rowCount === rowCount,
        vscroll.containerHeight === scrollEl.clientHeight,
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

function renderHeaders(): void {
    const headerHtml = renderHexViewHeader(false);
    for (const id of ['diff-header-a', 'diff-header-b']) {
        const header = document.getElementById(id);
        if (header) { header.innerHTML = headerHtml; }
    }
}

interface GridContainers {
    a: HTMLElement;
    b: HTMLElement;
    scroll: HTMLElement;
}

function gridContainers(): GridContainers | null {
    const a = document.getElementById('diff-rows-a');
    const b = document.getElementById('diff-rows-b');
    const scroll = scrollContainerA();
    if (!a || !b || !scroll) { return null; }
    return { a, b, scroll };
}

function scrollContainerA(): HTMLElement | null {
    return document.getElementById('diff-a')?.querySelector<HTMLElement>('.mem-scroll') ?? null;
}
