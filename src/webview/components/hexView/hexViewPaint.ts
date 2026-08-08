// ── HexView paint/match DOM utilities ────────────────────────────
// DOM-scoped helpers for transient paint operations (selection columns,
// match highlighting, cell preview). Split out of HexView.ts so the
// interaction controller stays focused on event routing + state.

import { lowerBound } from '../../utils';
import { BYTES_PER_ROW } from './hexViewRender';

export function cellAddress(el: HTMLElement): number | null {
    const raw = el.dataset.addr;
    if (!raw) { return null; }
    const addr = parseInt(raw, 16);
    return Number.isNaN(addr) ? null : addr;
}

export function selectedColumns(selStart: number, selEnd: number): Set<number> {
    const cols = new Set<number>();
    const startRow = Math.floor(selStart / BYTES_PER_ROW);
    const endRow = Math.floor(selEnd / BYTES_PER_ROW);
    const startCol = selStart % BYTES_PER_ROW;
    const endCol = selEnd % BYTES_PER_ROW;
    if (startRow === endRow) { return addColumnRange(cols, startCol, endCol); }
    if (endRow - startRow > 1) { return addColumnRange(cols, 0, BYTES_PER_ROW - 1); }
    addColumnRange(cols, startCol, BYTES_PER_ROW - 1);
    return addColumnRange(cols, 0, endCol);
}

function addColumnRange(cols: Set<number>, start: number, end: number): Set<number> {
    for (let c = start; c <= end; c++) { cols.add(c); }
    return cols;
}

interface CellAddressIndex {
    cellsByAddr: Map<number, HTMLElement[]>;
    visibleMin: number;
    visibleMax: number;
}

function buildCellAddressIndex(cells: NodeListOf<HTMLElement>): CellAddressIndex | null {
    const index: CellAddressIndex = {
        cellsByAddr: new Map<number, HTMLElement[]>(),
        visibleMin: Number.MAX_SAFE_INTEGER,
        visibleMax: Number.MIN_SAFE_INTEGER,
    };
    cells.forEach(el => addIndexedCell(index, el));
    if (index.cellsByAddr.size === 0) { return null; }
    return index;
}

function addIndexedCell(index: CellAddressIndex, el: HTMLElement): void {
    const addr = cellAddress(el);
    if (addr === null) { return; }
    addCellToMap(index.cellsByAddr, addr, el);
    index.visibleMin = Math.min(index.visibleMin, addr);
    index.visibleMax = Math.max(index.visibleMax, addr);
}

function addCellToMap(cellsByAddr: Map<number, HTMLElement[]>, addr: number, el: HTMLElement): void {
    const existing = cellsByAddr.get(addr);
    if (existing) {
        existing.push(el);
    } else {
        cellsByAddr.set(addr, [el]);
    }
}

function highlightVisibleMatches(
    index: CellAddressIndex,
    matchAddrs: readonly number[],
    activeIndex: number,
    length: number,
): void {
    const firstRelevant = lowerBound(matchAddrs, index.visibleMin - (length - 1));
    for (let mi = firstRelevant; mi < matchAddrs.length; mi++) {
        const matchBase = matchAddrs[mi];
        if (matchBase > index.visibleMax) { break; }
        if (matchBase + length - 1 < index.visibleMin) { continue; }
        highlightMatchRange(index.cellsByAddr, matchBase, length, mi === activeIndex);
    }
}

function highlightMatchRange(
    cellsByAddr: Map<number, HTMLElement[]>,
    matchBase: number,
    length: number,
    active: boolean,
): void {
    for (let i = 0; i < length; i++) {
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

export function columnFor(cell: HTMLElement): 'hex' | 'char' {
    return cell.classList.contains('char-cell') ? 'char' : 'hex';
}

export function isCopyShortcut(e: KeyboardEvent): boolean {
    return (e.ctrlKey || e.metaKey) && e.key === 'c';
}

export function isEditableTarget(target: HTMLElement | null): boolean {
    return !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
}

export function paintMatchesInRoot(
    root: HTMLElement,
    matchAddrs: readonly number[],
    index: number,
    length: number,
): void {
    const cells = root.querySelectorAll<HTMLElement>('.data-cell[data-addr], .char-cell[data-addr]');
    cells.forEach(el => el.classList.remove('match', 'amatch'));
    if (matchAddrs.length === 0 || length <= 0) { return; }
    const cellIndex = buildCellAddressIndex(cells);
    if (!cellIndex) { return; }
    highlightVisibleMatches(cellIndex, matchAddrs, index, length);
}

export function clearCellPreview(cell: HTMLElement): void {
    cell.classList.remove('editing');
    const raw = cell.dataset.val;
    if (raw === undefined) { return; }
    const value = parseInt(raw, 10);
    if (!Number.isNaN(value)) {
        cell.textContent = value.toString(16).toUpperCase().padStart(2, '0');
    }
}
