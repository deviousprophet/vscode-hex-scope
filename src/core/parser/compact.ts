import type { HexRecord, MemorySegment, ParseProgress } from './types';
import type { SourceRange } from './records';

const RECORD_PAGE_CAPACITY = 65_536;

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

export class CompactRecordStore {
    private readonly pages: RecordMetadataPage[] = [];
    public readonly length: number;

    constructor(records: HexRecord[], ranges: SourceRange[]) {
        if (records.length !== ranges.length) { throw new Error('Record metadata range mismatch'); }
        this.length = records.length;
        for (let i = 0; i < records.length; i++) { this.append(i, records[i], ranges[i]); }
    }

    private append(index: number, record: HexRecord, range: SourceRange): void {
        const pageIndex = Math.floor(index / RECORD_PAGE_CAPACITY);
        const target = this.pages[pageIndex] ?? page();
        if (!this.pages[pageIndex]) { this.pages.push(target); }
        const i = target.length++;
        target.sourceStart[i] = range.start;
        target.sourceEnd[i] = range.end;
        target.lineNumber[i] = record.lineNumber;
        target.address[i] = record.address >>> 0;
        target.resolvedAddress[i] = record.resolvedAddress >>> 0;
        target.byteCount[i] = record.byteCount;
        target.recordType[i] = record.recordType;
        target.checksum[i] = record.checksum;
        target.flags[i] = (record.checksumValid ? 1 : 0) | (record.error ? 2 : 0);
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

export interface CompactParserOptions {
    signal?: AbortSignal;
    timeBudgetMs?: number;
    now?: () => number;
    yieldControl?: () => Promise<void>;
    onProgress?: (progress: ParseProgress) => void;
}
