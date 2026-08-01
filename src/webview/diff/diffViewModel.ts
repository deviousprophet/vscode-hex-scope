// Diff view model — pure state for the HexScope diff webview.
// No DOM, no vscode API: unit-testable in isolation.
// The webview holds a light full row list (address + hasDiff) plus the two
// segment indexes; per-window cells are computed on scroll via `diffCellWindow`.

import type { DiffCell, DiffByteStatus, DiffMeta } from '../../core/diff';
import { DIFF_BPR } from '../../core/diff';

/** Row width in bytes; single source of truth is `DIFF_BPR` in core/diff.ts. */
export const DIFF_ROW_BYTES = DIFF_BPR;

/** Fixed row height in px; must match `.diff-row` height in diff.css. */
export const DIFF_ROW_HEIGHT = 22;

/** One lightweight union row: address + whether it contains a diff. */
export interface DiffLightRow {
    baseAddress: number;
    hasDiff: boolean;
}

/** One 16-byte visual row: per-address cells + statuses for both panels. */
export interface DiffVisualRow {
    baseAddress: number;
    a: Array<DiffCell | null>;
    b: Array<DiffCell | null>;
    statuses: DiffByteStatus[];
}

/** Build the light full row list from the meta pass (no per-cell data). */
export function groupVisualRows(meta: DiffMeta): DiffLightRow[] {
    const rows: DiffLightRow[] = new Array(meta.totalRows);
    const starts = meta.rowStarts;
    for (let i = 0; i < starts.length; i++) {
        rows[i] = { baseAddress: starts[i], hasDiff: meta.hasDiff[i] === 1 };
    }
    return rows;
}

/** Index of the union row containing `address`, or -1 (gaps included). */
export function rowIndexForAddress(meta: DiffMeta | null, address: number): number {
    if (!meta) { return -1; }
    const starts = meta.rowStarts;
    let lo = 0;
    let hi = starts.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        const base = starts[mid];
        if (address < base) { hi = mid - 1; }
        else if (address >= base + DIFF_ROW_BYTES) { lo = mid + 1; }
        else { return mid; }
    }
    return -1;
}

/** Byte offset (0-15) of `address` inside its BPR-aligned row. */
export function columnForAddress(baseAddress: number, address: number): number {
    return address - baseAddress;
}

export interface DiffFocus {
    address: number;
    rowIndex: number;
    column: number;
}

/**
 * Index of the visual row containing `address` among `rows` (sorted by
 * baseAddress), or -1. Rows may skip address ranges (gaps): an address that
 * falls between rows is not part of any row.
 */
export function visualRowIndexForAddress(rows: readonly { baseAddress: number }[], address: number): number {
    let lo = 0;
    let hi = rows.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        const base = rows[mid].baseAddress;
        if (address < base) { hi = mid - 1; }
        else if (address >= base + DIFF_ROW_BYTES) { lo = mid + 1; }
        else { return mid; }
    }
    return -1;
}

/** Wrap an index into [0, len) moving by `direction` from `current`; `current < 0` starts at 0. */
function wrapIndex(len: number, current: number, direction: 1 | -1): number {
    if (current < 0) { return 0; }
    return (current + direction + len) % len;
}

/** Next/prev difference run boundary relative to `current` address (wraps). */
export function diffRunFocus(meta: DiffMeta | null, current: number, direction: 1 | -1): DiffFocus | null {
    if (!meta || meta.runs.length === 0) { return null; }
    const idx = meta.runs.findIndex(r => r.start <= current && current <= r.end);
    const next = wrapIndex(meta.runs.length, idx, direction);
    const address = meta.runs[next].start;
    const rowIndex = rowIndexForAddress(meta, address);
    if (rowIndex < 0) { return null; }
    return { address, rowIndex, column: address - meta.rowStarts[rowIndex] };
}

/** Next/prev search match address relative to `current` (wraps). */
export function searchMatchFocus(meta: DiffMeta | null, matches: number[], current: number, direction: 1 | -1): DiffFocus | null {
    if (!meta || matches.length === 0) { return null; }
    const idx = matches.indexOf(current);
    const next = wrapIndex(matches.length, idx, direction);
    const address = matches[next];
    const rowIndex = rowIndexForAddress(meta, address);
    if (rowIndex < 0) { return null; }
    return { address, rowIndex, column: address - meta.rowStarts[rowIndex] };
}

export function formatAddress(address: number): string {
    return address.toString(16).toUpperCase().padStart(8, '0');
}
