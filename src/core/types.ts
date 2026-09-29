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
    data: ArrayLike<number>;
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

export interface WireSegment {
    startAddress: number;
    data: ArrayBuffer;
}

export interface WireParseResult {
    recordCount: number;
    segments: WireSegment[];
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

/** Live label-form draft range previewed in the grid while the form is open. */
export interface LabelDraftPreview {
    start: number;
    end: number;
    color: string;
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

export type StructFieldType = StructScalarFieldType | 'struct' | 'bitfield' | 'enum';

/** Runtime list mirroring StructFieldType — the JSON-schema enum drift guard. */
export const STRUCT_FIELD_TYPES: readonly StructFieldType[] = [
    'void', 'ascii',
    'uint8', 'uint16', 'uint32', 'uint64',
    'int8', 'int16', 'int32', 'int64',
    'float32', 'float64',
    'pointer', 'struct', 'bitfield', 'enum',
];

/** A single named child of a BitField container field. */
export interface BitFieldChild {
    name: string;
    bitWidth: number;
    /** Optional `kind: 'enum'` def reference supplying labels for this bit value. */
    refStructId?: string;
}

/** Unsigned integer widths usable as a bit-field storage base. */
export type StructBaseType = 'uint8' | 'uint16' | 'uint32' | 'uint64';

/** Runtime list mirroring StructBaseType — the JSON-schema enum drift guard. */
export const STRUCT_BASE_TYPES: readonly StructBaseType[] = ['uint8', 'uint16', 'uint32', 'uint64'];

/** Named-type discriminator; absent = plain struct. */
export type StructDefKind = 'struct' | 'bitfield' | 'enum';

/** One `NAME = value` entry of a `kind: 'enum'` def. */
export interface EnumEntry {
    name: string;
    value: number;
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
    /** When true, this field/container is omitted from the Struct Instances view unless the
     *  global "show hidden fields" toggle is on. Absent/false = visible. Instance-view only:
     *  decode, offsets, and the C preview are unaffected. */
    hidden?: boolean;
    /** Explicit byte order for this field's multi-byte value / bit-field unit.
     *  Absent = inherit (field beats struct beats nested parents beats global overlay).
     *  Ignored for pointer values (always decode with the global overlay endian). */
    endian?: 'le' | 'be';
    /** Explicit bit allocation for this field's bit-field container unit.
     *  Absent = inherit. Only meaningful on bit-field container / struct fields. */
    allocation?: 'lsb' | 'msb';
}

export interface StructDef {
    id: string;
    name: string;
    fields: StructField[];
    /** Named-type discriminator. Absent = plain struct (`'struct'`). */
    kind?: StructDefKind;
    /** Storage width for a `kind: 'bitfield'` def (uint8/uint16/uint32/uint64). */
    baseType?: StructBaseType;
    /** Named bit-field children for a `kind: 'bitfield'` def (its `fields` is empty). */
    bitFields?: BitFieldChild[];
    /** Ordered name/value entries for a `kind: 'enum'` def (its `fields` is empty). */
    entries?: EnumEntry[];
    /** When true: no padding between fields (GCC __attribute__((packed))).
     *  When false/absent: fields are naturally aligned (default). */
    packed?: boolean;
    /** Explicit byte order inherited by all fields (unless a field overrides).
     *  Absent = inherit from nested parents / global overlay. */
    endian?: 'le' | 'be';
    /** Explicit bit allocation inherited by bit-field containers (unless a field overrides).
     *  Absent = inherit from nested parents / global overlay. */
    allocation?: 'lsb' | 'msb';
}

/** A saved struct overlay instance: one struct definition applied to one address with a user label. */
export interface StructPointerSource {
    sourcePinId: string;
    sourcePinName: string;
    sourceStructId: string;
    sourceFieldPath: string;
    pointerStorageAddress: number;
    targetAddress: number;
}

export interface StructPin {
    id: string;
    structId: string;  // references StructDef.id
    addr: number;      // base address
    name: string;      // user-provided label
    pointerSources?: StructPointerSource[];
}
