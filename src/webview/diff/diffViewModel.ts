// Diff view model — pure state for the HexScope diff webview.
// No DOM, no vscode API: unit-testable in isolation.

import type {
    DiffResult,
    DiffRow,
} from '../../core/diff';

export const DIFF_ROW_BYTES = 16;

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

/** Next/prev difference run boundary relative to `current` address (wraps). */
export function diffRunFocus(result: DiffResult, current: number, direction: 1 | -1): DiffFocus | null {
    if (!result || result.runs.length === 0) { return null; }
    const idx = result.runs.findIndex(r => r.start <= current && current < r.end);
    let next = idx < 0 ? 0 : idx + direction;
    if (next < 0) { next = result.runs.length - 1; }
    if (next >= result.runs.length) { next = 0; }
    const address = result.runs[next].start;
    return { address, rowIndex: rowIndexForAddress(result, address), column: 0 };
}

/** Next/prev search match address relative to `current` (wraps). */
export function searchMatchFocus(result: DiffResult, matches: number[], current: number, direction: 1 | -1): DiffFocus | null {
    if (!result || matches.length === 0) { return null; }
    const idx = matches.indexOf(current);
    const next = idx < 0 ? 0 : (idx + direction + matches.length) % matches.length;
    const address = matches[next];
    const rowIndex = rowIndexForAddress(result, address);
    if (rowIndex < 0) { return null; }
    return { address, rowIndex, column: columnForAddress(result.rows[rowIndex], address) };
}

export function formatAddress(address: number): string {
    return address.toString(16).toUpperCase().padStart(8, '0');
}

export function esc(s: string): string {
    return s.replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c] as string));
}

