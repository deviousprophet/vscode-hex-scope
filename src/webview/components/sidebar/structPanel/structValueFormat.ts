/** Struct panel — decoded value formatting and copy-text helpers.
Extracted verbatim from structPanel.ts (pure move). */
import { esc, formatDecimal, formatHex, formatHexHtml, getBigUint64, getBigInt64, asUint64 } from '../../../utils';
import { bytesToBigUint, enumHexDigits, formatEnumLabel } from '../../../../core/structCodec.js';
import type { DecodedField } from '../../../../core/structCodec.js';
import type { BitFieldAllocation, StructDef, StructFieldType, StructPin } from '../../../../core/types';
import {
    binaryBitsForValue, binaryGroupsLowBitsFirst, bitChildValKey, formatPlainBinaryBits, isBitFieldRow,
    renderPlainBinaryBits, scalarValKey,
} from './structBinaryView';

/** Pointer-follow readiness shared with the row renderer and the panel class. */
export type PointerFollowState = { ok: true } | { ok: false; reason: string };

/** Narrow render context threaded through the extracted render modules. */
export interface StructRenderCtx {
    structs: readonly StructDef[];
    pins: readonly StructPin[];
    endian: 'le' | 'be';
    bitFieldAllocation: BitFieldAllocation;
    showHiddenFields: boolean;
    fieldValTypes: ReadonlyMap<string, ColType>;
    defaultValType: ColType;
    readByte: (addr: number) => number | undefined;
    expandedArrayFields: ReadonlySet<string>;
    expandedArrayElements: ReadonlySet<string>;
    selectedBitRange: { parentByteStart: number; startBit: number; endBit: number } | null;
    hoveredBitRange: { parentByteStart: number; startBit: number; endBit: number } | null;
    pointerFollowState: (row: DecodedField | null) => PointerFollowState;
}

export type ColType = 'hex' | 'dec' | 'ascii' | 'bin' | 'bin-sliced' | 'ieee';

export const FLOAT_FIELD_TYPES: ReadonlySet<StructFieldType> = new Set(['float32', 'float64']);

export const RAW_HTML_VALUE_TYPES: ReadonlySet<ColType> = new Set(['bin', 'bin-sliced', 'ieee', 'hex']);

export const TYPE_LABELS: Record<ColType, string> = {
    hex: 'Hex',
    dec: 'Decimal',
    bin: 'Binary',
    'bin-sliced': 'Binary (bit fields only)',
    ascii: 'ASCII',
    ieee: 'IEEE754',
};

export const SAMPLE_TYPE_MENUS: Partial<Record<StructFieldType, ColType[]>> = {
    float32: ['hex', 'dec', 'ieee', 'bin'],
    float64: ['hex', 'dec', 'ieee', 'bin'],
    ascii: ['ascii', 'hex', 'bin'],
};

export type NumericValueFormatter = (valType: ColType, dv: DataView, le: boolean) => string;

/** Get a display string for a field given the requested column display type. */
export function getValForType(rctx: StructRenderCtx, r: DecodedField, valType: ColType): string {
    if (!r.hasData) { return '??'; }
    const enumLabel = renderEnumLabelValue(rctx, r, valType);
    if (enumLabel !== null) { return enumLabel; }
    if (isBitFieldRow(r)) { return renderBitFieldValue(r, valType); }

    const bytes = fieldBytes(r);
    // Resolved per-row effective endian (field → struct → global), already
    // threaded by the decoder; pointer rows carry the global endian in core,
    // so the pointer-always-global rule holds here too.
    const endian = r.endian ?? rctx.endian;
    const dv = dataViewForBytes(bytes);
    return renderScalarValue(rctx, r, valType, bytes, dv, endian);
}

/**
 * Matched enum rows render `NAME (0xNN)` in their default value mode; unmatched
 * values (and non-default view modes) fall through to the numeric rendering.
 * Uses the shared `formatEnumLabel` for scalar enum fields and enum-ref bit children.
 */
export function renderEnumLabelValue(rctx: StructRenderCtx, r: DecodedField, valType: ColType): string | null {
    if (r.enumLabel === undefined || valType !== defaultValueTypeForRow(rctx, r)) { return null; }
    const view = enumNumericView(rctx, r);
    return view ? esc(formatEnumLabel(r.enumLabel, view.value, view.hexDigits)) : null;
}

export function enumNumericView(rctx: StructRenderCtx, r: DecodedField): { value: bigint; hexDigits: number } | null {
    if (isBitFieldRow(r)) {
        return { value: BigInt(r.bitValueUnsigned ?? '0'), hexDigits: enumHexDigits(r.bitWidth ?? 1) };
    }
    const bytes = fieldBytes(r);
    if (bytes.length === 0 || bytes.some(b => Number.isNaN(b))) { return null; }
    return { value: bytesToBigUint(bytes, r.endian ?? rctx.endian), hexDigits: bytes.length * 2 };
}

export function fieldBytes(r: DecodedField): number[] {
    return r.bytesHex.split(' ').map(h => parseInt(h, 16));
}

export function dataViewForBytes(bytes: number[]): DataView {
    const buf = new ArrayBuffer(bytes.length);
    const dv = new DataView(buf);
    bytes.forEach((b, i) => dv.setUint8(i, b));
    return dv;
}

export function isBinaryDisplay(valType: ColType): boolean {
    return valType === 'bin' || valType === 'bin-sliced';
}

export function bitFieldDisplaySource(r: DecodedField): { width: number; value: bigint } {
    return {
        width: r.bitWidth ?? 1,
        value: BigInt(r.bitValueUnsigned ?? '0'),
    };
}

export function renderBitFieldValue(r: DecodedField, valType: ColType): string {
    const { width, value: v } = bitFieldDisplaySource(r);
    if (valType === 'hex') {
        return formatHexHtml(formatHex(v, Math.max(1, Math.ceil(width / 4))));
    }
    if (isBinaryDisplay(valType)) {
        const groups = binaryGroupsLowBitsFirst(v.toString(2).padStart(width, '0'));
        const html = groups.map(g => [...g].map(bit =>
            `<span class="si-bit ${bit === '1' ? 'one' : 'zero'}">${bit}</span>`
        ).join('')).join(' ');
        return `<span class="si-bin-wrap">${html}</span>`;
    }
    return v.toString(10);
}

export function copyBitFieldValue(r: DecodedField, valType: ColType): string {
    const { width, value: v } = bitFieldDisplaySource(r);
    if (valType === 'hex') {
        return `0x${v.toString(16).toUpperCase().padStart(Math.max(1, Math.ceil(width / 4)), '0')}`;
    }
    if (isBinaryDisplay(valType)) {
        return binaryGroupsLowBitsFirst(v.toString(2).padStart(width, '0')).join(' ');
    }
    return v.toString(10);
}

export function renderScalarValue(
    rctx: StructRenderCtx, r: DecodedField,
    valType: ColType,
    bytes: number[],
    dv: DataView,
    endian: 'le' | 'be',
): string {
    const le = endian === 'le';
    const special = renderSpecialScalarValue(rctx, r, valType, bytes, dv, endian, le);
    if (special !== null) { return special; }
    return renderNumericValue(r, valType, dv, le);
}

export function renderSpecialScalarValue(
    rctx: StructRenderCtx, r: DecodedField,
    valType: ColType,
    bytes: number[],
    dv: DataView,
    endian: 'le' | 'be',
    le: boolean,
): string | null {
    const byType = renderSpecialScalarByType(rctx, r, valType, bytes, dv, le);
    if (byType !== null) { return byType; }
    return renderSpecialScalarByValueType(r, valType, bytes, endian);
}

export function renderSpecialScalarByType(
    rctx: StructRenderCtx, r: DecodedField,
    valType: ColType,
    bytes: number[],
    dv: DataView,
    le: boolean,
): string | null {
    if (r.isPointer) { return renderPointerValue(rctx, r, dv, le); }
    if (r.type === 'ascii') { return renderAsciiValue(r, valType, bytes); }
    return null;
}

export function renderSpecialScalarByValueType(
    r: DecodedField,
    valType: ColType,
    bytes: number[],
    endian: 'le' | 'be',
): string | null {
    if (isBinaryDisplay(valType)) { return renderPlainBinaryBits(binaryBitsForValue(bytes, endian)); }
    if (valType === 'ieee') { return renderIeeeValue(r, bytes, endian); }
    if (valType === 'ascii') { return `'${asciiFromBytes(bytes)}'`; }
    return null;
}

export function renderPointerValue(rctx: StructRenderCtx, r: DecodedField, dv: DataView, le: boolean): string {
    const v = r.pointerValue ?? (dv.getUint32(0, le) >>> 0);
    const note = v !== 0 && rctx.readByte(v) === undefined ? ` <span class="si-f-ptr-note">(unmapped)</span>` : '';
    return `<span class="si-f-ptr-sym">\u2192</span>\u2009` + formatHexHtml(formatHex(v, 8)) + note;
}

export function renderAsciiValue(r: DecodedField, valType: ColType, bytes: number[]): string {
    if (valType === 'hex') {
        const hex = bytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join('');
        return formatHexHtml(`0x${hex}`);
    }
    if (isBinaryDisplay(valType)) {
        return renderPlainBinaryBits(bytes.map(b => b.toString(2).padStart(8, '0')).join(''));
    }
    const s = r.decoded === '??' ? '' : r.decoded;
    return `'${s}'`;
}

export function renderIeeeValue(r: DecodedField, bytes: number[], endian: 'le' | 'be'): string {
    const parts = getFloatPartsForField(r, bytes, endian);
    if (!parts) { return '??'; }
    return (
        `<pre class="si-ieee">` +
        `<span class="si-ieee-label">sign:</span> <span class="si-ieee-val">${esc(String(parts.sign))}</span><br>` +
        `<span class="si-ieee-label">exponent:</span> ${formatHexHtml(parts.exponentHex)}<br>` +
        `<span class="si-ieee-label">mantissa:</span> ${formatHexHtml(parts.mantissaHex)}<br>` +
        `<span class="si-ieee-label">class:</span> <span class="si-ieee-val">${esc(parts.className)}</span>` +
        `</pre>`
    );
}

export const RENDER_NUMERIC_VALUE: Partial<Record<DecodedField['type'], NumericValueFormatter>> = {
    uint8:  (valType, dv)     => { const v = dv.getUint8(0);            return valType === 'hex' ? formatHexHtml(formatHex(v, 2)) : String(v); },
    int8:   (valType, dv)     => { const v = dv.getInt8(0);             return valType === 'hex' ? formatHexHtml(formatHex(dv.getUint8(0), 2)) : String(v); },
    uint16: (valType, dv, le) => { const v = dv.getUint16(0, le);       return valType === 'hex' ? formatHexHtml(formatHex(v, 4)) : String(v); },
    int16:  (valType, dv, le) => { const v = dv.getInt16(0, le);        return valType === 'hex' ? formatHexHtml(formatHex(dv.getUint16(0, le), 4)) : String(v); },
    uint32: (valType, dv, le) => { const v = dv.getUint32(0, le) >>> 0; return valType === 'hex' ? formatHexHtml(formatHex(v, 8)) : String(v); },
    int32:  (valType, dv, le) => { const v = dv.getInt32(0, le);        return valType === 'hex' ? formatHexHtml(formatHex(dv.getUint32(0, le), 8)) : String(v); },
    float32: (valType, dv, le) => {
        const v = dv.getFloat32(0, le);
        return valType === 'hex'
            ? formatHexHtml(formatHex(dv.getUint32(0, le) >>> 0, 8))
            : formatFloat(v, 6);
    },
    uint64: (valType, dv, le) => {
        const v = getBigUint64(dv, 0, le);
        return valType === 'hex' ? formatHexHtml(formatHex(v, 16)) : formatDecimal(v as bigint);
    },
    int64: (valType, dv, le) => {
        const v = getBigInt64(dv, 0, le);
        return valType === 'hex'
            ? formatHexHtml(formatHex(asUint64(v as bigint), 16))
            : formatDecimal(v as bigint);
    },
    float64: (valType, dv, le) => {
        const v = dv.getFloat64(0, le);
        return valType === 'hex'
            ? formatHexHtml(formatHex(getBigUint64(dv, 0, le), 16))
            : formatFloat(v, 16);
    },
};

export function renderNumericValue(r: DecodedField, valType: ColType, dv: DataView, le: boolean): string {
    return RENDER_NUMERIC_VALUE[r.type]?.(valType, dv, le) ?? r.decoded;
}

export function formatFloat(v: number, digits: number): string {
    return isNaN(v) ? 'NaN' : !isFinite(v) ? String(v) : v.toExponential(digits);
}

export function asciiFromBytes(bytes: number[]): string {
    return bytes.map(b => b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.').join('');
}

/** Parse IEEE754 parts from raw bytes for float32/float64. Returns null on missing/invalid bytes. */
export function getFloatParts(bytes: number[], type: 'float32' | 'float64', endian: 'le' | 'be') {
    const size = FLOAT_BYTE_SIZE[type];
    if (!hasFloatBytes(bytes, size)) { return null; }
    const dv = floatDataView(bytes, size);
    const le = endian === 'le';
    return FLOAT_PART_READERS[type](dv, le);
}

export const FLOAT_BYTE_SIZE: Record<'float32' | 'float64', number> = { float32: 4, float64: 8 };

export const FLOAT_PART_READERS = { float32: (dv: DataView, le: boolean) => getFloat32Parts(dv, le), float64: (dv: DataView, le: boolean) => getFloat64Parts(dv, le) };

export function hasFloatBytes(bytes: number[], size: number): boolean {
    return bytes.length >= size && bytes.every(b => isPresentByte(b));
}

export function isPresentByte(byte: number): boolean {
    return byte >= 0;
}

export function floatDataView(bytes: number[], size: number): DataView {
    const buf = new ArrayBuffer(size);
    const dv = new DataView(buf);
    bytes.forEach((b, i) => dv.setUint8(i, b));
    return dv;
}

export function getFloat32Parts(dv: DataView, le: boolean) {
    const raw = dv.getUint32(0, le) >>> 0;
    const sign = (raw >>> 31) & 1;
    const exp = (raw >>> 23) & 0xFF;
    const mant = raw & 0x7FFFFF;
    const exponentBits = exp.toString(2).padStart(8, '0');
    const mantissaBits = mant.toString(2).padStart(23, '0');
    const exponentHex = `0x${exp.toString(16).toUpperCase().padStart(2, '0')}`;
    const mantissaHex = `0x${mant.toString(16).toUpperCase().padStart(6, '0')}`;
    const rawHex = `0x${raw.toString(16).toUpperCase().padStart(8, '0')}`;
    const className = float32ClassName(exp, mant);
    const binStr = `${sign} | ${exponentBits} | ${mantissaBits}`;
    return { sign, exp, mant, exponentBits, mantissaBits, exponentHex, mantissaHex, rawHex, className, binStr };
}

export function float32ClassName(exp: number, mant: number): string {
    return floatClassName(exp, mant === 0, 0xFF);
}

export function getFloat64Parts(dv: DataView, le: boolean) {
    const raw = dv.getBigUint64(0, le);
    const sign = Number((raw >> 63n) & 1n);
    const exp = Number((raw >> 52n) & 0x7FFn);
    const mant = raw & ((1n << 52n) - 1n);
    const exponentBits = exp.toString(2).padStart(11, '0');
    const mantissaBits = mant.toString(2).padStart(52, '0');
    const exponentHex = `0x${exp.toString(16).toUpperCase().padStart(3, '0')}`;
    const mantissaHex = `0x${mant.toString(16).toUpperCase().padStart(13, '0')}`;
    const rawHex = `0x${raw.toString(16).toUpperCase().padStart(16, '0')}`;
    const className = float64ClassName(exp, mant);
    const binStr = `${sign} | ${exponentBits} | ${mantissaBits}`;
    return { sign, exp, mant, exponentBits, mantissaBits, exponentHex, mantissaHex, rawHex, className, binStr };
}

export function float64ClassName(exp: number, mant: bigint): string {
    return floatClassName(exp, mant === 0n, 0x7FF);
}

export function floatClassName(exp: number, isZeroMant: boolean, infinityExp: number): string {
    return ({
        0: isZeroMant ? 'zero' : 'subnormal',
        [infinityExp]: isZeroMant ? 'infinity' : 'NaN',
    })[exp] ?? 'normal';
}

/** Get a plain-text representation suitable for copying. */
export function getCopyText(rctx: StructRenderCtx, r: DecodedField, valType: ColType): string {
    if (!r.hasData) { return '??'; }
    return copySpecialRowText(r, valType) ?? copyNonAsciiFieldValue(rctx, r, valType);
}

export function copySpecialRowText(r: DecodedField, valType: ColType): string | null {
    const copier = SPECIAL_ROW_COPIERS.find(entry => entry.matches(r));
    return copier ? copier.copy(r, valType) : null;
}

export const SPECIAL_ROW_COPIERS: Array<{
    matches: (row: DecodedField) => boolean;
    copy: (row: DecodedField, valType: ColType) => string;
}> = [
    { matches: row => isBitFieldRow(row), copy: (row, valType) => copyBitFieldValue(row, valType) },
    { matches: row => row.isPointer === true, copy: row => copyPointerRowText(row) },
    { matches: row => row.type === 'ascii', copy: row => row.decoded },
];

export function copyPointerRowText(r: DecodedField): string {
    return r.pointerValue === undefined ? '??' : formatHex(r.pointerValue, 8);
}

export function copyNonAsciiFieldValue(rctx: StructRenderCtx, r: DecodedField, valType: ColType): string {
    const bytes = fieldBytes(r);
    const endian = r.endian ?? rctx.endian;
    const le = endian === 'le';
    const special = copySpecialFieldValue(r, valType, bytes, endian, le);
    if (special !== null) { return special; }
    return copyNumericValue(r, valType, dataViewForBytes(bytes), le);
}

export function copySpecialFieldValue(
    r: DecodedField,
    valType: ColType,
    bytes: number[],
    endian: 'le' | 'be',
    le: boolean,
): string | null {
    const byType = copySpecialFieldByType(r, valType, bytes, le);
    if (byType !== null) { return byType; }
    return copySpecialFieldByValueType(r, valType, bytes, endian);
}

export function copySpecialFieldByType(r: DecodedField, valType: ColType, bytes: number[], le: boolean): string | null {
    if (r.isPointer) { return copyPointerValue(bytes, le); }
    if (hasSlicedBitCopyValue(r, valType)) { return copySlicedBitValue(r); }
    return null;
}

export function copySpecialFieldByValueType(
    r: DecodedField,
    valType: ColType,
    bytes: number[],
    endian: 'le' | 'be',
): string | null {
    if (isBinaryDisplay(valType)) { return formatPlainBinaryBits(binaryBitsForValue(bytes, endian)); }
    if (valType === 'ieee') { return copyIeeeValue(r, bytes, endian); }
    if (valType === 'ascii') { return asciiFromBytes(bytes); }
    return null;
}

export function copyPointerValue(bytes: number[], le: boolean): string {
    const v = dataViewForBytes(bytes).getUint32(0, le) >>> 0;
    return hexPad(v, 8);
}

export function hasSlicedBitCopyValue(r: DecodedField, valType: ColType): boolean {
    return valType === 'bin-sliced' && typeof r.bitWidth === 'number' && r.bitValueUnsigned !== undefined;
}

export function copySlicedBitValue(r: DecodedField): string {
    return formatPlainBinaryBits(BigInt(r.bitValueUnsigned!).toString(2).padStart(r.bitWidth!, '0'));
}

export function hexPad(v: number, pad: number): string {
    return `0x${(v >>> 0).toString(16).toUpperCase().padStart(pad, '0')}`;
}

export function hexPadBig(v: bigint, pad: number): string {
    return `0x${v.toString(16).toUpperCase().padStart(pad, '0')}`;
}

export function copyIeeeValue(r: DecodedField, bytes: number[], endian: 'le' | 'be'): string {
    const parts = getFloatPartsForField(r, bytes, endian);
    if (!parts) { return '??'; }
    return `sign: ${parts.sign}; exponent: ${parts.exponentHex}; mantissa: ${parts.mantissaHex}; class: ${parts.className}`;
}

export function getFloatPartsForField(r: DecodedField, bytes: number[], endian: 'le' | 'be'): ReturnType<typeof getFloatParts> {
    if (r.type !== 'float32' && r.type !== 'float64') { return null; }
    return getFloatParts(bytes, r.type, endian);
}

export const IMPLICIT_DISPLAY_BY_TYPE: Partial<Record<DecodedField['type'], ColType>> = {
    float32: 'dec',
    float64: 'dec',
    ascii: 'ascii',
};

export function fieldImplicitDisplayType(rctx: StructRenderCtx, field: DecodedField | null | undefined): ColType {
    return field ? definedFieldImplicitDisplayType(rctx, field) : rctx.defaultValType;
}

export function definedFieldImplicitDisplayType(rctx: StructRenderCtx, field: DecodedField): ColType {
    if (isBitFieldRow(field)) { return 'bin'; }
    return field.isPointer ? 'hex' : (IMPLICIT_DISPLAY_BY_TYPE[field.type] ?? rctx.defaultValType);
}

export function implicitDisplayType(rctx: StructRenderCtx, field: DecodedField | null | undefined, forceBinary = false): ColType {
    return forceBinary ? 'bin' : fieldImplicitDisplayType(rctx, field);
}

export const COPY_NUMERIC_VALUE: Partial<Record<DecodedField['type'], NumericValueFormatter>> = {
    uint8:  (valType, dv)     => { const v = dv.getUint8(0);            return valType === 'hex' ? hexPad(v, 2) : String(v); },
    int8:   (valType, dv)     => { const v = dv.getInt8(0);             return valType === 'hex' ? hexPad(dv.getUint8(0), 2) : String(v); },
    uint16: (valType, dv, le) => { const v = dv.getUint16(0, le);       return valType === 'hex' ? hexPad(v, 4) : String(v); },
    int16:  (valType, dv, le) => { const v = dv.getInt16(0, le);        return valType === 'hex' ? hexPad(dv.getUint16(0, le), 4) : String(v); },
    uint32: (valType, dv, le) => { const v = dv.getUint32(0, le) >>> 0; return valType === 'hex' ? hexPad(v, 8) : String(v); },
    int32:  (valType, dv, le) => { const v = dv.getInt32(0, le);        return valType === 'hex' ? hexPad(dv.getUint32(0, le), 8) : String(v); },
    float32: (valType, dv, le) => {
        const v = dv.getFloat32(0, le);
        return valType === 'hex'
            ? hexPad(dv.getUint32(0, le) >>> 0, 8)
            : formatFloat(v, 6);
    },
    uint64: (valType, dv, le) => {
        const v = dv.getBigUint64(0, le);
        return valType === 'hex' ? hexPadBig(v, 16) : v.toString(10);
    },
    int64: (valType, dv, le) => {
        const v = dv.getBigInt64(0, le);
        return valType === 'hex' ? hexPadBig(BigInt.asUintN(64, v as bigint), 16) : v.toString(10);
    },
    float64: (valType, dv, le) => {
        const v = dv.getFloat64(0, le);
        return valType === 'hex'
            ? hexPadBig(dv.getBigUint64(0, le), 16)
            : formatFloat(v, 16);
    },
};

export function copyNumericValue(r: DecodedField, valType: ColType, dv: DataView, le: boolean): string {
    return COPY_NUMERIC_VALUE[r.type]?.(valType, dv, le) ?? r.decoded;
}

export const TYPE_ABBREV: Record<string, string> = {
    ascii: 'str',
    uint8: 'u8',  uint16: 'u16', uint32: 'u32', uint64: 'u64',
    int8:  'i8',  int16:  'i16', int32:  'i32', int64:  'i64',
    float32: 'f32', float64: 'f64', pointer: 'ptr',
};

export const TYPE_CELL_MAX_CHARS = 14;

export const TYPE_CELL_ELLIPSIS = '...';

export function fieldValueKey(r: DecodedField, byteStart: number): string {
    return isBitFieldRow(r)
        ? bitChildValKey(byteStart, r.bitOffset ?? 0, r.bitWidth ?? 0)
        : scalarValKey(byteStart);
}

export function defaultValueTypeForRow(rctx: StructRenderCtx, r: DecodedField): ColType {
    if (isBitFieldRow(r)) { return 'bin'; }
    if (FLOAT_FIELD_TYPES.has(r.type)) { return 'dec'; }
    if (r.type === 'ascii') { return 'ascii'; }
    return rctx.defaultValType;
}

export function valueTypeForRow(rctx: StructRenderCtx, r: DecodedField, valKey: string): ColType {
    return rctx.fieldValTypes.get(valKey) ?? defaultValueTypeForRow(rctx, r);
}

export function fieldTypeAbbrev(r: DecodedField, byteCount: number): string {
    const special = specialFieldTypeLabel(r, true);
    if (special) { return special; }
    const abbrevBase = TYPE_ABBREV[r.type] ?? r.type;
    return r.type === 'ascii' ? `${abbrevBase}[${byteCount}]` : abbrevBase;
}

export function fieldFullTypeLabel(r: DecodedField, byteCount: number): string {
    const special = specialFieldTypeLabel(r, false);
    if (special) { return special; }
    return r.type === 'ascii' ? `ascii[${byteCount}]` : r.type;
}

export function specialFieldTypeLabel(r: DecodedField, abbreviated: boolean): string | null {
    if (isBitFieldRow(r)) { return `bit:${r.bitWidth}`; }
    return r.isPointer ? `${pointerTargetTypeLabel(r, abbreviated)}*` : null;
}

export function pointerTargetTypeLabel(r: DecodedField, abbreviated: boolean): string {
    const target = r.pointerTargetType ?? r.type;
    return POINTER_TARGET_LABELS[target]?.(r, abbreviated) ?? scalarPointerTargetLabel(target, abbreviated);
}

export const POINTER_TARGET_LABELS: Partial<Record<StructFieldType, (row: DecodedField, abbreviated: boolean) => string>> = {
    struct: row => row.pointerTargetStructName ?? 'struct',
    ascii: () => 'char',
    void: () => 'void',
};

export function scalarPointerTargetLabel(target: StructFieldType, abbreviated: boolean): string {
    return abbreviated ? (TYPE_ABBREV[target] ?? target) : target;
}

export function typeCellHtml(abbrev: string, fullTypeLabel: string): string {
    const compact = compactTypeCellLabel(abbrev);
    const escapedFullType = esc(fullTypeLabel);
    return `<span class="si-f-type" title="${escapedFullType}" aria-label="${escapedFullType}">${esc(compact)}</span>`;
}

export function compactTypeCellLabel(label: string): string {
    return label.length <= TYPE_CELL_MAX_CHARS ? label : compactLongTypeCellLabel(label);
}

export function compactLongTypeCellLabel(label: string): string {
    const pointerSuffix = pointerLabelSuffix(label);
    const body = label.slice(0, label.length - pointerSuffix.length);
    const availableBodyChars = TYPE_CELL_MAX_CHARS - TYPE_CELL_ELLIPSIS.length - pointerSuffix.length;
    const headChars = Math.ceil(availableBodyChars / 2);
    const tailChars = availableBodyChars - headChars;
    return `${body.slice(0, headChars)}${TYPE_CELL_ELLIPSIS}${body.slice(-tailChars)}${pointerSuffix}`;
}

export function pointerLabelSuffix(label: string): string {
    return label.endsWith('*') ? '*' : '';
}

export function fieldOffsetLabel(r: DecodedField): string {
    if (isBitFieldRow(r)) { return `.${String(r.bitOffset ?? 0)}`; }
    return `+${r.byteOffset.toString(16).toUpperCase().padStart(3, '0')}`;
}

export function bitFieldDataAttrs(r: DecodedField): string {
    if (!isBitFieldRow(r)) { return ''; }
    return ` data-bit-start="${r.bitOffset ?? 0}" data-bit-width="${r.bitWidth ?? 0}"`;
}

export function valueHtmlForRow(rctx: StructRenderCtx, r: DecodedField, valType: ColType, ptr: boolean): string {
    const value = getValForType(rctx, r, valType);
    return valueIsRawHtml(valType, ptr) ? value : esc(value);
}

export function valueIsRawHtml(valType: ColType, ptr: boolean): boolean {
    if (ptr) { return true; }
    return RAW_HTML_VALUE_TYPES.has(valType);
}

