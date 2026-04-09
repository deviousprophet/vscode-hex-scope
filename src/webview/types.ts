// ── Shared type definitions ───────────────────────────────────

export interface SerializedRecord {
    lineNumber: number;
    raw: string;
    byteCount: number;
    address: number;
    recordType: number;
    data: number[];
    checksum: number;
    checksumValid: boolean;
    resolvedAddress: number;
    error?: string;
}

export interface SerializedSegment {
    startAddress: number;
    data: number[];
}

export interface SerializedParseResult {
    records: SerializedRecord[];
    segments: SerializedSegment[];
    totalDataBytes: number;
    checksumErrors: number;
    malformedLines: number;
    startAddress?: number;
}

export interface SegmentLabel {
    id: string;
    name: string;
    startAddress: number;
    length: number;
    color: string;
    hidden?: boolean;
}

export type SearchMode = 'hex' | 'ascii' | 'addr';

export type MemRow =
    | { type: 'data'; address: number }
    | { type: 'gap'; from: number; to: number; bytes: number };
