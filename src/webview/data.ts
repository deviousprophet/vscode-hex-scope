// ── Data processing ───────────────────────────────────────────────
// Builds segment index and row list from parse result segments (no per-byte materialization).
// Memory access uses binary search on segment index; rows are computed per-segment.

import { S, BPR } from './state';

/**
 * Build segment index from parseResult for O(log n) byte access.
 * Index maps each segment's memory range for binary-search lookup.
 */
export function initSegmentIndex(): void {
    console.time('[DATA] initSegmentIndex');
    S.segmentIndex = [];
    if (!S.parseResult || S.parseResult.segments.length === 0) { 
        console.timeEnd('[DATA] initSegmentIndex');
        return; 
    }

    for (const seg of S.parseResult.segments) {
        S.segmentIndex.push({
            startAddr: seg.startAddress,
            endAddr: seg.startAddress + seg.data.length - 1,
            offset: S.segmentIndex.length,
        });
    }
    console.log(`[DATA] Built segment index: ${S.segmentIndex.length} entries`);
    console.timeEnd('[DATA] initSegmentIndex');
}

/**
 * Get byte at address by binary-searching segment index and indexing into segment data.
 * Returns undefined if address is not in any segment.
 */
export function getByte(addr: number): number | undefined {
    if (!S.parseResult || S.segmentIndex.length === 0) { return undefined; }

    let lo = 0, hi = S.segmentIndex.length - 1;
    while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const seg = S.segmentIndex[mid];
        if (addr >= seg.startAddr && addr <= seg.endAddr) {
            const offset = addr - seg.startAddr;
            return S.parseResult.segments[seg.offset].data[offset];
        } else if (addr < seg.startAddr) {
            hi = mid - 1;
        } else {
            lo = mid + 1;
        }
    }
    return undefined;
}

/**
 * Build S.memRows from segments without per-byte iteration.
 * Insert gap entries between non-adjacent segment regions.
 */
export function buildMemRows(): void {
    console.time('[DATA] buildMemRows');
    S.memRows = [];
    if (!S.parseResult || S.parseResult.segments.length === 0) { 
        console.timeEnd('[DATA] buildMemRows');
        return; 
    }

    const rows: number[] = [];
    for (const seg of S.parseResult.segments) {
        const startRow = seg.startAddress - (seg.startAddress % BPR);
        const endAddr = seg.startAddress + seg.data.length - 1;
        const endRow = endAddr - (endAddr % BPR);
        for (let row = startRow; row <= endRow; row += BPR) {
            if (rows.length === 0 || rows[rows.length - 1] !== row) {
                rows.push(row);
            }
        }
    }

    for (let i = 0; i < rows.length; i++) {
        if (i > 0) {
            const prev = rows[i - 1];
            const cur = rows[i];
            if (cur - prev > BPR) {
                S.memRows.push({ type: 'gap', from: prev + BPR, to: cur - 1, bytes: cur - prev - BPR });
            }
        }
        S.memRows.push({ type: 'data', address: rows[i] });
    }
    console.log(`[DATA] Built memory rows: ${S.memRows.length} rows (data: ${S.memRows.filter(r => r.type === 'data').length}, gaps: ${S.memRows.filter(r => r.type === 'gap').length})`);
    console.timeEnd('[DATA] buildMemRows');
}

/** Legacy alias; calls initSegmentIndex. */
export function initFlatBytes(): void {
    initSegmentIndex();
}
