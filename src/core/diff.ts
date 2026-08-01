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
        const firstRow = seg.startAddress - (seg.startAddress % DIFF_BPR);
        const lastRow = (seg.startAddress + seg.data.length - 1) - ((seg.startAddress + seg.data.length - 1) % DIFF_BPR);
        for (let row = firstRow; row <= lastRow; row += DIFF_BPR) {
            set.add(row);
        }
    }
    const rows = [...set].sort((a, b) => a - b);
    if (rows.length > 0 && rows[0] % DIFF_BPR !== 0) {
        rows.unshift(rows[0] - (rows[0] % DIFF_BPR));
    }
    return rows;
}

/**
 * Build the aligned diff between two parsed firmware images.
 *
 * Alignment: union of both files' row spans (D5). A cell is `null` when that
 * side has no byte at an address (`getByteAt` returns undefined for unmapped).
 * Status per address (D4); added/removed are per-address statuses, not
 * structures. Runs (D16) = contiguous non-unchanged addresses, merged across
 * row boundaries.
 */
export function computeDiff(aResult: CompactParseResult | null, bResult: CompactParseResult | null): DiffResult {
    const aSegs = segmentList(aResult);
    const bSegs = segmentList(bResult);
    const aIndex = buildSegmentIndex(aResult as never);
    const bIndex = buildSegmentIndex(bResult as never);
    const noEdits = new Map<number, number>();

    const rows = unionRowStarts(aSegs, bSegs);

    const summary: DiffSummary = { unchanged: 0, changed: 0, added: 0, removed: 0 };
    const diffRows: DiffRow[] = [];
    const runs: DiffRun[] = [];
    let runStart = -1;

    const closeRun = (addr: number): void => {
        if (runStart >= 0) {
            runs.push({ start: runStart, end: addr - 1 });
            runStart = -1;
        }
    };

    for (const row of rows) {
        for (let i = 0; i < DIFF_BPR; i++) {
            const addr = row + i;
            const aByte = getByteAt(aResult as never, aIndex, noEdits, addr);
            const bByte = getByteAt(bResult as never, bIndex, noEdits, addr);

            let status: DiffByteStatus;
            if (aByte === undefined && bByte === undefined) {
                status = 'empty';
            } else if (aByte === undefined) {
                status = 'added';
            } else if (bByte === undefined) {
                status = 'removed';
            } else if (aByte === bByte) {
                status = 'unchanged';
            } else {
                status = 'changed';
            }

            switch (status) {
                case 'unchanged': summary.unchanged++; break;
                case 'changed':   summary.changed++;   break;
                case 'added':     summary.added++;     break;
                case 'removed':   summary.removed++;   break;
            }

            diffRows.push({
                address: addr,
                a: aByte === undefined ? null : { present: true, byte: aByte },
                b: bByte === undefined ? null : { present: true, byte: bByte },
                status,
            });

            if (status === 'unchanged' || status === 'empty') {
                closeRun(addr);
            } else if (runStart < 0) {
                runStart = addr;
            }
        }
    }
    closeRun(rows.length > 0 ? rows[rows.length - 1] + DIFF_BPR : 0);

    return {
        rows: diffRows,
        summary,
        runs,
        totalBytes: diffRows.length,
        identical: summary.changed === 0 && summary.added === 0 && summary.removed === 0,
    };
}
