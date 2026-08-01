// Diff renderer — renders one aligned diff row as two byte panels.

import type { DiffResult, DiffRow } from '../../core/diff';
import { DIFF_ROW_BYTES, esc, formatAddress } from './diffViewModel';

export interface DiffRenderState {
    result: DiffResult | null;
    /** Row index that holds the current search focus. */
    searchRowIndex: number;
}

function byteText(cell: DiffRow['a']): string {
    return cell && cell.present ? cell.byte.toString(16).toUpperCase().padStart(2, '0') : '··';
}

function cellClass(cell: DiffRow['a'], status: DiffRow['status']): string {
    if (!cell || !cell.present) { return 'cell empty'; }
    return `cell ${status}`;
}

function rowHtml(row: DiffRow, isSearchRow: boolean): string {
    const addr = esc(formatAddress(row.address));
    const aCols: string[] = [];
    const bCols: string[] = [];
    for (let i = 0; i < DIFF_ROW_BYTES; i++) {
        aCols.push(`<span class="${cellClass(row.a, row.status)}">${byteText(row.a)}</span>`);
        bCols.push(`<span class="${cellClass(row.b, row.status)}">${byteText(row.b)}</span>`);
    }
    return `<div class="diff-row" data-addr="${addr}">
        <span class="addr">${addr}</span>
        <div class="side a${isSearchRow ? ' search-row' : ''}">${aCols.join('')}</div>
        <div class="side b${isSearchRow ? ' search-row' : ''}">${bCols.join('')}</div>
    </div>`;
}

/** Build the visible window of rows using fixed-height windowing. */
export function renderDiffRowsHtml(
    state: DiffRenderState,
    visibleRange: [number, number],
    totalHeight: number,
    scrollTop: number,
): string {
    const rows = state.result?.rows ?? [];
    const parts = rows
        .slice(visibleRange[0], visibleRange[1])
        .map((row, i) => rowHtml(row, visibleRange[0] + i === state.searchRowIndex));
    return `<div class="diff-body" style="height:${totalHeight}px;transform:translateY(${scrollTop}px)">${parts.join('')}</div>`;
}

export function renderDiffSummaryHtml(state: DiffRenderState): string {
    const r = state.result;
    if (!r) { return ''; }
    if (r.identical) { return '<div class="diff-summary identical">Files are identical</div>'; }
    const { changed, added, removed } = r.summary;
    return `<div class="diff-summary">Changed <b>${changed}</b> · Added <b>${added}</b> · Removed <b>${removed}</b> · ${r.runs.length} regions</div>`;
}
