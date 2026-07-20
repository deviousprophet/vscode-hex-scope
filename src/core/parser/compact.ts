import type { HexRecord, MemorySegment, ParseWorkOptions } from './types';
import type { ParsedRecordsWithRanges, SourceRange } from './records';
import { collectSegmentRanges, type SegmentRange } from './segments';

const RECORD_PAGE_CAPACITY = 65_536;
const COMPACTION_BATCH_SIZE = 2_048;

interface RecordMetadataPage {
    length: number;
    sourceStart: Uint32Array;
    sourceEnd: Uint32Array;
    lineNumber: Uint32Array;
    address: Uint32Array;
    resolvedAddress: Uint32Array;
    byteCount: Uint8Array;
    recordType: Uint8Array;
    checksum: Uint8Array;
    flags: Uint8Array;
}

export interface CompactParseResult {
    records: CompactRecordStore;
    segments: MemorySegment[];
    totalDataBytes: number;
    checksumErrors: number;
    malformedLines: number;
    startAddress?: number;
}

export async function createCompactParseResult(
    parsed: ParsedRecordsWithRanges,
    segRanges: SegmentRange[],
    options: ParseWorkOptions,
    startAddress?: number,
    isDataRecord?: (rec: HexRecord) => boolean,
): Promise<CompactParseResult> {
    const segments: MemorySegment[] = segRanges.map(r => ({
        startAddress: r.address,
        data: new Uint8Array(r.length),
    }));
    const segOffsets = new Uint32Array(segRanges.length);
    let segCursor = 0;

    const records = await CompactRecordStore.create(parsed.records, parsed.ranges, options, (i, record) => {
        while (segCursor < segRanges.length && i > segRanges[segCursor].endRecord) { segCursor++; }
        if (segCursor < segRanges.length && i >= segRanges[segCursor].startRecord
            && !record.error && record.checksumValid && isDataRecord?.(record)) {
            segments[segCursor].data.set(record.data, segOffsets[segCursor]);
            segOffsets[segCursor] += record.data.length;
        }
    });

    return {
        records,
        segments,
        totalDataBytes: segments.reduce((sum, seg) => sum + seg.data.length, 0),
        checksumErrors: parsed.checksumErrors,
        malformedLines: parsed.malformedLines,
        startAddress,
    };
}

function page(): RecordMetadataPage {
    return {
        length: 0,
        sourceStart: new Uint32Array(RECORD_PAGE_CAPACITY),
        sourceEnd: new Uint32Array(RECORD_PAGE_CAPACITY),
        lineNumber: new Uint32Array(RECORD_PAGE_CAPACITY),
        address: new Uint32Array(RECORD_PAGE_CAPACITY),
        resolvedAddress: new Uint32Array(RECORD_PAGE_CAPACITY),
        byteCount: new Uint8Array(RECORD_PAGE_CAPACITY),
        recordType: new Uint8Array(RECORD_PAGE_CAPACITY),
        checksum: new Uint8Array(RECORD_PAGE_CAPACITY),
        flags: new Uint8Array(RECORD_PAGE_CAPACITY),
    };
}

class CompactionWork {
    private readonly now: () => number;
    private readonly yieldControl: () => Promise<void>;
    private readonly budget: number;
    private deadline: number;

    constructor(private readonly options: ParseWorkOptions, private readonly total: number) {
        this.now = options.now ?? (() => performance.now());
        this.yieldControl = options.yieldControl ?? (() => new Promise<void>(resolve => setTimeout(resolve, 0)));
        this.budget = options.timeBudgetMs ?? 24;
        this.deadline = this.now() + this.budget;
    }

    public async afterRecord(completed: number): Promise<void> {
        if (completed % COMPACTION_BATCH_SIZE !== 0) { return; }
        this.throwIfCancelled();
        if (this.now() < this.deadline) { return; }
        this.options.onProgress?.({ stage: 'build', completed, total: this.total });
        await this.yieldControl();
        this.deadline = this.now() + this.budget;
    }

    public finish(): void {
        this.throwIfCancelled();
        this.options.onProgress?.({ stage: 'build', completed: this.total, total: this.total });
    }

    private throwIfCancelled(): void {
        if (this.options.signal?.aborted) { throw new Error('Parse cancelled'); }
    }
}

export class CompactRecordStore {
    private readonly pages: RecordMetadataPage[] = [];
    public readonly length: number;

    private constructor(length: number) {
        this.length = length;
    }

    public static async create(
        records: HexRecord[],
        ranges: SourceRange[],
        options: ParseWorkOptions = {},
        forRecord?: (index: number, record: HexRecord) => void,
    ): Promise<CompactRecordStore> {
        assertMatchingRecordRanges(records, ranges);
        const store = new CompactRecordStore(records.length);
        const work = new CompactionWork(options, records.length);

        for (let i = 0; i < records.length; i++) {
            store.append(i, records[i], ranges[i]);
            forRecord?.(i, records[i]);
            await work.afterRecord(i + 1);
        }
        work.finish();
        return store;
    }

    private append(index: number, record: HexRecord, range: SourceRange): void {
        const pageIndex = Math.floor(index / RECORD_PAGE_CAPACITY);
        const target = this.pageAt(pageIndex);
        const i = target.length++;
        target.sourceStart[i] = range.start;
        target.sourceEnd[i] = range.end;
        target.lineNumber[i] = record.lineNumber;
        target.address[i] = record.address >>> 0;
        target.resolvedAddress[i] = record.resolvedAddress >>> 0;
        target.byteCount[i] = record.byteCount;
        target.recordType[i] = record.recordType;
        target.checksum[i] = record.checksum;
        target.flags[i] = recordFlags(record);
    }

    private pageAt(pageIndex: number): RecordMetadataPage {
        const existing = this.pages[pageIndex];
        if (existing) { return existing; }
        const created = page();
        this.pages.push(created);
        return created;
    }

    public materialize(index: number, source: string, parseLine: (raw: string, lineNumber: number) => HexRecord): HexRecord {
        if (!Number.isInteger(index) || index < 0 || index >= this.length) { throw new RangeError('Record index out of range'); }
        const p = this.pages[Math.floor(index / RECORD_PAGE_CAPACITY)];
        const i = index % RECORD_PAGE_CAPACITY;
        const record = parseLine(source.slice(p.sourceStart[i], p.sourceEnd[i]), p.lineNumber[i]);
        record.address = p.address[i];
        record.resolvedAddress = p.resolvedAddress[i];
        record.byteCount = p.byteCount[i];
        record.recordType = p.recordType[i];
        record.checksum = p.checksum[i];
        record.checksumValid = (p.flags[i] & 1) !== 0;
        return record;
    }
}

function assertMatchingRecordRanges(records: HexRecord[], ranges: SourceRange[]): void {
    if (records.length !== ranges.length) { throw new Error('Record metadata range mismatch'); }
}

function recordFlags(record: HexRecord): number {
    let flags = 0;
    if (record.checksumValid) { flags |= 1; }
    if (record.error) { flags |= 2; }
    return flags;
}

export type CompactParserOptions = ParseWorkOptions;
