// Reusable hexview component: optional filename label + 00..0F header +
// (address gutter + hex cells), with its own hover / selection / column-hover
// interaction. Emits callbacks so a host (e.g. the diff view) can paint
// cross-panel highlights. Reusable later by the single-file hex view.

import type { DiffCell } from '../../core/diff';
import { DIFF_ROW_BYTES, DIFF_ROW_HEIGHT, formatAddress, type DiffVisualRow } from './diffViewModel';
import { esc } from '../utils';

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
    searchRowIndex: number;
    matchSet: ReadonlySet<number>;
    error: string | null;
    visibleRange: [number, number];
    totalHeight: number;
}

function byteText(cell: DiffCell | null): string {
    return cell && cell.present ? cell.byte.toString(16).toUpperCase().padStart(2, '0') : '··';
}

function cellClass(cell: DiffCell | null, status: string, isMatch: boolean): string {
    const cls = !cell || !cell.present ? 'data-cell empty' : `data-cell ${status}`;
    return isMatch && cell?.present ? `${cls} match` : cls;
}

function cellHtml(cell: DiffCell | null, status: string, isMatch: boolean, side: 'a' | 'b', addr: number): string {
    return `<span class="${cellClass(cell, status, isMatch)}" data-addr="${esc(formatAddress(addr))}" data-side="${side}">${byteText(cell)}</span>`;
}

function rowHtml(vr: DiffVisualRow, side: 'a' | 'b', index: number, isSearchRow: boolean, matchSet: ReadonlySet<number>, error: string | null): string {
    const addr = esc(formatAddress(vr.baseAddress));
    const cells: string[] = [];
    for (let j = 0; j < DIFF_ROW_BYTES; j++) {
        const byteAddr = vr.baseAddress + j;
        const cell = side === 'a' ? vr.a[j] : vr.b[j];
        cells.push(cellHtml(cell, vr.statuses[j], matchSet.has(byteAddr), side, byteAddr));
    }
    return `<div class="diff-row" data-addr="${addr}" style="top:${index * DIFF_ROW_HEIGHT}px">
        <span class="addr">${addr}</span>
        <div class="side${isSearchRow ? ' search-row' : ''}${error ? ' panel-error' : ''}">${cells.join('')}</div>
    </div>`;
}

function headerHtml(): string {
    const cells: string[] = [];
    for (let i = 0; i < DIFF_ROW_BYTES; i++) {
        cells.push(`<span class="hcell">${esc(i.toString(16).toUpperCase().padStart(2, '0'))}</span>`);
    }
    return `<span class="addr"></span><div class="side">${cells.join('')}</div>`;
}

/** Pure HTML for one component (testable without DOM). */
export function renderHexViewComponentHtml(side: 'a' | 'b', input: HexViewRenderInput): string {
    const rows: string[] = [];
    for (let i = input.visibleRange[0]; i < input.visibleRange[1] && i < input.rows.length; i++) {
        rows.push(rowHtml(input.rows[i], side, i, i === input.searchRowIndex, input.matchSet, input.error));
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
            if (c) { this.cb.onHover?.(c.addr); }
        });
        on('mouseout', e => {
            if (cell(e.target)) { this.cb.onLeave?.(); }
        });
        on('mouseup', () => { this._dragging = false; });

        on('mouseover', e => {
            const h = (e.target as HTMLElement).closest?.(`${this.rootSel} .diff-header .hcell`) as HTMLElement | null;
            if (!h) { return; }
            const col = Array.prototype.indexOf.call(h.parentElement?.children ?? [], h);
            this.applyColumn(col);
            this.cb.onColumnHover?.(col);
        });
        on('mouseout', e => {
            if ((e.target as HTMLElement).closest?.(`${this.rootSel} .diff-header .hcell`)) {
                this.applyColumn(-1);
                this.cb.onColumnLeave?.();
            }
        });
    }

    destroy(): void {
        for (const [type, fn] of this._listeners) { document.removeEventListener(type, fn); }
        this._listeners.length = 0;
        this._mounted = false;
    }

    getSelection(): HexViewRange | null { return this._selection; }
    setSelection(range: HexViewRange | null): void { this._selection = range; this.applySel(); }

    /** Paint the hovered-by-the-other-side address in this component. */
    setMirrorAddr(addr: number): void { this._mirrorAddr = addr; this.applyMirror(); }
    /** Paint the selected-by-the-other-side range in this component. */
    setMirrorRange(range: HexViewRange | null): void { this._mirrorRange = range; this.applyMirrorRange(); }
    /** Paint a byte column in this component (from either header's hover). */
    setColumn(col: number): void { this.applyColumn(col); }

    /** Re-apply transient paints after the DOM is rebuilt. */
    reapply(): void { this.applySel(); this.applyMirror(); this.applyMirrorRange(); this.applyColumn(); }

    private applySel(): void {
        const scope = this.rootSel;
        document.querySelectorAll(`${scope} .data-cell.sel`).forEach(el => el.classList.remove('sel'));
        if (!this._selection) { return; }
        for (const el of document.querySelectorAll<HTMLElement>(`${scope} .data-cell[data-addr]`)) {
            const a = parseInt(el.dataset.addr ?? '', 16);
            if (a >= this._selection.start && a <= this._selection.end) { el.classList.add('sel'); }
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
        if (this._column < 0) { return; }
        for (const el of document.querySelectorAll<HTMLElement>(`${scope} .data-cell[data-addr]`)) {
            const a = parseInt(el.dataset.addr ?? '', 16);
            if (a >= 0 && (a & 0xF) === this._column) { el.classList.add('col-hi'); }
        }
    }
}

