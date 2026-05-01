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
    format: 'ihex' | 'srec';
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

// ── Struct Overlay ────────────────────────────────────────────────

export type StructFieldType =
    | 'uint8' | 'uint16' | 'uint32'
    | 'int8'  | 'int16'  | 'int32'
    | 'float32' | 'float64'
    | 'pointer';

export type StructFieldEndian = 'le' | 'be' | 'inherit';

export interface StructField {
    name: string;
    type: StructFieldType;
    /** Array element count; 1 for a scalar field. */
    count: number;
    endian: StructFieldEndian;
}

export interface StructDef {
    id: string;
    name: string;
    fields: StructField[];
    /** When true: no padding between fields (GCC __attribute__((packed))).
     *  When false/absent: fields are naturally aligned (default). */
    packed?: boolean;
}

/** A saved struct overlay instance: one struct definition applied to one address with a user label. */
export interface StructPin {
    id: string;
    structId: string;  // references StructDef.id
    addr: number;      // base address
    name: string;      // user-provided label
}
