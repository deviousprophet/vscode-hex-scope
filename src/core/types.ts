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
    recordCount?: number;
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

export type SearchMode = 'bytes' | 'value' | 'ascii' | 'addr';
export type SearchEndianness = 'auto' | 'be' | 'le';
export type BitFieldAllocation = 'lsb' | 'msb';

export type MemRow =
    | { type: 'data'; address: number }
    | { type: 'gap'; from: number; to: number; bytes: number };

// ── Struct Overlay ────────────────────────────────────────────────

export type StructScalarFieldType =
    | 'void'
    | 'ascii'
    | 'uint8' | 'uint16' | 'uint32' | 'uint64'
    | 'int8'  | 'int16'  | 'int32'  | 'int64'
    | 'float32' | 'float64'
    | 'pointer';

export type StructFieldType = StructScalarFieldType | 'struct';

/** A single named child of a BitField container field. */
export interface BitFieldChild {
    name: string;
    bitWidth: number;
}

export interface StructField {
    name: string;
    type: StructFieldType;
    /** When true, the field stores a pointer value whose target type is `type` / `refStructId`. */
    isPointer?: boolean;
    /** Required when type === 'struct'; references StructDef.id. */
    refStructId?: string;
    /** Named bit-field children. When present, this field is a BitField container.
     *  Only valid for unsigned integer base types (uint8/16/32/64). */
    bitFields?: BitFieldChild[];
    /** Array element count; 1 for a scalar field. */
    count: number;
    /** Whether the bit-field detail editor is collapsed. Only applies to BitField containers. */
    bitFieldsCollapsed?: boolean;
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
