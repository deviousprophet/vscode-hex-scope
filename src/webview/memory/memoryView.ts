//  Memory View
// Renders the hex-grid memory view through the shared HexViewComponent.
// Host owns virtual scroll (slice + position), cell-state mapping, selection
// state (S.selStart/S.selEnd), and the match set; the component owns markup,
// CSS, and transient hover/column interaction. Mirrors the diff host
// (diff/diffView.ts): host -> virtualScroll (slice + position) -> component.

import { S, BPR } from '../state';
import { getByte } from '../memory/memoryData';
import { byteClass } from '../utils';
import {
    calcScrollLayout,
    calcVisibleRange,
    calcRowOffset,
    calcCompressedWindowTop,
    logicalToPhysicalScroll,
    physicalToLogicalScroll,
    type VirtualScrollLayout,
    type VirtualScrollState,
} from '../render/virtualScroll';
import {
    HexViewComponent,
    renderHexViewComponentHtml,
    type HexViewCell,
    type HexViewRange,
    type HexViewRow,
} from '../ui-components/hex-view/hexViewComponent';

//  Virtual scroll state 
let vscrollState: VirtualScrollState | null = null;
let vscrollContainer: HTMLElement | null = null;

/** Rendered data-row height; must match the component ROW_HEIGHT + `.diff-row` css. */
const ROW_HEIGHT = 22;
/** Rendered segment-banner height; must match `.seg-banner` css. */
const BANNER_HEIGHT = 18;
const VIRTUAL_SCROLL_CONFIG = {
    bufferSize: 10,           // render 10 rows above/below viewport
    fallbackRowHeight: 20.8,  // CSS fallback: 13px * 1.6
};

type HexCellHandler = (e: MouseEvent, el: HTMLElement) => void;
interface MemoryScrollElement extends HTMLElement {
    _hexDownCallback?: HexCellHandler;
    _hexCtxCallback?: HexCellHandler;
}
interface MemoryInteractionCallbacks {
    onHexDown?: HexCellHandler;
    onHexCtx?: HexCellHandler;
}

const comp = new HexViewComponent('a');

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

function getVirtualScrollMetrics(scrollContainer: HTMLElement): { gapHeight: number } {
    const rootStyle = getComputedStyle(document.documentElement);
    const editorFontSize = parsePx(rootStyle.getPropertyValue('--vscode-editor-font-size'));

    if (editorFontSize !== null) {
        return { gapHeight: editorFontSize * 1.6 * 1.5 };
    }

    const rowHeight = measureCssHeight(scrollContainer, 'var(--cell-size)', VIRTUAL_SCROLL_CONFIG.fallbackRowHeight);
    const gapHeight = measureCssHeight(scrollContainer, 'calc(var(--cell-size) * 1.5)', rowHeight * 1.5);
    return { gapHeight };
}

//  Labels (banners above data rows) 

let labelMap = new Map<number, typeof S.labels>();

function buildLabelMap(): void {
    const m = new Map<number, typeof S.labels>();
    for (const lbl of S.labels) {
        if (lbl.hidden) { continue; }
        const ra = lbl.startAddress - (lbl.startAddress % BPR);
        m.set(ra, [...(m.get(ra) ?? []), lbl]);
    }
    labelMap = m;
}

function labelSignature(): string {
    return S.labels.filter(l => !l.hidden).map(l => l.startAddress.toString(16)).join(',');
}

function memoryRowHeightGetter(gapHeight: number): (rowIndex: number) => number {
    return rowIndex => {
        const row = S.memRows[rowIndex];
        if (row?.type === 'gap') { return gapHeight; }
        return ROW_HEIGHT + (row && labelMap.has(row.address) ? BANNER_HEIGHT : 0);
    };
}

function virtualScrollHeightVersion(gapHeight: number): string {
    return `r${ROW_HEIGHT}:g${gapHeight.toFixed(3)}:b${BANNER_HEIGHT}:l${labelSignature()}`;
}

function syncVirtualScrollMetrics(scrollContainer: HTMLElement): void {
    if (!vscrollState) { return; }
    const { gapHeight } = getVirtualScrollMetrics(scrollContainer);
    const containerHeight = scrollContainer.clientHeight;
    const heightVersion = virtualScrollHeightVersion(gapHeight);
    if (vscrollState.heightVersion === heightVersion
        && vscrollState.containerHeight === containerHeight
        && vscrollState.rowCount === S.memRows.length) { return; }
    buildLabelMap();
    vscrollState.containerHeight = containerHeight;
    vscrollState.rowCount = S.memRows.length;
    vscrollState.heightVersion = heightVersion;
    vscrollState.getRowHeight = memoryRowHeightGetter(gapHeight);
}

//  Virtual scroll rendering 

function rowHeightsFor(startIdx: number, endIdx: number): number[] {
    const get = vscrollState!.getRowHeight;
    const heights: number[] = [];
    for (let i = startIdx; i < endIdx; i++) { heights.push(get(i)); }
    return heights;
}

function dataRowCells(base: number): HexViewCell[] {
    const cells: HexViewCell[] = [];
    for (let col = 0; col < BPR; col++) {
        cells.push(cellForByte(base + col, getByte(base + col)));
    }
    return cells;
}

function cellForByte(addr: number, val: number | undefined): HexViewCell {
    if (val === undefined) {
        return { hex: '  ', char: ' ', cls: 'be cd' };
    }
    const dirty = S.edits.has(addr) ? ' dirty' : '';
    const integrity = integrityHighlightClass(addr);
    const hexCls = `${byteClass(val)}${dirty}${integrity}`;
    const charCls = `${charCellClass(val)}${dirty}${integrity}`
        + (S.editMode && !isPrintableMemoryByte(val) ? ' edit-placeholder' : '');
    return {
        hex: val.toString(16).toUpperCase().padStart(2, '0'),
        char: charCellText(val),
        cls: `${hexCls} ${charCls}`,
    };
}

function isPrintableMemoryByte(val: number): boolean {
    return val >= 0x20 && val < 0x7F;
}

function charCellClass(val: number): string {
    return isPrintableMemoryByte(val) ? 'cp' : 'cd';
}

function charCellText(val: number): string {
    if (isPrintableMemoryByte(val)) { return String.fromCharCode(val); }
    return S.editMode ? '·' : '';
}
function buildHexRows(startIdx: number, endIdx: number): HexViewRow[] {
    const rows: HexViewRow[] = [];
    for (let i = startIdx; i < endIdx && i < S.memRows.length; i++) {
        const row = S.memRows[i];
        if (row.type === 'gap') {
            rows.push({ address: row.from, kind: 'gap', cells: [], gap: { from: row.from, to: row.to, bytes: row.bytes } });
            continue;
        }
        const banners = (labelMap.get(row.address) ?? []).map(lbl => ({
            name: lbl.name,
            start: lbl.startAddress,
            length: lbl.length,
            color: lbl.color,
        }));
        rows.push({ address: row.address, kind: 'data', cells: dataRowCells(row.address), banners });
    }
    return rows;
}

export function integrityHighlightClass(address: number): string {
    const highlight = S.integrityHighlight;
    if (!highlight) { return ''; }
    if (isStoredIntegrityAddress(highlight, address)) { return ` integrity-stored-${highlight.status}`; }
    if (isIntegrityRangeAddress(highlight, address)) { return ' integrity-range'; }
    return '';
}

type IntegrityHighlight = NonNullable<typeof S.integrityHighlight>;

function isStoredIntegrityAddress(highlight: IntegrityHighlight, address: number): boolean {
    if (highlight.storedStart === undefined) { return false; }
    if (highlight.storedLength === undefined) { return false; }
    return address >= highlight.storedStart && address < highlight.storedStart + highlight.storedLength;
}

function isIntegrityRangeAddress(highlight: IntegrityHighlight, address: number): boolean {
    return address >= highlight.rangeStart && address <= highlight.rangeEnd;
}

//  Selection + match (painted through the render input) 

function selectionFromState(): HexViewRange | null {
    return S.selStart !== null && S.selEnd !== null ? { start: S.selStart, end: S.selEnd } : null;
}

function buildMatchSet(): Set<number> {
    const set = new Set<number>();
    if (S.matchAddrs.length === 0) { return set; }
    const nLen = getNeedleLen();
    if (!nLen) { return set; }
    for (const base of S.matchAddrs) {
        for (let i = 0; i < nLen; i++) { set.add(base + i); }
    }
    return set;
}

function searchRowIndex(): number {
    if (S.matchIdx < 0 || S.matchIdx >= S.matchAddrs.length) { return -1; }
    return findContainingRowIndex(S.matchAddrs[S.matchIdx]);
}

function findContainingRowIndex(addr: number): number {
    for (let i = 0; i < S.memRows.length; i++) {
        const row = S.memRows[i];
        if (row.type === 'data' && addr >= row.address && addr < row.address + BPR) { return i; }
    }
    return -1;
}

function renderVisibleRows(): void {
    if (!vscrollState) { return; }

    const container = document.getElementById('mem-rows')!;
    const scrollContainer = document.getElementById('mem-scroll') as MemoryScrollElement;
    syncVirtualScrollMetrics(scrollContainer);

    const [startIdx, endIdx] = calcVisibleRange(vscrollState);
    const layout = calcScrollLayout(vscrollState);
    const rows = buildHexRows(startIdx, endIdx);
    const windowTop = layout.isCompressed
        ? calcCompressedWindowTop(startIdx, vscrollState, layout)
        : calcRowOffset(startIdx, vscrollState);

    container.innerHTML = renderHexViewComponentHtml('a', {
        label: '',
        rows,
        rowOffset: startIdx,
        searchRowIndex: searchRowIndex(),
        matchSet: buildMatchSet(),
        error: null,
        totalHeight: layout.physicalHeight,
        selection: selectionFromState(),
        showChar: true,
        windowTop,
        rowHeights: rowHeightsFor(startIdx, endIdx),
    });

    attachMemoryCellHandlers(container, getMemoryInteractionCallbacks(scrollContainer));
    comp.reapply();
}

function getMemoryInteractionCallbacks(scrollContainer: MemoryScrollElement): MemoryInteractionCallbacks {
    return {
        onHexDown: scrollContainer._hexDownCallback,
        onHexCtx: scrollContainer._hexCtxCallback,
    };
}

function storeMemoryInteractionCallbacks(
    scrollContainer: MemoryScrollElement,
    onHexDown: HexCellHandler,
    onHexCtx: HexCellHandler,
): void {
    scrollContainer._hexDownCallback = onHexDown;
    scrollContainer._hexCtxCallback = onHexCtx;
}

function attachMemoryCellHandlers(container: HTMLElement, callbacks: MemoryInteractionCallbacks): void {
    if (!callbacks.onHexDown && !callbacks.onHexCtx) { return; }
    attachMemoryCellHandlersForSelector(container, '.data-cell[data-addr]', callbacks);
    attachMemoryCellHandlersForSelector(container, '.char-cell[data-addr]', callbacks);
}

function attachMemoryCellHandlersForSelector(
    container: HTMLElement,
    selector: string,
    callbacks: MemoryInteractionCallbacks,
): void {
    container.querySelectorAll<HTMLElement>(selector).forEach(el => attachMemoryCellHandler(el, callbacks));
}

function attachMemoryCellHandler(el: HTMLElement, callbacks: MemoryInteractionCallbacks): void {
    if (callbacks.onHexDown) {
        el.addEventListener('mousedown', e => callbacks.onHexDown?.(e as MouseEvent, el));
    }
    if (callbacks.onHexCtx) {
        el.addEventListener('contextmenu', e => {
            callbacks.onHexCtx?.(e as MouseEvent, el);
            e.preventDefault();
        });
    }
}

function initializeMemoryScrollState(scrollContainer: MemoryScrollElement): void {
    buildLabelMap();
    const { gapHeight } = getVirtualScrollMetrics(scrollContainer);
    const logicalScrollTop = vscrollState && vscrollContainer === scrollContainer
        ? physicalToLogicalScroll(scrollContainer.scrollTop, vscrollState)
        : scrollContainer.scrollTop;
    vscrollState = {
        containerHeight: scrollContainer.clientHeight,
        scrollTop: logicalScrollTop,
        bufferSize: VIRTUAL_SCROLL_CONFIG.bufferSize,
        visibleRowIndices: [0, 0],
        rowCount: S.memRows.length,
        heightVersion: virtualScrollHeightVersion(gapHeight),
        getRowHeight: memoryRowHeightGetter(gapHeight),
    };
    vscrollContainer = scrollContainer;
    const layout = calcScrollLayout(vscrollState);
    vscrollState.scrollTop = Math.min(vscrollState.scrollTop, layout.logicalScrollable);
    scrollContainer.scrollTop = logicalToPhysicalScroll(vscrollState.scrollTop, vscrollState);
}

function initializeMemoryScrollListeners(scrollContainer: MemoryScrollElement): void {
    if (scrollContainer.dataset.vscrollInit) { return; }
    scrollContainer.dataset.vscrollInit = '1';
    scrollContainer.addEventListener('scroll', () => refreshMemoryScrollPosition(scrollContainer));
    window.addEventListener('resize', () => refreshMemoryScrollPosition(scrollContainer));
}

function refreshMemoryScrollPosition(scrollContainer: MemoryScrollElement): void {
    if (!vscrollState) { return; }
    vscrollState.scrollTop = physicalToLogicalScroll(scrollContainer.scrollTop, vscrollState);
    renderVisibleRows();
}

//  Memory body

export function renderMemBody(
    onHexDown: (e: MouseEvent, el: HTMLElement) => void,
    onHexCtx:  (e: MouseEvent, el: HTMLElement) => void,
): void {
    const container = document.getElementById('mem-rows')!;

    if (S.memRows.length === 0) {
        container.innerHTML = `<div style="padding:30px 20px;color:var(--non-graphic);font-size:12px">No data records found.</div>`;
        return;
    }

    const scrollContainer = document.getElementById('mem-scroll') as MemoryScrollElement;
    initializeMemoryScrollState(scrollContainer);
    storeMemoryInteractionCallbacks(scrollContainer, onHexDown, onHexCtx);
    renderVisibleRows();
    initializeMemoryScrollListeners(scrollContainer);
    comp.mount();
}

//  Selection + match triggers (re-render: the component paints from the input)

export function applySel(): void {
    renderVisibleRows();
}

export function applyMatchHighlights(): void {
    renderVisibleRows();
}

//  Scroll

function scrollRenderedRow(row: number): void {
    const ah = row.toString(16).toUpperCase().padStart(8, '0');
    const el = document.querySelector<HTMLElement>(`.diff-row[data-addr="${ah}"]`);
    if (!el) { return; }
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function setVirtualScrollPosition(scrollContainer: HTMLElement, rowIndex: number): VirtualScrollLayout {
    const state = vscrollState!;
    syncVirtualScrollMetrics(scrollContainer);
    const desiredTop = Math.max(0, calcRowOffset(rowIndex, state) - state.getRowHeight(rowIndex) * 2);
    const layout = calcScrollLayout(state);
    const targetTop = Math.min(desiredTop, layout.logicalScrollable);
    scrollContainer.scrollTop = logicalToPhysicalScroll(targetTop, state);
    // Keep virtual state aligned with the scroll position the browser accepted.
    // Browsers clamp scrollTop when content fits or the target is near the end.
    state.scrollTop = physicalToLogicalScroll(scrollContainer.scrollTop, state);
    return layout;
}

function scrollRenderedRowWhenUncompressed(row: number, layout: VirtualScrollLayout): void {
    if (layout.isCompressed) { return; }
    scrollRenderedRow(row);
}

export function scrollTo(addr: number): void {
    const row = addr - (addr % BPR);
    const scrollContainer = document.getElementById('mem-scroll');
    if (!scrollContainer) { return; }

    if (!vscrollState) {
        scrollRenderedRow(row);
        return;
    }

    const rowIndex = findRowIndex(row);
    if (rowIndex < 0) { return; }

    const layout = setVirtualScrollPosition(scrollContainer, rowIndex);
    renderVisibleRows();
    scrollRenderedRowWhenUncompressed(row, layout);
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

//  Match needle length (from the search input, as main) 

type NeedleLenReader = (query: string) => number | null;

const NEEDLE_LEN_BY_MODE: Record<typeof S.searchMode, NeedleLenReader> = {
    addr: () => 1,
    bytes: bytesNeedleLen,
    value: valueNeedleLen,
    ascii: asciiNeedleLen,
};

function getNeedleLen(): number | null {
    const q = (document.getElementById('search-input') as HTMLInputElement)?.value ?? '';
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
