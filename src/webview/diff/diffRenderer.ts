// Diff renderer — renders one reusable "hexview component" per file.
// A component = optional filename label + 00..0F header + (address gutter + cells).
// The diff view places two components side by side with a single separator.

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

function cellHtml(cell: DiffCell | null, status: string, isMatch: boolean, selected: boolean, side: 'a' | 'b', addr: number): string {
    return `<span class="${cellClass(cell, status, isMatch, selected)}" data-addr="${esc(formatAddress(addr))}" data-side="${side}">${byteText(cell)}</span>`;
}

function sideRowHtml(vr: DiffVisualRow, side: 'a' | 'b', index: number, isSearchRow: boolean, state: DiffRenderState): string {
    const addr = esc(formatAddress(vr.baseAddress));
    const error = side === 'a' ? state.aError : state.bError;
    const cells: string[] = [];
    for (let j = 0; j < DIFF_ROW_BYTES; j++) {
        const byteAddr = vr.baseAddress + j;
        const cell = side === 'a' ? vr.a[j] : vr.b[j];
        cells.push(cellHtml(cell, vr.statuses[j], state.matchSet.has(byteAddr), isSelected(state.selection, side, byteAddr), side, byteAddr));
    }
    return `<div class="diff-row" data-addr="${addr}" style="top:${index * DIFF_ROW_HEIGHT}px">
        <span class="addr">${addr}</span>
        <div class="side${isSearchRow ? ' search-row' : ''}${sideError(error)}">${cells.join('')}</div>
    </div>`;
}

function headerSideHtml(): string {
    const cells: string[] = [];
    for (let i = 0; i < DIFF_ROW_BYTES; i++) {
        cells.push(`<span class="hcell">${esc(i.toString(16).toUpperCase().padStart(2, '0'))}</span>`);
    }
    return `<span class="addr"></span><div class="side">${cells.join('')}</div>`;
}

/**
 * Render one reusable hexview component for a single side.
 * `label` is optional: an empty string omits the filename row.
 */
export function renderDiffComponentHtml(
    state: DiffRenderState,
    side: 'a' | 'b',
    label: string,
    visibleRange: [number, number],
    totalHeight: number,
): string {
    const rows: string[] = [];
    for (let i = visibleRange[0]; i < visibleRange[1] && i < state.visualRows.length; i++) {
        rows.push(sideRowHtml(state.visualRows[i], side, i, i === state.searchRowIndex, state));
    }
    return `<div class="diff-component ${side}">
        ${label ? `<div class="panel-label">${esc(label)}</div>` : ''}
        <div class="diff-header">${headerSideHtml()}</div>
        <div class="diff-body" style="height:${totalHeight}px">${rows.join('')}</div>
    </div>`;
}

export function renderDiffSummaryHtml(state: DiffRenderState): string {
    if (!state.result) { return ''; }
    if (state.result.identical && !state.aError && !state.bError) {
        return '<div class="diff-summary identical">Files are identical</div>';
    }
    return '';
}
