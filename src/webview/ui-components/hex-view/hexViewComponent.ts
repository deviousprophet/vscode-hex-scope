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

function cellClass(cell: DiffCell | null, status: string, isMatch: boolean): string {
    const cls = `data-cell ${STATUS_CLASS[status] ?? status}`;
    return isMatch && cell?.present ? `${cls} match` : cls;
}

function cellHtml(cell: DiffCell | null, status: string, isMatch: boolean, side: 'a' | 'b', addr: number): string {
    return `<span class="${cellClass(cell, status, isMatch)}" data-addr="${esc(formatAddress(addr))}" data-side="${side}">${byteText(cell)}</span>`;
}

function rowHtml(vr: DiffVisualRow, side: 'a' | 'b', index: number, rowOffset: number, isSearchRow: boolean, matchSet: ReadonlySet<number>, error: string | null): string {
    const addr = esc(formatAddress(vr.baseAddress));
    const cells: string[] = [];
    for (let j = 0; j < DIFF_ROW_BYTES; j++) {
        const byteAddr = vr.baseAddress + j;
        const cell = side === 'a' ? vr.a[j] : vr.b[j];
        cells.push(cellHtml(cell, vr.statuses[j], matchSet.has(byteAddr), side, byteAddr));
    }
    const top = (index + rowOffset) * DIFF_ROW_HEIGHT;
    return `<div class="diff-row" data-addr="${addr}" style="top:${top}px">
        <span class="addr">${addr}</span>
        <div class="side${isSearchRow ? ' search-row' : ''}${error ? ' panel-error' : ''}">${cells.join('')}</div>
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

/** Interaction controller: owns its own hover/selection, emits callbacks. */
export class HexViewComponent {
    private _selection: HexViewRange | null = null;
    private _hoverAddr = -1;
    private _mirrorAddr = -1;
    private _mirrorRange: HexViewRange | null = null;
    private _column = -1;
    private _dragging = false;
    private _mounted = false;
    private readonly _listeners: Array<[string, EventListener]> = [];
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
        const on = (type: string, fn: EventListener): void => {
            document.addEventListener(type, fn);
            this._listeners.push([type, fn]);
        };
        const cell = (t: EventTarget | null): { addr: number } | null => {
            const el = (t as HTMLElement).closest?.(`${this.rootSel} .data-cell[data-addr]`) as HTMLElement | null;
            if (!el) { return null; }
            const addr = parseInt(el.dataset.addr ?? '', 16);
            return Number.isFinite(addr) ? { addr } : null;
        };

        on('mousedown', e => {
            const c = cell(e.target);
            if (!c) { return; }
            // Empty (be) cells carry no data: they cannot start a selection.
            const targetEl = (e.target as HTMLElement).closest?.(`${this.rootSel} .data-cell`) as HTMLElement | null;
            if (targetEl?.classList.contains('be')) { return; }
            this._dragging = true;
            this._selection = { start: c.addr, end: c.addr };
            this.applySel();
            this.cb.onSelectionChange?.(this._selection);
        });
        on('mouseover', e => {
            if (this._dragging) {
                const c = cell(e.target);
                if (!c || !this._selection) { return; }
                this._selection = {
                    start: Math.min(this._selection.start, c.addr),
                    end: Math.max(this._selection.end, c.addr),
                };
                this.applySel();
                this.cb.onSelectionChange?.(this._selection);
                return;
            }
            const c = cell(e.target);
            if (c) {
                // byte hover + its column (single-view parity: byte hover highlights the column)
                this._hoverAddr = c.addr;
                this.applyHover();
                this.cb.onHover?.(c.addr);
                this.applyColumn(c.addr & 0xF);
                this.cb.onColumnHover?.(c.addr & 0xF);
                return;
            }
            const h = (e.target as HTMLElement).closest?.(`${this.rootSel} .diff-header .hcell`) as HTMLElement | null;
            if (h) {
                const col = Array.prototype.indexOf.call(h.parentElement?.children ?? [], h);
                this.applyColumn(col);
                this.cb.onColumnHover?.(col);
            }
        });
        on('mouseout', e => {
            // Leaving the whole component clears hover + column (mouseleave emulation).
            const t = e.target as HTMLElement;
            const related = (e as MouseEvent).relatedTarget as HTMLElement | null;
            if (t.closest?.(this.rootSel) && !related?.closest?.(this.rootSel)) {
                this._hoverAddr = -1;
                this.applyHover();
                this.cb.onLeave?.();
                this.applyColumn(-1);
                this.cb.onColumnLeave?.();
            }
        });
        on('mouseup', () => { this._dragging = false; });
    }

    destroy(): void {
        for (const [type, fn] of this._listeners) { document.removeEventListener(type, fn); }
        this._listeners.length = 0;
        this._mounted = false;
    }

    getSelection(): HexViewRange | null { return this._selection; }
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

    /** Highlight the row containing `addr` (mirrors the other side's row hover). */
    private applyMirrorRow(addr: number): void {
        const scope = this.rootSel;
        document.querySelectorAll(`${scope} .diff-row.row-hi`).forEach(el => el.classList.remove('row-hi'));
        if (addr < 0) { return; }
        for (const el of document.querySelectorAll<HTMLElement>(`${scope} .diff-row[data-addr]`)) {
            const base = parseInt(el.dataset.addr ?? '', 16);
            if (Number.isFinite(base) && addr >= base && addr < base + DIFF_ROW_BYTES) { el.classList.add('row-hi'); }
        }
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
        const scope = this.rootSel;
        document.querySelectorAll(`${scope} .data-cell.sel`).forEach(el => el.classList.remove('sel'));
        document.querySelectorAll(`${scope} .diff-row.row-sel`).forEach(el => el.classList.remove('row-sel'));
        document.querySelectorAll(`${scope} .diff-header .hcell.sel-col`).forEach(el => el.classList.remove('sel-col'));
        if (!this._selection) { return; }
        const { start, end } = this._selection;
        const cols = new Set<number>();
        for (const el of document.querySelectorAll<HTMLElement>(`${scope} .data-cell[data-addr]`)) {
            const a = parseInt(el.dataset.addr ?? '', 16);
            if (a >= start && a <= end) {
                el.classList.add('sel');
                cols.add(a & 0xF);
            }
        }
        // Selected rows highlight their address gutter (single-view `.row-sel`).
        for (const el of document.querySelectorAll<HTMLElement>(`${scope} .diff-row[data-addr]`)) {
            const base = parseInt(el.dataset.addr ?? '', 16);
            if (Number.isFinite(base) && base + DIFF_ROW_BYTES > start && base <= end) { el.classList.add('row-sel'); }
        }
        // Selected columns highlight in the header (single-view `.sel-col`).
        for (const el of document.querySelectorAll<HTMLElement>(`${scope} .diff-header .hcell[data-col]`)) {
            if (cols.has(parseInt(el.dataset.col ?? '', 10))) { el.classList.add('sel-col'); }
        }
    }

    private applyMirror(): void {
        const scope = this.rootSel;
        document.querySelectorAll(`${scope} .data-cell.cell-mirror`).forEach(el => el.classList.remove('cell-mirror'));
        if (this._mirrorAddr < 0) { return; }
        const el = document.querySelector(`${scope} .data-cell[data-addr="${esc(formatAddress(this._mirrorAddr))}"]`);
        el?.classList.add('cell-mirror');
    }

    private applyMirrorRange(): void {
        const scope = this.rootSel;
        document.querySelectorAll(`${scope} .data-cell.sel-mirror`).forEach(el => el.classList.remove('sel-mirror'));
        if (!this._mirrorRange) { return; }
        for (const el of document.querySelectorAll<HTMLElement>(`${scope} .data-cell[data-addr]`)) {
            const a = parseInt(el.dataset.addr ?? '', 16);
            if (a >= this._mirrorRange.start && a <= this._mirrorRange.end) { el.classList.add('sel-mirror'); }
        }
    }

    private applyColumn(col?: number): void {
        this._column = col ?? this._column;
        const scope = this.rootSel;
        document.querySelectorAll(`${scope} .data-cell.col-hi`).forEach(el => el.classList.remove('col-hi'));
        document.querySelectorAll(`${scope} .diff-header .hcell.col-hi`).forEach(el => el.classList.remove('col-hi'));
        if (this._column < 0) { return; }
        for (const el of document.querySelectorAll<HTMLElement>(`${scope} .data-cell[data-addr]`)) {
            const a = parseInt(el.dataset.addr ?? '', 16);
            if (a >= 0 && (a & 0xF) === this._column) { el.classList.add('col-hi'); }
        }
        for (const el of document.querySelectorAll<HTMLElement>(`${scope} .diff-header .hcell[data-col]`)) {
            if (parseInt(el.dataset.col ?? '', 10) === this._column) { el.classList.add('col-hi'); }
        }
    }
}

