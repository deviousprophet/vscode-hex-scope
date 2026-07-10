import type { HexRecord, MemorySegment, ParseWorkOptions } from './types';

type SegmentRange = { startRecord: number; endRecord: number; address: number; length: number };

function canUseSegmentRecord(rec: HexRecord, isDataRecord: (rec: HexRecord) => boolean): boolean {
    return !rec.error && isDataRecord(rec) && rec.checksumValid;
}

function startsNewRange(rec: HexRecord, current: SegmentRange | null): boolean {
    return !current || rec.resolvedAddress !== current.address + current.length;
}

function collectSegmentRanges(records: HexRecord[], isDataRecord: (rec: HexRecord) => boolean): SegmentRange[] {
    const ranges: SegmentRange[] = [];
    let current: SegmentRange | null = null;
    for (let i = 0; i < records.length; i++) {
        const rec = records[i];
        if (!canUseSegmentRecord(rec, isDataRecord)) { continue; }
        if (startsNewRange(rec, current)) {
            current = { startRecord: i, endRecord: i, address: rec.resolvedAddress, length: 0 };
            ranges.push(current);
        }
        const active = current!;
        active.endRecord = i;
        active.length += rec.data.length;
    }
    return ranges;
}

function rangeToSegment(range: SegmentRange, records: HexRecord[], isDataRecord: (rec: HexRecord) => boolean): MemorySegment {
    const data = new Uint8Array(range.length);
    let offset = 0;
    for (let i = range.startRecord; i <= range.endRecord; i++) {
        const rec = records[i];
        if (!canUseSegmentRecord(rec, isDataRecord)) { continue; }
        data.set(rec.data, offset);
        offset += rec.data.length;
    }
    return { startAddress: range.address, data };
}

export function buildContiguousSegments(
    records: HexRecord[],
    isDataRecord: (rec: HexRecord) => boolean,
): MemorySegment[] {
    return collectSegmentRanges(records, isDataRecord)
        .map(range => rangeToSegment(range, records, isDataRecord));
}

export async function buildContiguousSegmentsAsync(
    records: HexRecord[],
    isDataRecord: (rec: HexRecord) => boolean,
    options: ParseWorkOptions = {},
): Promise<MemorySegment[]> {
    const now = options.now ?? (() => performance.now());
    const yieldControl = options.yieldControl ?? (() => new Promise<void>(resolve => setTimeout(resolve, 0)));
    const budget = options.timeBudgetMs ?? 24;
    const ranges: SegmentRange[] = [];
    let current: SegmentRange | null = null;
    let deadline = now() + budget;
    for (let i = 0; i < records.length; i++) {
        if (options.signal?.aborted) { throw new Error('Parse cancelled'); }
        const rec = records[i];
        if (canUseSegmentRecord(rec, isDataRecord)) {
            if (startsNewRange(rec, current)) {
                current = { startRecord: i, endRecord: i, address: rec.resolvedAddress, length: 0 };
                ranges.push(current);
            }
            current!.endRecord = i;
            current!.length += rec.data.length;
        }
        if (now() >= deadline) {
            await yieldControl();
            deadline = now() + budget;
        }
    }
    const segments: MemorySegment[] = [];
    for (const range of ranges) {
        const data = new Uint8Array(range.length);
        let offset = 0;
        for (let i = range.startRecord; i <= range.endRecord; i++) {
            if (options.signal?.aborted) { throw new Error('Parse cancelled'); }
            const rec = records[i];
            if (canUseSegmentRecord(rec, isDataRecord)) {
                data.set(rec.data, offset);
                offset += rec.data.length;
            }
            if (now() >= deadline) {
                await yieldControl();
                deadline = now() + budget;
            }
        }
        segments.push({ startAddress: range.address, data });
    }
    return segments;
}
