//  Memory View 
// Renders the hex-grid memory view: column header, data rows, gap rows,
// and segment label banners. Uses virtual scrolling to efficiently handle
// large files by rendering only visible rows + a buffer.

import { S, BPR } from './state';
import { getByte } from './data';
import { esc, fmtB, byteClass } from './utils';
import {
    calcScrollLayout,
    calcVisibleRange,
    calcTotalHeight,
    calcRowOffset,
    logicalToPhysicalScroll,
    physicalToLogicalScroll,
    type VirtualScrollLayout,
    type VirtualScrollState,
} from './virtualScroll';

//  Virtual scroll state 
let vscrollState: VirtualScrollState | null = null;
let vscrollRenderedRange: [number, number] = [0, 0];
type HexCellHandler = (e: MouseEvent, el: HTMLElement) => void;
interface MemoryScrollElement extends HTMLElement {
    _hexDownCallback?: HexCellHandler;
    _hexCtxCallback?: HexCellHandler;
}
interface MemoryInteractionCallbacks {
    onHexDown?: HexCellHandler;
    onHexCtx?: HexCellHandler;
}

const VIRTUAL_SCROLL_CONFIG = {
    fallbackRowHeight: 20.8,  // CSS fallback: 13px * 1.6
    fallbackGapHeight: 35.2,  // CSS fallback: row * 1.5 + 2px vertical margins
    bufferSize: 10,           // render 10 rows above/below viewport
};

function syncHeaderScroll(scrollLeft: number): void {
    const header = document.getElementById('mem-header');
    if (!header) { return; }
    header.scrollLeft = scrollLeft;
}

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

function syncVirtualScrollMetrics(scrollContainer: HTMLElement): void {
    if (!vscrollState) { return; }
    const { rowHeight, gapHeight } = getVirtualScrollMetrics(scrollContainer);
    const containerHeight = scrollContainer.clientHeight;
    if (
        Math.abs(vscrollState.rowHeight - rowHeight) < 0.01 &&
        Math.abs(vscrollState.gapHeight - gapHeight) < 0.01 &&
        vscrollState.containerHeight === containerHeight
    ) { return; }

    vscrollState.rowHeight = rowHeight;
    vscrollState.gapHeight = gapHeight;
    vscrollState.containerHeight = containerHeight;
    vscrollRenderedRange = [-1, -1];
}

//  Column header 

export function renderMemHeader(): void {
    const hidden = `<div class="cell-group"><span class="addr-cell">00000000</span></div>`;

    const hexHdr = Array.from({ length: BPR }, (_, i) =>
        `<span class="data-cell" data-col="${i}" style="cursor:default;color:var(--addr-active-fg)">${i.toString(16).toUpperCase().padStart(2, '0')}</span>`
    ).join('');

    document.getElementById('mem-header')!.innerHTML =
        `${hidden}` +
        `<div class="cell-group">${hexHdr}</div>` +
        `<div class="cell-group"><span class="mem-hdr-decoded">Decoded text</span></div>`;
}

//  Virtual scroll rendering 

function renderVisibleRows(): void {
    if (!vscrollState) { return; }

    const container = document.getElementById('mem-rows')!;
    const scrollContainer = document.getElementById('mem-scroll') as MemoryScrollElement;
    syncVirtualScrollMetrics(scrollContainer);

    const [startIdx, endIdx] = calcVisibleRange(vscrollState);
    const layout = calcScrollLayout(vscrollState);

    // No change in rendered range? Skip
    if (!layout.isCompressed && startIdx === vscrollRenderedRange[0] && endIdx === vscrollRenderedRange[1]) { return; }
    vscrollRenderedRange = [startIdx, endIdx];

    const labelMap = buildLabelMap();
    const topOffset = calcRowOffset(startIdx, vscrollState);
    const parts = buildVisibleRowsHtml(startIdx, endIdx, labelMap, vscrollState, !layout.isCompressed);

    if (layout.isCompressed) {
        container.style.position = 'relative';
        container.style.height = `${layout.physicalHeight}px`;
    } else {
        container.style.position = '';
        container.style.height = '';
    }

    if (layout.isCompressed) {
        const physicalScrollTop = scrollContainer.scrollTop;
        const windowTop = physicalScrollTop + topOffset - vscrollState.scrollTop;
        container.innerHTML = `<div style="position:absolute;top:${windowTop}px;left:0;width:max-content;min-width:100%">${parts.join('')}</div>`;
    } else {
        container.innerHTML = parts.join('');
    }

    attachMemoryCellHandlers(container, getMemoryInteractionCallbacks(scrollContainer));
    refreshMemoryHighlights();
}

function buildVisibleRowsHtml(
    startIdx: number,
    endIdx: number,
    labelMap: Map<number, typeof S.labels>,
    state: VirtualScrollState,
    includeSpacers = true,
): string[] {
    const parts: string[] = [];
    if (includeSpacers) { appendSpacer(parts, calcRowOffset(startIdx, state)); }
    appendVisibleMemoryRows(parts, startIdx, endIdx, labelMap);
    if (includeSpacers) { appendSpacer(parts, calcTotalHeight(state) - calcRowOffset(endIdx, state)); }
    return parts;
}

function appendVisibleMemoryRows(
    parts: string[],
    startIdx: number,
    endIdx: number,
    labelMap: Map<number, typeof S.labels>,
): void {
    for (let i = startIdx; i < endIdx && i < S.memRows.length; i++) {
        appendMemoryRow(parts, S.memRows[i], labelMap);
    }
}

function appendSpacer(parts: string[], height: number): void {
    if (height > 0) {
        parts.push(`<div style="height:${height}px"></div>`);
    }
}

function appendMemoryRow(
    parts: string[],
    row: (typeof S.memRows)[number],
    labelMap: Map<number, typeof S.labels>,
): void {
    if (row.type === 'gap') {
        parts.push(renderGapRow(row));
        return;
    }

    appendSegmentBanners(parts, labelMap.get(row.address) ?? []);
    parts.push(renderRow(row.address));
}

function renderGapRow(row: Extract<(typeof S.memRows)[number], { type: 'gap' }>): string {
    const f = row.from.toString(16).toUpperCase().padStart(8, '0');
    const t = row.to.toString(16).toUpperCase().padStart(8, '0');
    return `<div class="gap-row">
        <span class="gap-dots"></span>
        <span class="gap-range">0x${f}  0x${t}</span>
        <span class="gap-size">${fmtB(row.bytes)} unmapped</span>
    </div>`;
}

function appendSegmentBanners(parts: string[], labels: typeof S.labels): void {
    for (const lbl of labels) {
        parts.push(`<div class="seg-banner" style="border-color:${lbl.color};background:${lbl.color}14;color:${lbl.color}">
            <span class="sb-name">${esc(lbl.name)}</span>
            <span class="sb-meta">0x${lbl.startAddress.toString(16).toUpperCase().padStart(8, '0')}  ${fmtB(lbl.length)}</span>
        </div>`);
    }
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

function refreshMemoryHighlights(): void {
    applyMatchHighlights();
    applySel();
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

    // Initialize virtual scroll state
    const scrollContainer = document.getElementById('mem-scroll') as MemoryScrollElement;
    const { rowHeight, gapHeight } = getVirtualScrollMetrics(scrollContainer);

    vscrollState = {
        containerHeight: scrollContainer.clientHeight,
        rowHeight,
        gapHeight,
        scrollTop: scrollContainer.scrollTop,
        bufferSize: VIRTUAL_SCROLL_CONFIG.bufferSize,
        visibleRowIndices: [0, 0],
    };
    vscrollRenderedRange = [-1, -1];

    storeMemoryInteractionCallbacks(scrollContainer, onHexDown, onHexCtx);

    // Keep header columns aligned with horizontal body scrolling.
    syncHeaderScroll(scrollContainer.scrollLeft);

    // Initial render of visible rows
    renderVisibleRows();

    // Column hover  set up once per container lifetime
    if (!container.dataset.colHoverInit) {
        container.dataset.colHoverInit = '1';
        const hdr = document.getElementById('mem-header')!;
        let activeCol: string | null = null;
        const setCol = (col: string | null) => {
            if (col === activeCol) { return; }
            if (activeCol !== null) {
                container.querySelectorAll<HTMLElement>(`[data-col="${activeCol}"]`).forEach(el => el.classList.remove('col-hi'));
                hdr.querySelectorAll<HTMLElement>(`[data-col="${activeCol}"]`).forEach(el => el.classList.remove('col-hi'));
            }
            activeCol = col;
            if (col !== null) {
                container.querySelectorAll<HTMLElement>(`[data-col="${col}"]`).forEach(el => el.classList.add('col-hi'));
                hdr.querySelectorAll<HTMLElement>(`[data-col="${col}"]`).forEach(el => el.classList.add('col-hi'));
            }
        };
        container.addEventListener('mouseover', e => {
            const col = (e.target as HTMLElement).closest<HTMLElement>('[data-col]')?.dataset.col ?? null;
            setCol(col);
        });
        container.addEventListener('mouseleave', () => setCol(null));
    }

    // Set up scroll listener for virtual scrolling (only once)
    if (!scrollContainer.dataset.vscrollInit) {
        scrollContainer.dataset.vscrollInit = '1';
        scrollContainer.addEventListener('scroll', () => {
            if (!vscrollState) { return; }
            vscrollState.scrollTop = physicalToLogicalScroll(scrollContainer.scrollTop, vscrollState);
            syncHeaderScroll(scrollContainer.scrollLeft);
            renderVisibleRows();
        });
        window.addEventListener('resize', () => {
            if (!vscrollState) { return; }
            vscrollState.scrollTop = physicalToLogicalScroll(scrollContainer.scrollTop, vscrollState);
            renderVisibleRows();
        });
    }
}

//  Single data row 

function renderRow(base: number): string {
    const hexCells: string[] = [];
    const chrCells: string[] = [];

    for (let col = 0; col < BPR; col++) {
        const addr = base + col;
        const val  = getByte(addr);
        const ah   = addr.toString(16).toUpperCase().padStart(8, '0');

        if (val === undefined) {
            hexCells.push(`<span class="data-cell be" data-col="${col}" aria-hidden="true">  </span>`);
            chrCells.push(`<span class="char-cell cd" data-col="${col}" aria-hidden="true"> </span>`);
        } else {
            const hex   = val.toString(16).toUpperCase().padStart(2, '0');
            const dirty = S.edits.has(addr) ? ' dirty' : '';
            hexCells.push(`<span class="data-cell ${byteClass(val)}${dirty}" data-col="${col}" data-addr="${ah}" data-val="${val}">${hex}</span>`);
            const p = val >= 0x20 && val < 0x7F;
            chrCells.push(`<span class="char-cell ${p ? 'cp' : 'cd'}${dirty}" data-col="${col}" data-addr="${ah}">${p ? esc(String.fromCharCode(val)) : ''}</span>`);
        }
    }

    return `<div class="data-row" data-row="${base}">
        <div class="cell-group"><span class="addr-cell">${base.toString(16).toUpperCase().padStart(8, '0')}</span></div>
        <div class="cell-group">${hexCells.join('')}</div>
        <div class="cell-group">${chrCells.join('')}</div>
    </div>`;
}

//  Selection highlight 

export function applySel(): void {
    const allAddrCells = document.querySelectorAll<HTMLElement>('[data-addr]');
    const rowEls = document.querySelectorAll<HTMLElement>('.data-row.row-sel');
    const headerSelCols = document.querySelectorAll<HTMLElement>('#mem-header .data-cell.sel-col');

    rowEls.forEach(el => el.classList.remove('row-sel'));
    headerSelCols.forEach(el => el.classList.remove('sel-col'));

    if (S.selStart === null || S.selEnd === null) {
        allAddrCells.forEach(el => el.classList.remove('sel'));
        return;
    }

    allAddrCells.forEach(el => {
        const a = parseInt(el.dataset.addr!, 16);
        const isSelected = a >= S.selStart! && a <= S.selEnd!;
        el.classList.toggle('sel', isSelected);
        if (!isSelected) { return; }
        const rowEl = el.closest<HTMLElement>('.data-row');
        if (rowEl) {
            rowEl.classList.add('row-sel');
        }
    });

    const selectedCols = getSelectedColumns(S.selStart, S.selEnd);
    for (const col of selectedCols) {
        document
            .querySelectorAll<HTMLElement>(`#mem-header .data-cell[data-col="${col}"]`)
            .forEach(el => el.classList.add('sel-col'));
    }
}

function getSelectedColumns(selStart: number, selEnd: number): Set<number> {
    const cols = new Set<number>();
    const startRow = Math.floor(selStart / BPR);
    const endRow = Math.floor(selEnd / BPR);
    const startCol = selStart % BPR;
    const endCol = selEnd % BPR;

    if (startRow === endRow) {
        for (let c = startCol; c <= endCol; c++) {
            cols.add(c);
        }
        return cols;
    }

    if (endRow - startRow > 1) {
        for (let c = 0; c < BPR; c++) {
            cols.add(c);
        }
        return cols;
    }

    for (let c = startCol; c < BPR; c++) {
        cols.add(c);
    }
    for (let c = 0; c <= endCol; c++) {
        cols.add(c);
    }

    return cols;
}

//  Match highlight 

interface VisibleCellIndex {
    cellsByAddr: Map<number, HTMLElement[]>;
    visibleMin: number;
    visibleMax: number;
}

export function applyMatchHighlights(): void {
    const renderedCells = getRenderedAddressCells();
    clearMatchClasses(renderedCells);
    if (!S.matchAddrs.length) { return; }

    const nLen = getNeedleLen();
    if (!nLen) { return; }

    const cellIndex = buildVisibleCellIndex(renderedCells);
    if (!cellIndex) { return; }
    highlightVisibleMatches(cellIndex, nLen);
}

function getRenderedAddressCells(): NodeListOf<HTMLElement> {
    return document.querySelectorAll<HTMLElement>('.data-cell[data-addr], .char-cell[data-addr]');
}

function clearMatchClasses(renderedCells: NodeListOf<HTMLElement>): void {
    renderedCells.forEach(el => el.classList.remove('match', 'amatch'));
}

function buildVisibleCellIndex(renderedCells: NodeListOf<HTMLElement>): VisibleCellIndex | null {
    const cellIndex: VisibleCellIndex = {
        cellsByAddr: new Map<number, HTMLElement[]>(),
        visibleMin: Number.MAX_SAFE_INTEGER,
        visibleMax: Number.MIN_SAFE_INTEGER,
    };

    renderedCells.forEach(el => addVisibleCell(cellIndex, el));
    return cellIndex.cellsByAddr.size === 0 ? null : cellIndex;
}

function addVisibleCell(cellIndex: VisibleCellIndex, el: HTMLElement): void {
    const addr = getElementAddress(el);
    if (addr === null) { return; }

    addCellAddress(cellIndex.cellsByAddr, addr, el);
    cellIndex.visibleMin = Math.min(cellIndex.visibleMin, addr);
    cellIndex.visibleMax = Math.max(cellIndex.visibleMax, addr);
}

function getElementAddress(el: HTMLElement): number | null {
    const addrHex = el.dataset.addr;
    if (!addrHex) { return null; }

    const addr = parseInt(addrHex, 16);
    return isNaN(addr) ? null : addr;
}

function addCellAddress(cellsByAddr: Map<number, HTMLElement[]>, addr: number, el: HTMLElement): void {
    const existing = cellsByAddr.get(addr);
    if (existing) {
        existing.push(el);
        return;
    }

    cellsByAddr.set(addr, [el]);
}

function highlightVisibleMatches(cellIndex: VisibleCellIndex, nLen: number): void {
    const firstRelevant = lowerBound(S.matchAddrs, cellIndex.visibleMin - (nLen - 1));
    for (let mi = firstRelevant; mi < S.matchAddrs.length; mi++) {
        const matchBase = S.matchAddrs[mi];
        if (matchBase > cellIndex.visibleMax) { break; }
        if (matchBase + nLen - 1 < cellIndex.visibleMin) { continue; }
        highlightMatchRange(cellIndex.cellsByAddr, matchBase, nLen, mi === S.matchIdx);
    }
}

function highlightMatchRange(
    cellsByAddr: Map<number, HTMLElement[]>,
    matchBase: number,
    nLen: number,
    active: boolean,
): void {
    for (let i = 0; i < nLen; i++) {
        const cells = cellsByAddr.get(matchBase + i);
        if (!cells) { continue; }
        highlightMatchCells(cells, active);
    }
}

function highlightMatchCells(cells: HTMLElement[], active: boolean): void {
    for (const el of cells) {
        el.classList.add('match');
        if (active) { el.classList.add('amatch'); }
    }
}

function lowerBound(sorted: number[], value: number): number {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sorted[mid] < value) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    return lo;
}

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
    if (value === 0n) { return 1; }
    let tmp = value;
    let bytes = 0;
    while (tmp > 0n && bytes < 8) {
        bytes++;
        tmp >>= 8n;
    }
    return bytes || null;
}

function asciiNeedleLen(query: string): number | null {
    return new TextEncoder().encode(query).length || null;
}

//  Scroll 

function scrollRenderedRow(row: number): void {
    const el = document.querySelector<HTMLElement>(`.data-row[data-row="${row}"]`);
    if (!el) { return; }
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function setVirtualScrollPosition(scrollContainer: HTMLElement, rowIndex: number): VirtualScrollLayout {
    const state = vscrollState!;
    syncVirtualScrollMetrics(scrollContainer);
    const desiredTop = Math.max(0, calcRowOffset(rowIndex, state) - state.rowHeight * 2);
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

//  Label map 

function buildLabelMap(): Map<number, typeof S.labels> {
    const m = new Map<number, typeof S.labels>();
    for (const lbl of S.labels) {
        if (lbl.hidden) { continue; }
        const ra = lbl.startAddress - (lbl.startAddress % BPR);
        m.set(ra, [...(m.get(ra) ?? []), lbl]);
    }
    return m;
}
