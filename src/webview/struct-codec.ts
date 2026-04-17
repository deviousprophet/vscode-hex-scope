// ── Struct Overlay — pure codec (no DOM / VS Code API dependencies) ──
// Contains field size helpers, decode logic, presets, and allStructs().
// Importable from both the webview runtime and the test runner.

import { S }       from './state';
import type { StructDef, StructField, StructFieldType, StructFieldEndian } from './types';

export type { StructDef, StructField, StructFieldType, StructFieldEndian };

// ── Constants ─────────────────────────────────────────────────────

export const FIELD_TYPES: StructFieldType[] = [
    'uint8', 'uint16', 'uint32',
    'int8',  'int16',  'int32',
    'float32', 'float64',
    'pointer',
];

export function fieldByteSize(type: StructFieldType): number {
    switch (type) {
        case 'uint8':  case 'int8':    return 1;
        case 'uint16': case 'int16':   return 2;
        case 'uint32': case 'int32':
        case 'float32': case 'pointer': return 4;
        case 'float64':                return 8;
    }
}

export function structByteSize(def: StructDef): number {
    return def.fields.reduce((s, f) => s + fieldByteSize(f.type) * f.count, 0);
}

// ── Decode logic ──────────────────────────────────────────────────

export interface DecodedField {
    fieldName: string;
    type: StructFieldType;
    /** Index within the array (0 for scalars). */
    arrayIdx: number;
    byteOffset: number;
    bytesHex: string;
    decoded: string;
    hasData: boolean;
}

export function decodeField(
    bytes: number[],       // exactly fieldByteSize(type) bytes; value < 0 means missing
    type: StructFieldType,
    endian: 'le' | 'be',
): string {
    const size = fieldByteSize(type);
    if (bytes.length < size || bytes.some(b => b < 0)) { return '??'; }

    const buf = new ArrayBuffer(size);
    const dv  = new DataView(buf);
    const le  = endian === 'le';
    bytes.slice(0, size).forEach((b, i) => dv.setUint8(i, b));

    switch (type) {
        case 'uint8':   return `${dv.getUint8(0)}  (0x${dv.getUint8(0).toString(16).toUpperCase().padStart(2,'0')})`;
        case 'int8':    return `${dv.getInt8(0)}`;
        case 'uint16':  { const v = dv.getUint16(0, le); return `${v}  (0x${v.toString(16).toUpperCase().padStart(4,'0')})`; }
        case 'int16':   return `${dv.getInt16(0, le)}`;
        case 'uint32':  { const v = dv.getUint32(0, le); return `${v >>> 0}  (0x${(v >>> 0).toString(16).toUpperCase().padStart(8,'0')})`; }
        case 'int32':   return `${dv.getInt32(0, le)}`;
        case 'float32': {
            const v = dv.getFloat32(0, le);
            return isNaN(v) ? 'NaN' : !isFinite(v) ? String(v) : parseFloat(v.toPrecision(7)).toString();
        }
        case 'float64': {
            const v = dv.getFloat64(0, le);
            return isNaN(v) ? 'NaN' : !isFinite(v) ? String(v) : parseFloat(v.toPrecision(10)).toString();
        }
        case 'pointer': {
            const v = dv.getUint32(0, le);
            return `0x${(v >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
        }
    }
}

export function decodeStruct(
    def: StructDef,
    baseAddr: number,
    flatBytes: Map<number, number>,
    globalEndian: 'le' | 'be',
): DecodedField[] {
    const rows: DecodedField[] = [];
    let offset = 0;
    for (const field of def.fields) {
        const sz = fieldByteSize(field.type);
        const endian = field.endian === 'inherit' ? globalEndian : field.endian;
        for (let idx = 0; idx < field.count; idx++) {
            const raw: number[] = [];
            for (let b = 0; b < sz; b++) {
                const v = flatBytes.get(baseAddr + offset + b);
                raw.push(v !== undefined ? v : -1);
            }
            const hasData = raw.every(v => v >= 0);
            const bytesHex = raw.map(v => v >= 0 ? v.toString(16).toUpperCase().padStart(2, '0') : '??').join(' ');
            const decoded = hasData ? decodeField(raw, field.type, endian) : '??';
            const name = field.count > 1 ? `${field.name}[${idx}]` : field.name;
            rows.push({ fieldName: name, type: field.type, arrayIdx: idx, byteOffset: offset, bytesHex, decoded, hasData });
            offset += sz;
        }
    }
    return rows;
}

// ── All visible structs (presets + user-defined) ──────────────────

export function allStructs(): StructDef[] {
    return [...S.structs];
}

// ── C struct text parser ──────────────────────────────────────────

/**
 * Maps common C type names (including aliases) to our internal StructFieldType.
 * Lookup is case-sensitive first, then case-folded as fallback.
 */
const C_TYPE_MAP: Record<string, StructFieldType> = {
    // uint8
    'uint8_t': 'uint8', 'uint8': 'uint8', 'u8': 'uint8',
    'unsigned char': 'uint8', 'byte': 'uint8', 'BYTE': 'uint8',
    // uint16
    'uint16_t': 'uint16', 'uint16': 'uint16', 'u16': 'uint16',
    'unsigned short': 'uint16', 'WORD': 'uint16', 'word': 'uint16',
    // uint32
    'uint32_t': 'uint32', 'uint32': 'uint32', 'u32': 'uint32',
    'unsigned int': 'uint32', 'unsigned long': 'uint32',
    'DWORD': 'uint32', 'dword': 'uint32',
    // int8
    'int8_t': 'int8', 'int8': 'int8', 'i8': 'int8',
    'signed char': 'int8', 'char': 'int8',
    // int16
    'int16_t': 'int16', 'int16': 'int16', 'i16': 'int16',
    'short': 'int16', 'signed short': 'int16',
    // int32
    'int32_t': 'int32', 'int32': 'int32', 'i32': 'int32',
    'int': 'int32', 'long': 'int32', 'signed int': 'int32',
    // float32
    'float': 'float32', 'float32': 'float32',
    // float64
    'double': 'float64', 'float64': 'float64',
};

/** Maps our internal types back to canonical C type names for serialization. */
export const TYPE_TO_C: Record<StructFieldType, string> = {
    uint8: 'uint8_t', uint16: 'uint16_t', uint32: 'uint32_t',
    int8: 'int8_t', int16: 'int16_t', int32: 'int32_t',
    float32: 'float', float64: 'double',
    pointer: 'void*',
};

export interface ParseStructTextResult {
    /** Struct name extracted from a `struct Name { }` wrapper, or null. */
    structName: string | null;
    fields: StructField[];
    /** Parse error messages (one per bad line). */
    errors: string[];
}

/**
 * Parse C-style struct field declarations into StructField[].
 * Accepts bare field declarations OR a full `struct Name { ... }` / `typedef struct Name { ... }`
 * definition pasted directly from a header file.
 *
 * Supported types: uint8_t, uint16_t, uint32_t, int8_t, int16_t, int32_t, float, double,
 * unsigned/signed variants, _t-less aliases, Arduino/CMSIS BYTE/WORD/DWORD.
 * Endian override: add `// be` or `\/* be *\/` after the declaration.
 * Qualifiers `const`, `volatile`, `static`, `register` are silently stripped.
 */
export function parseStructText(text: string): ParseStructTextResult {
    const errors: string[] = [];
    const fields: StructField[] = [];
    let structName: string | null = null;

    // Strip only MULTI-LINE block comments (preserving single-line `/* be */` hints)
    const cleaned = text.replace(/\/\*[\s\S]*?\*\//g, m => {
        const newlines = (m.match(/\n/g) ?? []).length;
        return newlines === 0 ? m : '\n'.repeat(newlines);
    });

    // Extract struct name from "struct Name {" / "typedef struct Name {"
    const nameMatch = cleaned.match(/(?:typedef\s+)?struct\s+(\w+)\s*\{/);
    if (nameMatch) { structName = nameMatch[1]; }

    // Use body inside braces if present, otherwise treat the whole text as body
    const bodyMatch = cleaned.match(/\{([\s\S]*)\}/);
    const body = bodyMatch ? bodyMatch[1] : cleaned;

    for (const rawLine of body.split('\n')) {
        // Extract endian hint from EITHER a trailing `// hint` OR an inline `/* hint */`
        // before stripping, so both notations round-trip correctly.
        const blockComMatch = rawLine.match(/\/\*([^*\n]*)\*\//);
        const blockComment  = blockComMatch ? blockComMatch[1].trim() : '';
        const noBlock = rawLine.replace(/\/\*[^*\n]*\*\//g, '');
        const slashIdx   = noBlock.indexOf('//');
        const lineComment = slashIdx >= 0 ? noBlock.slice(slashIdx + 2).trim() : '';
        const line = (slashIdx >= 0 ? noBlock.slice(0, slashIdx) : noBlock).trim();
        const comment = lineComment || blockComment;

        // Strip trailing semicolon; skip structural / empty lines
        const stripped = line.replace(/;$/, '').trim();
        if (!stripped || stripped === '{' || stripped === '}'
            || /^(?:typedef|struct|union)\b/.test(stripped)) { continue; }

        // Strip leading type qualifiers
        const unqual = stripped.replace(/^(?:(?:const|volatile|static|register)\s+)+/, '');

        // Match: TYPE FIELD_NAME [ARRAY]
        // TYPE supports two-word forms like "unsigned short" or single tokens like "uint32_t"
        const m = unqual.match(
            /^((?:unsigned|signed)\s+\w+|\w+)\s+(\w+)\s*(?:\[(\d+)\])?$/
        );
        if (!m) {
            if (unqual) { errors.push(`Cannot parse: "${stripped}"`); }
            continue;
        }

        const rawType   = m[1].replace(/\s+/g, ' ');
        const fieldName = m[2];
        const count     = m[3] ? Math.max(1, parseInt(m[3], 10)) : 1;

        const mapped = C_TYPE_MAP[rawType] ?? C_TYPE_MAP[rawType.toLowerCase()];
        if (!mapped) {
            errors.push(`Unknown type "${rawType}" for field "${fieldName}"`);
            continue;
        }

        // Endian override from comment: "be" / "BE" / "le" / "LE"
        let endian: StructFieldEndian = 'inherit';
        if (/\bbe\b/i.test(comment)) { endian = 'be'; }
        else if (/\ble\b/i.test(comment)) { endian = 'le'; }

        fields.push({ name: fieldName, type: mapped, count, endian });
    }

    return { structName, fields, errors };
}

/**
 * Serialize StructField[] back to C-style field declarations.
 * Type names are padded to align field identifiers.
 * Endian overrides are emitted as `\/* be *\/` / `\/* le *\/` comments.
 */
export function fieldsToText(fields: StructField[]): string {
    if (fields.length === 0) { return ''; }
    const maxTypeLen = Math.max(...fields.map(f => TYPE_TO_C[f.type].length));
    return fields.map(f => {
        const cType = TYPE_TO_C[f.type].padEnd(maxTypeLen);
        const arr   = f.count > 1 ? `[${f.count}]` : '';
        const hint  = f.endian !== 'inherit' ? `  // ${f.endian}` : '';
        return `${cType} ${f.name}${arr};${hint}`;
    }).join('\n');
}
