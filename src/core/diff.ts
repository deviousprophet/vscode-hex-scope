// Pure hex diff engine. No `vscode`, no DOM — testable in isolation.
// Computes a byte-level diff between two parsed firmware images aligned by
// memory address. Designed for large files: the full scan produces only a
// light metadata pass (row starts + per-row hasDiff + summary + runs); the
// webview computes per-window cells on demand via `diffCellWindow`.

import type { CompactParseResult } from './parser/compact';
import type { SerializedParseResult } from './types';
import { buildSegmentIndex, getByteAt, type SegmentIndexEntry } from './memory';

export const DIFF_BPR = 16;

export type DiffByteStatus = 'unchanged' | 'changed' | 'added' | 'removed' | 'empty';

export interface DiffCell {
    present: boolean;
    byte: number;
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

/**
 * Light full-scan metadata for a pair. `rowStarts` is the BPR-aligned union
 * row set (sorted); `hasDiff[i]` is 1 when union row `i` contains any
 * changed/added/removed address. No per-cell data is materialized.
 */
export interface DiffMeta {
    rowStarts: Uint32Array;
    hasDiff: Uint8Array;
    summary: DiffSummary;
    runs: DiffRun[];
    identical: boolean;
    totalRows: number;
}

/** One 16-byte window of per-address cells + statuses for both panels. */
export interface DiffCellWindow {
    baseAddress: number;
    a: Array<DiffCell | null>;
    b: Array<DiffCell | null>;
    statuses: DiffByteStatus[];
}

/** Shared empty edit map: the diff view never edits bytes. */
const NO_EDITS = new Map<number, number>();

type SegmentInput = { startAddress: number; data: Uint8Array };

function segmentList(result: CompactParseResult | null): SegmentInput[] {
    return result?.segments ?? [];
}

/**
 * Sorted, deduped, BPR-aligned union of both files' row starts.
 * A leading aligned row is prepended when the first segment starts
 * mid-row, so both panels share the same aligned gutter.
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

/** Per-address status from both sides' bytes. */
export function statusFor(a: number | undefined, b: number | undefined): DiffByteStatus {
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

export function isChange(status: DiffByteStatus): boolean {
    return status !== 'unchanged' && status !== 'empty';
}

function isIdentical(summary: DiffSummary): boolean {
    return summary.changed === 0 && summary.added === 0 && summary.removed === 0;
}

export function cellFor(byte: number | undefined): DiffCell | null {
    return byte === undefined ? null : { present: true, byte };
}

/** Close an open run ending just before `beforeAddr`; returns the new run start (-1). */
function closeRun(runs: DiffRun[], runStart: number, beforeAddr: number): number {
    if (runStart < 0) { return -1; }
    runs.push({ start: runStart, end: beforeAddr - 1 });
    return -1;
}

/**
 * One synchronous O(bytes) scan producing the light metadata pass for a pair.
 * Runs = contiguous non-unchanged (changed/added/removed) addresses, merged
 * across row boundaries.
 */
export function buildDiffMeta(aResult: CompactParseResult | null, bResult: CompactParseResult | null): DiffMeta {
    const aIndex = buildSegmentIndex(aResult as never);
    const bIndex = buildSegmentIndex(bResult as never);
    const starts = unionRowStarts(segmentList(aResult), segmentList(bResult));
    const summary: DiffSummary = { unchanged: 0, changed: 0, added: 0, removed: 0 };
    const rowStarts = new Uint32Array(starts.length);
    const hasDiff = new Uint8Array(starts.length);
    const runs: DiffRun[] = [];
    let runStart = -1;

    for (let r = 0; r < starts.length; r++) {
        const base = starts[r];
        rowStarts[r] = base;
        for (let i = 0; i < DIFF_BPR; i++) {
            const addr = base + i;
            const aByte = getByteAt(aResult as never, aIndex, NO_EDITS, addr);
            const bByte = getByteAt(bResult as never, bIndex, NO_EDITS, addr);
            const status = statusFor(aByte, bByte);
            bumpSummary(summary, status);
            if (isChange(status)) {
                if (runStart < 0) { runStart = addr; }
                hasDiff[r] = 1;
            } else {
                runStart = closeRun(runs, runStart, addr);
            }
        }
    }
    if (starts.length > 0) {
        runStart = closeRun(runs, runStart, starts[starts.length - 1] + DIFF_BPR);
    }

    return { rowStarts, hasDiff, summary, runs, identical: isIdentical(summary), totalRows: starts.length };
}

/**
 * Compute the 16-byte cell window at `baseAddress` for both sides, reading
 * bytes lazily from the segment indexes. Empty cells where a side lacks data.
 */
export function diffCellWindow(
    aResult: SerializedParseResult | null,
    aIndex: readonly SegmentIndexEntry[],
    bResult: SerializedParseResult | null,
    bIndex: readonly SegmentIndexEntry[],
    baseAddress: number,
): DiffCellWindow {
    const a: Array<DiffCell | null> = [];
    const b: Array<DiffCell | null> = [];
    const statuses: DiffByteStatus[] = [];
    for (let i = 0; i < DIFF_BPR; i++) {
        const addr = baseAddress + i;
        const aByte = getByteAt(aResult, aIndex, NO_EDITS, addr);
        const bByte = getByteAt(bResult, bIndex, NO_EDITS, addr);
        a.push(cellFor(aByte));
        b.push(cellFor(bByte));
        statuses.push(statusFor(aByte, bByte));
    }
    return { baseAddress, a, b, statuses };
}
