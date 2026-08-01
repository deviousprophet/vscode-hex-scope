// Diff view model — pure state for the HexScope diff webview.
// No DOM, no vscode API: unit-testable in isolation.

import type {
    DiffResult,
    DiffRow,
} from '../../core/diff';
import { DIFF_BPR } from '../../core/diff';

/** Row width in bytes; single source of truth is `DIFF_BPR` in core/diff.ts. */
export const DIFF_ROW_BYTES = DIFF_BPR;

/** Fixed row height in px; must match `.diff-row` height in diff.css. */
export const DIFF_ROW_HEIGHT = 22;

/** Index of the row containing `address`, or -1. */
export function rowIndexForAddress(result: DiffResult, address: number): number {
    return result.rows.findIndex(row => row.address <= address && address < row.address + DIFF_ROW_BYTES);
}

/** Byte offset (0-15) of `address` inside its row. */
export function columnForAddress(row: DiffRow, address: number): number {
    return address - row.address;
}

export interface DiffFocus {
    address: number;
    rowIndex: number;
    column: number;
}

/** One 16-byte visual row: per-address cells + statuses for both panels. */
export interface DiffVisualRow {
    baseAddress: number;
    a: Array<{ present: boolean; byte: number } | null>;
    b: Array<{ present: boolean; byte: number } | null>;
    statuses: DiffRow['status'][];
}

/**
 * Group per-address diff rows (one per byte) into 16-byte visual rows.
 * `computeDiff` emits `DIFF_ROW_BYTES` consecutive address rows per aligned
 * block (empty cells for missing data), so chunking is contiguous.
 */
export function groupVisualRows(rows: readonly DiffRow[]): DiffVisualRow[] {
    const visual: DiffVisualRow[] = [];
    for (let i = 0; i < rows.length; i += DIFF_ROW_BYTES) {
        const chunk = rows.slice(i, i + DIFF_ROW_BYTES);
        visual.push({
            baseAddress: chunk[0].address,
            a: chunk.map(r => r.a),
            b: chunk.map(r => r.b),
            statuses: chunk.map(r => r.status),
        });
    }
    return visual;
}

/** Index of the visual row containing `address`, or -1. */
export function visualRowIndexForAddress(visualRows: readonly DiffVisualRow[], address: number): number {
    return visualRows.findIndex(r => address >= r.baseAddress && address < r.baseAddress + DIFF_ROW_BYTES);
}

/** Wrap an index into [0, len) moving by `direction` from `current`; `current < 0` starts at 0. */
function wrapIndex(len: number, current: number, direction: 1 | -1): number {
    if (current < 0) { return 0; }
    return (current + direction + len) % len;
}

/** Next/prev difference run boundary relative to `current` address (wraps). */
export function diffRunFocus(result: DiffResult, current: number, direction: 1 | -1): DiffFocus | null {
    if (!result || result.runs.length === 0) { return null; }
    const idx = result.runs.findIndex(r => r.start <= current && current < r.end);
    const next = wrapIndex(result.runs.length, idx, direction);
    const address = result.runs[next].start;
    return { address, rowIndex: rowIndexForAddress(result, address), column: 0 };
}

/** Next/prev search match address relative to `current` (wraps). */
export function searchMatchFocus(result: DiffResult, matches: number[], current: number, direction: 1 | -1): DiffFocus | null {
    if (!result || matches.length === 0) { return null; }
    const idx = matches.indexOf(current);
    const next = wrapIndex(matches.length, idx, direction);
    const address = matches[next];
    const rowIndex = rowIndexForAddress(result, address);
    if (rowIndex < 0) { return null; }
    return { address, rowIndex, column: columnForAddress(result.rows[rowIndex], address) };
}

export function formatAddress(address: number): string {
    return address.toString(16).toUpperCase().padStart(8, '0');
}

