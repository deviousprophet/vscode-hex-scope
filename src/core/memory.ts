import type { MemRow, SerializedParseResult } from './types';

export interface SegmentIndexEntry {
    startAddr: number;
    endAddr: number;
    offset: number;
}

type ParseSegment = SerializedParseResult['segments'][number];

export function buildSegmentIndex(parseResult: SerializedParseResult | null): SegmentIndexEntry[] {
    if (!parseResult || parseResult.segments.length === 0) {
        return [];
    }

    return parseResult.segments
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

function findSegmentAtAddress(segmentIndex: readonly SegmentIndexEntry[], addr: number): SegmentIndexEntry | undefined {
    let lo = 0;
    let hi = segmentIndex.length - 1;
    while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const seg = segmentIndex[mid];
        const cmp = compareAddressToSegment(addr, seg);
        if (cmp === 0) { return seg; }
        if (cmp < 0) { hi = mid - 1; }
        else { lo = mid + 1; }
    }
    return undefined;
}

export function getByteAt(
    parseResult: SerializedParseResult | null,
    segmentIndex: readonly SegmentIndexEntry[],
    edits: ReadonlyMap<number, number>,
    addr: number,
): number | undefined {
    if (!parseResult) { return undefined; }

    const seg = findSegmentAtAddress(segmentIndex, addr);
    if (!seg) { return undefined; }
    const offset = addr - seg.startAddr;
    return edits.get(addr) ?? parseResult.segments[seg.offset].data[offset];
}

function rowStartForAddress(addr: number, bytesPerRow: number): number {
    return addr - (addr % bytesPerRow);
}

function collectDataRows(segments: readonly ParseSegment[], bytesPerRow: number): number[] {
    const rowSet = new Set<number>();
    for (const seg of segments) {
        const startRow = rowStartForAddress(seg.startAddress, bytesPerRow);
        const endAddr = seg.startAddress + seg.data.length - 1;
        const endRow = rowStartForAddress(endAddr, bytesPerRow);
        for (let row = startRow; row <= endRow; row += bytesPerRow) {
            rowSet.add(row);
        }
    }
    return [...rowSet].sort((a, b) => a - b);
}

function appendGapBeforeRow(memRows: MemRow[], rows: number[], index: number, bytesPerRow: number): void {
    if (index === 0) { return; }
    const prev = rows[index - 1];
    const cur = rows[index];
    if (cur - prev > bytesPerRow) {
        memRows.push({ type: 'gap', from: prev + bytesPerRow, to: cur - 1, bytes: cur - prev - bytesPerRow });
    }
}

export function buildMemoryRows(parseResult: SerializedParseResult | null, bytesPerRow: number): MemRow[] {
    if (!parseResult || parseResult.segments.length === 0) {
        return [];
    }

    const memRows: MemRow[] = [];
    const rows = collectDataRows(parseResult.segments, bytesPerRow);
    for (let i = 0; i < rows.length; i++) {
        appendGapBeforeRow(memRows, rows, i, bytesPerRow);
        memRows.push({ type: 'data', address: rows[i] });
    }
    return memRows;
}
