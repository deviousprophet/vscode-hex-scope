import type { HexRecord, MemorySegment } from './types';

type SegmentBlock = { address: number; data: number[] };

function canUseSegmentRecord(rec: HexRecord, isDataRecord: (rec: HexRecord) => boolean): boolean {
    return !rec.error && isDataRecord(rec) && rec.checksumValid;
}

function startsNewBlock(rec: HexRecord, current: SegmentBlock | null): boolean {
    return !current || rec.resolvedAddress !== current.address + current.data.length;
}

function appendRecordData(block: SegmentBlock, data: ArrayLike<number>): void {
    for (let i = 0; i < data.length; i++) { block.data.push(data[i]); }
}

function appendSegmentRecord(blocks: SegmentBlock[], current: SegmentBlock | null, rec: HexRecord): SegmentBlock {
    const next = startsNewBlock(rec, current) ? { address: rec.resolvedAddress, data: [] } : current!;
    if (next !== current) { blocks.push(next); }
    appendRecordData(next, rec.data);
    return next;
}

function blockToSegment(block: SegmentBlock): MemorySegment {
    return { startAddress: block.address, data: new Uint8Array(block.data) };
}

export function buildContiguousSegments(
    records: HexRecord[],
    isDataRecord: (rec: HexRecord) => boolean,
): MemorySegment[] {
    const blocks: SegmentBlock[] = [];
    let current: SegmentBlock | null = null;

    for (const rec of records) {
        if (!canUseSegmentRecord(rec, isDataRecord)) { continue; }
        current = appendSegmentRecord(blocks, current, rec);
    }

    return blocks.map(blockToSegment);
}
