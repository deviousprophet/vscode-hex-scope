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

interface SegmentBuildWork {
    now: () => number;
    yieldControl: () => Promise<void>;
    budget: number;
    deadline: number;
    options: ParseWorkOptions;
}

function createSegmentBuildWork(options: ParseWorkOptions): SegmentBuildWork {
    const now = options.now ?? (() => performance.now());
    const budget = options.timeBudgetMs ?? 24;
    return {
        now,
        yieldControl: options.yieldControl ?? (() => new Promise<void>(resolve => setTimeout(resolve, 0))),
        budget,
        deadline: now() + budget,
        options,
    };
}

function throwIfBuildCancelled(work: SegmentBuildWork): void {
    if (work.options.signal?.aborted) { throw new Error('Parse cancelled'); }
}

async function yieldSegmentBuildWhenDue(work: SegmentBuildWork): Promise<void> {
    if (work.now() < work.deadline) { return; }
    await work.yieldControl();
    work.deadline = work.now() + work.budget;
}

async function collectSegmentRangesAsync(
    records: HexRecord[],
    isDataRecord: (rec: HexRecord) => boolean,
    work: SegmentBuildWork,
): Promise<SegmentRange[]> {
    const ranges: SegmentRange[] = [];
    let current: SegmentRange | null = null;
    for (let i = 0; i < records.length; i++) {
        throwIfBuildCancelled(work);
        const rec = records[i];
        if (canUseSegmentRecord(rec, isDataRecord)) {
            current = appendSegmentRange(ranges, current, rec, i);
        }
        await yieldSegmentBuildWhenDue(work);
    }
    return ranges;
}

function appendSegmentRange(
    ranges: SegmentRange[],
    current: SegmentRange | null,
    record: HexRecord,
    recordIndex: number,
): SegmentRange {
    let active = current;
    if (startsNewRange(record, active)) {
        active = { startRecord: recordIndex, endRecord: recordIndex, address: record.resolvedAddress, length: 0 };
        ranges.push(active);
    }
    active!.endRecord = recordIndex;
    active!.length += record.data.length;
    return active!;
}

async function buildSegmentRangeAsync(
    range: SegmentRange,
    records: HexRecord[],
    isDataRecord: (rec: HexRecord) => boolean,
    work: SegmentBuildWork,
): Promise<MemorySegment> {
    const data = new Uint8Array(range.length);
    let offset = 0;
    for (let i = range.startRecord; i <= range.endRecord; i++) {
        throwIfBuildCancelled(work);
        const rec = records[i];
        if (canUseSegmentRecord(rec, isDataRecord)) {
            data.set(rec.data, offset);
            offset += rec.data.length;
        }
        await yieldSegmentBuildWhenDue(work);
    }
    return { startAddress: range.address, data };
}

export async function buildContiguousSegmentsAsync(
    records: HexRecord[],
    isDataRecord: (rec: HexRecord) => boolean,
    options: ParseWorkOptions = {},
): Promise<MemorySegment[]> {
    const work = createSegmentBuildWork(options);
    const ranges = await collectSegmentRangesAsync(records, isDataRecord, work);
    const segments: MemorySegment[] = [];
    for (const range of ranges) {
        segments.push(await buildSegmentRangeAsync(range, records, isDataRecord, work));
    }
    return segments;
}
