/** Struct panel — decoded row/group renderers and pointer renderers.
Extracted verbatim from structPanel.ts (pure move). */
import { esc, formatHex, formatHexHtml } from '../../../utils';
import {
    allStructs, bytesToBigUint, decodeField, decodeStruct, fieldByteSize, normalizeStructField,
    resolveStructFieldByPath, structByteSize,
} from '../../../../core/structCodec.js';
import type { DecodedField } from '../../../../core/structCodec.js';
import type { BitFieldAllocation, StructDef, StructField, StructFieldType, StructPin, StructScalarFieldType } from '../../../../core/types';
import {
    bitRowWidth, bitUnitValKey, byteHexParts, bytesFromHexParts, hasMissingByte, isBitFieldRow,
    renderBinaryFromBitRows, renderBinaryStorageUnit, rowAllocOrDefault, rowEndianOrDefault,
} from './structBinaryView';
import {
    TYPE_ABBREV, bitFieldDataAttrs, fieldFullTypeLabel, fieldOffsetLabel, fieldTypeAbbrev, fieldValueKey,
    getValForType, pointerTargetTypeLabel, typeCellHtml, valueHtmlForRow, valueTypeForRow,
} from './structValueFormat';
import type { ColType, StructRenderCtx } from './structValueFormat';

const MAX_INLINE_POINTER_HOPS = 2;

type StructRenderContext = {
    def: StructDef;
    pin: StructPin;
    baseAddr: number;
    keyPrefix: string;
    pointerDepth: number;
    hideOffsets: boolean;
};

type FieldGroup = { baseName: string; rows: DecodedField[] };

type IndexedFieldGroup = { idx: number; rows: DecodedField[] };

type NestedFieldGroup = { baseRel: string; fullBase: string; rows: DecodedField[] };

type StructGroupInfo = {
    declaredType: StructFieldType;
    count: number;
    isPointer: boolean;
    isArray: boolean;
    isStruct: boolean;
    isString: boolean;
    isBitUnit: boolean;
    isComposite: boolean;
    structName: string;
    summary: string;
    summaryLabel: string;
    byteCount: number;
};

type StructGroupDeclarationInfo = {
    declaredType: StructFieldType;
    count: number;
    structName: string;
    isPointer: boolean;
};

type RenderBodyGroup = {
    rows: DecodedField[];
    baseName: string;
    key: string;
    info: StructGroupInfo;
};

type BodyRule = readonly [
    (group: RenderBodyGroup) => boolean,
    (rctx: StructRenderCtx, ctx: StructRenderContext, group: RenderBodyGroup) => string,
];

type PointerDerefTarget =
    | { ok: true; addr: number; byteCount: number; def: StructDef | null }
    | { ok: false; reason: string; addr: number | null; byteCount: number };

type PointerChildState = {
    key: string;
    storageStart: number;
    byteStart: number;
    byteCount: number;
    valKey: string;
    name: string;
    summary: string;
    summaryTitle: string;
    canExpand: boolean;
    expandTitle: string;
    isOpen: boolean;
    allowCreate: boolean;
    bodyHtml: string;
};

function mkFieldRow(rctx: StructRenderCtx, r: DecodedField, bs: number, bc: number, ctx: StructRenderContext, displayName?: string): string {
    const ptr = r.isPointer === true;
    const valKey = fieldValueKey(r, bs);
    const t = valueTypeForRow(rctx, r, valKey);
    const valHtml = valueHtmlForRow(rctx, r, t, ptr);
    const byteCount = fieldByteCount(r, bc);
    const abbrev = fieldTypeAbbrev(r, byteCount);
    const fullTypeLabel = fieldFullTypeLabel(r, byteCount);
    const offsetLabel = fieldOffsetLabel(r);
    const offsetHtml = offsetCellHtml(ctx.hideOffsets, offsetLabel);
    const display = rowDisplayName(r, displayName);
    return (
        `<div class="si-field${fieldRowClasses(r.hasData, ptr)}" ` +
        `data-byte-start="${bs}" data-byte-cnt="${bc}" data-val-key="${esc(valKey)}"` +
        sourceContextDataAttrs(ctx) +
        bitFieldDataAttrs(r) +
        `>` +
        offsetHtml +
        typeCellHtml(abbrev, fullTypeLabel) +
        `<span class="si-toggle-pad" aria-hidden="true"></span>` +
        `<span class="si-f-body">` +
        `<span class="si-f-name">${esc(display)}</span>` +
        (isBitFieldRow(r) ? '' : overrideBadgeHtml(rctx, r)) +
        `<span class="si-f-lead"></span>` +
        `<span class="si-f-val si-f-pri${pointerValueClass(ptr)}" data-val-type="${t}" data-bs="${bs}" data-val-key="${esc(valKey)}">${valHtml}</span>` +
        `</span>` +
        `</div>`
    );
}

function fieldByteCount(r: DecodedField, fallback: number): number {
    return r.bytesHex.length > 0 ? r.bytesHex.split(' ').length : fallback;
}

function rowDisplayName(r: DecodedField, displayName?: string): string {
    return displayName ?? leafName(r.fieldName);
}

function offsetCellHtml(hideOffsets: boolean, offsetLabel: string): string {
    return hideOffsets
        ? '<span class="si-node-pad" aria-hidden="true"></span>'
        : `<span class="si-f-off">${offsetLabel}</span>`;
}

function fieldRowClasses(hasData: boolean, pointer: boolean): string {
    return `${hasData ? '' : ' si-no-data'}${pointer ? ' si-ptr-field' : ''}`;
}

/** Explicit-override badge chips for a decoded row: shown when the row's
 *  effective endian/allocation differs from the global overlay values
 *  (i.e. an explicit override is in effect somewhere up the chain). */
function overrideBadgeHtml(rctx: StructRenderCtx, r: DecodedField | undefined): string {
    if (!r) { return ''; }
    return overrideChipHtml(r.endian, rctx.endian, 'si-chip-endian') +
        overrideChipHtml(r.allocation, rctx.bitFieldAllocation, 'si-chip-alloc');
}

function overrideChipHtml(
    value: 'le' | 'be' | 'lsb' | 'msb' | undefined,
    global: string,
    cls: string,
): string {
    if (value === undefined || value === global) { return ''; }
    return `<span class="si-chip ${cls}">${value.toUpperCase()}</span>`;
}

function pointerValueClass(pointer: boolean): string {
    return pointer ? ' si-f-ptr' : '';
}

function parseArrayIndex(fieldPath: string, baseName: string): number | null {
    const escBase = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = fieldPath.match(new RegExp(`^${escBase}\\[(\\d+)\\]`));
    if (!m) { return null; }
    const idx = parseInt(m[1], 10);
    return isNaN(idx) ? null : idx;
}

function indexOnlyName(fieldPath: string, baseName: string): string {
    const idx = parseArrayIndex(fieldPath, baseName);
    return idx === null ? leafName(fieldPath) : `[${idx}]`;
}

function leafName(fieldPath: string): string {
    const parts = fieldPath.split('.').filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : fieldPath;
}

function displayFieldName(fieldPath: string): string {
    return leafName(fieldPath).replace(/\[\d+\]$/, '');
}

function isBitUnitGroup(rows: DecodedField[]): boolean {
    return rows.length > 0 && rows.every(r => isBitFieldRow(r));
}

function groupHeaderName(baseName: string): string {
    return displayFieldName(baseName);
}

function groupSummaryLabel(rctx: StructRenderCtx, rows: DecodedField[], fallback: string): string {
    if (!isBitUnitGroup(rows)) { return fallback; }
    const first = rows[0];
    if (!first) { return fallback; }
    const raw = completeByteValues(first.bytesHex);
    if (!raw) { return '??'; }

    const value = bytesToBigUint(raw, rowEndianOrDefault(first, rctx.endian));
    const hex = value.toString(16).toUpperCase().padStart(raw.length * 2, '0');
    return `0x${hex} (${value.toString(10)})`;
}

function completeByteValues(bytesHex: string): number[] | null {
    const rawParts = byteHexParts(bytesHex);
    if (hasMissingByte(rawParts)) { return null; }
    const raw = bytesFromHexParts(rawParts);
    return raw.every(v => isByteValue(v)) ? raw : null;
}

function isByteValue(value: number): boolean {
    return Number.isFinite(value) && value >= 0 && value <= 0xFF;
}

export function buildBitUnitAggregateRow(rctx: StructRenderCtx, rows: DecodedField[]): DecodedField | null {
    const first = rows[0];
    if (!first) { return null; }
    const usedWidth = rows.reduce((sum, row) => sum + bitRowWidth(row), 0);
    const slicedValue = bitUnitValueSnippet(rctx, first, usedWidth);
    return {
        fieldName: 'BitField',
        type: first.type,
        arrayIdx: 0,
        byteOffset: first.byteOffset,
        bytesHex: first.bytesHex,
        decoded: first.decoded,
        hasData: first.hasData,
        bitWidth: usedWidth,
        bitStorageByteSize: first.bitStorageByteSize,
        bitValueUnsigned: slicedValue,
        endian: first.endian,
        allocation: first.allocation,
    };
}

function bitUnitValueSnippet(rctx: StructRenderCtx, first: DecodedField, usedWidth: number): string | undefined {
    const rawParts = byteHexParts(first.bytesHex);
    if (!canDecodeBitUnit(usedWidth, rawParts, first.hasData)) { return undefined; }
    const raw = bytesFromHexParts(rawParts);
    const value = bytesToBigUint(raw, rowEndianOrDefault(first, rctx.endian));
    const sliced = sliceUnitValue(value, raw.length * 8, usedWidth, rowAllocOrDefault(first, rctx.bitFieldAllocation));
    return sliced.toString(10);
}

function sliceUnitValue(value: bigint, unitBits: number, usedWidth: number, allocation: BitFieldAllocation): bigint {
    const mask = (1n << BigInt(usedWidth)) - 1n;
    return allocation === 'lsb'
        ? value & mask
        : (value >> BigInt(Math.max(0, unitBits - usedWidth))) & mask;
}

function canDecodeBitUnit(usedWidth: number, rawParts: string[], hasData: boolean): boolean {
    return usedWidth > 0 && !hasMissingByte(rawParts) && hasData;
}

function activeBitRangeForHeader(rctx: StructRenderCtx, start: number): { startBit: number; endBit: number } | null {
    return matchingBitRange(rctx.selectedBitRange, start) ?? matchingBitRange(rctx.hoveredBitRange, start);
}

function matchingBitRange(range: { parentByteStart: number; startBit: number; endBit: number } | null, start: number): { startBit: number; endBit: number } | null {
    if (!range || range.parentByteStart !== start) { return null; }
    return { startBit: range.startBit, endBit: range.endBit };
}

function bitUnitHeaderClasses(kind: 'group' | 'element'): { headerClass: string; buttonClass: string } {
    return {
        headerClass: kind === 'element' ? 'si-arr-el-hdr' : 'si-arr-grp-hdr',
        buttonClass: kind === 'element' ? 'si-arr-el-exp-btn' : 'si-arr-exp-btn',
    };
}

function emptyBitUnitHeaderHtml(
    headerClass: string,
    buttonClass: string,
    headerName: string,
    valKey: string,
    start: number,
    cnt: number,
    isOpen: boolean,
): string {
    return (
        `<div class="${headerClass} si-bitunit-hdr si-field" data-byte-start="${start}" data-byte-cnt="${cnt}" data-val-key="${esc(valKey)}">` +
        `<span class="si-f-off">+000</span>` +
        typeCellHtml('u8', 'uint8') +
        `<button class="${buttonClass}" title="${isOpen ? 'Collapse group' : 'Expand group'}" aria-label="${isOpen ? 'Collapse group' : 'Expand group'}">›</button>` +
        `<span class="si-f-body">` +
        `<span class="si-f-name">${esc(headerName)}</span>` +
        `<span class="si-f-lead"></span>` +
        `<span class="si-f-val si-f-pri" data-val-type="hex" data-bs="${start}" data-val-key="${esc(valKey)}">??</span>` +
        `</span>` +
        `</div>`
    );
}

function bitUnitHeaderValueHtml(
    rctx: StructRenderCtx, rows: DecodedField[],
    agg: DecodedField,
    valueType: ColType,
    activeRange: { startBit: number; endBit: number } | null,
): string {
    // The agg/rows carry the container's resolved (possibly overridden) endian
    // + allocation; pass them down so the binary rendering matches the decode.
    if (valueType === 'bin') { return renderBinaryStorageUnit({ endian: rctx.endian, bitFieldAllocation: rctx.bitFieldAllocation }, agg, activeRange, agg.endian, agg.allocation); }
    if (valueType === 'bin-sliced') { return renderBinaryFromBitRows({ endian: rctx.endian, bitFieldAllocation: rctx.bitFieldAllocation }, rows, activeRange, agg.endian, agg.allocation); }
    return getValForType(rctx, agg, valueType);
}

function bitUnitHeaderDisplayValue(
    rctx: StructRenderCtx, rows: DecodedField[],
    agg: DecodedField,
    valueType: ColType,
    start: number,
): string {
    const value = bitUnitHeaderValueHtml(rctx, rows, agg, valueType, activeBitRangeForHeader(rctx, start));
    return shouldUseRawHeaderValue(valueType, agg) ? value : esc(value);
}

const RAW_BIT_UNIT_VALUE_TYPES = new Set<ColType>(['bin', 'bin-sliced', 'ieee', 'hex']);

function shouldUseRawHeaderValue(valueType: ColType, agg: DecodedField): boolean {
    return RAW_BIT_UNIT_VALUE_TYPES.has(valueType) || agg.isPointer === true;
}

function bitUnitByteCount(agg: DecodedField, fallback: number): number {
    return agg.bytesHex.length > 0 ? agg.bytesHex.split(' ').length : fallback;
}

function bitUnitHeaderHtml(
    rctx: StructRenderCtx, rows: DecodedField[],
    start: number,
    cnt: number,
    isOpen: boolean,
    headerNameOverride?: string,
    kind: 'group' | 'element' = 'group',
    hideOffset = false,
): string {
    const agg = buildBitUnitAggregateRow(rctx, rows);
    const headerName = bitUnitHeaderName(rows, headerNameOverride);
    const { headerClass, buttonClass } = bitUnitHeaderClasses(kind);
    const valKey = bitUnitValKey(start);
    if (!agg) { return emptyBitUnitHeaderHtml(headerClass, buttonClass, headerName, valKey, start, cnt, isOpen); }

    return populatedBitUnitHeaderHtml(rctx, rows, agg, headerClass, buttonClass, headerName, valKey, start, cnt, isOpen, hideOffset);
}

function bitUnitHeaderName(rows: DecodedField[], headerNameOverride?: string): string {
    if (headerNameOverride !== undefined) { return headerNameOverride; }
    return groupHeaderName(arrayGroupBaseName(firstBitUnitFieldName(rows)));
}

function firstBitUnitFieldName(rows: DecodedField[]): string {
    return rows[0]?.fieldName ?? '';
}

function bitUnitOffsetHtml(offsetLabel: string, hideOffset: boolean): string {
        return hideOffset
            ? '<span class="si-node-pad" aria-hidden="true"></span>'
            : `<span class="si-f-off">${offsetLabel}</span>`;
    }

function collapsibleIconHtml(buttonClass: string, isOpen: boolean): string {
        return `<button class="${buttonClass}" title="${isOpen ? 'Collapse group' : 'Expand group'}" aria-label="${isOpen ? 'Collapse group' : 'Expand group'}">›</button>`;
    }

function populatedBitUnitHeaderHtml(
        rctx: StructRenderCtx, rows: DecodedField[],
        agg: DecodedField,
        headerClass: string,
        buttonClass: string,
        headerName: string,
        valKey: string,
        start: number,
        cnt: number,
        isOpen: boolean,
        hideOffset: boolean,
    ): string {
        const t = bitUnitHeaderValueType(rctx, valKey);
        const ptrClass = bitUnitPointerClass(agg);
        const valHtml = bitUnitHeaderDisplayValue(rctx, rows, agg, t, start);
        const byteCount = bitUnitByteCount(agg, cnt);
        const abbrev = fieldTypeAbbrev(agg, byteCount);
        const fullTypeLabel = fieldFullTypeLabel(agg, byteCount);
        const offsetLabel = fieldOffsetLabel(agg);

        return (
            `<div class="${headerClass} si-bitunit-hdr si-field" data-byte-start="${start}" data-byte-cnt="${cnt}" data-val-key="${esc(valKey)}">` +
            bitUnitOffsetHtml(offsetLabel, hideOffset) +
            typeCellHtml(abbrev, fullTypeLabel) +
            collapsibleIconHtml(buttonClass, isOpen) +
            `<span class="si-f-body">` +
            `<span class="si-f-name">${esc(headerName)}</span>` +
            overrideBadgeHtml(rctx, agg) +
            `<span class="si-f-lead"></span>` +
            `<span class="si-f-val si-f-pri${ptrClass}" data-val-type="${t}" data-bs="${start}" data-val-key="${esc(valKey)}">${valHtml}</span>` +
            `</span>` +
            `</div>`
        );
    }

function bitUnitHeaderValueType(rctx: StructRenderCtx, valKey: string): ColType {
    return rctx.fieldValTypes.get(valKey) ?? 'bin';
}

function bitUnitPointerClass(agg: DecodedField): string {
    return agg.isPointer === true ? ' si-f-ptr' : '';
}

function disambiguateLeafNames(names: string[]): string[] {
    const seen = new Map<string, number>();
    return names.map(name => {
        const count = (seen.get(name) ?? 0) + 1;
        seen.set(name, count);
        return count === 1 ? name : `${name}#${count}`;
    });
}

function arrayGroupBaseName(fieldPath: string): string {
    // Group by the first local segment (before first dot), even when arrays are present.
    // This keeps nested fields under their owning parent node.
    const matches = [...fieldPath.matchAll(/\[\d+\]/g)];
    if (matches.length === 0) {
        return baseNameBeforeDot(fieldPath);
    }
    const first = matches[0];
    if (first.index === undefined) { return fieldPath; }
    const firstArrayIdx = first.index;
    const firstDot = fieldPath.indexOf('.');
    if (dotPrecedesArray(firstDot, firstArrayIdx)) { return fieldPath.slice(0, firstDot); }
    return fieldPath.slice(0, first.index);
}

function baseNameBeforeDot(fieldPath: string): string {
    const dot = fieldPath.indexOf('.');
    return dot >= 0 ? fieldPath.slice(0, dot) : fieldPath;
}

function dotPrecedesArray(dot: number, arrayIdx: number): boolean {
    return dot >= 0 && dot < arrayIdx;
}

function bitUnitArrayBaseName(fieldPath: string): string {
    return fieldPath.replace(/\[\d+\]$/, '');
}

function decodedRowByteCount(r: DecodedField): number {
    if (isBitFieldRow(r)) { return r.bitStorageByteSize ?? 1; }
    return r.bytesHex.length > 0 ? r.bytesHex.split(' ').length : fieldByteSize(r.type);
}

function sumDecodedRowBytes(rows: DecodedField[]): number {
    return rows.reduce((sum, row) => sum + decodedRowByteCount(row), 0);
}

function isCompositeStructGroup(isBitUnit: boolean, isStruct: boolean, isArray: boolean, isString: boolean): boolean {
    if (isBitUnit || isStruct) { return true; }
    return isArray && !isString;
}

function structGroupSummary(type: StructFieldType, isArray: boolean, count: number, structName: string): string {
    if (type === 'struct') {
        return isArray ? `${structName}[${count}]` : structName;
    }
    const scalarType = TYPE_ABBREV[type] ?? type;
    return `${scalarType}[${count}]`;
}

function pointerGroupSummary(type: StructFieldType, isArray: boolean, count: number, structName: string): string {
    const base = type === 'struct' ? structName : pointerScalarSummaryBase(type);
    return isArray ? `${base}*[${count}]` : `${base}*`;
}

function pointerScalarSummaryBase(type: StructFieldType): string {
    if (type === 'ascii') { return 'char'; }
    return TYPE_ABBREV[type] ?? type;
}

function structGroupSummaryLabel(rctx: StructRenderCtx, rows: DecodedField[], isBitUnit: boolean, isArray: boolean, summary: string): string {
    return isBitUnit && isArray ? summary : groupSummaryLabel(rctx, rows, summary);
}

function structGroupByteCount(rows: DecodedField[], isBitUnit: boolean, isArray: boolean, count: number): number {
    if (isBitUnit) { return decodedRowByteCount(rows[0]) * (isArray ? count : 1); }
    return sumDecodedRowBytes(rows);
}

function describeStructGroup(rctx: StructRenderCtx, def: StructDef, rows: DecodedField[], baseName: string): StructGroupInfo {
    const declared = structGroupDeclarationInfo(rctx, def, rows, baseName);
    const isArray = declared.count > 1;
    const isStruct = declared.declaredType === 'struct' && !declared.isPointer;
    const isString = declared.declaredType === 'ascii' && !declared.isPointer;
    const isBitUnit = isBitUnitGroup(rows);
    const isComposite = isCompositeStructGroup(isBitUnit, isStruct, isArray, isString);
    const summary = groupSummaryForDeclaration(declared, isArray);
    return {
        declaredType: declared.declaredType,
        count: declared.count,
        isPointer: declared.isPointer,
        isArray,
        isStruct,
        isString,
        isBitUnit,
        isComposite,
        structName: declared.structName,
        summary,
        summaryLabel: structGroupSummaryLabel(rctx, rows, isBitUnit, isArray, summary),
        byteCount: structGroupByteCount(rows, isBitUnit, isArray, declared.count),
    };
}

function structGroupDeclarationInfo(rctx: StructRenderCtx, def: StructDef, rows: DecodedField[], baseName: string): StructGroupDeclarationInfo {
    const declared = resolveStructFieldByPath(def, baseName, rctx.structs);
    return declared ? resolvedStructGroupDeclarationInfo(declared) : inferredStructGroupDeclarationInfo(rows);
}

function resolvedStructGroupDeclarationInfo(declared: { field: StructField; structName?: string }): StructGroupDeclarationInfo {
    return {
        declaredType: declared.field.type,
        count: declared.field.count,
        structName: declared.structName ?? 'struct',
        isPointer: normalizeStructField(declared.field).isPointer === true,
    };
}

function inferredStructGroupDeclarationInfo(rows: DecodedField[]): StructGroupDeclarationInfo {
    const first = rows[0];
    return {
        declaredType: first.type,
        count: rows.length,
        structName: 'struct',
        isPointer: first.isPointer === true,
    };
}

function groupSummaryForDeclaration(declared: StructGroupDeclarationInfo, isArray: boolean): string {
    return declared.isPointer
        ? pointerGroupSummary(declared.declaredType, isArray, declared.count, declared.structName)
        : structGroupSummary(declared.declaredType, isArray, declared.count, declared.structName);
}

function groupRowsByBase(rows: DecodedField[]): FieldGroup[] {
    const groups: FieldGroup[] = [];
    for (const row of rows) {
        const base = arrayGroupBaseName(row.fieldName);
        const last = groups[groups.length - 1];
        if (last && last.baseName === base) { last.rows.push(row); }
        else { groups.push({ baseName: base, rows: [row] }); }
    }
    return groups;
}

function groupRowsByArrayIndex(rows: DecodedField[], baseName: string): IndexedFieldGroup[] {
    const groups: IndexedFieldGroup[] = [];
    for (const row of rows) {
        const idx = parseArrayIndex(row.fieldName, baseName);
        if (idx === null) { continue; }
        appendIndexedFieldRow(groups, idx, row);
    }
    return groups;
}

function appendIndexedFieldRow(groups: IndexedFieldGroup[], idx: number, row: DecodedField): void {
    const last = groups[groups.length - 1];
    if (last && last.idx === idx) { last.rows.push(row); }
    else { groups.push({ idx, rows: [row] }); }
}

function groupNestedRows(rows: DecodedField[], structBase: string): NestedFieldGroup[] {
    const structPrefix = `${structBase}.`;
    const groups: NestedFieldGroup[] = [];
    for (const row of rows) {
        const relPath = relativeStructFieldPath(row.fieldName, structPrefix);
        const baseRel = arrayGroupBaseName(relPath);
        const fullBase = `${structBase}.${baseRel}`;
        const last = groups[groups.length - 1];
        if (last && last.fullBase === fullBase) { last.rows.push(row); }
        else { groups.push({ baseRel, fullBase, rows: [row] }); }
    }
    return groups;
}

function relativeStructFieldPath(fieldName: string, structPrefix: string): string {
    return fieldName.startsWith(structPrefix) ? fieldName.slice(structPrefix.length) : fieldName;
}

function leafRowsHtml(rctx: StructRenderCtx, rows: DecodedField[], ctx: StructRenderContext): string {
    const labels = disambiguateLeafNames(rows.map(r => leafName(r.fieldName)));
    return rows.map((row, idx) =>
        mkFieldRow(rctx, row, ctx.baseAddr + row.byteOffset, decodedRowByteCount(row), ctx, labels[idx])
    ).join('');
}

function indexedRowsHtml(rctx: StructRenderCtx, rows: DecodedField[], ctx: StructRenderContext, baseName: string): string {
    return rows.map(row =>
        mkFieldRow(rctx, row, ctx.baseAddr + row.byteOffset, decodedRowByteCount(row), ctx, indexOnlyName(row.fieldName, baseName))
    ).join('');
}

function structArrayElementHtml(
    element: IndexedFieldGroup,
    elementKey: string,
    baseAddr: number,
    byteCnt: number,
    isOpen: boolean,
    summary: string,
    hideOffsets: boolean,
    bodyHtml: string,
): string {
    const first = element.rows[0];
    const byteStart = baseAddr + first.byteOffset;
    const groupClass = structArrayElementGroupClass(isOpen);
    const offsetAttr = structArrayElementOffsetAttr(first.byteOffset, hideOffsets);
    const bodyStyle = structArrayElementBodyStyle(isOpen);
    return (
        `<div class="${groupClass}" data-arr-el-key="${esc(elementKey)}">` +
        `<div class="si-arr-el-hdr" data-arr-el-key="${esc(elementKey)}" data-byte-start="${byteStart}" data-byte-cnt="${byteCnt}"${offsetAttr}>` +
        compositeHeaderPrefixHtml(isOpen, first.byteOffset, hideOffsets) +
        `<button class="si-arr-el-exp-btn" title="${isOpen ? 'Collapse element' : 'Expand element'}" aria-label="${isOpen ? 'Collapse element' : 'Expand element'}">›</button>` +
        `<span class="si-f-body">` +
        `<span class="si-f-name">[${element.idx}]</span>` +
        `<span class="si-f-lead"></span>` +
        `<span class="si-arr-addr">${esc(summary)}</span>` +
        `</span>` +
        `</div>` +
        `<div class="si-arr-el-body"${bodyStyle}>${bodyHtml}</div>` +
        `</div>`
    );
}

function structArrayElementGroupClass(isOpen: boolean): string {
    return isOpen ? 'si-arr-el-grp open' : 'si-arr-el-grp';
}

function structArrayElementOffsetAttr(byteOffset: number, hideOffsets: boolean): string {
    return hideOffsets ? '' : ` data-offset-label="${offsetLabel(byteOffset)}"`;
}

function structArrayElementBodyStyle(isOpen: boolean): string {
    return isOpen ? '' : ' style="display:none"';
}

function offsetLabel(byteOffset: number): string {
    return `+${byteOffset.toString(16).toUpperCase().padStart(3, '0')}`;
}

function compositeHeaderPrefixHtml(isOpen: boolean, byteOffset: number, hideOffset = false): string {
    if (isOpen || hideOffset) {
        return (
            `<span class="si-node-pad" aria-hidden="true"></span>` +
            `<span class="si-node-type-pad" aria-hidden="true"></span>`
        );
    }
    return (
        `<span class="si-f-off">${offsetLabel(byteOffset)}</span>` +
        `<span class="si-node-type-pad" aria-hidden="true"></span>`
    );
}

export function syncCompositeHeaderOffset(hdr: HTMLElement, isOpen: boolean): void {
    if (hdr.classList.contains('si-bitunit-hdr')) { return; }
    if (hdr.classList.contains('si-ptr-hdr')) { return; }

    const existingOffset = hdr.querySelector<HTMLElement>(':scope > .si-f-off');
    const existingPad = hdr.querySelector<HTMLElement>(':scope > .si-node-pad');
    const typePad = hdr.querySelector<HTMLElement>(':scope > .si-node-type-pad');
    if (isOpen) {
        syncOpenCompositeHeaderOffset(existingOffset, existingPad, typePad);
        return;
    }

    syncClosedCompositeHeaderOffset(hdr.dataset.offsetLabel, existingOffset, existingPad, typePad);
}

function syncOpenCompositeHeaderOffset(
    existingOffset: HTMLElement | null,
    existingPad: HTMLElement | null,
    typePad: HTMLElement | null,
): void {
    existingOffset?.remove();
    if (!existingPad && typePad) {
        typePad.insertAdjacentHTML('beforebegin', '<span class="si-node-pad" aria-hidden="true"></span>');
    }
}

function syncClosedCompositeHeaderOffset(
    label: string | undefined,
    existingOffset: HTMLElement | null,
    existingPad: HTMLElement | null,
    typePad: HTMLElement | null,
): void {
    if (!label) { return; }
    existingPad?.remove();
    if (!existingOffset && typePad) {
        typePad.insertAdjacentHTML('beforebegin', `<span class="si-f-off">${esc(label)}</span>`);
    }
}

function sourceContextDataAttrs(ctx: StructRenderContext): string {
    return ` data-source-struct-id="${esc(ctx.def.id)}" data-source-base-addr="${ctx.baseAddr}"`;
}

const BODY_RULES: ReadonlyArray<BodyRule> = [
    [
        group => group.info.isStruct && group.info.isArray,
        (rctx, ctx, group) => renderStructArrayElements(rctx, ctx, group.rows, group.baseName, group.key, group.info.structName),
    ],
    [
        group => group.info.isBitUnit && group.info.isArray,
        (rctx, ctx, group) => renderBitUnitArrayElements(rctx, group.rows, group.baseName, group.key, ctx),
    ],
    [
        group => group.info.isStruct && !group.info.isArray,
        (rctx, ctx, group) => renderStructChildren(rctx, ctx, group.rows, group.baseName, group.key),
    ],
    [
        group => group.info.isBitUnit,
        (rctx, ctx, group) => renderBitUnitLeafRows(rctx, group.rows, ctx),
    ],
    [
        group => !group.info.isStruct && group.info.isArray && !group.info.isString,
        (rctx, ctx, group) => indexedRowsHtml(rctx, group.rows, ctx, group.baseName),
    ],
];

export function renderStructBody(rctx: StructRenderCtx, def: StructDef, pin: StructPin): string {
    const rows = decodeStruct(def, pin.addr, rctx.readByte, rctx.endian, rctx.bitFieldAllocation, rctx.structs);
    return `<div class="si-fields">${renderStructFieldGroups(rctx, {
        def,
        pin,
        baseAddr: pin.addr,
        keyPrefix: pin.id,
        pointerDepth: 0,
        hideOffsets: false,
    }, rows)}</div>`;
}

function renderBitUnitLeafRows(rctx: StructRenderCtx, unitRows: DecodedField[], ctx: StructRenderContext): string {
    return leafRowsHtml(rctx, unitRows, ctx);
}

function renderBitUnitArrayElements(
    rctx: StructRenderCtx, unitRows: DecodedField[],
    baseName: string,
    parentKey: string,
    ctx: StructRenderContext,
): string {
    const arrayBase = bitUnitArrayBaseName(baseName);
    return groupRowsByArrayIndex(unitRows, arrayBase).map(element => {
        const first = element.rows[0];
        const elementByteStart = ctx.baseAddr + first.byteOffset;
        const elementByteCnt = decodedRowByteCount(first);
        const elementKey = `${parentKey}::${element.idx}`;
        const isElementOpen = rctx.expandedArrayElements.has(elementKey);
        const elementRowsHtml = renderBitUnitLeafRows(rctx, element.rows, ctx);
        return (
            `<div class="si-arr-el-grp${isElementOpen ? ' open' : ''}" data-arr-el-key="${esc(elementKey)}">` +
            bitUnitHeaderHtml(rctx, element.rows, elementByteStart, elementByteCnt, isElementOpen, `[${element.idx}]`, 'element') +
            `<div class="si-arr-el-body"${isElementOpen ? '' : ' style=\"display:none\"'}>${elementRowsHtml}</div>` +
            `</div>`
        );
    }).join('');
}

function renderStructChildren(rctx: StructRenderCtx, ctx: StructRenderContext, structRows: DecodedField[], structBase: string, parentKey: string): string {
    return groupNestedRows(structRows, structBase).map(ng => renderNestedStructGroup(rctx, ctx, ng, parentKey)).join('');
}

function renderNestedStructGroup(rctx: StructRenderCtx, ctx: StructRenderContext, ng: NestedFieldGroup, parentKey: string): string {
    if (isHiddenDeclaredField(rctx, ctx.def, ng.fullBase)) { return ''; }
    const info = describeStructGroup(rctx, ctx.def, ng.rows, ng.fullBase);
    if (isStructPointerRows(ng.rows)) {
        return renderStructPointerRows(rctx, ctx, ng.rows, parentKey, ng.baseRel, info);
    }
    if (!info.isComposite) {
        return leafRowsHtml(rctx, ng.rows, ctx);
    }

    const nestedKey = `${parentKey}::${ng.baseRel}`;
    const nestedOpen = rctx.expandedArrayFields.has(nestedKey);
    const nestedStart = ctx.baseAddr + ng.rows[0].byteOffset;
    const nestedBodyHtml = renderNestedStructBody(rctx, ctx, {
        rows: ng.rows,
        baseName: ng.fullBase,
        key: nestedKey,
        info,
    });

    return compositeGroupHtml(
        nestedKey,
        nestedOpen,
        nestedStructHeaderHtml(rctx, ctx, ng, info, nestedStart, nestedOpen),
        nestedBodyHtml,
    );
}

function nestedStructHeaderHtml(rctx: StructRenderCtx, ctx: StructRenderContext, ng: NestedFieldGroup, info: StructGroupInfo, nestedStart: number, nestedOpen: boolean): string {
    if (info.isBitUnit && !info.isArray) {
        return bitUnitHeaderHtml(rctx, ng.rows, nestedStart, info.byteCount, nestedOpen, groupHeaderName(ng.baseRel), 'group', ctx.hideOffsets);
    }
    return compositeHeaderHtml(
        nestedOpen,
        nestedStart,
        info.byteCount,
        ng.rows[0].byteOffset,
        groupHeaderName(ng.baseRel),
        info.summaryLabel,
        ctx.hideOffsets,
        false,
        overrideBadgeHtml(rctx, ng.rows[0]),
    );
}

function bodyRuleFor(group: RenderBodyGroup): ((rctx: StructRenderCtx, ctx: StructRenderContext, group: RenderBodyGroup) => string) | undefined {
    return BODY_RULES.find(([matches]) => matches(group))?.[1];
}

function renderNestedStructBody(
    rctx: StructRenderCtx,
    ctx: StructRenderContext,
    group: RenderBodyGroup,
): string {
    const rule = bodyRuleFor(group);
    return rule ? rule(rctx, ctx, group) : leafRowsHtml(rctx, group.rows, ctx);
}

function renderStructArrayElements(
    rctx: StructRenderCtx, ctx: StructRenderContext,
    rows: DecodedField[],
    baseName: string,
    parentKey: string,
    structName: string,
): string {
    return groupRowsByArrayIndex(rows, baseName).map(element => {
        const elementKey = `${parentKey}::${element.idx}`;
        const isElementOpen = rctx.expandedArrayElements.has(elementKey);
        const childRowsHtml = renderStructChildren(
            rctx, ctx,
            element.rows,
            `${baseName}[${element.idx}]`,
            elementKey,
        );
        return structArrayElementHtml(
            element,
            elementKey,
            ctx.baseAddr,
            sumDecodedRowBytes(element.rows),
            isElementOpen,
            structName,
            ctx.hideOffsets,
            childRowsHtml,
        );
    }).join('');
}

function renderStructFieldGroups(rctx: StructRenderCtx, ctx: StructRenderContext, rows: DecodedField[]): string {
    return groupRowsByBase(rows)
        .filter(g => !isHiddenDeclaredField(rctx, ctx.def, g.baseName))
        .map(g => renderStructFieldGroup(rctx, ctx, g))
        .join('');
}

/**
 * Whether the declaration at `fieldPath` is marked hidden. Resolved through
 * the def by full dotted path so leaf, composite, nested-struct, array, and
 * bit-unit-container groups are all covered uniformly; a hidden container
 * drops its whole subtree (its rows never reach a group). The global toggle
 * short-circuits to "visible".
 */
function isHiddenDeclaredField(rctx: StructRenderCtx, def: StructDef, fieldPath: string): boolean {
    if (rctx.showHiddenFields) { return false; }
    return resolveStructFieldByPath(def, fieldPath, rctx.structs)?.field.hidden === true;
}

function renderStructFieldGroup(rctx: StructRenderCtx, ctx: StructRenderContext, g: FieldGroup): string {
    const r0 = g.rows[0];
    const info = describeStructGroup(rctx, ctx.def, g.rows, g.baseName);
    if (isStructPointerRows(g.rows)) {
        return renderStructPointerRows(rctx, ctx, g.rows, ctx.keyPrefix, g.baseName, info);
    }
    if (!info.isComposite) {
        return leafRowsHtml(rctx, g.rows, ctx);
    }

    const key = `${ctx.keyPrefix}::${g.baseName}`;
    const isOpen = rctx.expandedArrayFields.has(key);
    const byteStart = ctx.baseAddr + r0.byteOffset;
    const elHtml = renderStructFieldBody(rctx, ctx, {
        rows: g.rows,
        baseName: g.baseName,
        key,
        info,
    });

    return compositeGroupHtml(
        key,
        isOpen,
        structFieldHeaderHtml(rctx, ctx, g, info, byteStart, isOpen),
        elHtml,
    );
}

function structFieldHeaderHtml(rctx: StructRenderCtx, ctx: StructRenderContext, g: FieldGroup, info: StructGroupInfo, byteStart: number, isOpen: boolean): string {
    if (info.isBitUnit && !info.isArray) {
        return bitUnitHeaderHtml(rctx, g.rows, byteStart, info.byteCount, isOpen, undefined, 'group', ctx.hideOffsets);
    }
    return compositeHeaderHtml(
        isOpen,
        byteStart,
        info.byteCount,
        g.rows[0].byteOffset,
        groupHeaderName(g.baseName),
        info.summaryLabel,
        ctx.hideOffsets,
        true,
        overrideBadgeHtml(rctx, g.rows[0]),
    );
}

function compositeGroupHtml(key: string, isOpen: boolean, headerHtml: string, bodyHtml: string): string {
    return (
        `<div class="si-arr-grp${isOpen ? ' open' : ''}" data-arr-key="${esc(key)}">` +
        headerHtml +
        `<div class="si-arr-grp-body"${isOpen ? '' : ' style=\"display:none\"'}>${bodyHtml}</div>` +
        `</div>`
    );
}

function compositeHeaderAttr(byteOffset: number, hideOffset: boolean): string {
        return hideOffset ? '' : ` data-offset-label="${offsetLabel(byteOffset)}"`;
    }

function compositeHeaderHtml(
        isOpen: boolean,
        byteStart: number,
        byteCount: number,
        byteOffset: number,
        name: string,
        summaryLabel: string,
        hideOffset = false,
        includeTitle = false,
        badgeHtml = '',
    ): string {
        const title = includeTitle ? ` title="${esc(summaryLabel)}"` : '';
        return (
            `<div class="si-arr-grp-hdr" data-byte-start="${byteStart}" data-byte-cnt="${byteCount}"` +
            compositeHeaderAttr(byteOffset, hideOffset) + `>` +
            compositeHeaderPrefixHtml(isOpen, byteOffset, hideOffset) +
            collapsibleIconHtml('si-arr-exp-btn', isOpen) +
            `<span class="si-f-body">` +
            `<span class="si-f-name">${esc(name)}</span>` +
            badgeHtml +
            `<span class="si-f-lead"></span>` +
            `<span class="si-arr-addr"${title}>${esc(summaryLabel)}</span>` +
            `</span>` +
            `</div>`
        );
    }

function isStructPointerRows(rows: DecodedField[]): boolean {
    return rows.length > 0 && rows.every(row => row.isPointer === true);
}

function renderStructPointerRows(
    rctx: StructRenderCtx, ctx: StructRenderContext,
    rows: DecodedField[],
    parentKey: string,
    baseName: string,
    info: StructGroupInfo,
): string {
    if (info.isArray) {
        return renderStructPointerArrayRows(rctx, ctx, rows, parentKey, baseName, info);
    }
    return rows.map(row => {
        return renderStructPointerGroup(rctx, ctx, row, `${parentKey}::ptr::${row.fieldName}`, groupHeaderName(baseName));
    }).join('');
}

function renderStructPointerArrayRows(
    rctx: StructRenderCtx, ctx: StructRenderContext,
    rows: DecodedField[],
    parentKey: string,
    baseName: string,
    info: StructGroupInfo,
): string {
    const key = `${parentKey}::${baseName}`;
    const isOpen = rctx.expandedArrayFields.has(key);
    const first = rows[0];
    const byteStart = ctx.baseAddr + first.byteOffset;
    const bodyHtml = rows.map(row =>
        renderStructPointerGroup(rctx, ctx, row, `${key}::ptr::${row.fieldName}`, indexOnlyName(row.fieldName, baseName))
    ).join('');
    return compositeGroupHtml(
        key,
        isOpen,
        compositeHeaderHtml(isOpen, byteStart, info.byteCount, first.byteOffset, groupHeaderName(baseName), info.summary, ctx.hideOffsets, true, overrideBadgeHtml(rctx, first)),
        bodyHtml,
    );
}

function renderStructPointerGroup(rctx: StructRenderCtx, ctx: StructRenderContext, row: DecodedField, key: string, name: string): string {
    const target = pointerDerefTarget(rctx, row);
    if (!target.ok || !pointerHasInlinePreview(row, target)) {
        return structPointerLeafHtml(ctx, row, key, name, target);
    }
    const isOpen = rctx.expandedArrayFields.has(key);
    const childKey = `${key}::child`;
    return compositeGroupHtml(
        key,
        isOpen,
        structPointerHeaderHtml(ctx, row, key, name, target, isOpen),
        structPointerTargetBodyHtml(rctx, ctx, row, target, childKey),
    );
}

function pointerHasInlinePreview(row: DecodedField, target: PointerDerefTarget): target is Extract<PointerDerefTarget, { ok: true }> {
    if (!target.ok) { return false; }
    if (target.def) { return true; }
    return scalarPointerTargetType(row) !== 'void';
}

function structPointerLeafHtml(
    ctx: StructRenderContext,
    row: DecodedField,
    key: string,
    name: string,
    target: PointerDerefTarget,
): string {
    const storageStart = ctx.baseAddr + row.byteOffset;
    const valKey = fieldValueKey(row, storageStart);
    return (
        structPointerLeafOpenTag(ctx, row, target, key, storageStart, valKey) +
        structPointerHeaderPrefixHtml(row, ctx.hideOffsets) +
        `<span class="si-toggle-pad" aria-hidden="true"></span>` +
        structPointerHeaderBodyHtml(row, target, name, storageStart, valKey) +
        `</div>`
    );
}

function structPointerLeafOpenTag(
    ctx: StructRenderContext,
    row: DecodedField,
    target: PointerDerefTarget,
    key: string,
    storageStart: number,
    valKey: string,
): string {
    return structPointerOpenTag(ctx, row, target, key, storageStart, valKey, 'si-field si-ptr-hdr si-ptr-field', 0);
}

function pointerChildState(rctx: StructRenderCtx, ctx: StructRenderContext, row: DecodedField, target: Extract<PointerDerefTarget, { ok: true }>, key: string): PointerChildState {
    const storageStart = ctx.baseAddr + row.byteOffset;
    const expandable = pointerChildExpandable(ctx, target);
    const isOpen = pointerChildIsOpen(rctx, key, expandable.ok);
    return {
        key,
        storageStart,
        byteStart: target.addr,
        byteCount: target.byteCount,
        valKey: fieldValueKey(row, storageStart),
        name: pointerChildName(target),
        summary: pointerChildSummary(row, target),
        summaryTitle: pointerChildSummaryTitle(row, target),
        canExpand: expandable.ok,
        expandTitle: expandable.ok ? 'Expand' : expandable.reason,
        isOpen,
        allowCreate: row.pointerTargetType === 'struct',
        bodyHtml: pointerChildBodyHtml(rctx, ctx, key, target, expandable.ok),
    };
}

function pointerChildName(target: Extract<PointerDerefTarget, { ok: true }>): string {
    return target.def ? '{ }' : '';
}

function pointerChildIsOpen(rctx: StructRenderCtx, key: string, canExpand: boolean): boolean {
    return canExpand && rctx.expandedArrayFields.has(key);
}

function pointerChildBodyHtml(
    rctx: StructRenderCtx, ctx: StructRenderContext,
    key: string,
    target: PointerDerefTarget,
    canExpand: boolean,
): string {
    if (!canExpand || !target.ok || !target.def) { return ''; }
    const resolvedTarget = { ...target, def: target.def };
    return renderStructPointerBody(rctx, ctx, key, resolvedTarget);
}

function pointerChildSummary(row: DecodedField, target: Extract<PointerDerefTarget, { ok: true }>): string {
    return target.def ? structPointerTargetSummary(row, target.addr, target.def) : pointerTargetTypeLabel(row, false);
}

function pointerChildSummaryTitle(row: DecodedField, target: Extract<PointerDerefTarget, { ok: true }>): string {
    const targetName = target.def ? row.pointerTargetStructName ?? target.def.name : pointerTargetTypeLabel(row, false);
    return `${targetName} @ ${formatHex(target.addr, 8)}`;
}

function structPointerTargetSummary(
    row: DecodedField,
    addr: number,
    def: StructDef,
): string {
    return `${row.pointerTargetStructName ?? def.name} @ ${formatHex(addr, 8)}`;
}

function scalarPointerTargetType(row: DecodedField): StructScalarFieldType | null {
    const targetType = row.pointerTargetType;
    return targetType !== undefined && isScalarStructFieldType(targetType) ? targetType : null;
}

/** A pointer target type that decodes as a scalar (not a named struct/bit-field/enum). */
function isScalarStructFieldType(type: StructFieldType): type is StructScalarFieldType {
    return type !== 'struct' && type !== 'bitfield' && type !== 'enum';
}

function readScalarPointerTargetBytes(
    rctx: StructRenderCtx, row: DecodedField,
    targetType: StructScalarFieldType,
    addr: number,
): number[] | null {
    const size = Math.max(1, row.pointerTargetByteSize ?? fieldByteSize(targetType));
    const bytes: number[] = [];
    for (let offset = 0; offset < size; offset++) {
        const value = rctx.readByte(addr + offset);
        if (value === undefined) { return null; }
        bytes.push(value);
    }
    return bytes;
}

function scalarPointerTargetRow(rctx: StructRenderCtx, row: DecodedField, targetType: StructScalarFieldType, bytes: number[]): DecodedField {
    return {
        fieldName: `${row.fieldName}.*`,
        type: targetType,
        arrayIdx: 0,
        byteOffset: 0,
        bytesHex: bytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' '),
        decoded: decodeField(bytes, targetType, rctx.endian),
        hasData: true,
    };
}

function pointerDerefTarget(rctx: StructRenderCtx, row: DecodedField): PointerDerefTarget {
    const follow = rctx.pointerFollowState(row);
    const addr = typeof row.pointerValue === 'number' ? row.pointerValue : null;
    if (!follow.ok) { return { ok: false, reason: follow.reason, addr, byteCount: 1 }; }
    return resolvedPointerTarget(rctx, row, addr!);
}

function resolvedPointerTarget(rctx: StructRenderCtx, row: DecodedField, addr: number): PointerDerefTarget {
    const def = pointerTargetStructDef(rctx, row) ?? null;
    if (def) {
        return { ok: true, addr, byteCount: structByteSize(def, rctx.structs), def };
    }
    return { ok: true, addr, byteCount: Math.max(1, row.pointerTargetByteSize ?? 1), def: null };
}

function pointerChildExpandable(
    ctx: StructRenderContext,
    target: PointerDerefTarget,
): { ok: true; reason: string } | { ok: false; reason: string } {
    if (!target.ok) { return { ok: false, reason: target.reason }; }
    if (!target.def) { return { ok: false, reason: 'non-struct target' }; }
    if (ctx.pointerDepth >= MAX_INLINE_POINTER_HOPS) { return { ok: false, reason: 'max depth' }; }
    return { ok: true, reason: 'Expand' };
}

function structPointerHeaderHtml(
    ctx: StructRenderContext,
    row: DecodedField,
    key: string,
    name: string,
    target: PointerDerefTarget,
    isOpen: boolean,
): string {
    const storageStart = ctx.baseAddr + row.byteOffset;
    const valKey = fieldValueKey(row, storageStart);
    return (
        structPointerHeaderOpenTag(ctx, row, target, key, storageStart, valKey) +
        structPointerHeaderPrefixHtml(row, ctx.hideOffsets) +
        `<button class="si-arr-exp-btn" title="${isOpen ? 'Collapse group' : 'Expand group'}" aria-label="${isOpen ? 'Collapse group' : 'Expand group'}">›</button>` +
        structPointerHeaderBodyHtml(row, target, name, storageStart, valKey) +
        `</div>`
    );
}

function structPointerHeaderPrefixHtml(row: DecodedField, hideOffset: boolean): string {
    const byteCount = decodedRowByteCount(row);
    const abbrev = fieldTypeAbbrev(row, byteCount);
    const fullTypeLabel = fieldFullTypeLabel(row, byteCount);
    const offsetHtml = hideOffset
        ? '<span class="si-node-pad" aria-hidden="true"></span>'
        : `<span class="si-f-off">${offsetLabel(row.byteOffset)}</span>`;
    return offsetHtml + typeCellHtml(abbrev, fullTypeLabel);
}

function structPointerHeaderOpenTag(
    ctx: StructRenderContext,
    row: DecodedField,
    target: PointerDerefTarget,
    key: string,
    storageStart: number,
    valKey: string,
): string {
    const targetCnt = target.ok ? target.byteCount : 0;
    return structPointerOpenTag(ctx, row, target, key, storageStart, valKey, 'si-arr-grp-hdr si-ptr-hdr si-ptr-field', targetCnt);
}

function structPointerOpenTag(
    ctx: StructRenderContext,
    row: DecodedField,
    target: PointerDerefTarget,
    key: string,
    storageStart: number,
    valKey: string,
    className: string,
    targetCnt: number,
): string {
    const targetStart = target.addr ?? storageStart;
    const byteCount = decodedRowByteCount(row);
    return `<div class="${className}" data-byte-start="${storageStart}" data-byte-cnt="${byteCount}" ` +
        `data-offset-label="${offsetLabel(row.byteOffset)}" data-pointer-storage-start="${storageStart}" data-val-key="${esc(valKey)}"` +
        ` data-pointer-target-start="${targetStart}" data-pointer-target-cnt="${targetCnt}"` +
        ` data-pointer-allow-create="false"` +
        sourceContextDataAttrs(ctx) +
        ` data-arr-key="${esc(key)}">`;
}

function structPointerHeaderBodyHtml(
    row: DecodedField,
    target: PointerDerefTarget,
    name: string,
    storageStart: number,
    valKey: string,
): string {
    return `<span class="si-f-body">` +
        `<span class="si-f-name">${esc(name)}</span>` +
        `<span class="si-f-lead"></span>` +
        `<span class="si-f-val si-f-pri si-f-ptr" data-val-type="hex" data-bs="${storageStart}" data-val-key="${esc(valKey)}">${pointerValueDisplayHtml(row, target)}</span>` +
        `</span>`;
}

function pointerValueDisplayHtml(row: DecodedField, target: PointerDerefTarget): string {
    const addr = target.addr ?? 0;
    const addrHtml = formatHexHtml(formatHex(addr, 8));
    return target.ok ? `<span class="si-f-ptr-sym">→</span> ${addrHtml}` : pointerStatusAddressHtml(target, addrHtml);
}

function pointerStatusAddressHtml(target: Extract<PointerDerefTarget, { ok: false }>, addrHtml: string): string {
    return `<span class="si-f-ptr-note">(${esc(target.reason)})</span> ${addrHtml}`;
}

function structPointerBodyHtml(ctx: StructRenderContext, row: DecodedField, child: PointerChildState): string {
    return (
        `<div class="si-arr-grp${child.isOpen ? ' open' : ''}" data-arr-key="${esc(child.key)}">` +
        pointerChildHeaderHtml(ctx, row, child) +
        `<div class="si-arr-grp-body"${child.isOpen ? '' : ' style=\"display:none\"'}>${child.bodyHtml}</div>` +
        `</div>`
    );
}

function pointerChildHeaderHtml(ctx: StructRenderContext, row: DecodedField, child: PointerChildState): string {
    const storageStart = child.storageStart;
    const disabled = child.canExpand ? '' : ' disabled';
    return `<div class="si-arr-grp-hdr si-ptr-child-hdr si-ptr-field" data-byte-start="${child.byteStart}" data-byte-cnt="${child.byteCount}" ` +
        `data-pointer-storage-start="${storageStart}" data-val-key="${esc(child.valKey)}" data-pointer-allow-create="${child.allowCreate ? 'true' : 'false'}"` +
        sourceContextDataAttrs(ctx) +
        ` data-arr-key="${esc(child.key)}">` +
        compositeHeaderPrefixHtml(child.isOpen, row.byteOffset, true) +
        `<button class="si-arr-exp-btn"${disabled} title="${esc(child.expandTitle)}" aria-label="${esc(child.expandTitle)}">›</button>` +
        `<span class="si-f-body">` +
        `<span class="si-f-name">${esc(child.name)}</span>` +
        `<span class="si-f-lead"></span>` +
        `<span class="si-arr-addr" title="${esc(child.summaryTitle)}">${esc(child.summary)}</span>` +
        `</span>` +
        `</div>`;
}

function structPointerTargetBodyHtml(
    rctx: StructRenderCtx, ctx: StructRenderContext,
    row: DecodedField,
    target: Extract<PointerDerefTarget, { ok: true }>,
    childKey: string,
): string {
    if (!target.def) { return scalarPointerTargetFieldHtml(rctx, ctx, row, target); }
    const child = pointerChildState(rctx, ctx, row, target, childKey);
    return structPointerBodyHtml(ctx, row, child);
}

function scalarPointerTargetFieldHtml(
    rctx: StructRenderCtx, ctx: StructRenderContext,
    row: DecodedField,
    target: Extract<PointerDerefTarget, { ok: true }>,
): string {
    const targetRow = scalarPointerTargetDecodedRow(rctx, row, target.addr);
    return targetRow ? mkFieldRow(rctx, targetRow, target.addr, target.byteCount, scalarPointerTargetContext(ctx, target), '*') : '';
}

function scalarPointerTargetDecodedRow(rctx: StructRenderCtx, row: DecodedField, addr: number): DecodedField | null {
    const targetType = scalarPointerTargetType(row);
    if (!targetType || targetType === 'void') { return null; }
    const bytes = readScalarPointerTargetBytes(rctx, row, targetType, addr);
    return bytes ? scalarPointerTargetRow(rctx, row, targetType, bytes) : null;
}

function scalarPointerTargetContext(
    ctx: StructRenderContext,
    target: Extract<PointerDerefTarget, { ok: true }>,
): StructRenderContext {
    return {
        ...ctx,
        baseAddr: target.addr,
        pointerDepth: ctx.pointerDepth + 1,
        hideOffsets: true,
    };
}

function renderStructPointerBody(
    rctx: StructRenderCtx, ctx: StructRenderContext,
    key: string,
    target: { ok: true; addr: number; byteCount: number; def: StructDef },
): string {
    const rows = decodeStruct(target.def, target.addr, rctx.readByte, rctx.endian, rctx.bitFieldAllocation, rctx.structs);
    return renderStructFieldGroups(rctx, {
        def: target.def,
        pin: ctx.pin,
        baseAddr: target.addr,
        keyPrefix: key,
        pointerDepth: ctx.pointerDepth + 1,
        hideOffsets: false,
    }, rows);
}

function renderStructFieldBody(
    rctx: StructRenderCtx,
    ctx: StructRenderContext,
    group: RenderBodyGroup,
): string {
    const rule = bodyRuleFor(group);
    return rule ? rule(rctx, ctx, group) : '';
}
/** Resolve the struct-def a pointer row targets (moved from StructPanel). */
export function pointerTargetStructDef(rctx: StructRenderCtx, row: DecodedField): StructDef | undefined {
    if (row.pointerTargetType !== 'struct' || !row.pointerTargetStructId) { return undefined; }
    return allStructs(rctx.structs).find(candidate => candidate.id === row.pointerTargetStructId);
}

