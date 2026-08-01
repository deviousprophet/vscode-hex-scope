// Pure hex diff engine. No `vscode`, no DOM — testable in isolation.
// Computes a byte-level diff between two parsed firmware images aligned by
// memory address (PRD D3/D4/D5/D16).

import type { CompactParseResult } from './parser/compact';
import { buildSegmentIndex, getByteAt } from './memory';

export const DIFF_BPR = 16;

export type DiffByteStatus = 'unchanged' | 'changed' | 'added' | 'removed' | 'empty';

export interface DiffCell {
    present: boolean;
    byte: number;
}

export interface DiffRow {
    address: number;
    a: DiffCell | null;
    b: DiffCell | null;
    status: DiffByteStatus;
}

export interface DiffRun {
    start: number;
    end: number;
}

export interface DiffSummary {
    unchanged: number;
    changed: number;
    added: number;
    removed: number;
}

export interface DiffResult {
    rows: DiffRow[];
    summary: DiffSummary;
    runs: DiffRun[];
    totalBytes: number;
    identical: boolean;
}

type SegmentInput = { startAddress: number; data: Uint8Array };

function segmentList(result: CompactParseResult | null): SegmentInput[] {
    return result?.segments ?? [];
}

/**
 * Sorted, deduped, BPR-aligned union of both files' row starts (D5).
 * A leading aligned row is prepended when the first segment starts
 * mid-row, so both panels share the same aligned gutter (AC2b).
 */
function unionRowStarts(aSegs: readonly SegmentInput[], bSegs: readonly SegmentInput[]): number[] {
    const set = new Set<number>();
    for (const seg of [...aSegs, ...bSegs]) {
        for (let row = firstRowOf(seg); row <= lastRowOf(seg); row += DIFF_BPR) {
            set.add(row);
        }
    }
    const rows = [...set].sort((a, b) => a - b);
    if (needsLeadingRow(rows)) {
        rows.unshift(rows[0] - (rows[0] % DIFF_BPR));
    }
    return rows;
}

function firstRowOf(seg: SegmentInput): number {
    return seg.startAddress - (seg.startAddress % DIFF_BPR);
}

function lastRowOf(seg: SegmentInput): number {
    return seg.startAddress + seg.data.length - 1 - ((seg.startAddress + seg.data.length - 1) % DIFF_BPR);
}

function needsLeadingRow(rows: readonly number[]): boolean {
    return rows.length > 0 && rows[0] % DIFF_BPR !== 0;
}

function bothMissing(a: number | undefined, b: number | undefined): boolean {
    return a === undefined && b === undefined;
}

/** Per-address status from both sides' bytes (D4). */
function statusFor(a: number | undefined, b: number | undefined): DiffByteStatus {
    if (bothMissing(a, b)) { return 'empty'; }
    if (a === undefined) { return 'added'; }
    if (b === undefined) { return 'removed'; }
    return a === b ? 'unchanged' : 'changed';
}

function bumpSummary(summary: DiffSummary, status: DiffByteStatus): void {
    const key = status === 'empty' ? null : status;
    if (key === null) { return; }
    summary[key]++;
}

function isChange(status: DiffByteStatus): boolean {
    return status !== 'unchanged' && status !== 'empty';
}

function isIdentical(summary: DiffSummary): boolean {
    return summary.changed === 0 && summary.added === 0 && summary.removed === 0;
}

/** Runs (D16) = contiguous non-unchanged addresses, merged across row boundaries. */
function extractRuns(rows: readonly DiffRow[]): DiffRun[] {
    const runs: DiffRun[] = [];
    let start = -1;
    for (const row of rows) {
        start = absorbRow(runs, start, row);
    }
    if (start >= 0) { runs.push({ start, end: rows[rows.length - 1].address }); }
    return runs;
}

/** Fold one row into the run accumulator; returns the new open-run start (-1 = none). */
function absorbRow(runs: DiffRun[], start: number, row: DiffRow): number {
    if (isChange(row.status)) {
        return start < 0 ? row.address : start;
    }
    if (start >= 0) { runs.push({ start, end: row.address - 1 }); }
    return -1;
}

function cellFor(byte: number | undefined): DiffCell | null {
    return byte === undefined ? null : { present: true, byte };
}

/** Build one aligned diff row (address + both cells + status) and count it. */
function diffRowFor(addr: number, aByte: number | undefined, bByte: number | undefined, summary: DiffSummary): DiffRow {
    const status = statusFor(aByte, bByte);
    bumpSummary(summary, status);
    return { address: addr, a: cellFor(aByte), b: cellFor(bByte), status };
}

/**
 * Build the aligned diff between two parsed firmware images.
 *
 * Alignment: union of both files' row spans (D5). A cell is `null` when that
 * side has no byte at an address (`getByteAt` returns undefined for unmapped).
 * Status per address (D4); added/removed are per-address statuses, not
 * structures.
 */
export function computeDiff(aResult: CompactParseResult | null, bResult: CompactParseResult | null): DiffResult {
    const aIndex = buildSegmentIndex(aResult as never);
    const bIndex = buildSegmentIndex(bResult as never);
    const noEdits = new Map<number, number>();
    const summary: DiffSummary = { unchanged: 0, changed: 0, added: 0, removed: 0 };
    const diffRows: DiffRow[] = [];

    for (const rowStart of unionRowStarts(segmentList(aResult), segmentList(bResult))) {
        for (let i = 0; i < DIFF_BPR; i++) {
            const addr = rowStart + i;
            const aByte = getByteAt(aResult as never, aIndex, noEdits, addr);
            const bByte = getByteAt(bResult as never, bIndex, noEdits, addr);
            diffRows.push(diffRowFor(addr, aByte, bByte, summary));
        }
    }

    return {
        rows: diffRows,
        summary,
        runs: extractRuns(diffRows),
        totalBytes: diffRows.length,
        identical: isIdentical(summary),
    };
}
