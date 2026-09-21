import type { DiffModel } from '../../core/diff';
import { HexView } from '../components/hexView/hexView';
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

let data: DiffGridData | null = null;
let viewA: HexView | null = null;
let viewB: HexView | null = null;
let vscroll: VirtualScrollState | null = null;
let vscrollContainer: HTMLElement | null = null;
let activeRange: HexViewRange | null = null;
let syncingScroll = false;

export function mountDiffGrid(): void {
    if (!viewA) {
        viewA = new HexView('#diff-a', { onVisibleWindowChange: (top, left) => syncFrom('a', top, left) });
        viewA.mount();
    }
    if (!viewB) {
        viewB = new HexView('#diff-b', { onVisibleWindowChange: (top, left) => syncFrom('b', top, left) });
        viewB.mount();
    }
}

/** Test seam: drop cached grid instances so a fresh document re-attaches listeners. */
export function resetDiffGrid(): void {
    data = null;
    viewA = null;
    viewB = null;
    vscroll = null;
    vscrollContainer = null;
    activeRange = null;
    syncingScroll = false;
}

export function setDiffData(a: DiffSideData, b: DiffSideData, diff: DiffModel): void {
    data = { rows: buildDiffRows(a, b), a, b, diff };
    vscroll = null;
    vscrollContainer = null;
    activeRange = null;
    clearDiffError();
    renderHeaders();
    renderDiffGrid();
}

function renderDiffGrid(): void {
    const ui = gridContainers();
    if (!ui || !data) { return; }
    if (data.rows.length === 0) { renderEmptyGrid(ui); return; }
    renderVisibleSlice(ui);
}

function renderEmptyGrid(ui: GridContainers): void {
    const emptyHtml = renderHexViewHtml(emptyInput());
    ui.a.innerHTML = emptyHtml;
    ui.b.innerHTML = emptyHtml;
}

function renderVisibleSlice(ui: GridContainers): void {
    const state = ensureScrollState(ui.scroll);
    const layout = calcScrollLayout(state);
    const [start, end] = calcVisibleRange(state);
    applyVirtualScrollLayout(ui.a, layout);
    applyVirtualScrollLayout(ui.b, layout);
    const topSpacer = calcRowOffset(start, state);
    const bottomSpacer = calcTotalHeight(state) - calcRowOffset(end, state);
    const sliceHeight = calcRowOffset(end, state) - calcRowOffset(start, state);
    const windowTop = clampWindowTop(ui.scroll.scrollTop + topSpacer - state.scrollTop, layout.physicalHeight, sliceHeight);
    ui.a.innerHTML = renderHexViewHtml(buildInput('a', start, end, layout, windowTop, topSpacer, bottomSpacer));
    ui.b.innerHTML = renderHexViewHtml(buildInput('b', start, end, layout, windowTop, topSpacer, bottomSpacer));
}

export function scrollToDiff(range: HexViewRange): void {
    if (!data || !vscroll) { return; }
    const rowIndex = findRowIndexForAddress(range.start);
    if (rowIndex < 0) { return; }
    activeRange = range;
    const state = vscroll;
    const desiredTop = Math.max(0, calcRowOffset(rowIndex, state) - state.getRowHeight(rowIndex) * 2);
    const layout = calcScrollLayout(state);
    const targetTop = Math.min(desiredTop, layout.logicalScrollable);
    state.scrollTop = targetTop;
    const physicalTop = logicalToPhysicalScroll(targetTop, state);
    viewA?.setScrollTop(physicalTop);
    viewB?.setScrollTop(physicalTop);
    renderDiffGrid();
}

export function showDiffError(message: string): void {
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
}

// ── Scroll sync ───────────────────────────────────────────────────

/** Mirror one grid's scroll onto the other; both grids share rows and row heights. */
function syncFrom(driver: 'a' | 'b', top: number, left: number): void {
    if (syncingScroll || !data || !vscroll) { return; }
    syncingScroll = true;
    try {
        vscroll.scrollTop = physicalToLogicalScroll(top, vscroll);
        renderDiffGrid();
        const follower = followerOf(driver);
        follower?.setScrollTop(top);
        follower?.setScrollLeft(left);
    } finally {
        syncingScroll = false;
    }
}

function followerOf(driver: 'a' | 'b'): HexView | null {
    return driver === 'a' ? viewB : viewA;
}

// ── Render input building ─────────────────────────────────────────

function emptyInput(): HexViewRenderInput {
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
        showAscii: false,
    };
}

function buildInput(
    side: 'a' | 'b',
    start: number,
    end: number,
    layout: VirtualScrollLayout,
    windowTop: number,
    topSpacer: number,
    bottomSpacer: number,
): HexViewRenderInput {
    const sideData = side === 'a' ? data!.a : data!.b;
    const rows: HexViewRow[] = [];
    for (let i = start; i < end && i < data!.rows.length; i++) {
        rows.push(toHexRow(data!.rows[i], side, sideData));
    }
    return {
        rows,
        topSpacer,
        bottomSpacer,
        compressed: layout.isCompressed,
        containerHeight: layout.physicalHeight,
        windowTop,
        matchSet: new Set(),
        selection: activeRange,
        activeMatch: null,
        showAscii: false,
    };
}

function toHexRow(row: DiffRow, side: 'a' | 'b', sideData: DiffSideData): HexViewRow {
    if (row.kind === 'gap') {
        return { address: row.address, kind: 'gap', cells: [], gap: row.gap };
    }
    return { address: row.address, kind: 'data', cells: buildCells(row.address, side, sideData) };
}

function buildCells(base: number, side: 'a' | 'b', sideData: DiffSideData): HexViewCell[] {
    const cells: HexViewCell[] = [];
    for (let col = 0; col < BYTES_PER_ROW; col++) {
        const addr = base + col;
        const val = getSideByte(sideData, addr);
        cells.push(val === undefined ? EMPTY_CELL : dataCell(val, side, addr));
    }
    return cells;
}

function dataCell(val: number, side: 'a' | 'b', addr: number): HexViewCell {
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
    const rowCount = data!.rows.length;
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
        getRowHeight: index => data!.rows[index]?.kind === 'gap' ? gapHeight : rowHeight,
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
    for (let i = 0; i < data!.rows.length; i++) {
        const row = data!.rows[i];
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
