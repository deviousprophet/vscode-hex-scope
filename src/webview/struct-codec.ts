// -- Struct Overlay - pure codec (no DOM / VS Code API dependencies) --
// Contains field size helpers, decode logic, parser/serializer helpers, and struct validation.

import { S } from './state';
import type {
    BitFieldAllocation,
    BitFieldChild,
    StructDef,
    StructField,
    StructFieldType,
    StructScalarFieldType,
} from './types';

export type { StructDef, StructField };

export const MAX_NESTED_DEPTH = 32;

// -- Constants -----------------------------------------------------

export const FIELD_TYPES: StructScalarFieldType[] = [
    'ascii',
    'uint8', 'uint16', 'uint32', 'uint64',
    'int8', 'int16', 'int32', 'int64',
    'float32', 'float64',
    'pointer',
];

const FIELD_BYTE_SIZE: Record<StructScalarFieldType, number> = {
    ascii: 1,
    uint8: 1,
    int8: 1,
    uint16: 2,
    int16: 2,
    uint32: 4,
    int32: 4,
    float32: 4,
    pointer: 4,
    uint64: 8,
    int64: 8,
    float64: 8,
};

type UnsignedScalarType = 'uint8' | 'uint16' | 'uint32' | 'uint64';

function isUnsignedScalarType(type: StructFieldType): type is UnsignedScalarType {
    return type === 'uint8' || type === 'uint16' || type === 'uint32' || type === 'uint64';
}

function isBitFieldContainer(field: StructField): boolean {
    return Array.isArray(field.bitFields) && field.bitFields.length > 0 &&
        isUnsignedScalarType(field.type);
}

function bitMask(width: number): bigint {
    return (1n << BigInt(width)) - 1n;
}

function bytesToBigUint(raw: number[], endian: 'le' | 'be'): bigint {
    if (endian === 'le') {
        let v = 0n;
        for (let i = 0; i < raw.length; i++) {
            v |= BigInt(raw[i]) << BigInt(i * 8);
        }
        return v;
    }
    let v = 0n;
    for (const b of raw) {
        v = (v << 8n) | BigInt(b);
    }
    return v;
}

export function fieldByteSize(type: StructScalarFieldType): number {
    return FIELD_BYTE_SIZE[type];
}

/** Natural alignment for a scalar field type. */
function fieldAlignment(type: StructScalarFieldType): number {
    return fieldByteSize(type);
}

function alignUp(offset: number, align: number): number {
    return align <= 1 ? offset : (offset + align - 1) & ~(align - 1);
}

function defsMap(extra?: StructDef): Map<string, StructDef> {
    const map = new Map<string, StructDef>();
    allStructs().forEach(d => map.set(d.id, d));
    if (extra) { map.set(extra.id, extra); }
    return map;
}

function referencedStruct(field: StructField, map: Map<string, StructDef>): StructDef | null {
    if (field.type !== 'struct' || !field.refStructId) { return null; }
    return map.get(field.refStructId) ?? null;
}

function fieldSizeWithDefs(field: StructField, map: Map<string, StructDef>, depth: number): number {
    if (field.type !== 'struct') {
        return fieldByteSize(field.type);
    }
    if (depth >= MAX_NESTED_DEPTH) { return 0; }
    const child = referencedStruct(field, map);
    if (!child) { return 0; }
    return structByteSizeWithDefs(child, map, depth + 1);
}

function fieldAlignWithDefs(field: StructField, map: Map<string, StructDef>, depth: number): number {
    if (field.type !== 'struct') {
        return fieldAlignment(field.type);
    }
    if (depth >= MAX_NESTED_DEPTH) { return 1; }
    const child = referencedStruct(field, map);
    if (!child) { return 1; }
    return structAlignmentWithDefs(child, map, depth + 1);
}

function structAlignmentWithDefs(def: StructDef, map: Map<string, StructDef>, depth: number): number {
    if (def.packed || def.fields.length === 0) { return 1; }
    let maxAlign = 1;
    for (const f of def.fields) {
        const align = fieldAlignWithDefs(f, map, depth);
        maxAlign = Math.max(maxAlign, align);
    }
    return maxAlign;
}

function structByteSizeWithDefs(def: StructDef, map: Map<string, StructDef>, depth: number): number {
    let offset = 0;
    let maxAlign = 1;

    for (const f of def.fields) {
        const sz = fieldSizeWithDefs(f, map, depth);
        const align = def.packed ? 1 : fieldAlignWithDefs(f, map, depth);
        maxAlign = Math.max(maxAlign, align);
        offset = alignUp(offset, align);
        offset += sz * f.count;
    }

    if (def.packed) { return offset; }
    return alignUp(offset, maxAlign);
}

/**
 * Compute byte size of a struct, respecting alignment padding unless packed.
 * Includes trailing padding so that arrays of the struct are correctly aligned.
 */
export function structByteSize(def: StructDef): number {
    const map = defsMap(def);
    return structByteSizeWithDefs(def, map, 1);
}

/** Validate nested struct references, cycles, and max depth constraints. */
export function validateStructs(defs: StructDef[], maxDepth = MAX_NESTED_DEPTH): string[] {
    const byId = new Map<string, StructDef>();
    defs.forEach(d => byId.set(d.id, d));
    const errors: string[] = [];

    for (const d of defs) {
        for (const f of d.fields) {
            validateStructReference(d, f, byId, errors);

            // ── New bitFields container validation ──────────────────────────────
            if (isBitFieldContainer(f)) {
                validateBitFieldContainer(d, f, errors);
                continue;
            }
        }
    }

    defs.forEach(d => validateNestedStructGraph(d.id, 1, [d.id], byId, maxDepth, errors));
    return [...new Set(errors)];
}

function validateStructReference(
    def: StructDef,
    field: StructField,
    byId: Map<string, StructDef>,
    errors: string[],
): void {
    if (field.type !== 'struct') { return; }

    if (!field.refStructId) {
        errors.push(`Struct "${def.name}": field "${field.name}" is missing a referenced struct.`);
        return;
    }
    if (!byId.has(field.refStructId)) {
        errors.push(`Struct "${def.name}": field "${field.name}" references an unknown struct.`);
    }
}

function validateBitFieldContainer(def: StructDef, field: StructField, errors: string[]): void {
    if (!isUnsignedScalarType(field.type)) {
        errors.push(`Struct "${def.name}": field "${field.name}" bit-field container must be an unsigned type.`);
        return;
    }

    const unitBits = fieldByteSize(field.type as UnsignedScalarType) * 8;
    const totalBits = validateBitFieldChildren(def, field, errors);
    if (totalBits > unitBits) {
        errors.push(`Struct "${def.name}": field "${field.name}" children total ${totalBits} bits exceeds ${unitBits}-bit container.`);
    }
}

function validateBitFieldChildren(def: StructDef, field: StructField, errors: string[]): number {
    let totalBits = 0;
    for (const child of field.bitFields ?? []) {
        if (!isValidBitWidth(child.bitWidth)) {
            errors.push(`Struct "${def.name}": field "${field.name}" child "${child.name}" bit width must be > 0.`);
        } else {
            totalBits += child.bitWidth;
        }
    }
    return totalBits;
}

function isValidBitWidth(bitWidth: number): boolean {
    return Number.isInteger(bitWidth) && bitWidth > 0;
}

function validateNestedStructGraph(
    defId: string,
    depth: number,
    stack: string[],
    byId: Map<string, StructDef>,
    maxDepth: number,
    errors: string[],
): void {
    if (depth > maxDepth) {
        const name = nestedStructName(byId, defId);
        errors.push(`Nesting depth exceeds ${maxDepth} at struct "${name}".`);
        return;
    }

    const def = byId.get(defId);
    if (!def) { return; }

    for (const field of def.fields) {
        validateNestedStructField(field, depth, stack, byId, maxDepth, errors);
    }
}

function nestedStructName(byId: Map<string, StructDef>, defId: string): string {
    return byId.get(defId)?.name ?? defId;
}

function validateNestedStructField(
    field: StructField,
    depth: number,
    stack: string[],
    byId: Map<string, StructDef>,
    maxDepth: number,
    errors: string[],
): void {
    if (field.type !== 'struct' || !field.refStructId) { return; }
    if (stack.includes(field.refStructId)) {
        errors.push(`Nested struct cycle detected: ${formatStructCycle([...stack, field.refStructId], byId)}`);
        return;
    }

    validateNestedStructGraph(field.refStructId, depth + 1, [...stack, field.refStructId], byId, maxDepth, errors);
}

function formatStructCycle(stack: string[], byId: Map<string, StructDef>): string {
    return stack.map(id => byId.get(id)?.name ?? id).join(' -> ');
}

// -- Decode logic --------------------------------------------------

export interface DecodedField {
    fieldName: string;
    type: StructScalarFieldType;
    /** Index within the array (0 for scalars). */
    arrayIdx: number;
    byteOffset: number;
    bytesHex: string;
    decoded: string;
    hasData: boolean;
    isBitField?: boolean;
    bitWidth?: number;
    /** Bit offset within the storage unit in declaration order. */
    bitOffset?: number;
    bitStorageByteSize?: number;
    bitValueUnsigned?: string;
}

export interface ResolvedStructFieldPath {
    field: StructField;
    structName?: string;
}

/**
 * Resolve a dotted field path (optionally containing array indices) to the declared field.
 * Example accepted paths: "nodes", "nodes[0]", "outer[1].nodes".
 */
export function resolveStructFieldByPath(
    def: StructDef,
    fieldPath: string,
    defs: StructDef[] = allStructs(),
): ResolvedStructFieldPath | null {
    const parts = parseStructFieldPathParts(fieldPath);
    if (!parts) { return null; }

    const byId = createStructDefMap(def, defs);
    const field = resolveStructPathParts(def, parts, byId);
    return field ? buildResolvedStructFieldPath(field, byId) : null;
}

function parseStructFieldPathParts(fieldPath: string): string[] | null {
    const normalized = fieldPath.replace(/\[\d+\]/g, '');
    const parts = normalized.split('.').map(p => p.trim()).filter(Boolean);
    return parts.length > 0 ? parts : null;
}

function createStructDefMap(def: StructDef, defs: StructDef[]): Map<string, StructDef> {
    const byId = new Map<string, StructDef>(defs.map(d => [d.id, d]));
    byId.set(def.id, def);
    return byId;
}

function resolveStructPathParts(
    def: StructDef,
    parts: string[],
    byId: Map<string, StructDef>,
): StructField | null {
    const field = findStructField(def, parts[0]);
    if (!field) { return null; }
    if (parts.length === 1) { return field; }
    const child = resolveChildStructDef(field, byId);
    if (!child) { return null; }
    return resolveStructPathParts(child, parts.slice(1), byId);
}

function findStructField(def: StructDef, fieldName: string): StructField | undefined {
    return def.fields.find((candidate: StructField) => candidate.name === fieldName);
}

function resolveChildStructDef(field: StructField, byId: Map<string, StructDef>): StructDef | null {
    if (field.type !== 'struct' || !field.refStructId) { return null; }
    return byId.get(field.refStructId) ?? null;
}

function buildResolvedStructFieldPath(field: StructField, byId: Map<string, StructDef>): ResolvedStructFieldPath {
    if (field.type !== 'struct') { return { field }; }
    const child = field.refStructId ? byId.get(field.refStructId) : null;
    return { field, structName: child?.name };
}

type FieldDecoder = (dv: DataView, le: boolean) => string;

function decodeFloat(value: number, precision: number): string {
    if (isNaN(value)) { return 'NaN'; }
    if (!isFinite(value)) { return String(value); }
    return value.toExponential(precision);
}

const FIELD_DECODERS: Record<StructScalarFieldType, FieldDecoder> = {
    ascii: dv => {
        const b = dv.getUint8(0);
        if (b === 0) { return ''; }
        return b >= 0x20 && b < 0x7F ? String.fromCharCode(b) : '.';
    },
    int8: dv => `${dv.getInt8(0)}`,
    int16: (dv, le) => `${dv.getInt16(0, le)}`,
    int32: (dv, le) => `${dv.getInt32(0, le)}`,
    int64: (dv, le) => dv.getBigInt64(0, le).toString(10),
    uint8: dv => `${dv.getUint8(0)}  (0x${dv.getUint8(0).toString(16).toUpperCase().padStart(2, '0')})`,
    uint16: (dv, le) => {
        const v = dv.getUint16(0, le);
        return `${v}  (0x${v.toString(16).toUpperCase().padStart(4, '0')})`;
    },
    uint32: (dv, le) => {
        const v = dv.getUint32(0, le);
        return `${v >>> 0}  (0x${(v >>> 0).toString(16).toUpperCase().padStart(8, '0')})`;
    },
    uint64: (dv, le) => {
        const v = dv.getBigUint64(0, le);
        return `${v.toString(10)}  (0x${v.toString(16).toUpperCase().padStart(16, '0')})`;
    },
    float32: (dv, le) => decodeFloat(dv.getFloat32(0, le), 6),
    float64: (dv, le) => decodeFloat(dv.getFloat64(0, le), 16),
    pointer: (dv, le) => {
        const v = dv.getUint32(0, le);
        return `0x${(v >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
    },
};

export function decodeField(
    bytes: number[],
    type: StructScalarFieldType,
    endian: 'le' | 'be',
): string {
    const size = fieldByteSize(type);
    if (bytes.length < size || bytes.some(b => b < 0)) { return '??'; }

    const buf = new ArrayBuffer(size);
    const dv = new DataView(buf);
    const le = endian === 'le';
    bytes.slice(0, size).forEach((b, i) => dv.setUint8(i, b));

    return FIELD_DECODERS[type](dv, le);
}

interface DecodeContext {
    baseAddr: number;
    getByte: (addr: number) => number | undefined;
    bitFieldAllocation: BitFieldAllocation;
    map: Map<string, StructDef>;
    rows: DecodedField[];
    depth: number;
    pathPrefix: string;
    baseOffset: number;
}

function readFieldBytes(ctx: DecodeContext, absOffset: number, count: number): number[] {
    const raw: number[] = [];
    for (let b = 0; b < count; b++) {
        const v = ctx.getByte(ctx.baseAddr + absOffset + b);
        raw.push(v !== undefined ? v : -1);
    }
    return raw;
}

function bytesToHex(raw: number[]): string {
    return raw
        .map(v => (v >= 0 ? v.toString(16).toUpperCase().padStart(2, '0') : '??'))
        .join(' ');
}

function joinFieldPath(prefix: string, name: string): string {
    return prefix ? `${prefix}.${name}` : name;
}

function decodeAsciiBytes(raw: number[]): string {
    const chars: string[] = [];
    for (const b of raw) {
        if (b === 0) { break; }
        chars.push(isPrintableAsciiByte(b) ? String.fromCharCode(b) : '.');
    }
    return chars.join('');
}

function bitFieldValueText(value: bigint, width: number): string {
    const hexDigits = Math.max(1, Math.ceil(width / 4));
    return `${value.toString(10)}  (0x${value.toString(16).toUpperCase().padStart(hexDigits, '0')})`;
}

function extractBitFieldValue(
    unitValue: bigint,
    unitBits: number,
    bitOffset: number,
    width: number,
    allocation: BitFieldAllocation,
): bigint {
    const shift = allocation === 'lsb'
        ? bitOffset
        : unitBits - bitOffset - width;
    return (unitValue >> BigInt(shift)) & bitMask(width);
}

function decodeBitFieldContainer(
    ctx: DecodeContext,
    field: StructField,
    offset: number,
    align: number,
    endian: 'le' | 'be',
): number {
    const unitBytes = fieldByteSize(field.type as UnsignedScalarType);
    const unitBits = unitBytes * 8;
    const alignedOffset = alignUp(offset, align);

    for (let idx = 0; idx < field.count; idx++) {
        const fieldPath = fieldElementPath(ctx, field, idx);
        const absOffset = ctx.baseOffset + alignedOffset + idx * unitBytes;
        decodeBitFieldChildren(ctx, field, fieldPath, idx, absOffset, unitBytes, unitBits, endian);
    }

    return alignedOffset + unitBytes * field.count;
}

function decodeBitFieldChildren(
    ctx: DecodeContext,
    field: StructField,
    fieldPath: string,
    arrayIdx: number,
    absOffset: number,
    unitBytes: number,
    unitBits: number,
    endian: 'le' | 'be',
): void {
    const unit = readBitFieldUnit(ctx, absOffset, unitBytes, endian);
    let bitPos = 0;

    for (const child of field.bitFields!) {
        const width = child.bitWidth;
        if (width > 0) {
            ctx.rows.push(bitFieldChildRow(ctx, field, child, fieldPath, arrayIdx, absOffset, unitBytes, unitBits, bitPos, unit));
        }
        bitPos += width;
    }
}

function readBitFieldUnit(ctx: DecodeContext, absOffset: number, unitBytes: number, endian: 'le' | 'be'): {
    hasData: boolean;
    bytesHex: string;
    value: bigint;
} {
    const raw = readFieldBytes(ctx, absOffset, unitBytes);
    const hasData = raw.every(v => v >= 0);
    return {
        hasData,
        bytesHex: bytesToHex(raw),
        value: hasData ? bytesToBigUint(raw.filter(v => v >= 0), endian) : 0n,
    };
}

function bitFieldChildRow(
    ctx: DecodeContext,
    field: StructField,
    child: BitFieldChild,
    fieldPath: string,
    arrayIdx: number,
    absOffset: number,
    unitBytes: number,
    unitBits: number,
    bitPos: number,
    unit: { hasData: boolean; bytesHex: string; value: bigint },
): DecodedField {
    const unsignedValue = unit.hasData
        ? extractBitFieldValue(unit.value, unitBits, bitPos, child.bitWidth, ctx.bitFieldAllocation)
        : 0n;
    const valueText = bitFieldDecodedText(unit.hasData, unsignedValue, child.bitWidth);
    return {
        fieldName: `${fieldPath}.${child.name || `bit${bitPos}`}`,
        type: field.type as UnsignedScalarType,
        arrayIdx,
        byteOffset: absOffset,
        bytesHex: unit.bytesHex,
        decoded: valueText,
        hasData: unit.hasData,
        isBitField: true,
        bitWidth: child.bitWidth,
        bitOffset: bitPos,
        bitStorageByteSize: unitBytes,
        bitValueUnsigned: bitFieldUnsignedText(unit.hasData, unsignedValue),
    };
}

function bitFieldDecodedText(hasData: boolean, unsignedValue: bigint, width: number): string {
    return hasData ? bitFieldValueText(unsignedValue, width) : '??';
}

function bitFieldUnsignedText(hasData: boolean, unsignedValue: bigint): string | undefined {
    return hasData ? unsignedValue.toString(10) : undefined;
}

function decodeAsciiField(
    ctx: DecodeContext,
    field: StructField,
    offset: number,
    elemSize: number,
    endian: 'le' | 'be',
): number {
    const absOffset = ctx.baseOffset + offset;
    const totalBytes = elemSize * field.count;
    const raw = readFieldBytes(ctx, absOffset, totalBytes);
    const hasData = raw.every(v => v >= 0);
    ctx.rows.push({
        fieldName: joinFieldPath(ctx.pathPrefix, field.name),
        type: 'ascii',
        arrayIdx: 0,
        byteOffset: absOffset,
        bytesHex: bytesToHex(raw),
        decoded: hasData ? decodeAsciiBytes(raw) : '??',
        hasData,
    });
    return offset + totalBytes;
}

function decodeScalarFieldElement(
    ctx: DecodeContext,
    field: StructField,
    fieldPath: string,
    arrayIdx: number,
    absOffset: number,
    elemSize: number,
    endian: 'le' | 'be',
): void {
    if (field.type === 'struct') { return; }
    const raw = readFieldBytes(ctx, absOffset, elemSize);
    const hasData = raw.every(v => v >= 0);
    ctx.rows.push({
        fieldName: fieldPath,
        type: field.type,
        arrayIdx,
        byteOffset: absOffset,
        bytesHex: bytesToHex(raw),
        decoded: hasData ? decodeField(raw, field.type, endian) : '??',
        hasData,
    });
}

function decodeNestedStructField(
    ctx: DecodeContext,
    field: StructField,
    fieldPath: string,
    absOffset: number,
    endian: 'le' | 'be',
): void {
    const child = referencedStruct(field, ctx.map);
    if (!child || ctx.depth >= MAX_NESTED_DEPTH) { return; }
    decodeStructRecursive(
        child,
        ctx.baseAddr,
        ctx.getByte,
        endian,
        ctx.bitFieldAllocation,
        ctx.map,
        ctx.rows,
        ctx.depth + 1,
        fieldPath,
        absOffset,
    );
}

function decodeFieldElements(
    ctx: DecodeContext,
    field: StructField,
    offset: number,
    elemSize: number,
    endian: 'le' | 'be',
): number {
    let nextOffset = offset;
    for (let idx = 0; idx < field.count; idx++) {
        const fieldPath = fieldElementPath(ctx, field, idx);
        const absOffset = ctx.baseOffset + nextOffset;
        if (field.type === 'struct') {
            decodeNestedStructField(ctx, field, fieldPath, absOffset, endian);
        } else {
            decodeScalarFieldElement(ctx, field, fieldPath, idx, absOffset, elemSize, endian);
        }
        nextOffset += elemSize;
    }
    return nextOffset;
}

function fieldElementPath(ctx: DecodeContext, field: StructField, idx: number): string {
    const elementName = field.count > 1 ? `${field.name}[${idx}]` : field.name;
    return joinFieldPath(ctx.pathPrefix, elementName);
}

function decodeStructRecursive(
    def: StructDef,
    baseAddr: number,
    getByte: (addr: number) => number | undefined,
    globalEndian: 'le' | 'be',
    bitFieldAllocation: BitFieldAllocation,
    map: Map<string, StructDef>,
    rows: DecodedField[],
    depth: number,
    pathPrefix: string,
    baseOffset: number,
): number {
    let offset = 0;
    const ctx: DecodeContext = { baseAddr, getByte, bitFieldAllocation, map, rows, depth, pathPrefix, baseOffset };

    for (const field of def.fields) {
        offset = decodeStructField(ctx, def, field, offset, globalEndian);
    }

    if (!def.packed) {
        const structAlign = structAlignmentWithDefs(def, map, depth);
        offset = alignUp(offset, structAlign);
    }

    return offset;
}

function decodeStructField(
    ctx: DecodeContext,
    def: StructDef,
    field: StructField,
    offset: number,
    globalEndian: 'le' | 'be',
): number {
    const align = def.packed ? 1 : fieldAlignWithDefs(field, ctx.map, ctx.depth);
    const elemSize = fieldSizeWithDefs(field, ctx.map, ctx.depth);
    if (isBitFieldContainer(field)) {
        return decodeBitFieldContainer(ctx, field, offset, align, globalEndian);
    }

    const alignedOffset = alignUp(offset, align);
    if (field.type === 'ascii') {
        return decodeAsciiField(ctx, field, alignedOffset, elemSize, globalEndian);
    }
    return decodeFieldElements(ctx, field, alignedOffset, elemSize, globalEndian);
}

export function decodeStruct(
    def: StructDef,
    baseAddr: number,
    getByte: (addr: number) => number | undefined,
    globalEndian: 'le' | 'be',
    bitFieldAllocation: BitFieldAllocation = 'msb',
): DecodedField[] {
    const rows: DecodedField[] = [];
    const map = defsMap(def);
    decodeStructRecursive(def, baseAddr, getByte, globalEndian, bitFieldAllocation, map, rows, 1, '', 0);
    return rows;
}

// -- All visible structs ------------------------------------------

export function allStructs(): StructDef[] {
    return [...S.structs];
}

// -- C struct text parser -----------------------------------------

/**
 * Maps common C scalar type names to our internal scalar field type.
 * Lookup is case-sensitive first, then case-folded as fallback.
 */
const C_TYPE_MAP: Record<string, StructScalarFieldType> = {
    'char': 'ascii',
    'uint8_t': 'uint8', 'uint8': 'uint8', 'u8': 'uint8',
    'unsigned char': 'uint8', 'byte': 'uint8', 'BYTE': 'uint8',

    'uint16_t': 'uint16', 'uint16': 'uint16', 'u16': 'uint16',
    'unsigned short': 'uint16', 'WORD': 'uint16', 'word': 'uint16',

    'uint32_t': 'uint32', 'uint32': 'uint32', 'u32': 'uint32',
    'unsigned int': 'uint32', 'unsigned long': 'uint32',
    'DWORD': 'uint32', 'dword': 'uint32',

    'uint64_t': 'uint64', 'uint64': 'uint64', 'u64': 'uint64',
    'unsigned long long': 'uint64',

    'int8_t': 'int8', 'int8': 'int8', 'i8': 'int8',
    'signed char': 'int8',

    'int16_t': 'int16', 'int16': 'int16', 'i16': 'int16',
    'short': 'int16', 'signed short': 'int16',

    'int32_t': 'int32', 'int32': 'int32', 'i32': 'int32',
    'int': 'int32', 'long': 'int32', 'signed int': 'int32',

    'int64_t': 'int64', 'int64': 'int64', 'i64': 'int64',
    'long long': 'int64', 'signed long long': 'int64',

    'float': 'float32', 'float32': 'float32',
    'double': 'float64', 'float64': 'float64',
};

/** Maps scalar field types back to canonical C type names for serialization. */
const TYPE_TO_C: Record<StructScalarFieldType, string> = {
    ascii: 'char',
    uint8: 'uint8_t', uint16: 'uint16_t', uint32: 'uint32_t', uint64: 'uint64_t',
    int8: 'int8_t', int16: 'int16_t', int32: 'int32_t', int64: 'int64_t',
    float32: 'float', float64: 'double',
    pointer: 'void*',
};

function fieldTypeToC(field: StructField, defsById: Map<string, StructDef>): string {
    if (field.type !== 'struct') {
        return TYPE_TO_C[field.type];
    }
    const child = defsById.get(field.refStructId ?? '');
    return child === undefined ? 'uint8_t' : child.name;
}

function isPrintableAsciiByte(value: number): boolean {
    return value >= 0x20 && value < 0x7F;
}

export interface ParseStructTextResult {
    /** Struct name extracted from a `struct Name { }` wrapper, or null. */
    structName: string | null;
    fields: StructField[];
    /** Parse error messages (one per bad line). */
    errors: string[];
}

function appendParsedBitField(
    fields: StructField[],
    type: UnsignedScalarType,
    name: string,
    bitWidth: number,
): void {
    const unitBits = fieldByteSize(type) * 8;
    const last = fields[fields.length - 1];
    const lastUsedBits = last?.bitFields?.reduce((sum, child) => sum + child.bitWidth, 0) ?? 0;
    if (canAppendBitField(last, type, lastUsedBits, bitWidth, unitBits)) {
        last.bitFields.push({ name, bitWidth });
        return;
    }

    fields.push({
        name,
        type,
        count: 1,
        bitFields: [{ name, bitWidth }],
    });
}

function canAppendBitField(
    last: StructField | undefined,
    type: UnsignedScalarType,
    lastUsedBits: number,
    bitWidth: number,
    unitBits: number,
): last is StructField & { bitFields: BitFieldChild[] } {
    if (!isMatchingBitFieldContainer(last, type)) { return false; }
    return lastUsedBits + bitWidth <= unitBits;
}

function isMatchingBitFieldContainer(
    field: StructField | undefined,
    type: UnsignedScalarType,
): field is StructField & { bitFields: BitFieldChild[] } {
    return Boolean(field) &&
        field!.type === type &&
        field!.count === 1 &&
        Array.isArray(field!.bitFields);
}

type ParsedStructLine =
    | { kind: 'skip' }
    | { kind: 'error'; message: string }
    | { kind: 'field'; field: StructField }
    | { kind: 'bitField'; type: UnsignedScalarType; name: string; bitWidth: number };

interface StructDeclarationParts {
    rawType: string;
    fieldName: string;
    bitWidth: number | null;
    count: number;
}

function preserveMultilineCommentSpacing(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, m => {
        const newlines = (m.match(/\n/g) ?? []).length;
        return newlines === 0 ? m : '\n'.repeat(newlines);
    });
}

function stripStructLine(rawLine: string): string {
    const noBlock = rawLine.replace(/\/\*[^*\n]*\*\//g, '');
    const slashIdx = noBlock.indexOf('//');
    const line = (slashIdx >= 0 ? noBlock.slice(0, slashIdx) : noBlock).trim();
    return line.replace(/;$/, '').trim();
}

function parseBitFieldDeclaration(
    fieldName: string,
    mapped: StructScalarFieldType,
    bitWidth: number,
    count: number,
): ParsedStructLine {
    const error = bitFieldDeclarationError(fieldName, mapped, bitWidth, count);
    if (error) { return { kind: 'error', message: error }; }
    return { kind: 'bitField', type: mapped as UnsignedScalarType, name: fieldName, bitWidth };
}

function bitFieldDeclarationError(
    fieldName: string,
    mapped: StructScalarFieldType,
    bitWidth: number,
    count: number,
): string | null {
    return bitFieldBaseTypeDeclarationError(fieldName, mapped) ??
        bitFieldWidthDeclarationError(fieldName, mapped, bitWidth) ??
        bitFieldCountDeclarationError(fieldName, count);
}

function bitFieldBaseTypeDeclarationError(fieldName: string, mapped: StructScalarFieldType): string | null {
    return isUnsignedScalarType(mapped) ? null : bitFieldBaseTypeError(fieldName);
}

function bitFieldWidthDeclarationError(fieldName: string, mapped: StructScalarFieldType, bitWidth: number): string | null {
    if (hasInvalidBitWidth(bitWidth)) { return bitFieldWidthError(fieldName, bitWidth); }
    if (!isUnsignedScalarType(mapped)) { return null; }
    const maxBits = fieldByteSize(mapped) * 8;
    return bitWidth > maxBits ? bitFieldMaxWidthError(fieldName, bitWidth, maxBits) : null;
}

function hasInvalidBitWidth(bitWidth: number): boolean {
    return !Number.isInteger(bitWidth) || bitWidth <= 0;
}

function bitFieldCountDeclarationError(fieldName: string, count: number): string | null {
    if (count !== 1) { return bitFieldArrayError(fieldName); }
    return null;
}

function bitFieldBaseTypeError(fieldName: string): string {
    return `Bit-field "${fieldName}" must use an unsigned integer base type.`;
}

function bitFieldWidthError(fieldName: string, bitWidth: number): string {
    return `Bit-field "${fieldName}" has invalid width "${bitWidth}".`;
}

function bitFieldMaxWidthError(fieldName: string, bitWidth: number, maxBits: number): string {
    return `Bit-field "${fieldName}" width ${bitWidth} exceeds ${maxBits}.`;
}

function bitFieldArrayError(fieldName: string): string {
    return `Bit-field "${fieldName}" cannot be declared as an array.`;
}

function parseStructDeclarationLine(rawLine: string): ParsedStructLine {
    const stripped = stripStructLine(rawLine);
    if (shouldSkipStructDeclaration(stripped)) { return { kind: 'skip' }; }

    const parts = parseStructDeclarationParts(stripped);
    if (!parts) { return { kind: 'error', message: `Cannot parse: "${stripped}"` }; }

    return parseResolvedStructDeclaration(parts);
}

function parseResolvedStructDeclaration(parts: StructDeclarationParts): ParsedStructLine {
    const mapped = mapStructDeclarationType(parts.rawType);
    if (!mapped) {
        return { kind: 'error', message: `Unknown type "${parts.rawType}" for field "${parts.fieldName}"` };
    }

    if (parts.bitWidth !== null) {
        return parseBitFieldDeclaration(parts.fieldName, mapped, parts.bitWidth, parts.count);
    }

    return {
        kind: 'field',
        field: { name: parts.fieldName, type: mapped, count: parts.count },
    };
}

function shouldSkipStructDeclaration(stripped: string): boolean {
    return !stripped || stripped === '{' || stripped === '}' || /^(?:typedef|struct|union)\b/.test(stripped);
}

function parseStructDeclarationParts(stripped: string): StructDeclarationParts | null {
    const unqual = stripped.replace(/^(?:(?:const|volatile|static|register)\s+)+/, '');
    const match = unqual.match(/^((?:unsigned|signed)\s+\w+|\w+)\s+(\w+)\s*(?::\s*(\d+))?\s*(?:\[(\d+)\])?$/);
    if (!match) { return null; }

    return {
        rawType: match[1].replace(/\s+/g, ' '),
        fieldName: match[2],
        bitWidth: match[3] ? parseInt(match[3], 10) : null,
        count: match[4] ? Math.max(1, parseInt(match[4], 10)) : 1,
    };
}

function mapStructDeclarationType(rawType: string): StructScalarFieldType | undefined {
    return C_TYPE_MAP[rawType] ?? C_TYPE_MAP[rawType.toLowerCase()];
}

/**
 * Parse C-style struct field declarations into StructField[].
 * Accepts bare field declarations OR a full `struct Name { ... }` / `typedef struct Name { ... }`.
 * Nested type references are not resolved here and must be chosen in the struct editor.
 */
export function parseStructText(text: string): ParseStructTextResult {
    const errors: string[] = [];
    const fields: StructField[] = [];
    let structName: string | null = null;

    const cleaned = preserveMultilineCommentSpacing(text);

    const nameMatch = cleaned.match(/(?:typedef\s+)?struct\s+(\w+)\s*\{/);
    if (nameMatch) { structName = nameMatch[1]; }

    const bodyMatch = cleaned.match(/\{([\s\S]*)\}/);
    const body = bodyMatch ? bodyMatch[1] : cleaned;

    for (const rawLine of body.split('\n')) {
        appendParsedStructLine(rawLine, fields, errors);
    }

    return { structName, fields, errors };
}

function appendParsedStructLine(rawLine: string, fields: StructField[], errors: string[]): void {
    const parsed = parseStructDeclarationLine(rawLine);
    if (parsed.kind === 'skip') { return; }
    if (parsed.kind === 'error') {
        errors.push(parsed.message);
        return;
    }
    if (parsed.kind === 'bitField') {
        appendParsedBitField(fields, parsed.type, parsed.name, parsed.bitWidth);
        return;
    }
    fields.push(parsed.field);
}

/** Serialize StructField[] back to C-style declarations. */
export function fieldsToText(fields: StructField[], defs: StructDef[] = allStructs()): string {
    if (fields.length === 0) { return ''; }
    const byId = new Map<string, StructDef>(defs.map(d => [d.id, d]));
    const typeNames = fields.map(f => fieldTypeToC(f, byId));
    const maxTypeLen = Math.max(...typeNames.map(t => t.length));

    return fields.map((f, i) => {
        // BitFields container: emit each child as a flat C bit declaration
        if (isBitFieldContainer(f)) {
            const cType = fieldTypeToC(f, byId).padEnd(maxTypeLen);
            const arr = f.count > 1 ? `[${f.count}]` : '';
            return f.bitFields!.map(child => `${cType} ${child.name}${arr}:${child.bitWidth};`).join('\n');
        }
        const cType = typeNames[i].padEnd(maxTypeLen);
        const arr = f.count > 1 ? `[${f.count}]` : '';
        return `${cType} ${f.name}${arr};`;
    }).join('\n');
}

type StructCEmitState = {
    byId: Map<string, StructDef>;
    lines: string[];
    maxTypeLen: number;
    offset: number;
    maxAlign: number;
    packed: boolean;
};

function emitStructCField(f: StructField, fieldIndex: number, state: StructCEmitState): void {
    if (isBitFieldContainer(f)) {
        emitBitFieldContainerC(f, state);
        return;
    }

    emitScalarStructFieldC(f, fieldIndex, state);
}

function emitBitFieldContainerC(f: StructField, state: StructCEmitState): void {
    const unitBytes = fieldByteSize(f.type as UnsignedScalarType);
    const align = state.packed ? 1 : fieldAlignWithDefs(f, state.byId, 1);
    applyStructCAlignment(align, state);

    const cType = fieldTypeToC(f, state.byId);
    const arr = f.count > 1 ? `[${f.count}]` : '';
    const fieldName = f.name || 'bitfield';

    state.lines.push(`    struct {`);
    appendBitFieldChildrenC(f, cType, state.lines);
    state.lines.push(`    } ${fieldName}${arr};`);
    state.offset += unitBytes * f.count;
}

function appendBitFieldChildrenC(f: StructField, cType: string, lines: string[]): void {
    let childBitPos = 0;
    for (const child of f.bitFields!) {
        const width = child.bitWidth;
        const childName = child.name || `bit${childBitPos}`;
        lines.push(
            `        ${cType} ${childName}:${width};`.padEnd(44) +
            `/* ${childBitPos.toString().padStart(2)}..${(childBitPos + width - 1).toString().padStart(2)} */`
        );
        childBitPos += width;
    }
}

function emitScalarStructFieldC(f: StructField, fieldIndex: number, state: StructCEmitState): void {
    const fieldSize = fieldSizeWithDefs(f, state.byId, 1);
    const align = state.packed ? 1 : fieldAlignWithDefs(f, state.byId, 1);
    applyStructCAlignment(align, state);

    const cType = fieldTypeToC(f, state.byId).padEnd(state.maxTypeLen);
    const displayFieldName = f.name || `field${fieldIndex}`;
    const arr = f.count > 1 ? `[${f.count}]` : '';
    const fieldBytes = fieldSize * f.count;
    state.lines.push(
        `    ${cType} ${displayFieldName}${arr};`.padEnd(44) +
        `/* +${state.offset.toString().padStart(3)}  ${fieldBytes}B */`
    );
    state.offset += fieldBytes;
}

function applyStructCAlignment(align: number, state: StructCEmitState): void {
    if (align > state.maxAlign) { state.maxAlign = align; }
    const aligned = alignUp(state.offset, align);
    if (!state.packed && aligned > state.offset) {
        appendStructCPadding(state.lines, state.offset, aligned - state.offset);
    }
    state.offset = aligned;
}

function appendStructCPadding(lines: string[], offset: number, padBytes: number): void {
    lines.push(
        `    uint8_t  _pad${offset}[${padBytes}];`.padEnd(44) +
        `/* +${offset.toString().padStart(3)}  ${padBytes}B padding */`
    );
}

function maxStructCTypeLength(fields: StructField[], byId: Map<string, StructDef>): number {
    const typeLens = fields.map(f => fieldTypeToC(f, byId).length);
    return typeLens.length > 0 ? Math.max(...typeLens) : 8;
}

function createStructCEmitState(def: StructDef, lines: string[], byId: Map<string, StructDef>): StructCEmitState {
    return { byId, lines, maxTypeLen: maxStructCTypeLength(def.fields, byId), offset: 0, maxAlign: 1, packed: !!def.packed };
}

function appendStructCFooter(def: StructDef, lines: string[], totalBytes: number, alignNote: string): void {
    const displayName = def.name || 'MyStruct';
    lines.push(`} ${displayName};`.padEnd(44) + `/* ${totalBytes}B, ${alignNote} */`);
}

function emitStructCFields(def: StructDef, state: StructCEmitState): void {
    for (let fieldIndex = 0; fieldIndex < def.fields.length; fieldIndex++) {
        emitStructCField(def.fields[fieldIndex], fieldIndex, state);
    }
}

function appendTrailingStructCPadding(def: StructDef, lines: string[], offset: number, totalPadded: number): void {
    if (def.packed || totalPadded <= offset) { return; }
    appendStructCPadding(lines, offset, totalPadded - offset);
}

function structCTotalBytes(def: StructDef, totalUnpadded: number, totalPadded: number): number {
    return def.packed ? totalUnpadded : totalPadded;
}

function structCAlignNote(def: StructDef, maxAlign: number): string {
    return def.packed ? 'packed' : `align=${maxAlign}`;
}

/** Render a StructDef as a C typedef with per-field offset comments. */
export function structToC(def: StructDef, defs: StructDef[] = allStructs()): string {
    const byId = createStructDefMap(def, defs);

    const attr = def.packed ? ' __attribute__((packed))' : '';
    const lines: string[] = [];
    lines.push(`typedef struct${attr} {`);

    const state = createStructCEmitState(def, lines, byId);

    emitStructCFields(def, state);

    const totalUnpadded = state.offset;
    const totalPadded = alignUp(state.offset, state.maxAlign);
    appendTrailingStructCPadding(def, lines, state.offset, totalPadded);

    const totalBytes = structCTotalBytes(def, totalUnpadded, totalPadded);
    const alignNote = structCAlignNote(def, state.maxAlign);
    appendStructCFooter(def, lines, totalBytes, alignNote);

    return lines.join('\n');
}
