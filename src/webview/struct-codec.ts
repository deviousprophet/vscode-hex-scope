// -- Struct Overlay - pure codec (no DOM / VS Code API dependencies) --
// Contains field size helpers, decode logic, parser/serializer helpers, and struct validation.

import { S } from './state';
import type {
    StructDef,
    StructField,
    StructFieldType,
    StructFieldEndian,
    StructScalarFieldType,
} from './types';

export type { StructDef, StructField, StructFieldType, StructFieldEndian };

export const MAX_NESTED_DEPTH = 32;

// -- Constants -----------------------------------------------------

export const FIELD_TYPES: StructScalarFieldType[] = [
    'ascii',
    'uint8', 'uint16', 'uint32', 'uint64',
    'int8', 'int16', 'int32', 'int64',
    'float32', 'float64',
    'pointer',
];

export function fieldByteSize(type: StructScalarFieldType): number {
    switch (type) {
        case 'ascii':
        case 'uint8':
        case 'int8':
            return 1;
        case 'uint16':
        case 'int16':
            return 2;
        case 'uint32':
        case 'int32':
        case 'float32':
        case 'pointer':
            return 4;
        case 'uint64':
        case 'int64':
        case 'float64':
            return 8;
    }
}

/** Natural alignment for a scalar field type. */
export function fieldAlignment(type: StructScalarFieldType): number {
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
        if (align > maxAlign) { maxAlign = align; }
    }
    return maxAlign;
}

function structByteSizeWithDefs(def: StructDef, map: Map<string, StructDef>, depth: number): number {
    if (def.packed) {
        return def.fields.reduce((s, f) => s + fieldSizeWithDefs(f, map, depth) * f.count, 0);
    }

    let offset = 0;
    let maxAlign = 1;
    for (const f of def.fields) {
        const sz = fieldSizeWithDefs(f, map, depth);
        const align = fieldAlignWithDefs(f, map, depth);
        if (align > maxAlign) { maxAlign = align; }
        offset = alignUp(offset, align);
        offset += sz * f.count;
    }
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
            if (f.type !== 'struct') { continue; }
            if (!f.refStructId) {
                errors.push(`Struct "${d.name}": field "${f.name}" is missing a referenced struct.`);
                continue;
            }
            if (!byId.has(f.refStructId)) {
                errors.push(`Struct "${d.name}": field "${f.name}" references an unknown struct.`);
            }
        }
    }

    const visit = (defId: string, depth: number, stack: string[]): void => {
        if (depth > maxDepth) {
            const name = byId.get(defId)?.name ?? defId;
            errors.push(`Nesting depth exceeds ${maxDepth} at struct "${name}".`);
            return;
        }
        const def = byId.get(defId);
        if (!def) { return; }

        for (const f of def.fields) {
            if (f.type !== 'struct' || !f.refStructId) { continue; }
            if (stack.includes(f.refStructId)) {
                const cycle = [...stack, f.refStructId]
                    .map(id => byId.get(id)?.name ?? id)
                    .join(' -> ');
                errors.push(`Nested struct cycle detected: ${cycle}`);
                continue;
            }
            visit(f.refStructId, depth + 1, [...stack, f.refStructId]);
        }
    };

    defs.forEach(d => visit(d.id, 1, [d.id]));
    return [...new Set(errors)];
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
    const normalized = fieldPath.replace(/\[\d+\]/g, '');
    const parts = normalized.split('.').map(p => p.trim()).filter(Boolean);
    if (parts.length === 0) { return null; }

    const byId = new Map<string, StructDef>(defs.map(d => [d.id, d]));
    byId.set(def.id, def);

    let curDef: StructDef | null = def;
    for (let i = 0; i < parts.length; i++) {
        if (!curDef) { return null; }
        const part = parts[i];
        const field: StructField | undefined = curDef.fields.find((candidate: StructField) => candidate.name === part);
        if (!field) { return null; }
        const isLast = i === parts.length - 1;
        if (isLast) {
            if (field.type !== 'struct') {
                return { field };
            }
            const child = field.refStructId ? byId.get(field.refStructId) : null;
            return { field, structName: child?.name };
        }
        if (field.type !== 'struct' || !field.refStructId) { return null; }
        curDef = byId.get(field.refStructId) ?? null;
    }

    return null;
}

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

    switch (type) {
        case 'ascii': {
            const b = dv.getUint8(0);
            if (b === 0) { return ''; }
            return b >= 0x20 && b < 0x7F ? String.fromCharCode(b) : '.';
        }
        case 'int8':
            return `${dv.getInt8(0)}`;
        case 'int16':
            return `${dv.getInt16(0, le)}`;
        case 'int32':
            return `${dv.getInt32(0, le)}`;
        case 'int64': {
            const v = dv.getBigInt64(0, le);
            return `${v.toString(10)}`;
        }
        case 'uint8':
            return `${dv.getUint8(0)}  (0x${dv.getUint8(0).toString(16).toUpperCase().padStart(2, '0')})`;
        case 'uint16': {
            const v = dv.getUint16(0, le);
            return `${v}  (0x${v.toString(16).toUpperCase().padStart(4, '0')})`;
        }
        case 'uint32': {
            const v = dv.getUint32(0, le);
            return `${v >>> 0}  (0x${(v >>> 0).toString(16).toUpperCase().padStart(8, '0')})`;
        }
        case 'uint64': {
            const v = dv.getBigUint64(0, le);
            return `${v.toString(10)}  (0x${v.toString(16).toUpperCase().padStart(16, '0')})`;
        }
        case 'float32': {
            const v = dv.getFloat32(0, le);
            if (isNaN(v)) { return 'NaN'; }
            if (!isFinite(v)) { return String(v); }
            return v.toExponential(6);
        }
        case 'float64': {
            const v = dv.getFloat64(0, le);
            if (isNaN(v)) { return 'NaN'; }
            if (!isFinite(v)) { return String(v); }
            return v.toExponential(16);
        }
        case 'pointer': {
            const v = dv.getUint32(0, le);
            return `0x${(v >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
        }
    }
}

function decodeStructRecursive(
    def: StructDef,
    baseAddr: number,
    getByte: (addr: number) => number | undefined,
    globalEndian: 'le' | 'be',
    map: Map<string, StructDef>,
    rows: DecodedField[],
    depth: number,
    pathPrefix: string,
    baseOffset: number,
): number {
    let offset = 0;

    for (const field of def.fields) {
        const align = def.packed ? 1 : fieldAlignWithDefs(field, map, depth);
        const elemSize = fieldSizeWithDefs(field, map, depth);
        const endian = field.endian === 'inherit' ? globalEndian : field.endian;
        offset = alignUp(offset, align);

        if (field.type === 'ascii') {
            const fieldPath = pathPrefix ? `${pathPrefix}.${field.name}` : field.name;
            const absOffset = baseOffset + offset;
            const totalBytes = elemSize * field.count;
            const raw: number[] = [];
            for (let b = 0; b < totalBytes; b++) {
                const v = getByte(baseAddr + absOffset + b);
                raw.push(v !== undefined ? v : -1);
            }
            const hasData = raw.every(v => v >= 0);
            const bytesHex = raw
                .map(v => (v >= 0 ? v.toString(16).toUpperCase().padStart(2, '0') : '??'))
                .join(' ');
            const decoded = hasData
                ? (() => {
                    const chars: string[] = [];
                    for (const b of raw) {
                        if (b === 0) { break; }
                        chars.push(b >= 0x20 && b < 0x7F ? String.fromCharCode(b) : '.');
                    }
                    return chars.join('');
                })()
                : '??';

            rows.push({
                fieldName: fieldPath,
                type: 'ascii',
                arrayIdx: 0,
                byteOffset: absOffset,
                bytesHex,
                decoded,
                hasData,
            });
            offset += totalBytes;
            continue;
        }

        for (let idx = 0; idx < field.count; idx++) {
            const elementName = field.count > 1 ? `${field.name}[${idx}]` : field.name;
            const fieldPath = pathPrefix ? `${pathPrefix}.${elementName}` : elementName;
            const absOffset = baseOffset + offset;

            if (field.type === 'struct') {
                const child = referencedStruct(field, map);
                if (child && depth < MAX_NESTED_DEPTH) {
                    decodeStructRecursive(
                        child,
                        baseAddr,
                        getByte,
                        globalEndian,
                        map,
                        rows,
                        depth + 1,
                        fieldPath,
                        absOffset,
                    );
                }
                offset += elemSize;
                continue;
            }

            const raw: number[] = [];
            for (let b = 0; b < elemSize; b++) {
                const v = getByte(baseAddr + absOffset + b);
                raw.push(v !== undefined ? v : -1);
            }
            const hasData = raw.every(v => v >= 0);
            const bytesHex = raw
                .map(v => (v >= 0 ? v.toString(16).toUpperCase().padStart(2, '0') : '??'))
                .join(' ');
            const decoded = hasData ? decodeField(raw, field.type, endian) : '??';

            rows.push({
                fieldName: fieldPath,
                type: field.type,
                arrayIdx: idx,
                byteOffset: absOffset,
                bytesHex,
                decoded,
                hasData,
            });

            offset += elemSize;
        }
    }

    if (!def.packed) {
        const structAlign = structAlignmentWithDefs(def, map, depth);
        offset = alignUp(offset, structAlign);
    }

    return offset;
}

export function decodeStruct(
    def: StructDef,
    baseAddr: number,
    getByte: (addr: number) => number | undefined,
    globalEndian: 'le' | 'be',
): DecodedField[] {
    const rows: DecodedField[] = [];
    const map = defsMap(def);
    decodeStructRecursive(def, baseAddr, getByte, globalEndian, map, rows, 1, '', 0);
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
export const TYPE_TO_C: Record<StructScalarFieldType, string> = {
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
    const child = field.refStructId ? defsById.get(field.refStructId) : null;
    return child?.name ?? 'uint8_t';
}

export interface ParseStructTextResult {
    /** Struct name extracted from a `struct Name { }` wrapper, or null. */
    structName: string | null;
    fields: StructField[];
    /** Parse error messages (one per bad line). */
    errors: string[];
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

    const cleaned = text.replace(/\/\*[\s\S]*?\*\//g, m => {
        const newlines = (m.match(/\n/g) ?? []).length;
        return newlines === 0 ? m : '\n'.repeat(newlines);
    });

    const nameMatch = cleaned.match(/(?:typedef\s+)?struct\s+(\w+)\s*\{/);
    if (nameMatch) { structName = nameMatch[1]; }

    const bodyMatch = cleaned.match(/\{([\s\S]*)\}/);
    const body = bodyMatch ? bodyMatch[1] : cleaned;

    for (const rawLine of body.split('\n')) {
        const blockComMatch = rawLine.match(/\/\*([^*\n]*)\*\//);
        const blockComment = blockComMatch ? blockComMatch[1].trim() : '';
        const noBlock = rawLine.replace(/\/\*[^*\n]*\*\//g, '');
        const slashIdx = noBlock.indexOf('//');
        const lineComment = slashIdx >= 0 ? noBlock.slice(slashIdx + 2).trim() : '';
        const line = (slashIdx >= 0 ? noBlock.slice(0, slashIdx) : noBlock).trim();
        const comment = lineComment || blockComment;

        const stripped = line.replace(/;$/, '').trim();
        if (!stripped || stripped === '{' || stripped === '}' || /^(?:typedef|struct|union)\b/.test(stripped)) {
            continue;
        }

        const unqual = stripped.replace(/^(?:(?:const|volatile|static|register)\s+)+/, '');
        const m = unqual.match(/^((?:unsigned|signed)\s+\w+|\w+)\s+(\w+)\s*(?:\[(\d+)\])?$/);
        if (!m) {
            if (unqual) { errors.push(`Cannot parse: "${stripped}"`); }
            continue;
        }

        const rawType = m[1].replace(/\s+/g, ' ');
        const fieldName = m[2];
        const count = m[3] ? Math.max(1, parseInt(m[3], 10)) : 1;

        const mapped = C_TYPE_MAP[rawType] ?? C_TYPE_MAP[rawType.toLowerCase()];
        if (!mapped) {
            errors.push(`Unknown type "${rawType}" for field "${fieldName}"`);
            continue;
        }

        let endian: StructFieldEndian = 'inherit';
        if (/\bbe\b/i.test(comment)) { endian = 'be'; }
        else if (/\ble\b/i.test(comment)) { endian = 'le'; }

        fields.push({ name: fieldName, type: mapped, count, endian });
    }

    return { structName, fields, errors };
}

/** Serialize StructField[] back to C-style declarations. */
export function fieldsToText(fields: StructField[], defs: StructDef[] = allStructs()): string {
    if (fields.length === 0) { return ''; }
    const byId = new Map<string, StructDef>(defs.map(d => [d.id, d]));
    const typeNames = fields.map(f => fieldTypeToC(f, byId));
    const maxTypeLen = Math.max(...typeNames.map(t => t.length));

    return fields.map((f, i) => {
        const cType = typeNames[i].padEnd(maxTypeLen);
        const arr = f.count > 1 ? `[${f.count}]` : '';
        const hint = f.endian !== 'inherit' ? `  // ${f.endian}` : '';
        return `${cType} ${f.name}${arr};${hint}`;
    }).join('\n');
}

/** Render a StructDef as a C typedef with per-field offset comments. */
export function structToC(def: StructDef, defs: StructDef[] = allStructs()): string {
    const byId = new Map<string, StructDef>(defs.map(d => [d.id, d]));
    byId.set(def.id, def);

    const attr = def.packed ? ' __attribute__((packed))' : '';
    const lines: string[] = [];
    lines.push(`typedef struct${attr} {`);

    const typeLens = def.fields.map(f => fieldTypeToC(f, byId).length);
    const maxTypeLen = typeLens.length > 0 ? Math.max(...typeLens) : 8;

    let offset = 0;
    let maxAlign = 1;

    def.fields.forEach((f, fi) => {
        const sz = fieldSizeWithDefs(f, byId, 1);
        const align = def.packed ? 1 : fieldAlignWithDefs(f, byId, 1);
        if (align > maxAlign) { maxAlign = align; }
        const aligned = alignUp(offset, align);

        if (!def.packed && aligned > offset) {
            const padBytes = aligned - offset;
            lines.push(
                `    uint8_t  _pad${offset}[${padBytes}];`.padEnd(44) +
                `/* +${offset.toString().padStart(3)}  ${padBytes}B padding */`
            );
        }

        offset = aligned;
        const cType = fieldTypeToC(f, byId).padEnd(maxTypeLen);
        const displayFieldName = f.name || `field${fi}`;
        const arr = f.count > 1 ? `[${f.count}]` : '';
        const fieldBytes = sz * f.count;
        const endianHint = f.endian !== 'inherit' ? `  /* ${f.endian} */` : '';

        lines.push(
            `    ${cType} ${displayFieldName}${arr};`.padEnd(44) +
            `/* +${offset.toString().padStart(3)}  ${fieldBytes}B${endianHint} */`
        );

        offset += fieldBytes;
    });

    const totalUnpadded = offset;
    const totalPadded = alignUp(offset, maxAlign);
    if (!def.packed && totalPadded > totalUnpadded) {
        const padBytes = totalPadded - totalUnpadded;
        lines.push(
            `    uint8_t  _pad${offset}[${padBytes}];`.padEnd(44) +
            `/* +${offset.toString().padStart(3)}  ${padBytes}B padding */`
        );
    }

    const totalBytes = def.packed ? totalUnpadded : totalPadded;
    const alignNote = def.packed ? 'packed' : `align=${maxAlign}`;
    const displayName = def.name || 'MyStruct';
    lines.push(`} ${displayName};`.padEnd(44) + `/* ${totalBytes}B, ${alignNote} */`);

    return lines.join('\n');
}
