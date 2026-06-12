import type { HexRecord, MemorySegment } from './types';

export function buildContiguousSegments(
    records: HexRecord[],
    isDataRecord: (rec: HexRecord) => boolean,
): MemorySegment[] {
    const blocks: { address: number; data: number[] }[] = [];
    let current: { address: number; data: number[] } | null = null;

    for (const rec of records) {
        if (rec.error || !isDataRecord(rec) || !rec.checksumValid) {
            continue;
        }

        if (!current || rec.resolvedAddress !== current.address + current.data.length) {
            current = { address: rec.resolvedAddress, data: [] };
            blocks.push(current);
        }

        for (const b of rec.data) { current.data.push(b); }
    }

    return blocks.map(b => ({ startAddress: b.address, data: new Uint8Array(b.data) }));
}
