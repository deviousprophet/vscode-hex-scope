// ── Data processing ───────────────────────────────────────────────
// Builds segment index and row list from parse result segments (no per-byte materialization).
// Memory access uses binary search on segment index; rows are computed per-segment.

import { S, BPR } from './state';

type ParseSegment = NonNullable<typeof S.parseResult>['segments'][number];
type SegmentIndexEntry = (typeof S.segmentIndex)[number];

/**
 * Build segment index from parseResult for O(log n) byte access.
 * Index maps each segment's memory range for binary-search lookup.
 */
function initSegmentIndex(): void {
    S.segmentIndex = [];
    if (!S.parseResult || S.parseResult.segments.length === 0) { 
        return; 
    }

    S.segmentIndex = S.parseResult.segments
        .map((seg, segOffset) => ({
            startAddr: seg.startAddress,
            endAddr: seg.startAddress + seg.data.length - 1,
            offset: segOffset,
        }))
        .sort((a, b) => (a.startAddr - b.startAddr) || (a.endAddr - b.endAddr));

}

function compareAddressToSegment(addr: number, seg: SegmentIndexEntry): -1 | 0 | 1 {
    if (addr < seg.startAddr) { return -1; }
    if (addr > seg.endAddr) { return 1; }
    return 0;
}

function findSegmentAtAddress(addr: number): SegmentIndexEntry | undefined {
    let lo = 0;
    let hi = S.segmentIndex.length - 1;
    while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const seg = S.segmentIndex[mid];
        const cmp = compareAddressToSegment(addr, seg);
        if (cmp === 0) { return seg; }
        if (cmp < 0) { hi = mid - 1; }
        else { lo = mid + 1; }
    }
    return undefined;
}

function byteFromSegment(parseResult: NonNullable<typeof S.parseResult>, seg: SegmentIndexEntry, addr: number): number | undefined {
    const offset = addr - seg.startAddr;
    return S.edits.get(addr) ?? parseResult.segments[seg.offset].data[offset];
}

/**
 * Get effective byte at address, including any unsaved edit staged over segment data.
 * Returns undefined if address is not in any segment.
 */
export function getByte(addr: number): number | undefined {
    const parseResult = S.parseResult;
    if (!parseResult) { return undefined; }

    const seg = findSegmentAtAddress(addr);
    if (!seg) { return undefined; }
    return byteFromSegment(parseResult, seg, addr);
}

function rowStartForAddress(addr: number): number {
    return addr - (addr % BPR);
}

function collectDataRows(segments: ParseSegment[]): number[] {
    const rowSet = new Set<number>();
    for (const seg of segments) {
        const startRow = rowStartForAddress(seg.startAddress);
        const endAddr = seg.startAddress + seg.data.length - 1;
        const endRow = rowStartForAddress(endAddr);
        for (let row = startRow; row <= endRow; row += BPR) {
            rowSet.add(row);
        }
    }
    return [...rowSet].sort((a, b) => a - b);
}

function appendGapBeforeRow(rows: number[], index: number): void {
    if (index === 0) { return; }
    const prev = rows[index - 1];
    const cur = rows[index];
    if (cur - prev > BPR) {
        S.memRows.push({ type: 'gap', from: prev + BPR, to: cur - 1, bytes: cur - prev - BPR });
    }
}

function appendMemRows(rows: number[]): void {
    for (let i = 0; i < rows.length; i++) {
        appendGapBeforeRow(rows, i);
        S.memRows.push({ type: 'data', address: rows[i] });
    }
}

/**
 * Build S.memRows from segments without per-byte iteration.
 * Insert gap entries between non-adjacent segment regions.
 */
export function buildMemRows(): void {
    S.memRows = [];
    if (!S.parseResult || S.parseResult.segments.length === 0) { 
        return; 
    }

    appendMemRows(collectDataRows(S.parseResult.segments));
}

/** Legacy alias; calls initSegmentIndex. */
export function initFlatBytes(): void {
    initSegmentIndex();
}
