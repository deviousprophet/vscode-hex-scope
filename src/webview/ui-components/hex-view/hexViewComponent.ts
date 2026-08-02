// Reusable hexview component: optional filename label + 00..0F header +
// (address gutter + hex cells), with its own hover / selection / column-hover
// interaction. Emits callbacks so a host (e.g. the diff view) can paint
// cross-panel highlights. Reusable later by the single-file hex view.

import type { DiffCell } from '../../../core/diff';
import { DIFF_ROW_BYTES, DIFF_ROW_HEIGHT, formatAddress, type DiffVisualRow } from '../../diff/diffViewModel';
import { esc } from '../../utils';

export interface HexViewRange { start: number; end: number }

export interface HexViewCallbacks {
    onHover?: (addr: number) => void;
    onLeave?: () => void;
    onSelectionChange?: (range: HexViewRange | null) => void;
    onColumnHover?: (col: number) => void;
    onColumnLeave?: () => void;
    /** Ctrl/Cmd+C with this component's selection active; the host decides bytes + format. */
    onCopy?: (range: HexViewRange) => void;
}

export interface HexViewRenderInput {
    label: string;
    rows: readonly DiffVisualRow[];
    /** Index of `rows[0]` within the full row list (absolute positioning). */
    rowOffset: number;
    searchRowIndex: number;
    matchSet: ReadonlySet<number>;
    error: string | null;
    totalHeight: number;
}

function byteText(cell: DiffCell | null): string {
    return cell && cell.present ? cell.byte.toString(16).toUpperCase().padStart(2, '0') : '··';
}

/** Status -> byte-cell class: unchanged=bn, empty=be, all differences=bd. */
const STATUS_CLASS: Record<string, string> = {
    unchanged: 'bn',
    empty: 'be',
    changed: 'bd',
    added: 'bd',
    removed: 'bd',
};

function isMatchedCell(cell: DiffCell | null, isMatch: boolean): boolean {
    return isMatch && cell !== null && cell.present;
}

function cellClass(cell: DiffCell | null, status: string, isMatch: boolean): string {
    const cls = `data-cell ${STATUS_CLASS[status] ?? status}`;
    return isMatchedCell(cell, isMatch) ? `${cls} match` : cls;
}

function cellHtml(cell: DiffCell | null, status: string, isMatch: boolean, side: 'a' | 'b', addr: number): string {
    return `<span class="${cellClass(cell, status, isMatch)}" data-addr="${esc(formatAddress(addr))}" data-side="${side}">${byteText(cell)}</span>`;
}

function rowModifiers(isSearchRow: boolean, error: string | null): string {
    return `${isSearchRow ? ' search-row' : ''}${error ? ' panel-error' : ''}`;
}

function cellsForRow(vr: DiffVisualRow, side: 'a' | 'b', matchSet: ReadonlySet<number>): string[] {
    const cells: string[] = [];
    for (let j = 0; j < DIFF_ROW_BYTES; j++) {
        const byteAddr = vr.baseAddress + j;
        cells.push(cellHtml(side === 'a' ? vr.a[j] : vr.b[j], vr.statuses[j], matchSet.has(byteAddr), side, byteAddr));
    }
    return cells;
}

function rowHtml(vr: DiffVisualRow, side: 'a' | 'b', index: number, rowOffset: number, isSearchRow: boolean, matchSet: ReadonlySet<number>, error: string | null): string {
    const addr = esc(formatAddress(vr.baseAddress));
    const top = (index + rowOffset) * DIFF_ROW_HEIGHT;
    return `<div class="diff-row" data-addr="${addr}" style="top:${top}px">
        <span class="addr">${addr}</span>
        <div class="side${rowModifiers(isSearchRow, error)}">${cellsForRow(vr, side, matchSet).join('')}</div>
    </div>`;
}

function headerHtml(): string {
    const cells: string[] = [];
    for (let i = 0; i < DIFF_ROW_BYTES; i++) {
        cells.push(`<span class="hcell" data-col="${i}">${esc(i.toString(16).toUpperCase().padStart(2, '0'))}</span>`);
    }
    return `<span class="addr"></span><div class="side">${cells.join('')}</div>`;
}

/** Pure HTML for one component (testable without DOM). */
export function renderHexViewComponentHtml(side: 'a' | 'b', input: HexViewRenderInput): string {
    const rows: string[] = [];
    for (let i = 0; i < input.rows.length; i++) {
        rows.push(rowHtml(input.rows[i], side, i, input.rowOffset, i + input.rowOffset === input.searchRowIndex, input.matchSet, input.error));
    }
    return `<div class="diff-component ${side}">
        ${input.label ? `<div class="panel-label">${esc(input.label)}</div>` : ''}
        <div class="diff-header">${headerHtml()}</div>
        <div class="diff-body" style="height:${input.totalHeight}px">${rows.join('')}</div>
    </div>`;
}

// ── DOM helpers (module-private; keep decision points tiny) ────────────

function addrOf(el: HTMLElement): number {
    return parseInt(el.dataset.addr ?? '', 16);
}

function colOf(el: HTMLElement): number {
    return parseInt(el.dataset.col ?? '', 10);
}

function cellAt(t: EventTarget | null, scope: string): { addr: number } | null {
    const el = (t as HTMLElement).closest?.(`${scope} .data-cell[data-addr]`) as HTMLElement | null;
    if (!el) { return null; }
    return addrCell(el);
}

function addrCell(el: HTMLElement): { addr: number } | null {
    const addr = parseInt(el.dataset.addr ?? '', 16);
    return Number.isFinite(addr) ? { addr } : null;
}

function isEmptyCell(t: EventTarget | null, scope: string): boolean {
    const el = (t as HTMLElement).closest?.(`${scope} .data-cell`) as HTMLElement | null;
    return el?.classList.contains('be') === true;
}

function isCopyShortcut(k: KeyboardEvent): boolean {
    return (k.ctrlKey || k.metaKey) && k.key.toLowerCase() === 'c';
}

function isEditableTarget(k: KeyboardEvent): boolean {
    return (k.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable="true"]') !== null;
}

function headerCellAt(t: EventTarget | null, scope: string): HTMLElement | null {
    return (t as HTMLElement).closest?.(`${scope} .diff-header .hcell`) as HTMLElement | null;
}

function columnIndexOf(h: HTMLElement): number {
    return Array.prototype.indexOf.call(h.parentElement?.children ?? [], h);
}

function insideComponent(el: HTMLElement | null, scope: string): boolean {
    return el !== null && el.closest(scope) !== null;
}

function inRange(a: number, start: number, end: number): boolean {
    return a >= start && a <= end;
}

function rowOverlaps(base: number, start: number, end: number): boolean {
    return Number.isFinite(base) && base + DIFF_ROW_BYTES > start && base <= end;
}

function rowContains(base: number, addr: number): boolean {
    return Number.isFinite(base) && addr >= base && addr < base + DIFF_ROW_BYTES;
}

function clearSelectionClasses(scope: string): void {
    document.querySelectorAll(`${scope} .data-cell.sel`).forEach(el => el.classList.remove('sel'));
    document.querySelectorAll(`${scope} .diff-row.row-sel`).forEach(el => el.classList.remove('row-sel'));
    document.querySelectorAll(`${scope} .diff-header .hcell.sel-col`).forEach(el => el.classList.remove('sel-col'));
}

function paintSelectedCells(scope: string, sel: HexViewRange): Set<number> {
    const cols = new Set<number>();
    for (const el of document.querySelectorAll<HTMLElement>(`${scope} .data-cell[data-addr]`)) {
        const a = addrOf(el);
        if (inRange(a, sel.start, sel.end)) {
            el.classList.add('sel');
            cols.add(a & 0xF);
        }
    }
    return cols;
}

function paintSelectedRows(scope: string, sel: HexViewRange): void {
    for (const el of document.querySelectorAll<HTMLElement>(`${scope} .diff-row[data-addr]`)) {
        const base = addrOf(el);
        if (rowOverlaps(base, sel.start, sel.end)) { el.classList.add('row-sel'); }
    }
}

function paintSelectedColumns(scope: string, cols: ReadonlySet<number>): void {
    for (const el of document.querySelectorAll<HTMLElement>(`${scope} .diff-header .hcell[data-col]`)) {
        if (cols.has(colOf(el))) { el.classList.add('sel-col'); }
    }
}

function clearColumnHighlight(scope: string): void {
    document.querySelectorAll(`${scope} .data-cell.col-hi`).forEach(el => el.classList.remove('col-hi'));
    document.querySelectorAll(`${scope} .diff-header .hcell.col-hi`).forEach(el => el.classList.remove('col-hi'));
}

function isColumnCell(el: HTMLElement, column: number): boolean {
    return (addrOf(el) & 0xF) === column && addrOf(el) >= 0;
}

function paintColumnCells(scope: string, column: number): void {
    for (const el of document.querySelectorAll<HTMLElement>(`${scope} .data-cell[data-addr]`)) {
        if (isColumnCell(el, column)) { el.classList.add('col-hi'); }
    }
}

function paintColumnHeaders(scope: string, column: number): void {
    for (const el of document.querySelectorAll<HTMLElement>(`${scope} .diff-header .hcell[data-col]`)) {
        if (colOf(el) === column) { el.classList.add('col-hi'); }
    }
}

function paintMirrorRow(scope: string, addr: number): void {
    for (const el of document.querySelectorAll<HTMLElement>(`${scope} .diff-row[data-addr]`)) {
        if (rowContains(addrOf(el), addr)) { el.classList.add('row-hi'); }
    }
}

function paintMirrorRange(scope: string, range: HexViewRange): void {
    for (const el of document.querySelectorAll<HTMLElement>(`${scope} .data-cell[data-addr]`)) {
        if (inRange(addrOf(el), range.start, range.end)) { el.classList.add('sel-mirror'); }
    }
}

/** Interaction controller: owns its own hover/selection, emits callbacks. */
export class HexViewComponent {
    private _selection: HexViewRange | null = null;
    private _hoverAddr = -1;
    private _mirrorAddr = -1;
    private _mirrorRange: HexViewRange | null = null;
    private _column = -1;
    private _dragging = false;
    private _mounted = false;
    private cb: HexViewCallbacks;

    constructor(private readonly side: 'a' | 'b', cb: HexViewCallbacks = {}) {
        this.cb = cb;
    }

    /** Replace the interaction callbacks (e.g. after wiring cross-panel hosts). */
    setCallbacks(cb: HexViewCallbacks): void {
        this.cb = cb;
    }

    private get rootSel(): string {
        return `.diff-component.${this.side}`;
    }

    mount(): void {
        if (this._mounted) { return; }
        this._mounted = true;

        document.addEventListener('mousedown', e => {
            const c = cellAt(e.target, this.rootSel);
            if (!c || isEmptyCell(e.target, this.rootSel)) { return; }
            // Empty (be) cells carry no data: they cannot start a selection.
            this.startSelection(c.addr);
        });
        document.addEventListener('mouseover', e => this.onMouseOver(e as MouseEvent));
        document.addEventListener('mouseout', e => {
            if (this.shouldLeave(e as MouseEvent)) { this.clearHoverAndColumn(); }
        });
        document.addEventListener('mouseup', () => { this._dragging = false; });
        document.addEventListener('keydown', e => this.handleCopyKey(e as KeyboardEvent));
    }

    // ponytail: destroy() removed (unused; sole user of _listeners registry) — re-add with a listener registry when a host must detach document listeners.
    // ponytail: getSelection() removed (unused) — re-add when a host needs to read this component's selection range.
    setSelection(range: HexViewRange | null): void { this._selection = range; this.applySel(); }

    /** Paint the hovered-by-the-other-side byte in this component (cell + row + column). */
    setMirrorAddr(addr: number): void {
        this._mirrorAddr = addr;
        this.applyMirror();
        this.applyMirrorRow(addr);
    }
    /** Paint the selected-by-the-other-side range in this component. */
    setMirrorRange(range: HexViewRange | null): void { this._mirrorRange = range; this.applyMirrorRange(); }
    /** Paint a byte column in this component (from either header's hover). */
    setColumn(col: number): void { this.applyColumn(col); }

    /** Re-apply transient paints after the DOM is rebuilt. */
    reapply(): void {
        this.applySel();
        this.applyHover();
        this.applyMirror();
        this.applyMirrorRow(this._mirrorAddr);
        this.applyMirrorRange();
        this.applyColumn();
    }

    private startSelection(addr: number): void {
        this._dragging = true;
        this._selection = { start: addr, end: addr };
        this.applySel();
        this.cb.onSelectionChange?.(this._selection);
    }

    private onMouseOver(e: MouseEvent): void {
        const c = cellAt(e.target, this.rootSel);
        if (this._dragging) { this.extendDrag(c); return; }
        if (c) { this.paintByteHover(c.addr); return; }
        this.paintHeaderHover(e.target);
    }

    private extendDrag(c: { addr: number } | null): void {
        if (!c || !this._selection) { return; }
        this._selection = {
            start: Math.min(this._selection.start, c.addr),
            end: Math.max(this._selection.end, c.addr),
        };
        this.applySel();
        this.cb.onSelectionChange?.(this._selection);
    }

    private paintByteHover(addr: number): void {
        // byte hover + its column (single-view parity: byte hover highlights the column)
        this._hoverAddr = addr;
        this.applyHover();
        this.cb.onHover?.(addr);
        this.applyColumn(addr & 0xF);
        this.cb.onColumnHover?.(addr & 0xF);
    }

    private paintHeaderHover(target: EventTarget | null): void {
        const h = headerCellAt(target, this.rootSel);
        if (!h) { return; }
        const col = columnIndexOf(h);
        this.applyColumn(col);
        this.cb.onColumnHover?.(col);
    }

    private shouldLeave(e: MouseEvent): boolean {
        const t = e.target as HTMLElement;
        const related = e.relatedTarget as HTMLElement | null;
        // Leaving the whole component clears hover + column (mouseleave emulation).
        return t.closest(this.rootSel) !== null && !insideComponent(related, this.rootSel);
    }

    private clearHoverAndColumn(): void {
        this._hoverAddr = -1;
        this.applyHover();
        this.cb.onLeave?.();
        this.applyColumn(-1);
        this.cb.onColumnLeave?.();
    }

    private handleCopyKey(k: KeyboardEvent): boolean {
        if (!isCopyShortcut(k)) { return false; }
        if (isEditableTarget(k)) { return false; }
        if (!this._selection) { return false; }
        k.preventDefault();
        this.emitCopy(this._selection);
        return true;
    }

    private emitCopy(range: HexViewRange): void {
        this.cb.onCopy?.(range);
    }

    /** Highlight the row containing `addr` (mirrors the other side's row hover). */
    private applyMirrorRow(addr: number): void {
        document.querySelectorAll(`${this.rootSel} .diff-row.row-hi`).forEach(el => el.classList.remove('row-hi'));
        if (addr < 0) { return; }
        paintMirrorRow(this.rootSel, addr);
    }

    /** Highlight the hovered byte on its own side too (matches the mirror). */
    private applyHover(): void {
        const scope = this.rootSel;
        document.querySelectorAll(`${scope} .data-cell.cell-hover`).forEach(el => el.classList.remove('cell-hover'));
        if (this._hoverAddr < 0) { return; }
        const el = document.querySelector(`${scope} .data-cell[data-addr="${esc(formatAddress(this._hoverAddr))}"]`);
        el?.classList.add('cell-hover');
    }

    private applySel(): void {
        clearSelectionClasses(this.rootSel);
        const sel = this._selection;
        if (!sel) { return; }
        const cols = paintSelectedCells(this.rootSel, sel);
        paintSelectedRows(this.rootSel, sel);
        paintSelectedColumns(this.rootSel, cols);
    }

    private applyMirror(): void {
        const scope = this.rootSel;
        document.querySelectorAll(`${scope} .data-cell.cell-mirror`).forEach(el => el.classList.remove('cell-mirror'));
        if (this._mirrorAddr < 0) { return; }
        const el = document.querySelector(`${scope} .data-cell[data-addr="${esc(formatAddress(this._mirrorAddr))}"]`);
        el?.classList.add('cell-mirror');
    }

    private applyMirrorRange(): void {
        document.querySelectorAll(`${this.rootSel} .data-cell.sel-mirror`).forEach(el => el.classList.remove('sel-mirror'));
        if (!this._mirrorRange) { return; }
        paintMirrorRange(this.rootSel, this._mirrorRange);
    }

    private applyColumn(col?: number): void {
        this._column = col ?? this._column;
        clearColumnHighlight(this.rootSel);
        if (this._column < 0) { return; }
        paintColumnCells(this.rootSel, this._column);
        paintColumnHeaders(this.rootSel, this._column);
    }
}
