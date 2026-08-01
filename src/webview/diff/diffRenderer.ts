// Diff renderer — renders aligned 16-byte visual rows as two byte panels.

import type { DiffResult } from '../../core/diff';
import type { DiffCell } from '../../core/diff';
import { DIFF_ROW_BYTES, DIFF_ROW_HEIGHT, formatAddress, type DiffVisualRow } from './diffViewModel';
import { esc } from '../utils';

export interface DiffSelection {
    side: 'a' | 'b';
    start: number;
    end: number;
}

export interface DiffRenderState {
    result: DiffResult | null;
    /** Grouped 16-byte visual rows (derived from `result`). */
    visualRows: DiffVisualRow[];
    /** Visual-row index that holds the current search focus. */
    searchRowIndex: number;
    /** Byte addresses with search matches, for per-cell highlighting. */
    matchSet: ReadonlySet<number>;
    /** Per-side parse errors (null = side is valid). */
    aError: string | null;
    bError: string | null;
    /** Per-panel byte selection (addresses inclusive), or null. */
    selection: DiffSelection | null;
}

function byteText(cell: DiffCell | null): string {
    return cell && cell.present ? cell.byte.toString(16).toUpperCase().padStart(2, '0') : '··';
}

function isSelected(selection: DiffSelection | null, side: 'a' | 'b', addr: number): boolean {
    return selection !== null && selection.side === side && addr >= selection.start && addr <= selection.end;
}

function cellClass(cell: DiffCell | null, status: string, isMatch: boolean, selected: boolean): string {
    const cls = !cell || !cell.present ? 'data-cell empty' : `data-cell ${status}`;
    if (selected) { return `${cls} sel`; }
    return isMatch && cell?.present ? `${cls} match` : cls;
}

function sideError(error: string | null): string {
    return error ? ' panel-error' : '';
}

function rowHtml(vr: DiffVisualRow, isSearchRow: boolean, topPx: number, state: DiffRenderState): string {
    const addr = esc(formatAddress(vr.baseAddress));
    const aCols: string[] = [];
    const bCols: string[] = [];
    for (let i = 0; i < DIFF_ROW_BYTES; i++) {
        const byteAddr = vr.baseAddress + i;
        const addrText = esc(formatAddress(byteAddr));
        const isMatch = state.matchSet.has(byteAddr);
        aCols.push(`<span class="${cellClass(vr.a[i], vr.statuses[i], isMatch, isSelected(state.selection, 'a', byteAddr))}" data-addr="${addrText}" data-side="a">${byteText(vr.a[i])}</span>`);
        bCols.push(`<span class="${cellClass(vr.b[i], vr.statuses[i], isMatch, isSelected(state.selection, 'b', byteAddr))}" data-addr="${addrText}" data-side="b">${byteText(vr.b[i])}</span>`);
    }
    return `<div class="diff-row" data-addr="${addr}" style="top:${topPx}px">
        <span class="addr a">${addr}</span>
        <div class="side a${isSearchRow ? ' search-row' : ''}${sideError(state.aError)}">${aCols.join('')}</div>
        <span class="addr b">${addr}</span>
        <div class="side b${isSearchRow ? ' search-row' : ''}${sideError(state.bError)}">${bCols.join('')}</div>
    </div>`;
}

/** Fixed column header: 00..0F byte offsets over each panel, sticky at the top. */
export function renderDiffHeaderHtml(state: DiffRenderState): string {
    const cells: string[] = [];
    for (let i = 0; i < DIFF_ROW_BYTES; i++) {
        cells.push(`<span class="hcell">${esc(i.toString(16).toUpperCase().padStart(2, '0'))}</span>`);
    }
    return `<div class="diff-header">
        <span class="addr a"></span>
        <div class="side a">${cells.join('')}</div>
        <span class="addr b"></span>
        <div class="side b">${cells.join('')}</div>
    </div>`;
}

/** Build the visible window of visual rows using fixed-height windowing. */
export function renderDiffRowsHtml(
    state: DiffRenderState,
    visibleRange: [number, number],
    totalHeight: number,
): string {
    const parts = [];
    for (let i = visibleRange[0]; i < visibleRange[1] && i < state.visualRows.length; i++) {
        parts.push(rowHtml(state.visualRows[i], i === state.searchRowIndex, i * DIFF_ROW_HEIGHT, state));
    }
    return `<div class="diff-body" style="height:${totalHeight}px">${parts.join('')}</div>`;
}

export function renderDiffSummaryHtml(state: DiffRenderState): string {
    if (!state.result) { return ''; }
    if (state.result.identical && !state.aError && !state.bError) {
        return '<div class="diff-summary identical">Files are identical</div>';
    }
    return '';
}
