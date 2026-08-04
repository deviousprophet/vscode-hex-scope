// ── Memory hex grid (host side of the HexView component) ─────────
// Owns the virtualization slice, scroll math, render-input building,
// and host-invoked paint/scroll actions for the hex grid. The HexView
// component renders markup + transient interaction; all data/state
// (S.memRows, labels, selection, matches, edits) stays here.

import { S, BPR } from '../state';
import { getByte, integrityHighlightClass } from './memoryData';
import { currentSelectionRange } from './selection';
import { esc, byteClass, lowerBound } from '../utils';
import {
    calcScrollLayout,
    calcRowOffset,
    calcTotalHeight,
    calcVisibleRange,
    logicalToPhysicalScroll,
    physicalToLogicalScroll,
    type VirtualScrollLayout,
    type VirtualScrollState,
} from '../render/virtualScroll';
import {
    HexView,
    renderHexViewHeader,
    renderHexViewHtml,
    type HexViewCallbacks,
    type HexViewCell,
    type HexViewRange,
    type HexViewRenderInput,
    type HexViewRow,
} from '../components/HexView/HexView';
import type { MemRow, SegmentLabel } from '../../core/types';

const VIRTUAL_SCROLL_CONFIG = {
    fallbackRowHeight: 20.8,  // CSS fallback: 13px * 1.6
    fallbackGapHeight: 35.2,  // CSS fallback: row * 1.5 + 2px vertical margins
    bufferSize: 10,           // render 10 rows above/below viewport
};

let hexView: HexView | null = null;
let vscrollState: VirtualScrollState | null = null;
let vscrollContainer: HTMLElement | null = null;
let vscrollRenderedRange: [number, number] = [0, 0];
let injectedHeaderAscii: boolean | null = null;
let showAscii = true;

// ── Host-facing actions ───────────────────────────────────────────

export function mountHexView(hostCallbacks: HexViewCallbacks): void {
    const callbacks: HexViewCallbacks = {
        ...hostCallbacks,
        onVisibleWindowChange: scrollTop => refreshMemoryScrollPosition(scrollTop),
    };
    if (!hexView) {
        hexView = new HexView('#memory-view', callbacks);
        hexView.mount();
    } else {
        hexView.setCallbacks(callbacks);
    }
}

/** Toggle state is host-owned; the grid honors it via the render input. */
export function setShowAscii(value: boolean): void {
    if (showAscii === value) { return; }
    showAscii = value;
    injectedHeaderAscii = null;
    memRerender();
}

export function getShowAscii(): boolean {
    return showAscii;
}

/** Full memory-grid render (header + rows). */
export function memRerender(): void {
    injectMemoryHeader();
    const container = document.getElementById('mem-rows');
    if (!container) { return; }
    if (S.memRows.length === 0) {
        container.innerHTML = renderHexViewHtml(emptyRenderInput());
        return;
    }
    const scrollContainer = document.getElementById('mem-scroll');
    if (!scrollContainer) { return; }
    initializeMemoryScrollState(scrollContainer);
    renderMemoryGrid(scrollContainer);
}

/** Scroll so `addr` is visible (precise virtual-scroll position; reveal when uncompressed). */
export function scrollTo(addr: number): void {
    const row = addr - (addr % BPR);
    if (!hexView) { return; }
    if (!vscrollState) {
        hexView.scrollTo(row);
        return;
    }
    const rowIndex = findRowIndex(row);
    if (rowIndex < 0) { return; }
    const layout = setVirtualScrollPosition(rowIndex);
    renderMemoryGrid(document.getElementById('mem-scroll')!);
    revealIfUncompressed(layout, row);
}

function revealIfUncompressed(layout: VirtualScrollLayout, row: number): void {
    if (layout.isCompressed || !hexView) { return; }
    hexView.scrollTo(row);
}

export function paintMemorySelection(): void {
    hexView?.paintSelection(currentSelectionRange());
}

export function paintMemoryMatchHighlights(): void {
    hexView?.paintMatch(S.matchAddrs, S.matchIdx, getNeedleLen() ?? 0);
}

export function paintCell(addr: number, previewText: string | null): void {
    hexView?.paintCell(addr, previewText);
}

/** Called after a full page render (DOM recreated): forces header re-injection. */
export function invalidateGridRender(): void {
    injectedHeaderAscii = null;
}

// ── Render input building ─────────────────────────────────────────

function emptyRenderInput(): HexViewRenderInput {
    return {
        rows: [],
        topSpacer: 0,
        bottomSpacer: 0,
        compressed: false,
        containerHeight: 0,
        windowTop: 0,
        matchSet: new Set(),
        selection: null,
        activeMatch: null,
        showAscii,
    };
}

function renderMemoryGrid(scrollContainer: HTMLElement): void {
    syncVirtualScrollMetrics(scrollContainer);
    const state = vscrollState!;
    const layout = calcScrollLayout(state);
    const [startIdx, endIdx] = calcVisibleRange(state);
    if (shouldSkipMemoryRender(layout.isCompressed, startIdx, endIdx)) { return; }
    vscrollRenderedRange = [startIdx, endIdx];
    const container = document.getElementById('mem-rows')!;
    applyMemoryContainerLayout(container, layout);
    container.innerHTML = renderHexViewHtml(buildHexViewInput(startIdx, endIdx, layout, state, scrollContainer));
}

function shouldSkipMemoryRender(compressed: boolean, startIdx: number, endIdx: number): boolean {
    return !compressed && startIdx === vscrollRenderedRange[0] && endIdx === vscrollRenderedRange[1];
}

function applyMemoryContainerLayout(container: HTMLElement, layout: VirtualScrollLayout): void {
    if (layout.isCompressed) {
        container.style.position = 'relative';
        container.style.height = `${layout.physicalHeight}px`;
        return;
    }
    container.style.position = '';
    container.style.height = '';
}

/** Pure clamp: keep the rendered slice inside the fixed physical-height container. */
export function clampWindowTop(windowTop: number, physicalHeight: number, sliceHeight: number): number {
    return Math.max(0, Math.min(windowTop, physicalHeight - sliceHeight));
}

function buildHexViewInput(
    startIdx: number,
    endIdx: number,
    layout: VirtualScrollLayout,
    state: VirtualScrollState,
    scrollContainer: HTMLElement,
): HexViewRenderInput {
    const labelMap = buildLabelMap();
    const visibleRows = buildVisibleRows(startIdx, endIdx, labelMap);
    const topSpacer = calcRowOffset(startIdx, state);
    const bottomSpacer = calcTotalHeight(state) - calcRowOffset(endIdx, state);
    const windowTop = scrollContainer.scrollTop + topSpacer - state.scrollTop;
    // Clamp so the rendered slice never overflows the fixed physical-height container:
    // near the bottom, the buffer rows below the viewport would push the wrapper past
    // physicalHeight, the scroll area grows, and the scroll handler fights the browser
    // clamp — visible as end-of-scroll shaking.
    const sliceHeight = calcRowOffset(endIdx, state) - calcRowOffset(startIdx, state);
    const clampedWindowTop = clampWindowTop(windowTop, layout.physicalHeight, sliceHeight);
    const matchPaint = buildVisibleMatchPaint(visibleRows.visibleMin, visibleRows.visibleMax);
    return {
        rows: visibleRows.rows,
        topSpacer,
        bottomSpacer,
        compressed: layout.isCompressed,
        containerHeight: layout.physicalHeight,
        windowTop: clampedWindowTop,
        matchSet: matchPaint.matchSet,
        selection: currentSelectionRange(),
        activeMatch: matchPaint.activeMatch,
        showAscii,
    };
}

function buildVisibleRows(
    startIdx: number,
    endIdx: number,
    labelMap: Map<number, SegmentLabel[]>,
): { rows: HexViewRow[]; visibleMin: number; visibleMax: number } {
    const rows: HexViewRow[] = [];
    let visibleMin = Number.MAX_SAFE_INTEGER;
    let visibleMax = Number.MIN_SAFE_INTEGER;
    for (let i = startIdx; i < endIdx && i < S.memRows.length; i++) {
        const row = memRowToHexRow(S.memRows[i], labelMap);
        [visibleMin, visibleMax] = extendVisibleRange(row, visibleMin, visibleMax);
        rows.push(row);
    }
    return { rows, visibleMin, visibleMax };
}

function extendVisibleRange(row: HexViewRow, visibleMin: number, visibleMax: number): [number, number] {
    if (row.kind !== 'data') { return [visibleMin, visibleMax]; }
    return [
        Math.min(visibleMin, row.address),
        Math.max(visibleMax, row.address + row.cells.length - 1),
    ];
}

function buildVisibleMatchPaint(visibleMin: number, visibleMax: number): { matchSet: Set<number>; activeMatch: HexViewRange | null } {
    const length = getNeedleLen();
    const matchSet = length && visibleMin <= visibleMax
        ? buildVisibleMatchSet(length, visibleMin, visibleMax)
        : new Set<number>();
    return { matchSet, activeMatch: buildActiveMatch(length) };
}

function buildVisibleMatchSet(length: number, visibleMin: number, visibleMax: number): Set<number> {
    const matchSet = new Set<number>();
    if (S.matchAddrs.length === 0) { return matchSet; }
    const firstRelevant = lowerBound(S.matchAddrs, visibleMin - (length - 1));
    for (let mi = firstRelevant; mi < S.matchAddrs.length; mi++) {
        const base = S.matchAddrs[mi];
        if (base > visibleMax) { break; }
        addMatchSpan(matchSet, base, length);
    }
    return matchSet;
}

function addMatchSpan(matchSet: Set<number>, base: number, length: number): void {
    for (let i = 0; i < length; i++) { matchSet.add(base + i); }
}

function buildActiveMatch(length: number | null): HexViewRange | null {
    if (!length || S.matchIdx < 0 || S.matchIdx >= S.matchAddrs.length) { return null; }
    const base = S.matchAddrs[S.matchIdx];
    return { start: base, end: base + length - 1 };
}

// ── Row model building ────────────────────────────────────────────

function memRowToHexRow(row: MemRow, labelMap: Map<number, SegmentLabel[]>): HexViewRow {
    if (row.type === 'gap') {
        return {
            address: row.from,
            kind: 'gap',
            cells: [],
            gap: { from: row.from, to: row.to, bytes: row.bytes },
        };
    }
    return {
        address: row.address,
        kind: 'data',
        cells: buildRowCells(row.address),
        banners: (labelMap.get(row.address) ?? []).map(lbl => ({
            name: lbl.name,
            start: lbl.startAddress,
            length: lbl.length,
            color: lbl.color,
        })),
    };
}

function buildRowCells(base: number): HexViewCell[] {
    const cells: HexViewCell[] = [];
    for (let col = 0; col < BPR; col++) {
        const addr = base + col;
        const val = getByte(addr);
        cells.push(val === undefined ? emptyCell() : dataCell(addr, val));
    }
    return cells;
}

function emptyCell(): HexViewCell {
    return { hex: ' ', char: ' ', cls: 'be' };
}

function dataCell(addr: number, val: number): HexViewCell {
    const dirty = S.edits.has(addr) ? ' dirty' : '';
    const integrity = integrityHighlightClass(addr);
    const charCls = charCellClass(val) + (S.editMode && !isPrintableMemoryByte(val) ? ' edit-placeholder' : '');
    return {
        hex: val.toString(16).toUpperCase().padStart(2, '0'),
        char: charCellText(val),
        cls: byteClass(val) + dirty + integrity,
        charCls: charCls + dirty + integrity,
        val,
    };
}

function isPrintableMemoryByte(val: number): boolean {
    return val >= 0x20 && val < 0x7F;
}

function charCellClass(val: number): string {
    return isPrintableMemoryByte(val) ? 'cp' : 'cd';
}

function charCellText(val: number): string {
    if (isPrintableMemoryByte(val)) { return esc(String.fromCharCode(val)); }
    return S.editMode ? '·' : '';
}

function buildLabelMap(): Map<number, SegmentLabel[]> {
    const m = new Map<number, SegmentLabel[]>();
    for (const lbl of S.labels) {
        if (lbl.hidden) { continue; }
        const ra = lbl.startAddress - (lbl.startAddress % BPR);
        m.set(ra, [...(m.get(ra) ?? []), lbl]);
    }
    return m;
}

// ── Virtual-scroll metrics ────────────────────────────────────────

function parsePx(value: string | null | undefined): number | null {
    if (!value) { return null; }
    const n = parseFloat(value.trim());
    return Number.isFinite(n) && n > 0 ? n : null;
}

function measureCssHeight(scrollContainer: HTMLElement, cssHeight: string, fallback: number): number {
    const probe = document.createElement('div');
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    probe.style.pointerEvents = 'none';
    probe.style.height = cssHeight;
    probe.style.width = '0';
    probe.style.margin = '0';
    probe.style.padding = '0';
    probe.style.border = '0';
    scrollContainer.appendChild(probe);
    const height = parsePx(getComputedStyle(probe).height) ?? probe.getBoundingClientRect().height;
    probe.remove();
    return height > 0 ? height : fallback;
}

function getVirtualScrollMetrics(scrollContainer: HTMLElement): { rowHeight: number; gapHeight: number } {
    const rootStyle = getComputedStyle(document.documentElement);
    const editorFontSize = parsePx(rootStyle.getPropertyValue('--vscode-editor-font-size'));

    if (editorFontSize !== null) {
        const rowHeight = editorFontSize * 1.6;
        return {
            rowHeight,
            gapHeight: rowHeight * 1.5 + 4,
        };
    }

    const rowHeight = measureCssHeight(scrollContainer, 'var(--cell-size)', VIRTUAL_SCROLL_CONFIG.fallbackRowHeight);
    const gapBoxHeight = measureCssHeight(scrollContainer, 'calc(var(--cell-size) * 1.5)', rowHeight * 1.5);
    return {
        rowHeight,
        gapHeight: gapBoxHeight + 4,
    };
}

function virtualScrollHeightVersion(rowHeight: number, gapHeight: number): string {
    return `${rowHeight.toFixed(3)}:${gapHeight.toFixed(3)}`;
}

function memoryRowHeight(rowIndex: number, rowHeight: number, gapHeight: number): number {
    return S.memRows[rowIndex]?.type === 'gap' ? gapHeight : rowHeight;
}

function memoryRowHeightGetter(rowHeight: number, gapHeight: number): (rowIndex: number) => number {
    return rowIndex => memoryRowHeight(rowIndex, rowHeight, gapHeight);
}

function syncVirtualScrollMetrics(scrollContainer: HTMLElement): void {
    if (!vscrollState) { return; }
    const { rowHeight, gapHeight } = getVirtualScrollMetrics(scrollContainer);
    const containerHeight = scrollContainer.clientHeight;
    const heightVersion = virtualScrollHeightVersion(rowHeight, gapHeight);
    const unchanged = [
        vscrollState.heightVersion === heightVersion,
        vscrollState.containerHeight === containerHeight,
        vscrollState.rowCount === S.memRows.length,
    ].every(Boolean);
    if (unchanged) { return; }

    vscrollState.containerHeight = containerHeight;
    vscrollState.rowCount = S.memRows.length;
    vscrollState.heightVersion = heightVersion;
    vscrollState.getRowHeight = memoryRowHeightGetter(rowHeight, gapHeight);
    vscrollRenderedRange = [-1, -1];
}

function initializeMemoryScrollState(scrollContainer: HTMLElement): void {
    const { rowHeight, gapHeight } = getVirtualScrollMetrics(scrollContainer);
    const logicalScrollTop = vscrollState && vscrollContainer === scrollContainer
        ? physicalToLogicalScroll(scrollContainer.scrollTop, vscrollState)
        : scrollContainer.scrollTop;
    vscrollState = {
        containerHeight: scrollContainer.clientHeight,
        scrollTop: logicalScrollTop,
        bufferSize: VIRTUAL_SCROLL_CONFIG.bufferSize,
        visibleRowIndices: [0, 0],
        rowCount: S.memRows.length,
        heightVersion: virtualScrollHeightVersion(rowHeight, gapHeight),
        getRowHeight: memoryRowHeightGetter(rowHeight, gapHeight),
    };
    vscrollContainer = scrollContainer;
    const layout = calcScrollLayout(vscrollState);
    vscrollState.scrollTop = Math.min(vscrollState.scrollTop, layout.logicalScrollable);
    applyGridScrollTop(logicalToPhysicalScroll(vscrollState.scrollTop, vscrollState));
    vscrollRenderedRange = [-1, -1];
}

function applyGridScrollTop(top: number): void {
    if (hexView) {
        hexView.setScrollTop(top);
        return;
    }
    const el = document.getElementById('mem-scroll');
    if (el) { el.scrollTop = top; }
}

// ── Scroll / slice lifecycle ──────────────────────────────────────

function refreshMemoryScrollPosition(scrollTop: number): void {
    if (!vscrollState) { return; }
    vscrollState.scrollTop = physicalToLogicalScroll(scrollTop, vscrollState);
    const scrollContainer = document.getElementById('mem-scroll');
    if (scrollContainer) { renderMemoryGrid(scrollContainer); }
}

function findRowIndex(rowBase: number): number {
    for (let i = 0; i < S.memRows.length; i++) {
        const row = S.memRows[i];
        if (row.type === 'data' && row.address === rowBase) {
            return i;
        }
    }
    return -1;
}

function setVirtualScrollPosition(rowIndex: number): VirtualScrollLayout {
    const state = vscrollState!;
    syncVirtualScrollMetrics(document.getElementById('mem-scroll')!);
    const desiredTop = Math.max(0, calcRowOffset(rowIndex, state) - state.getRowHeight(rowIndex) * 2);
    const layout = calcScrollLayout(state);
    const targetTop = Math.min(desiredTop, layout.logicalScrollable);
    applyGridScrollTop(logicalToPhysicalScroll(targetTop, state));
    // Keep virtual state aligned with the scroll position the browser accepted.
    // Browsers clamp scrollTop when content fits or the target is near the end.
    state.scrollTop = physicalToLogicalScroll(getGridScrollTop(), state);
    return layout;
}

function getGridScrollTop(): number {
    if (hexView) { return hexView.getScrollTop(); }
    return document.getElementById('mem-scroll')?.scrollTop ?? 0;
}

// ── Header injection ──────────────────────────────────────────────

function injectMemoryHeader(): void {
    if (injectedHeaderAscii === showAscii) { return; }
    injectedHeaderAscii = showAscii;
    const header = document.getElementById('mem-header');
    if (header) {
        const headerHtml = renderHexViewHeader(showAscii);
        header.innerHTML = headerHtml;
    }
}

// ── Search needle length (host-side) ─────────────────────────────

type NeedleLenReader = (query: string) => number | null;

const NEEDLE_LEN_BY_MODE: Record<typeof S.searchMode, NeedleLenReader> = {
    addr: () => 1,
    bytes: bytesNeedleLen,
    value: valueNeedleLen,
    ascii: asciiNeedleLen,
};

function getNeedleLen(): number | null {
    const input = document.getElementById('search-input') as HTMLInputElement | null;
    const q = input?.value ?? '';
    if (!q.trim()) { return null; }
    return NEEDLE_LEN_BY_MODE[S.searchMode](q);
}

function bytesNeedleLen(query: string): number | null {
    const tokens = query.replace(/\s/g, '').match(/.{1,2}/g) ?? [];
    const n = tokens.filter(t => !isNaN(parseInt(t, 16))).length;
    return n || null;
}

function valueNeedleLen(query: string): number | null {
    const raw = query.trim().replace(/_/g, '');
    if (/^0x[0-9a-fA-F]+$/.test(raw)) {
        return Math.max(1, Math.ceil(raw.slice(2).length / 2));
    }
    if (!/^\d+$/.test(raw)) { return null; }
    try {
        return decimalValueNeedleLen(BigInt(raw));
    } catch {
        return null;
    }
}

function decimalValueNeedleLen(value: bigint): number | null {
    if (value < 0n) { return null; }
    return Math.min(8, Math.ceil(value.toString(16).length / 2));
}

function asciiNeedleLen(query: string): number | null {
    return new TextEncoder().encode(query).length || null;
}
