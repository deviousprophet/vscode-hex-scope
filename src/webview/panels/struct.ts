/** Struct Overlay — UI layer
Single section rendered into #s-struct-pins.
Type management (create / edit / delete) is inline within that section.
Pure codec logic lives in struct-codec.ts. */

import { S }        from '../state';
import { esc, actionBtnsHtml, wireActionBtns, formatDecimal, formatHex, formatHexHtml, getBigUint64, getBigInt64, asUint64, positionContextMenu, wireHoverSubmenus } from '../utils';
import { vscode }   from '../api';
import { rerender } from '../render';
import { getByte }  from '../data';
import {
    FIELD_TYPES,
    fieldByteSize, structByteSize, decodeField, decodeStruct, allStructs, resolveStructFieldByPath,
    parseStructText, fieldsToText, structToC, validateStructs, MAX_NESTED_DEPTH,
    normalizeStructField,
} from '../../core/struct-codec.js';
import type { DecodedField } from '../../core/struct-codec.js';
import type { BitFieldChild, StructDef, StructField, StructFieldType, StructPin, StructPointerSource } from '../../core/types';

// ── Module state ──────────────────────────────────────────────────

/** Struct id currently selected in the add form. */
let _applyStructId: string | null = null;
/** Set of instance card ids that are expanded. */
const _expanded = new Set<string>();
/** Array field groups that are expanded. Key: `${pinId}::${baseName}`. Collapsed by default. */
const _expandedArrayFields = new Set<string>();
/** Nested element groups that are expanded. Key: `${pinId}::${baseName}::${idx}`. Collapsed by default. */
const _expandedArrayElements = new Set<string>();
const MAX_INLINE_POINTER_HOPS = 2;

type ColType = 'hex' | 'dec' | 'ascii' | 'bin' | 'bin-sliced' | 'ieee';
const FLOAT_FIELD_TYPES: ReadonlySet<StructFieldType> = new Set(['float32', 'float64']);
const RAW_HTML_VALUE_TYPES: ReadonlySet<ColType> = new Set(['bin', 'bin-sliced', 'ieee', 'hex']);
const TYPE_LABELS: Record<ColType, string> = {
    hex: 'Hex',
    dec: 'Decimal',
    bin: 'Binary',
    'bin-sliced': 'Binary (bit fields only)',
    ascii: 'ASCII',
    ieee: 'IEEE754',
};
const SAMPLE_TYPE_MENUS: Partial<Record<StructFieldType, ColType[]>> = {
    float32: ['hex', 'dec', 'ieee', 'bin'],
    float64: ['hex', 'dec', 'ieee', 'bin'],
    ascii: ['ascii', 'hex', 'bin'],
};
/** Default display type for value cells (per-field default). */
let _defaultValType: ColType = 'hex';
/** Per-value display override keyed by stable row identity. */
const _fieldValTypes = new Map<string, ColType>();
/** Whether the inline add-instance form is open. */
let _addingPin = false;
/** Byte start address of the currently highlighted field row. */
let _selectedFieldAddr: number | null = null;
/** Array group key of the currently highlighted array header. */
let _selectedArrKey: string | null = null;
/** Nested array element key of the currently highlighted element header. */
let _selectedArrElemKey: string | null = null;
/** Selected bit-field range to highlight on its parent bit-unit value. */
let _selectedBitRange: { parentByteStart: number; startBit: number; endBit: number } | null = null;
/** Hovered bit-field range to preview highlight on parent bit-unit value. */
let _hoveredBitRange: { parentByteStart: number; startBit: number; endBit: number } | null = null;
/** Selected bit-field child row identity: `${byteStart}:${bitStart}:${bitWidth}`. */
let _selectedBitRowKey: string | null = null;
/** Hovered bit-field child row identity: `${byteStart}:${bitStart}:${bitWidth}`. */
let _hoveredBitRowKey: string | null = null;
/** Byte start addresses marked with struct-arr-sep in the hex view. */
const _arrSepAddrs: number[] = [];
/** Pin id of the currently selected instance card. */
let _selectedPinId: string | null = null;
/** Pins whose type-definition preview is open inside the card. */
const _previewedPins = new Set<string>();
/** Whether the manage-types list view is open. */
let _managingTypes = false;
/** Pin id currently being edited inline (name/addr/type). */
let _editingPinId: string | null = null;
/** Struct type id selected in the inline instance-edit form (may differ from the saved pin). */
let _editingPinDraftStructId: string | null = null;
/**
 * When non-null the section is in "type editor" mode.
 * `existing` is null for new types, or the original def being edited.
 * `draft`    holds the working copy being modified.
 * `fromAdd`  is true when the editor was opened from the add-instance form.
 * `fromManage` is true when opened from the manage-types list.
 */
let _editingType: { draft: StructDef; existing: StructDef | null; fromAdd: boolean; fromManage: boolean } | null = null;
let _editorError: string | null = null;

// ── Inline type editor helpers ────────────────────────────────────

function sanitizeCIdent(raw: string): string {
    return raw.replace(/[^A-Za-z0-9_]/g, '').replace(/^(\d)/, '_$1');
}

function isBitFieldRow(r: DecodedField): boolean {
    return r.isBitField === true && typeof r.bitWidth === 'number';
}

/** Calculate total bits used by all children in a bit-field container. */
function usedBitsInContainer(f: import('../../core/types').StructField): number {
    if (!Array.isArray(f.bitFields)) {
        return 0;
    }
    return f.bitFields.reduce((sum, child) => sum + child.bitWidth, 0);
}

/** Calculate available bits remaining in a bit-field container. */
function availableBitsInContainer(f: import('../../core/types').StructField): number {
    if (!isUnsignedScalarType(f.type)) { return 0; }
    const typeBytes = fieldByteSize(f.type);
    const totalBits = typeBytes * 8;
    const usedBits = usedBitsInContainer(f);
    return totalBits - usedBits;
}

function renderBitSpan(bit: string, idx: number, selected: boolean): string {
    const sel = selected ? ' sel' : '';
    return `<span class="si-bit ${bit === '1' ? 'one' : 'zero'}${sel}" data-bit-idx="${idx}">${bit}</span>`;
}

function renderUnknownBitSpan(bitIdx: number, selected: boolean): string {
    return `<span class="si-bit unknown${selected ? ' sel' : ''}" data-bit-idx="${bitIdx}">?</span>`;
}

function isBitSelected(
    bitIdx: number,
    selectedRange?: { startBit: number; endBit: number } | null,
): boolean {
    return !!selectedRange && bitIdx >= selectedRange.startBit && bitIdx <= selectedRange.endBit;
}

function byteHexParts(bytesHex: string): string[] {
    return bytesHex.split(' ').map(p => p.trim()).filter(Boolean);
}

function hasMissingByte(parts: string[]): boolean {
    return parts.length === 0 || parts.some(p => p === '??');
}

function bytesFromHexParts(parts: string[]): number[] {
    return parts.map(h => parseInt(h, 16));
}

function bytesToValue(raw: number[], endian: 'le' | 'be'): bigint {
    let value = 0n;
    if (endian === 'le') {
        for (let i = 0; i < raw.length; i++) {
            value |= BigInt(raw[i]) << BigInt(i * 8);
        }
        return value;
    }
    for (const b of raw) {
        value = (value << 8n) | BigInt(b);
    }
    return value;
}

function makeBitRowKey(byteStart: number, bitStart: number, bitWidth: number): string {
    return `${byteStart}:${bitStart}:${bitWidth}`;
}

function scalarValKey(byteStart: number): string {
    return `byte:${byteStart}`;
}

function bitChildValKey(byteStart: number, bitStart: number, bitWidth: number): string {
    return `bit:${makeBitRowKey(byteStart, bitStart, bitWidth)}`;
}

function bitUnitValKey(byteStart: number): string {
    return `bitunit:${byteStart}`;
}

function bitRowWidth(row: DecodedField | null | undefined): number {
    return isBitFieldRow(row as DecodedField) ? row?.bitWidth ?? 0 : 0;
}

function bitUnitUsesFullStorage(rows: DecodedField[]): boolean {
    const first = rows[0];
    if (!first || !isBitFieldRow(first)) { return false; }
    const usedBits = rows.reduce((sum, row) => sum + bitRowWidth(row), 0);
    const storageBits = (first.bitStorageByteSize ?? fieldByteSize(first.type)) * 8;
    return usedBits >= storageBits;
}

function binaryGroupsLowBitsFirst(bits: string): string[] {
    const groups: string[] = [];
    for (let end = bits.length; end > 0; end -= 4) {
        groups.unshift(bits.slice(Math.max(0, end - 4), end));
    }
    return groups;
}

function renderBinarySpanLines(spans: string[]): string {
    const groups: string[] = [];
    for (let i = 0; i < spans.length; i += 4) {
        groups.push(spans.slice(i, i + 4).join(''));
    }

    const lines: string[] = [];
    for (let i = 0; i < groups.length; i += 4) {
        lines.push(groups.slice(i, i + 4).join(' '));
    }
    return `<span class="si-bin-wrap">${lines.join('<br>')}</span>`;
}

function binaryBitsForValue(bytes: number[], endian: 'le' | 'be'): string {
    return bytesToValue(bytes, endian).toString(2).padStart(bytes.length * 8, '0');
}

function renderPlainBinaryBits(bits: string): string {
    return renderBinarySpanLines([...bits].map((bit, idx) => renderBitSpan(bit, idx, false)));
}

function formatPlainBinaryBits(bits: string): string {
    const groups = bits.match(/.{1,4}/g) || [];
    return groups.join(' ');
}

function singleLineCopyText(text: string): string {
    return text.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseDatasetInt(value: string | undefined): number | null {
    const parsed = parseInt(value ?? '', 10);
    return Number.isFinite(parsed) ? parsed : null;
}

function parsePositiveDatasetInt(value: string | undefined): number | null {
    const parsed = parseDatasetInt(value);
    return parsed !== null && parsed > 0 ? parsed : null;
}

function parseBitRowMeta(row: HTMLElement): { byteStart: number; bitStart: number; bitWidth: number } | null {
    const byteStart = parseDatasetInt(row.dataset.byteStart);
    if (byteStart === null) { return null; }
    const bitStart = parseDatasetInt(row.dataset.bitStart);
    if (bitStart === null) { return null; }
    const bitWidth = parsePositiveDatasetInt(row.dataset.bitWidth);
    if (bitWidth === null) { return null; }
    return { byteStart, bitStart, bitWidth };
}

function applyBitHighlightsInPlace(sec: HTMLElement): void {
    sec.querySelectorAll<HTMLElement>('.si-bit.hov').forEach(el => el.classList.remove('hov'));
    sec.querySelectorAll<HTMLElement>('.si-bit.sel').forEach(el => el.classList.remove('sel'));

    const applyRange = (
        range: { parentByteStart: number; startBit: number; endBit: number } | null,
        cls: 'sel' | 'hov',
    ) => {
        if (!range) { return; }
        const parentVal = sec.querySelector<HTMLElement>(
            `.si-arr-grp-hdr.si-bitunit-hdr[data-byte-start="${range.parentByteStart}"] .si-f-val[data-val-type="bin"], ` +
            `.si-arr-grp-hdr.si-bitunit-hdr[data-byte-start="${range.parentByteStart}"] .si-f-val[data-val-type="bin-sliced"], ` +
            `.si-arr-el-hdr.si-bitunit-hdr[data-byte-start="${range.parentByteStart}"] .si-f-val[data-val-type="bin"], ` +
            `.si-arr-el-hdr.si-bitunit-hdr[data-byte-start="${range.parentByteStart}"] .si-f-val[data-val-type="bin-sliced"]`
        );
        if (!parentVal) { return; }
        for (let i = range.startBit; i <= range.endBit; i++) {
            parentVal.querySelector<HTMLElement>(`.si-bit[data-bit-idx="${i}"]`)?.classList.add(cls);
        }
    };

    applyRange(_selectedBitRange, 'sel');
    applyRange(_hoveredBitRange, 'hov');
}

function renderBinaryFromBitRows(
    rows: DecodedField[],
    selectedRange?: { startBit: number; endBit: number } | null,
): string {
    const usedWidth = rows.reduce((sum, r) => sum + Math.max(0, r.bitWidth ?? 0), 0);
    const first = rows[0];
    if (!first || usedWidth <= 0) {
        return '<span class="si-bin-wrap"></span>';
    }
    const rawParts = byteHexParts(first.bytesHex);
    if (hasBitRowData(first, rawParts)) {
        return renderKnownBitRowBits(rawParts, usedWidth, selectedRange);
    }
    return renderUnknownBitRowBits(usedWidth, selectedRange);
}

function hasBitRowData(first: DecodedField, rawParts: string[]): boolean {
    return first.hasData && !hasMissingByte(rawParts);
}

function renderKnownBitRowBits(rawParts: string[], usedWidth: number, selectedRange?: { startBit: number; endBit: number } | null): string {
    const bits = slicedBitRowBits(rawParts, usedWidth);
    const spans = [...bits].map((bit, displayIdx) => {
        const bitIdx = displayBitIndex(displayIdx, usedWidth);
        return renderBitSpan(bit, bitIdx, isBitSelected(bitIdx, selectedRange));
    });
    return renderBinarySpanLines(spans);
}

function slicedBitRowBits(rawParts: string[], usedWidth: number): string {
    const raw = bytesFromHexParts(rawParts);
    const value = bytesToValue(raw, S.endian);
    const unitBits = raw.length * 8;
    const mask = (1n << BigInt(usedWidth)) - 1n;
    const slicedValue = S.bitFieldAllocation === 'lsb'
        ? value & mask
        : (value >> BigInt(Math.max(0, unitBits - usedWidth))) & mask;
    return slicedValue.toString(2).padStart(usedWidth, '0');
}

function renderUnknownBitRowBits(usedWidth: number, selectedRange?: { startBit: number; endBit: number } | null): string {
    const spans = Array.from({ length: usedWidth }, (_, displayIdx) => {
        const bitIdx = displayBitIndex(displayIdx, usedWidth);
        return renderUnknownBitSpan(bitIdx, isBitSelected(bitIdx, selectedRange));
    });
    return renderBinarySpanLines(spans);
}

function displayBitIndex(displayIdx: number, usedWidth: number): number {
    return S.bitFieldAllocation === 'lsb' ? usedWidth - displayIdx - 1 : displayIdx;
}

function renderBinaryStorageUnit(
    r: DecodedField,
    selectedRange?: { startBit: number; endBit: number } | null,
): string {
    const rawParts = byteHexParts(r.bytesHex);
    if (hasMissingByte(rawParts)) {
        const byteCount = r.bitStorageByteSize ?? (rawParts.length || 1);
        const bitCount = byteCount * 8;
        const spans = Array.from({ length: bitCount }, (_, displayIdx) => {
            const numericBitIdx = bitCount - displayIdx - 1;
            const bitIdx = S.bitFieldAllocation === 'lsb' ? numericBitIdx : displayIdx;
            return renderUnknownBitSpan(bitIdx, isBitSelected(bitIdx, selectedRange));
        });
        return renderBinarySpanLines(spans);
    }

    const bytes = bytesFromHexParts(rawParts);
    const bitCount = bytes.length * 8;
    const bits = binaryBitsForValue(bytes, S.endian);
    const spans = [...bits].map((bit, displayIdx) => {
        const numericBitIdx = bitCount - displayIdx - 1;
        const storageBitIdx = S.bitFieldAllocation === 'lsb' ? numericBitIdx : displayIdx;
        return renderBitSpan(bit, storageBitIdx, isBitSelected(storageBitIdx, selectedRange));
    });

    return renderBinarySpanLines(spans);
}

function fieldTypeOptionsHtml(f: StructField, draftId: string): string {
    f = normalizeStructField(f);
    const scalarOptions = FIELD_TYPES.map(t =>
        `<option value="${t}"${f.type === t ? ' selected' : ''}>${t}</option>`
    ).join('');
    const structOptions = allStructs(S.structs)
        .filter(d => d.id !== draftId)
        .map(d => structOptionHtml(f, d))
        .join('');
    return `<optgroup label="Scalar">${scalarOptions}</optgroup>` +
        (structOptions ? `<optgroup label="Struct">${structOptions}</optgroup>` : '');
}

function structOptionHtml(f: StructField, d: StructDef): string {
    f = normalizeStructField(f);
    const val = `struct:${d.id}`;
    const selected = f.type === 'struct' && f.refStructId === d.id;
    return `<option value="${esc(val)}"${selected ? ' selected' : ''}>struct ${esc(d.name)}</option>`;
}

function isBitContainerField(f: StructField): boolean {
    f = normalizeStructField(f);
    if (f.isPointer) { return false; }
    return isUnsignedScalarType(f.type) && Array.isArray(f.bitFields) && f.bitFields.length > 0;
}

function bitChildrenHtml(f: StructField, isBitContainer: boolean): string {
    if (!isBitContainer) { return ''; }
    const bitFields = f.bitFields ?? [];
    const childRows = bitFields.map((child, ci) => childFieldRowHtml(child, ci, bitFields.length)).join('');
    const remainingBits = availableBitsInContainer(f);
    const { addBtnDisabled, addBtnTitle } = bitChildButtonState(remainingBits);
    return (
        `<div class="sfe-bf-children"${f.bitFieldsCollapsed === true ? ' style="display:none"' : ''}>` +
        childRows +
        `<button class="sfe-bf-add-child" title="${addBtnTitle}"${addBtnDisabled}>+ Add bit</button>` +
        `</div>`
    );
}

function bitChildButtonState(remainingBits: number): { addBtnDisabled: string; addBtnTitle: string } {
    return {
        addBtnDisabled: remainingBits > 0 ? '' : ' disabled',
        addBtnTitle: remainingBits > 0 ? 'Add bit-field child' : 'No bits remaining in parent',
    };
}

function deleteFieldCellHtml(isOnly: boolean): string {
    return isOnly
        ? `<span class="sfe-del-placeholder"></span>`
        : `<button class="sfe-del-btn" title="Remove field">\u2715</button>`;
}

function disabledAttr(isDisabled: boolean): string {
    return isDisabled ? ' disabled' : '';
}

function activeClassAttr(isActive: boolean): string {
    return isActive ? ' active' : '';
}

function fieldArrayCellHtml(f: StructField): string {
    const isArr = f.count > 1;
    return (
        `<div class="sfe-arr-cell${isArr ? ' is-array' : ''}">` +
        `<button class="sfe-arr-toggle${activeClassAttr(isArr)}" title="${isArr ? 'Remove array' : 'Make array'}">[ ]</button>` +
        `<input class="sfe-count-inp" type="text" inputmode="numeric" ` +
               `value="${isArr ? f.count : ''}" placeholder="N" maxlength="3">` +
        `</div>`
    );
}

function fieldBitToggleHtml(f: StructField, isBitContainer: boolean): string {
    f = normalizeStructField(f);
    const isUnsigned = isUnsignedScalarType(f.type);
    const bitBtnClass = isUnsigned && isBitContainer ? ' sfe-bit-btn-on' : '';
    return `<button class="sfe-bit-btn${bitBtnClass}" title="Toggle bit-field details"${disabledAttr(!isUnsigned || f.isPointer === true)}>:N</button>`;
}

function fieldPointerToggleHtml(f: StructField, isBitContainer: boolean): string {
    f = normalizeStructField(f);
    const active = f.isPointer === true;
    const disabled = isBitContainer;
    return `<button class="sfe-ptr-btn${activeClassAttr(active)}" title="Toggle pointer field"${disabledAttr(disabled)}>*</button>`;
}

function fieldMoveButtonsHtml(i: number, total: number): string {
    return (
        `<div class="sfe-move-btns">` +
        `<button class="sfe-move-btn sfe-move-up" title="Move up"${disabledAttr(i === 0)}>&#x2192;</button>` +
        `<button class="sfe-move-btn sfe-move-dn" title="Move down"${disabledAttr(i === total - 1)}>&#x2192;</button>` +
        `</div>`
    );
}

function fieldRowHtml(
    f: StructField,
    i: number,
    isOnly: boolean,
    total: number,
    draftId: string,
): string {
    const typeOpts = fieldTypeOptionsHtml(f, draftId);
    const isBitContainer = isBitContainerField(f);
    const delCell = deleteFieldCellHtml(isOnly);
    const childrenHtml = bitChildrenHtml(f, isBitContainer);

    return (
        `<div class="struct-field-row${isBitContainer ? ' has-bit-children' : ''}" data-idx="${i}">` +
        `<select class="sfe-type-sel">${typeOpts}</select>` +
        fieldPointerToggleHtml(f, isBitContainer) +
        `<input class="sfe-name-inp" type="text" value="${esc(f.name)}" maxlength="64" ` +
               `placeholder="fieldName" spellcheck="false" autocomplete="off">` +
        fieldBitToggleHtml(f, isBitContainer) +
        fieldArrayCellHtml(f) +
        fieldMoveButtonsHtml(i, total) +
        delCell +
        childrenHtml +
        `</div>`
    );
}

/** Render a single bit-field child row inside a bit-field container parent. */
function childFieldRowHtml(child: BitFieldChild, ci: number, total: number): string {
    const upDis  = ci === 0        ? ' disabled' : '';
    const dnDis  = ci === total - 1 ? ' disabled' : '';
    const delCell = total <= 1
        ? `<span class="sfe-del-placeholder"></span>`
        : `<button class="sfe-bf-del-child" title="Remove child">\u2715</button>`;
    return (
        `<div class="sfe-bf-child-row" data-child-idx="${ci}">` +
        `<span class="sfe-bf-child-indent"></span>` +
        `<input class="sfe-bf-child-name" type="text" value="${esc(child.name)}" maxlength="64" ` +
               `placeholder="bit${ci}" spellcheck="false" autocomplete="off">` +
        `<input class="sfe-bf-child-width" type="text" inputmode="numeric" value="${child.bitWidth}" ` +
               `placeholder="N" maxlength="2">` +
        `<span class="sfe-bf-child-unit">bit</span>` +
        `<div class="sfe-bf-child-move">` +
        `<button class="sfe-move-btn sfe-move-up" title="Move up"${upDis}>&#x2192;</button>` +
        `<button class="sfe-move-btn sfe-move-dn" title="Move down"${dnDis}>&#x2192;</button>` +
        `</div>` +
        delCell +
        `</div>`
    );
}

/** Check if a field type is an unsigned scalar (eligible for bit-field container). */
function isUnsignedScalarType(type: import('../../core/types').StructFieldType): type is import('../../core/types').StructScalarFieldType {
    return type === 'uint8' || type === 'uint16' || type === 'uint32' || type === 'uint64';
}

/** Get bit capacity for a parent field type. */
function getParentBitCapacity(type: import('../../core/types').StructFieldType): number {
    return fieldByteSize(type as any) * 8;
}

// ── C syntax-highlighted struct preview ─────────────────────────────────────

const SC_KW   = /\b(typedef|struct)\b/g;
const SC_ATTR = /__attribute__\(\(packed\)\)/g;

function buildStructCPreviewNodes(def: StructDef): DocumentFragment {
    const out = document.createDocumentFragment();
    const nameEscRe = (def.name || 'MyStruct').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const nestedTypeNames = def.fields
        .filter(f => f.type === 'struct' && f.refStructId)
        .map(f => allStructs(S.structs).find(d => d.id === f.refStructId)?.name)
        .filter((n): n is string => typeof n === 'string')
        .map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const typeUnion = [
        'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t',
        'int8_t', 'int16_t', 'int32_t', 'int64_t',
        'float', 'double', 'void', 'char',
        nameEscRe,
        ...nestedTypeNames,
    ].join('|');
    const scTyp = new RegExp(`\\b(${typeUnion})\\b`, 'g');

    const appendText = (parent: DocumentFragment | HTMLElement, text: string) => {
        parent.appendChild(document.createTextNode(text));
    };

    const appendTokenizedCode = (parent: DocumentFragment | HTMLElement, code: string) => {
        // Tokenize into spans/text nodes so user text is never parsed as HTML.
        const tokenRe = new RegExp(`${SC_ATTR.source}|${SC_KW.source}|${scTyp.source}`, 'g');
        let lastIdx = 0;
        let m: RegExpExecArray | null;
        while ((m = tokenRe.exec(code)) !== null) {
            const idx = m.index;
            if (idx > lastIdx) { appendText(parent, code.slice(lastIdx, idx)); }
            const tok = m[0];
            const span = document.createElement('span');
            span.className = structCodeTokenClass(tok);
            span.textContent = tok;
            parent.appendChild(span);
            lastIdx = idx + tok.length;
        }
        if (lastIdx < code.length) { appendText(parent, code.slice(lastIdx)); }
    };

    const lines = structToC(def, S.structs).split('\n');
    lines.forEach((line, i) => {
        appendStructPreviewLine(out, line, i, lines.length, appendTokenizedCode);
    });

    return out;
}

function appendStructPreviewLine(
    out: DocumentFragment,
    line: string,
    idx: number,
    lineCount: number,
    appendTokenizedCode: (parent: DocumentFragment | HTMLElement, code: string) => void,
): void {
    const parts = structPreviewLineParts(line);
    if (isPaddingPreviewLine(parts.code)) {
        appendPaddingPreviewLine(out, line, parts.code);
    } else {
        appendTokenizedCode(out, parts.code);
        appendPreviewComment(out, parts.cmt);
    }
    appendPreviewLineBreak(out, idx, lineCount);
}

function structPreviewLineParts(line: string): { code: string; cmt: string } {
    const ci = line.indexOf('/*');
    if (ci < 0) { return { code: line, cmt: '' }; }
    return { code: line.slice(0, ci), cmt: line.slice(ci) };
}

function isPaddingPreviewLine(code: string): boolean {
    return /\b_pad\w+/.test(code);
}

function appendPreviewLineBreak(out: DocumentFragment, idx: number, lineCount: number): void {
    if (idx < lineCount - 1) { appendPreviewText(out, '\n'); }
}

function appendPaddingPreviewLine(out: DocumentFragment, line: string, code: string): void {
    const n = code.match(/_pad\w+\[(\d+)\]/)?.[1] ?? '?';
    const indent = line.slice(0, line.length - line.trimStart().length);
    appendPreviewText(out, indent);
    appendPreviewComment(out, `/* ${n} byte${n === '1' ? '' : 's'} padding */`);
}

function appendPreviewComment(out: DocumentFragment, cmt: string): void {
    if (!cmt) { return; }
    const span = document.createElement('span');
    span.className = 'sc-cmt';
    span.textContent = cmt;
    out.appendChild(span);
}

function appendPreviewText(parent: DocumentFragment | HTMLElement, text: string): void {
    parent.appendChild(document.createTextNode(text));
}

function structCodeTokenClass(tok: string): string {
    if (tok === '__attribute__((packed))') { return 'sc-attr'; }
    if (tok === 'typedef' || tok === 'struct') { return 'sc-kw'; }
    return 'sc-type';
}

function renderStructCPreview(pre: HTMLElement, def: StructDef): void {
    pre.replaceChildren(buildStructCPreviewNodes(def));
}

function hydrateStructPreviews(root: HTMLElement): void {
    root.querySelectorAll<HTMLElement>('.si-c-preview[data-struct-preview-id]').forEach(pre => {
        const id = pre.dataset.structPreviewId;
        if (!id) { return; }
        const def = (_editingType?.draft.id === id)
            ? _editingType.draft
            : allStructs(S.structs).find(d => d.id === id);
        if (!def) {
            pre.textContent = '';
            return;
        }
        renderStructCPreview(pre, def);
    });
}

function editorHtml(draft: StructDef, existing: StructDef | null): string {
    const n = draft.fields.length;
    const fieldRows = draft.fields.map((f, i) => fieldRowHtml(f, i, n === 1, n, draft.id)).join('');
    const errorHtml = _editorError ? `<div class="se-error">${esc(_editorError)}</div>` : '';
    return (
        `<div class="si-editor-wrap">` +
        `<div class="se-form">` +
        `<input id="se-name" class="se-name-inp" type="text" value="${esc(draft.name)}" ` +
               `maxlength="64" placeholder="TypeName" spellcheck="false" autocomplete="off">` +
        `<button id="se-packed" class="se-packed-btn${draft.packed ? ' active' : ''}" ` +
               `title="Toggle packed struct">__attribute__((packed))</button>` +
         `<div class="se-field-hdr"><span>Type</span><span>Ptr</span><span>Name</span><span>Bits</span><span>[ ]</span><span></span></div>` +
        `<div id="se-fields">${fieldRows}</div>` +
        `<button id="se-add" class="struct-add-field-btn">+ Add Field</button>` +
        errorHtml +
        `<div class="se-btns">` +
        `<button id="se-save" class="struct-btn struct-btn-apply">Save</button>` +
        `<button id="se-cancel" class="struct-btn struct-btn-secondary">Cancel</button>` +
        `</div>` +
        `<div id="se-preview" class="se-preview"><pre class="si-c-preview" data-struct-preview-id="${esc(draft.id)}"></pre></div>` +
        `</div>` +
        `</div>`
    );
}

function syncEditorDraft(sec: HTMLElement, draft: StructDef): void {
    draft.name   = sanitizeCIdent((sec.querySelector<HTMLInputElement>('#se-name'))?.value.trim() ?? '');
    draft.packed = sec.querySelector('#se-packed')?.classList.contains('active') ?? false;
    const rows = sec.querySelectorAll<HTMLElement>('.struct-field-row');
    draft.fields = Array.from(rows).map(row => {
        return readEditorFieldRow(row);
    });
}

function readEditorFieldRow(row: HTMLElement): StructField {
    const typeInfo = readEditorFieldType(row);
    const childrenContainer = row.querySelector<HTMLElement>('.sfe-bf-children');
    const result: StructField = {
        name: sanitizeCIdent((row.querySelector('.sfe-name-inp') as HTMLInputElement).value),
        type: typeInfo.type,
        refStructId: typeInfo.refStructId,
        isPointer: typeInfo.isPointer || undefined,
        count: readEditorArrayCount(row),
    };
    applyEditorBitFields(result, readEditorBitFields(row, typeInfo.isUnsigned, childrenContainer), childrenContainer);
    return result;
}

function readEditorFieldType(row: HTMLElement): { type: StructFieldType; refStructId: string | undefined; isUnsigned: boolean; isPointer: boolean } {
    const rawType = (row.querySelector('.sfe-type-sel') as HTMLSelectElement).value;
    const parsed = parseEditorFieldType(rawType);
    const ptrActive = row.querySelector<HTMLElement>('.sfe-ptr-btn')?.classList.contains('active') ?? false;
    return {
        ...parsed,
        isUnsigned: isUnsignedEditorParsedType(parsed),
        isPointer: ptrActive || parsed.type === 'void',
    };
}

function parseEditorFieldType(rawType: string): { type: StructFieldType; refStructId: string | undefined } {
    return rawType.startsWith('struct:')
        ? { type: 'struct', refStructId: rawType.slice('struct:'.length) }
        : { type: rawType as StructFieldType, refStructId: undefined };
}

function isUnsignedEditorParsedType(parsed: { type: StructFieldType; refStructId: string | undefined }): boolean {
    return parsed.type !== 'struct' && isUnsignedScalarType(parsed.type);
}

function readEditorBitFields(row: HTMLElement, isUnsigned: boolean, childrenContainer: HTMLElement | null): BitFieldChild[] | undefined {
    if (!isEditorBitFieldEnabled(row, isUnsigned, childrenContainer)) { return undefined; }
    const childRows = childrenContainer.querySelectorAll<HTMLElement>('.sfe-bf-child-row');
    const childArray = Array.from(childRows).map(readEditorBitFieldChild);
    return childArray.length > 0 ? childArray : [{ name: 'bit0', bitWidth: 1 }];
}

function isEditorBitFieldEnabled(row: HTMLElement, isUnsigned: boolean, childrenContainer: HTMLElement | null): childrenContainer is HTMLElement {
    if (!isUnsigned || !childrenContainer) { return false; }
    return row.querySelector('.sfe-bit-btn')?.classList.contains('sfe-bit-btn-on') ?? false;
}

function readEditorBitFieldChild(childRow: HTMLElement): BitFieldChild {
    const childName = sanitizeCIdent(
        (childRow.querySelector('.sfe-bf-child-name') as HTMLInputElement).value
    ) || `bit${childRow.dataset.childIdx || '0'}`;
    const childWidthRaw = (childRow.querySelector('.sfe-bf-child-width') as HTMLInputElement).value;
    const childWidth = parseInt(childWidthRaw, 10);
    return {
        name: childName,
        bitWidth: childWidth > 0 ? Math.min(childWidth, 64) : 1,
    };
}

function readEditorArrayCount(row: HTMLElement): number {
    const cell = row.querySelector<HTMLElement>('.sfe-arr-cell')!;
    if (!cell.classList.contains('is-array')) { return 1; }
    const v = parseInt((row.querySelector('.sfe-count-inp') as HTMLInputElement).value);
    return isNaN(v) || v < 1 ? 1 : Math.min(v, 256);
}

function applyEditorBitFields(result: StructField, bitFields: BitFieldChild[] | undefined, childrenContainer: HTMLElement | null): void {
    if (!bitFields || bitFields.length === 0) { return; }
    result.bitFields = bitFields;
    if (childrenContainer?.style.display === 'none') { result.bitFieldsCollapsed = true; }
}

function wireEditorInSec(sec: HTMLElement): void {
    if (!_editingType) { return; }
    const { draft } = _editingType;

    sec.querySelector('#se-packed')!.addEventListener('click', () => {
        const btn = sec.querySelector('#se-packed')!;
        const nowPacked = !btn.classList.contains('active');
        btn.classList.toggle('active', nowPacked);
        draft.packed = nowPacked;
        refreshEditorPreview(sec, draft);
    });

    function refreshEditorPreview(s: HTMLElement, d: StructDef): void {
        syncEditorDraft(s, d);
        const pre = s.querySelector<HTMLElement>('#se-preview pre');
        if (pre) { renderStructCPreview(pre, d); }
    }

    function syncedFieldForButton(btn: HTMLElement): { row: HTMLElement; idx: number; field: StructField | undefined } {
        const row = btn.closest<HTMLElement>('.struct-field-row')!;
        syncEditorDraft(sec, draft);
        const idx = parseInt(row.dataset.idx!);
        return { row, idx, field: draft.fields[idx] };
    }

    type StructFieldWithBits = StructField & { bitFields: NonNullable<StructField['bitFields']> };
    function syncedBitFieldChild(btn: HTMLElement): { childRow: HTMLElement; field: StructFieldWithBits; childIdx: number } | null {
        const childRow = btn.closest<HTMLElement>('.sfe-bf-child-row')!;
        const parentRow = childRow.closest<HTMLElement>('.struct-field-row')!;
        syncEditorDraft(sec, draft);
        const idx = parseInt(parentRow.dataset.idx!);
        const field = draft.fields[idx];
        if (!field?.bitFields) { return null; }
        return { childRow, field: field as StructFieldWithBits, childIdx: parseInt(childRow.dataset.childIdx!) };
    }

    sec.querySelector('#se-add')!.addEventListener('click', () => {
        syncEditorDraft(sec, draft);
        _editorError = null;
        draft.fields.push({ name: `field${draft.fields.length}`, type: 'uint8', count: 1 });
        renderStructPins();
    });

    sec.querySelectorAll<HTMLElement>('.sfe-del-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            syncEditorDraft(sec, draft);
            _editorError = null;
            const row = btn.closest<HTMLElement>('.struct-field-row')!;
            draft.fields.splice(parseInt(row.dataset.idx!), 1);
            renderStructPins();
        });
    });

    sec.querySelectorAll<HTMLElement>('.sfe-move-up').forEach(btn => {
        btn.addEventListener('click', () => {
            const { idx } = syncedFieldForButton(btn);
            _editorError = null;
            if (idx > 0) {
                [draft.fields[idx - 1], draft.fields[idx]] = [draft.fields[idx], draft.fields[idx - 1]];
                renderStructPins();
            }
        });
    });

    sec.querySelectorAll<HTMLElement>('.sfe-move-dn').forEach(btn => {
        btn.addEventListener('click', () => {
            const { idx } = syncedFieldForButton(btn);
            _editorError = null;
            if (idx < draft.fields.length - 1) {
                [draft.fields[idx], draft.fields[idx + 1]] = [draft.fields[idx + 1], draft.fields[idx]];
                renderStructPins();
            }
        });
    });

    sec.querySelectorAll<HTMLElement>('.sfe-arr-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            const cell = btn.closest<HTMLElement>('.sfe-arr-cell')!;
            const nowArr = !cell.classList.contains('is-array');
            cell.classList.toggle('is-array', nowArr);
            btn.classList.toggle('active', nowArr);
            btn.title = nowArr ? 'Remove array' : 'Make array';
            if (nowArr) {
                const inp = cell.querySelector<HTMLInputElement>('.sfe-count-inp')!;
                if (!inp.value) { inp.value = '2'; }
                inp.focus(); inp.select();
            }
            refreshEditorPreview(sec, draft);
        });
    });

    sec.querySelectorAll<HTMLElement>('.sfe-ptr-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            handlePointerToggleClick(sec, draft, btn);
        });
    });

    sec.querySelectorAll<HTMLInputElement>('.sfe-count-inp').forEach(inp => {
        inp.addEventListener('input', () => {
            inp.value = inp.value.replace(/\D/g, '').slice(0, 3);
            refreshEditorPreview(sec, draft);
        });
    });

    // ── Bit-field :N toggle button ─────────────────────────────────
    sec.querySelectorAll<HTMLElement>('.sfe-bit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const { row, field: f } = syncedFieldForButton(btn);
            if (!f) { return; }
            const isOn = btn.classList.contains('sfe-bit-btn-on');
            if (isOn) {
                // Toggle OFF: remove bitFields
                btn.classList.remove('sfe-bit-btn-on');
                delete f.bitFields;
                delete f.bitFieldsCollapsed;
                const children = row.querySelector<HTMLElement>('.sfe-bf-children');
                if (children) { children.remove(); }
                row.classList.remove('has-bit-children');
            } else {
                // Toggle ON: create default first child with 1 bit width
                btn.classList.add('sfe-bit-btn-on');
                row.classList.add('has-bit-children');
                f.bitFields = [{ name: 'bit0', bitWidth: 1 }];
                f.bitFieldsCollapsed = undefined;
            }
            // Update preview without re-syncing (refreshEditorPreview would overwrite our changes)
            renderBitFieldTogglePreview(sec, draft);
            renderStructPins();  // Re-render to show/hide child rows
        });
    });

    // ── Bit-field child: add ────────────────────────────────────
    sec.querySelectorAll<HTMLElement>('.sfe-bf-add-child').forEach(btn => {
        btn.addEventListener('click', () => {
            const { field: f } = syncedFieldForButton(btn);
            if (!f) { return; }
            if (!f.bitFields) { f.bitFields = []; }
            const nextIdx = f.bitFields.length;
            f.bitFields.push({ name: `bit${nextIdx}`, bitWidth: 1 });
            renderStructPins();
        });
    });

    // ── Bit-field child: delete ─────────────────────────────────
    sec.querySelectorAll<HTMLElement>('.sfe-bf-del-child').forEach(btn => {
        btn.addEventListener('click', () => {
            const child = syncedBitFieldChild(btn);
            if (!child) { return; }
            const { field: f, childIdx: ci } = child;
            f.bitFields.splice(ci, 1);
            if (f.bitFields.length === 0) {
                // Empty containers auto-recover with a 1-bit child.
                f.bitFields.push({ name: 'bit0', bitWidth: 1 });
            }
            renderStructPins();
        });
    });

    // ── Bit-field child: reorder up ─────────────────────────────
    sec.querySelectorAll<HTMLElement>('.sfe-bf-child-row .sfe-move-up').forEach(btn => {
        btn.addEventListener('click', () => {
            const child = syncedBitFieldChild(btn);
            if (!child) { return; }
            const { field: f, childIdx: ci } = child;
            if (ci > 0) {
                [f.bitFields[ci - 1], f.bitFields[ci]] = [f.bitFields[ci], f.bitFields[ci - 1]];
                renderStructPins();
            }
        });
    });

    // ── Bit-field child: reorder down ───────────────────────────
    sec.querySelectorAll<HTMLElement>('.sfe-bf-child-row .sfe-move-dn').forEach(btn => {
        btn.addEventListener('click', () => {
            const child = syncedBitFieldChild(btn);
            if (!child) { return; }
            const { field: f, childIdx: ci } = child;
            if (ci < f.bitFields.length - 1) {
                [f.bitFields[ci], f.bitFields[ci + 1]] = [f.bitFields[ci + 1], f.bitFields[ci]];
                renderStructPins();
            }
        });
    });

    sec.querySelectorAll<HTMLInputElement>('.sfe-name-inp').forEach(inp => {
        inp.addEventListener('input', () => { refreshEditorPreview(sec, draft); });
        inp.addEventListener('blur', () => {
            const clean = sanitizeCIdent(inp.value);
            if (clean !== inp.value) { inp.value = clean || 'field'; }
            refreshEditorPreview(sec, draft);
        });
    });

    sec.querySelectorAll<HTMLSelectElement>('.sfe-type-sel').forEach(sel => {
        sel.addEventListener('change', () => {
            handleFieldTypeChange(sec, draft, sel);
            refreshEditorPreview(sec, draft);
        });
    });

    // ── Bit-field child name/width input live refresh ───────────
    sec.querySelectorAll<HTMLInputElement>('.sfe-bf-child-name, .sfe-bf-child-width').forEach(inp => {
        inp.addEventListener('input', () => {
            refreshEditorPreview(sec, draft);
        });
    });

    sec.querySelector<HTMLInputElement>('#se-name')!.addEventListener('input', () => {
        refreshEditorPreview(sec, draft);
    });
    sec.querySelector<HTMLInputElement>('#se-name')!.addEventListener('blur', e => {
        const inp = e.target as HTMLInputElement;
        const clean = sanitizeCIdent(inp.value);
        if (clean !== inp.value) { inp.value = clean; }
        refreshEditorPreview(sec, draft);
    });

    sec.querySelector('#se-save')!.addEventListener('click', () => {
        saveEditorDraft(sec, draft);
    });

    sec.querySelector('#se-cancel')!.addEventListener('click', () => {
        _editorError = null;
        const { fromAdd } = _editingType!;
        _editingType = null;
        if (fromAdd) {
            _addingPin = true;
            _managingTypes = false;
        }
        renderStructPins();
    });
}

function saveEditorDraft(sec: HTMLElement, draft: StructDef): void {
    syncEditorDraft(sec, draft);
    if (draft.fields.length === 0) { return; }

    const def = editorDraftToStructDef(sec, draft);
    const validationErrors = validateStructs(upsertStructList(S.structs, def), MAX_NESTED_DEPTH);
    if (validationErrors.length > 0) {
        _editorError = validationErrors[0];
        renderStructPins();
        return;
    }

    _editorError = null;
    S.structs = upsertStructList(S.structs, def);
    vscode.postMessage({ type: 'saveStructs', structs: S.structs });
    closeEditorAfterSave(def.id);
    renderStructPins();
}

function editorDraftToStructDef(sec: HTMLElement, draft: StructDef): StructDef {
    return {
        id: draft.id,
        name: readEditorStructName(sec, draft.id),
        packed: draft.packed ?? false,
        fields: draft.fields.map((field, idx) => withSavedFieldName(field, idx, draft.fields)),
    };
}

function readEditorStructName(sec: HTMLElement, draftId: string): string {
    const nameInp = sec.querySelector<HTMLInputElement>('#se-name')!;
    const name = sanitizeCIdent(nameInp.value.trim());
    return name || nextStructName(draftId);
}

function nextStructName(draftId: string): string {
    const otherNames = new Set(S.structs.filter(d => d.id !== draftId).map(d => d.name));
    let candidate = 'MyStruct';
    let n = 1;
    while (otherNames.has(candidate)) { candidate = `MyStruct${n++}`; }
    return candidate;
}

function withSavedFieldName(field: StructField, idx: number, fields: StructField[]): StructField {
    if (field.name) { return { ...field }; }
    const takenNames = new Set(fields.map(f => f.name).filter(Boolean));
    let candidate = `field${idx}`;
    let n = 0;
    while (takenNames.has(candidate)) { candidate = `field${idx}_${n++}`; }
    return { ...field, name: candidate };
}

function upsertStructList(structs: StructDef[], def: StructDef): StructDef[] {
    const idx = structs.findIndex(d => d.id === def.id);
    if (idx < 0) { return [...structs, def]; }
    const clone = [...structs];
    clone[idx] = def;
    return clone;
}

function closeEditorAfterSave(defId: string): void {
    const { fromAdd } = _editingType!;
    _editingType = null;
    if (!fromAdd) { return; }
    _applyStructId = defId;
    _addingPin = true;
    _managingTypes = false;
}

function handleFieldTypeChange(sec: HTMLElement, draft: StructDef, sel: HTMLSelectElement): void {
    const row = sel.closest<HTMLElement>('.struct-field-row');
    if (!row) { return; }
    const bitBtn = row.querySelector<HTMLElement>('.sfe-bit-btn');
    const ptrBtn = row.querySelector<HTMLElement>('.sfe-ptr-btn');
    const isPointer = fieldTypeSelectionIsPointer(sel, ptrBtn);
    const isUnsigned = isUnsignedEditorType(sel.value) && !isPointer;
    setBitButtonEnabled(bitBtn, isUnsigned);
    clearInvalidBitChildren(sec, draft, row, bitBtn, isUnsigned);
}

function handlePointerToggleClick(sec: HTMLElement, draft: StructDef, btn: HTMLElement): void {
    const { row, field } = syncEditorFieldForButton(sec, draft, btn);
    if (!canTogglePointerField(field, btn)) { return; }
    _editorError = null;
    const active = !btn.classList.contains('active');
    btn.classList.toggle('active', active);
    field.isPointer = active || field.type === 'void' ? true : undefined;
    clearPointerBitChildren(sec, draft, row, active);
    renderStructPins();
}

function canTogglePointerField(field: StructField | undefined, btn: HTMLElement): field is StructField {
    return Boolean(field) && !btn.hasAttribute('disabled');
}

function syncEditorFieldForButton(sec: HTMLElement, draft: StructDef, btn: HTMLElement): { row: HTMLElement; field: StructField | undefined } {
    const row = btn.closest<HTMLElement>('.struct-field-row')!;
    syncEditorDraft(sec, draft);
    return { row, field: draft.fields[parseInt(row.dataset.idx!)] };
}

function clearPointerBitChildren(sec: HTMLElement, draft: StructDef, row: HTMLElement, active: boolean): void {
    if (!active) { return; }
    clearBitFieldChildren(sec, draft, row, row.querySelector<HTMLElement>('.sfe-bit-btn'));
}

function fieldTypeSelectionIsPointer(sel: HTMLSelectElement, ptrBtn: HTMLElement | null): boolean {
    if (sel.value === 'void') { ptrBtn?.classList.add('active'); }
    return ptrBtn?.classList.contains('active') || sel.value === 'void';
}

function setBitButtonEnabled(bitBtn: HTMLElement | null, isUnsigned: boolean): void {
    if (bitBtn) { (bitBtn as HTMLButtonElement).disabled = !isUnsigned; }
}

function clearInvalidBitChildren(sec: HTMLElement, draft: StructDef, row: HTMLElement, bitBtn: HTMLElement | null, isUnsigned: boolean): void {
    if (shouldClearBitChildren(bitBtn, isUnsigned)) { clearBitFieldChildren(sec, draft, row, bitBtn); }
}

function isUnsignedEditorType(rawType: string): boolean {
    return !rawType.startsWith('struct:') && isUnsignedScalarType(rawType as import('../../core/types').StructFieldType);
}

function shouldClearBitChildren(bitBtn: HTMLElement | null, isUnsigned: boolean): boolean {
    return !isUnsigned && Boolean(bitBtn?.classList.contains('sfe-bit-btn-on'));
}

function clearBitFieldChildren(sec: HTMLElement, draft: StructDef, row: HTMLElement, bitBtn: HTMLElement | null): void {
    bitBtn?.classList.remove('sfe-bit-btn-on');
    row.classList.remove('has-bit-children');
    row.querySelector<HTMLElement>('.sfe-bf-children')?.remove();
    syncEditorDraft(sec, draft);
    clearDraftBitFields(draft, row);
}

function clearDraftBitFields(draft: StructDef, row: HTMLElement): void {
    const idx = parseInt(row.dataset.idx!);
    const field = draft.fields[idx];
    if (field) {
        delete field.bitFields;
        delete field.bitFieldsCollapsed;
    }
}

// ── Main render function ───────────────────────────────────────────
export function renderStructPins(): void {
    const sec = document.getElementById('s-struct-pins');
    if (!sec) { return; }

    const all = allStructs(S.structs);
    prepareStructPanelState(all);
    sec.innerHTML = structPinsPanelHtml(all);

    hydrateStructPreviews(sec);
    wireStructPinsPanel(sec);

    wireInstanceCards(sec);

    if (_editingType) {
        wireEditorInSec(sec);
        sec.querySelector<HTMLInputElement>('#se-name')?.focus();
    }
}

function prepareStructPanelState(all: StructDef[]): void {
    _applyStructId = nextApplyStructId(all);
    _managingTypes = _editingType ? true : _managingTypes;
}

function nextApplyStructId(all: StructDef[]): string | null {
    const fallbackId = all.length > 0 ? all[0].id : null;
    if (!_applyStructId) { return fallbackId; }
    return all.some(d => d.id === _applyStructId) ? _applyStructId : fallbackId;
}

function structPinsPanelHtml(all: StructDef[]): string {
    const typeRows = typeRowsHtml(all);
    const addFormHtml = _addingPin ? addStructPinFormHtml(all) : '';
    const instHtml = instanceCardsHtml();
    const instBadge = S.structPins.length > 0 ? `<span class="sb-badge">${S.structPins.length}</span>` : '';

    return (
        `<div class="si-panel-clip">` +
        `<div class="si-panel-track${_managingTypes ? ' si-showing-types' : ''}" id="si-track">` +
        structInstancesPanelHtml(instBadge, addFormHtml, instHtml) +
        structTypesPanelHtml(typeRows) +
        `</div>` +
        `</div>`
    );
}

function typeRowsHtml(all: StructDef[]): string {
    if (all.length === 0) { return `<div class="sb-empty">No types defined yet.</div>`; }
    return all.map(structTypeRowHtml).join('');
}

function structTypeRowHtml(def: StructDef): string {
    const fieldCount = def.fields.length;
    const meta = `${fieldCount} field${fieldCount !== 1 ? 's' : ''}`;
    return (
        `<div class="sd-row">` +
        `<span class="sd-name">${esc(def.name)}</span>` +
        `<span class="sd-meta">${meta}</span>` +
        actionBtnsHtml(`data-struct-id="${esc(def.id)}"`, `data-struct-id="${esc(def.id)}"`) +
        `</div>`
    );
}

function addStructPinFormHtml(all: StructDef[]): string {
    const addrVal = S.activeStructAddr !== null
        ? S.activeStructAddr.toString(16).toUpperCase().padStart(8, '0')
        : '';
    return (
        `<div id="si-add-form" class="si-add-form">` +
        `<div class="sa-form-hdr sa-form-hdr-new">\uff0b New Instance</div>` +
        `<div class="sa-row">` +
        `<input id="sa-name" class="sa-name-inp" type="text" maxlength="40" ` +
               `placeholder="instance name" spellcheck="false" autocomplete="off">` +
        `</div>` +
        `<div class="sa-row">` +
        `<span class="struct-addr-pfx">0x</span>` +
        `<input id="sa-addr" class="struct-addr-inp sa-addr-inp" type="text" maxlength="8" ` +
               `placeholder="08000000" autocomplete="off" spellcheck="false" value="${esc(addrVal)}">` +
        `</div>` +
        addStructPinTypeRowHtml(all) +
        `<div class="sa-row sa-btn-row">` +
        `<button id="sa-confirm" class="struct-btn struct-btn-apply"${!_applyStructId ? ' disabled' : ''}>Confirm</button>` +
        `<button id="sa-cancel" class="struct-btn struct-btn-cancel">Cancel</button>` +
        `</div>` +
        `</div>`
    );
}

function addStructPinTypeRowHtml(all: StructDef[]): string {
    if (all.length === 0) {
        return (
            `<div class="sa-row sa-no-types-row">` +
            `<span class="sa-no-types-msg">No struct types yet — create one first.</span>` +
            `<button id="sa-new-type-btn" class="struct-btn struct-btn-secondary">New type</button>` +
            `</div>`
        );
    }

    const structOpts = all.map(d =>
        `<option value="${esc(d.id)}"${d.id === _applyStructId ? ' selected' : ''}>${esc(d.name)}</option>`
    ).join('');
    const applyDef = all.find(d => d.id === _applyStructId);
    const previewHtml = applyDef
        ? `<pre class="si-c-preview" data-struct-preview-id="${esc(applyDef.id)}"></pre>`
        : '';
    return (
        `<div class="sa-row">` +
        `<select id="sa-struct-sel" class="struct-sel">${structOpts}</select>` +
        `<button id="sa-new-type-btn" class="si-add-type-btn" title="New type">\uff0b</button>` +
        `</div>` +
        previewHtml
    );
}

function instanceCardsHtml(): string {
    return S.structPins.length === 0
        ? `<div class="sb-empty">No instances yet. Click [\uff0b Add] to create one.</div>`
        : S.structPins.map((pin, i) => buildInstanceCard(pin, i)).join('');
}

function structInstancesPanelHtml(instBadge: string, addFormHtml: string, instHtml: string): string {
    return (
        `<div class="si-main-panel">` +
        `<div class="si-hdr-row">` +
        `<span class="sb-hdr" style="margin:0">Struct Instances ${instBadge}</span>` +
        bitLayoutToggleHtml() +
        `<button id="si-add-btn" class="si-add-btn"${_addingPin ? ' disabled' : ''}>\uff0b Add</button>` +
        `<button id="si-types-btn" class="si-icon-btn" title="Manage types">&#9776;</button>` +
        `</div>` +
        addFormHtml +
        `<div id="si-list">${instHtml}</div>` +
        `</div>`
    );
}

function bitLayoutToggleHtml(): string {
    return (
        `<div class="si-toggle-group" title="Bit-field allocation: which side receives the first declared bit field">` +
        `<span class="si-toggle-label">Bit Layout</span>` +
        `<div class="compact-tabs sa-bit-order-tabs">` +
        `<button id="sa-btn-bit-lsb" class="${S.bitFieldAllocation === 'lsb' ? 'active' : ''}" title="Bit-field allocation: first declared bit field starts at the least significant bit">LSB</button>` +
        `<button id="sa-btn-bit-msb" class="${S.bitFieldAllocation === 'msb' ? 'active' : ''}" title="Bit-field allocation: first declared bit field starts at the most significant bit">MSB</button>` +
        `</div>` +
        `</div>`
    );
}

function structTypesPanelHtml(typeRows: string): string {
    return (
        `<div class="si-types-panel">` +
        `<div class="si-hdr-row">` +
        `<button id="sm-close-btn" class="si-icon-btn" title="${typePanelCloseTitle()}">&#8592;</button>` +
        `<span class="sb-hdr" style="margin:0">${typePanelTitle()}</span>` +
        typePanelNewButtonHtml() +
        `</div>` +
        typePanelBodyHtml(typeRows) +
        `</div>`
    );
}

function typePanelCloseTitle(): string {
    return _editingType ? 'Cancel' : 'Back';
}

function typePanelTitle(): string {
    if (!_editingType) { return 'Struct Types'; }
    return _editingType.existing ? 'Edit Type' : 'New Type';
}

function typePanelNewButtonHtml(): string {
    return _editingType ? '' : `<button id="sm-new-btn" class="struct-btn struct-btn-secondary">New type</button>`;
}

function typePanelBodyHtml(typeRows: string): string {
    if (!_editingType) { return `<div id="sm-list">${typeRows}</div>`; }
    return editorHtml(_editingType.draft, _editingType.existing);
}

function wireStructPinsPanel(sec: HTMLElement): void {
    wireTypesPanelControls(sec);
    wireAddStructPinControls();
    wireBitLayoutTabs();
}

function wireTypesPanelControls(sec: HTMLElement): void {
    document.getElementById('si-types-btn')?.addEventListener('click', () => {
        _managingTypes = true;
        document.getElementById('si-track')?.classList.add('si-showing-types');
    });

    document.getElementById('sm-close-btn')?.addEventListener('click', () => {
        if (_editingType) {
            const { fromAdd } = _editingType;
            _editingType = null;
            if (fromAdd) {
                _addingPin = true;
                _managingTypes = false;
            }
            // fromManage: stay on types panel (re-render shows type list)
            renderStructPins();
        } else {
            _managingTypes = false;
            document.getElementById('si-track')?.classList.remove('si-showing-types');
        }
    });

    document.getElementById('sm-new-btn')?.addEventListener('click', () => {
        _editorError = null;
        const draftId = `user_${Date.now()}`;
        _editingType = {
            draft: { id: draftId, name: '', packed: false, fields: [{ name: 'field0', type: 'uint32', count: 1 }] },
            existing: null,
            fromAdd: false,
            fromManage: true,
        };
        renderStructPins();
    });

    const typesPanel = sec.querySelector<HTMLElement>('.si-types-panel')!;
    wireActionBtns(
        typesPanel,
        '.act-btn-edit',
        '.act-btn-del',
        btn => {
            _editorError = null;
            const existing = S.structs.find(d => d.id === btn.dataset.structId) ?? null;
            if (!existing) { return; }
            _editingType = {
                draft: { id: existing.id, name: existing.name, packed: existing.packed ?? false, fields: existing.fields.map(f => ({ ...f })) },
                existing,
                fromAdd: false,
                fromManage: true,
            };
            renderStructPins();
        },
        btn => {
            const id = btn.dataset.structId!;
            S.structs    = S.structs.filter(d => d.id !== id);
            S.structPins = S.structPins.filter(p => p.structId !== id);
            if (_applyStructId === id) { _applyStructId = null; }
            vscode.postMessage({ type: 'saveStructs',    structs: S.structs });
            vscode.postMessage({ type: 'saveStructPins', pins:    S.structPins });
            renderStructPins();
        },
    );
}

function wireAddStructPinControls(): void {
    document.getElementById('si-add-btn')?.addEventListener('click', () => {
        _addingPin = true;
        renderStructPins();
        document.getElementById('sa-name')?.focus();
    });

    if (!_addingPin) { return; }

    document.getElementById('sa-struct-sel')?.addEventListener('change', e => {
        _applyStructId = (e.target as HTMLSelectElement).value || null;
        preservePendingStructAddress();
        renderStructPins();
    });
    document.getElementById('sa-new-type-btn')?.addEventListener('click', () => {
        _editorError = null;
        _addingPin = false;
        const draftId = `user_${Date.now()}`;
        _editingType = {
            draft: { id: draftId, name: '', packed: false, fields: [{ name: 'field0', type: 'uint32', count: 1 }] },
            existing: null,
            fromAdd: true,
            fromManage: false,
        };
        renderStructPins();
    });
    document.getElementById('sa-addr')?.addEventListener('input', () => {
        const addrInp = document.getElementById('sa-addr') as HTMLInputElement | null;
        const confirmBtn = document.getElementById('sa-confirm') as HTMLButtonElement | null;
        if (!addrInp || !confirmBtn) { return; }
        const hasAddr = addrInp.value.trim().length > 0;
        confirmBtn.disabled = !_applyStructId || !hasAddr;
    });
    document.getElementById('sa-confirm')?.addEventListener('click', () => {
        confirmAddStructPin();
    });
    document.getElementById('sa-cancel')?.addEventListener('click', () => {
        _addingPin = false;
        renderStructPins();
    });
}

function wireBitLayoutTabs(): void {
    document.getElementById('sa-btn-bit-lsb')?.addEventListener('click', () => {
        S.bitFieldAllocation = 'lsb';
        document.getElementById('sa-btn-bit-lsb')?.classList.add('active');
        document.getElementById('sa-btn-bit-msb')?.classList.remove('active');
        if (_expanded.size > 0) { renderStructPins(); }
    });
    document.getElementById('sa-btn-bit-msb')?.addEventListener('click', () => {
        S.bitFieldAllocation = 'msb';
        document.getElementById('sa-btn-bit-msb')?.classList.add('active');
        document.getElementById('sa-btn-bit-lsb')?.classList.remove('active');
        if (_expanded.size > 0) { renderStructPins(); }
    });
}

function confirmAddStructPin(): void {
    if (!_applyStructId) { return; }
    const addrInp = document.getElementById('sa-addr') as HTMLInputElement;
    const nameInp = document.getElementById('sa-name') as HTMLInputElement;
    const addr = parseStructApplyAddress(addrInp);
    if (addr === null) { return; }
    const name = structApplyName(nameInp);
    const pin: StructPin = { id: `pin_${Date.now()}`, structId: _applyStructId, addr, name };
    S.structPins       = [...S.structPins, pin];
    S.activeStructAddr = addr;
    _expanded.add(pin.id);
    _addingPin = false;
    vscode.postMessage({ type: 'saveStructPins', pins: S.structPins });
    renderStructPins();
}

function parseStructApplyAddress(addrInp: HTMLInputElement): number | null {
    const addr = parseInt(addrInp.value.replace(/^0x/i, ''), 16);
    if (!isNaN(addr)) {
        addrInp.style.borderColor = '';
        return addr;
    }
    addrInp.style.borderColor = 'var(--err)';
    return null;
}

function structApplyName(nameInp: HTMLInputElement): string {
    const name = nameInp.value.trim();
    return name || nextStructApplyName();
}

function nextStructApplyName(): string {
    const applyDef = S.structs.find(d => d.id === _applyStructId);
    const base = applyDef ? applyDef.name : 'inst';
    return uniqueStructPinName(`${base}_0`, n => `${base}_${n}`);
}

function uniqueStructPinName(initialName: string, nextName: (n: number) => string): string {
    const takenPinNames = new Set(S.structPins.map(p => p.name));
    let candidate = initialName;
    let n = 1;
    while (takenPinNames.has(candidate)) { candidate = nextName(n++); }
    return candidate;
}

/** Resets all transient view state for the struct panel and re-renders. Call when switching away and back. */
export function resetStructViewState(): void {
    _editingType             = null;
    _addingPin               = false;
    _managingTypes           = false;
    _editingPinId            = null;
    _editingPinDraftStructId = null;
    _selectedArrElemKey      = null;
    _selectedBitRange        = null;
    _hoveredBitRange         = null;
    _selectedBitRowKey       = null;
    _hoveredBitRowKey        = null;
    renderStructPins();
}

/** Get a display string for a field given the requested column display type. */
function getValForType(r: DecodedField, valType: ColType): string {
    if (!r.hasData) { return '??'; }
    if (isBitFieldRow(r)) { return renderBitFieldValue(r, valType); }

    const bytes = fieldBytes(r);
    const endian = S.endian;
    const dv = dataViewForBytes(bytes);
    return renderScalarValue(r, valType, bytes, dv, endian);
}

function fieldBytes(r: DecodedField): number[] {
    return r.bytesHex.split(' ').map(h => parseInt(h, 16));
}

function dataViewForBytes(bytes: number[]): DataView {
    const buf = new ArrayBuffer(bytes.length);
    const dv = new DataView(buf);
    bytes.forEach((b, i) => dv.setUint8(i, b));
    return dv;
}

function isBinaryDisplay(valType: ColType): boolean {
    return valType === 'bin' || valType === 'bin-sliced';
}

function renderBitFieldTogglePreview(sec: HTMLElement, draft: StructDef): void {
    const pre = sec.querySelector<HTMLElement>('#se-preview pre');
    if (pre) { renderStructCPreview(pre, draft); }
}

function bitFieldDisplaySource(r: DecodedField): { width: number; value: bigint } {
    return {
        width: r.bitWidth ?? 1,
        value: BigInt(r.bitValueUnsigned ?? '0'),
    };
}

function renderBitFieldValue(r: DecodedField, valType: ColType): string {
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

function copyBitFieldValue(r: DecodedField, valType: ColType): string {
    const { width, value: v } = bitFieldDisplaySource(r);
    if (valType === 'hex') {
        return `0x${v.toString(16).toUpperCase().padStart(Math.max(1, Math.ceil(width / 4)), '0')}`;
    }
    if (isBinaryDisplay(valType)) {
        return binaryGroupsLowBitsFirst(v.toString(2).padStart(width, '0')).join(' ');
    }
    return v.toString(10);
}

function renderScalarValue(
    r: DecodedField,
    valType: ColType,
    bytes: number[],
    dv: DataView,
    endian: 'le' | 'be',
): string {
    const le = endian === 'le';
    const special = renderSpecialScalarValue(r, valType, bytes, dv, endian, le);
    if (special !== null) { return special; }
    return renderNumericValue(r, valType, dv, le);
}

function renderSpecialScalarValue(
    r: DecodedField,
    valType: ColType,
    bytes: number[],
    dv: DataView,
    endian: 'le' | 'be',
    le: boolean,
): string | null {
    const byType = renderSpecialScalarByType(r, valType, bytes, dv, le);
    if (byType !== null) { return byType; }
    return renderSpecialScalarByValueType(r, valType, bytes, endian);
}

function renderSpecialScalarByType(
    r: DecodedField,
    valType: ColType,
    bytes: number[],
    dv: DataView,
    le: boolean,
): string | null {
    if (r.isPointer) { return renderPointerValue(r, dv, le); }
    if (r.type === 'ascii') { return renderAsciiValue(r, valType, bytes); }
    return null;
}

function renderSpecialScalarByValueType(
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

function renderPointerValue(r: DecodedField, dv: DataView, le: boolean): string {
    const v = r.pointerValue ?? (dv.getUint32(0, le) >>> 0);
    const note = v !== 0 && getByte(v) === undefined ? ` <span class="si-f-ptr-note">(unmapped)</span>` : '';
    return `<span class="si-f-ptr-sym">\u2192</span>\u2009` + formatHexHtml(formatHex(v, 8)) + note;
}

function renderAsciiValue(r: DecodedField, valType: ColType, bytes: number[]): string {
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

function renderIeeeValue(r: DecodedField, bytes: number[], endian: 'le' | 'be'): string {
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

type NumericValueFormatter = (valType: ColType, dv: DataView, le: boolean) => string;

const RENDER_NUMERIC_VALUE: Partial<Record<DecodedField['type'], NumericValueFormatter>> = {
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

function renderNumericValue(r: DecodedField, valType: ColType, dv: DataView, le: boolean): string {
    return RENDER_NUMERIC_VALUE[r.type]?.(valType, dv, le) ?? r.decoded;
}

function formatFloat(v: number, digits: number): string {
    return isNaN(v) ? 'NaN' : !isFinite(v) ? String(v) : v.toExponential(digits);
}

function asciiFromBytes(bytes: number[]): string {
    return bytes.map(b => b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.').join('');
}

/** Parse IEEE754 parts from raw bytes for float32/float64. Returns null on missing/invalid bytes. */
function getFloatParts(bytes: number[], type: 'float32' | 'float64', endian: 'le' | 'be') {
    const size = FLOAT_BYTE_SIZE[type];
    if (!hasFloatBytes(bytes, size)) { return null; }
    const dv = floatDataView(bytes, size);
    const le = endian === 'le';
    return FLOAT_PART_READERS[type](dv, le);
}

const FLOAT_BYTE_SIZE: Record<'float32' | 'float64', number> = { float32: 4, float64: 8 };
const FLOAT_PART_READERS = { float32: getFloat32Parts, float64: getFloat64Parts };

function hasFloatBytes(bytes: number[], size: number): boolean {
    return bytes.length >= size && bytes.every(isPresentByte);
}

function isPresentByte(byte: number): boolean {
    return byte >= 0;
}

function floatDataView(bytes: number[], size: number): DataView {
    const buf = new ArrayBuffer(size);
    const dv = new DataView(buf);
    bytes.forEach((b, i) => dv.setUint8(i, b));
    return dv;
}

function getFloat32Parts(dv: DataView, le: boolean) {
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

function float32ClassName(exp: number, mant: number): string {
    return floatClassName(exp, mant === 0, 0xFF);
}

function getFloat64Parts(dv: DataView, le: boolean) {
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

function float64ClassName(exp: number, mant: bigint): string {
    return floatClassName(exp, mant === 0n, 0x7FF);
}

function floatClassName(exp: number, isZeroMant: boolean, infinityExp: number): string {
    return ({
        0: isZeroMant ? 'zero' : 'subnormal',
        [infinityExp]: isZeroMant ? 'infinity' : 'NaN',
    })[exp] ?? 'normal';
}

/** Get a plain-text representation suitable for copying. */
function getCopyText(r: DecodedField, valType: ColType): string {
    if (!r.hasData) { return '??'; }
    return copySpecialRowText(r, valType) ?? copyNonAsciiFieldValue(r, valType);
}

function copySpecialRowText(r: DecodedField, valType: ColType): string | null {
    const copier = SPECIAL_ROW_COPIERS.find(entry => entry.matches(r));
    return copier ? copier.copy(r, valType) : null;
}

const SPECIAL_ROW_COPIERS: Array<{
    matches: (row: DecodedField) => boolean;
    copy: (row: DecodedField, valType: ColType) => string;
}> = [
    { matches: isBitFieldRow, copy: copyBitFieldValue },
    { matches: row => row.isPointer === true, copy: copyPointerRowText },
    { matches: row => row.type === 'ascii', copy: row => row.decoded },
];

function copyPointerRowText(r: DecodedField): string {
    return r.pointerValue === undefined ? '??' : formatHex(r.pointerValue, 8);
}

function copyNonAsciiFieldValue(r: DecodedField, valType: ColType): string {
    const bytes = fieldBytes(r);
    const endian = S.endian;
    const le = endian === 'le';
    const special = copySpecialFieldValue(r, valType, bytes, endian, le);
    if (special !== null) { return special; }
    return copyNumericValue(r, valType, dataViewForBytes(bytes), le);
}

function copySpecialFieldValue(
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

function copySpecialFieldByType(r: DecodedField, valType: ColType, bytes: number[], le: boolean): string | null {
    if (r.isPointer) { return copyPointerValue(bytes, le); }
    if (hasSlicedBitCopyValue(r, valType)) { return copySlicedBitValue(r); }
    return null;
}

function copySpecialFieldByValueType(
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

function copyPointerValue(bytes: number[], le: boolean): string {
    const v = dataViewForBytes(bytes).getUint32(0, le) >>> 0;
    return hexPad(v, 8);
}

function hasSlicedBitCopyValue(r: DecodedField, valType: ColType): boolean {
    return valType === 'bin-sliced' && typeof r.bitWidth === 'number' && r.bitValueUnsigned !== undefined;
}

function copySlicedBitValue(r: DecodedField): string {
    return formatPlainBinaryBits(BigInt(r.bitValueUnsigned!).toString(2).padStart(r.bitWidth!, '0'));
}

function hexPad(v: number, pad: number): string {
    return `0x${(v >>> 0).toString(16).toUpperCase().padStart(pad, '0')}`;
}

function hexPadBig(v: bigint, pad: number): string {
    return `0x${v.toString(16).toUpperCase().padStart(pad, '0')}`;
}

function copyIeeeValue(r: DecodedField, bytes: number[], endian: 'le' | 'be'): string {
    const parts = getFloatPartsForField(r, bytes, endian);
    if (!parts) { return '??'; }
    return `sign: ${parts.sign}; exponent: ${parts.exponentHex}; mantissa: ${parts.mantissaHex}; class: ${parts.className}`;
}

function getFloatPartsForField(r: DecodedField, bytes: number[], endian: 'le' | 'be'): ReturnType<typeof getFloatParts> {
    if (r.type !== 'float32' && r.type !== 'float64') { return null; }
    return getFloatParts(bytes, r.type, endian);
}

const IMPLICIT_DISPLAY_BY_TYPE: Partial<Record<DecodedField['type'], ColType>> = {
    float32: 'dec',
    float64: 'dec',
    ascii: 'ascii',
};

function fieldImplicitDisplayType(field: DecodedField | null | undefined): ColType {
    return field ? definedFieldImplicitDisplayType(field) : _defaultValType;
}

function definedFieldImplicitDisplayType(field: DecodedField): ColType {
    if (isBitFieldRow(field)) { return 'bin'; }
    return field.isPointer ? 'hex' : (IMPLICIT_DISPLAY_BY_TYPE[field.type] ?? _defaultValType);
}

function implicitDisplayType(field: DecodedField | null | undefined, forceBinary = false): ColType {
    return forceBinary ? 'bin' : fieldImplicitDisplayType(field);
}

const COPY_NUMERIC_VALUE: Partial<Record<DecodedField['type'], NumericValueFormatter>> = {
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

function copyNumericValue(r: DecodedField, valType: ColType, dv: DataView, le: boolean): string {
    return COPY_NUMERIC_VALUE[r.type]?.(valType, dv, le) ?? r.decoded;
}

const TYPE_ABBREV: Record<string, string> = {
    ascii: 'str',
    uint8: 'u8',  uint16: 'u16', uint32: 'u32', uint64: 'u64',
    int8:  'i8',  int16:  'i16', int32:  'i32', int64:  'i64',
    float32: 'f32', float64: 'f64', pointer: 'ptr',
};
const TYPE_CELL_MAX_CHARS = 20;
const TYPE_CELL_ELLIPSIS = '...';

function fieldValueKey(r: DecodedField, byteStart: number): string {
    return isBitFieldRow(r)
        ? bitChildValKey(byteStart, r.bitOffset ?? 0, r.bitWidth ?? 0)
        : scalarValKey(byteStart);
}

function defaultValueTypeForRow(r: DecodedField): ColType {
    if (isBitFieldRow(r)) { return 'bin'; }
    if (FLOAT_FIELD_TYPES.has(r.type)) { return 'dec'; }
    if (r.type === 'ascii') { return 'ascii'; }
    return _defaultValType;
}

function valueTypeForRow(r: DecodedField, valKey: string): ColType {
    return _fieldValTypes.get(valKey) ?? defaultValueTypeForRow(r);
}

function fieldTypeAbbrev(r: DecodedField, byteCount: number): string {
    const special = specialFieldTypeLabel(r, true);
    if (special) { return special; }
    const abbrevBase = TYPE_ABBREV[r.type] ?? r.type;
    return r.type === 'ascii' ? `${abbrevBase}[${byteCount}]` : abbrevBase;
}

function fieldFullTypeLabel(r: DecodedField, byteCount: number): string {
    const special = specialFieldTypeLabel(r, false);
    if (special) { return special; }
    return r.type === 'ascii' ? `ascii[${byteCount}]` : r.type;
}

function specialFieldTypeLabel(r: DecodedField, abbreviated: boolean): string | null {
    if (isBitFieldRow(r)) { return `bit:${r.bitWidth}`; }
    return r.isPointer ? `${pointerTargetTypeLabel(r, abbreviated)}*` : null;
}

function pointerTargetTypeLabel(r: DecodedField, abbreviated: boolean): string {
    const target = r.pointerTargetType ?? r.type;
    return POINTER_TARGET_LABELS[target]?.(r, abbreviated) ?? scalarPointerTargetLabel(target, abbreviated);
}

const POINTER_TARGET_LABELS: Partial<Record<StructFieldType, (row: DecodedField, abbreviated: boolean) => string>> = {
    struct: row => row.pointerTargetStructName ?? 'struct',
    ascii: () => 'char',
    void: () => 'void',
};

function scalarPointerTargetLabel(target: StructFieldType, abbreviated: boolean): string {
    return abbreviated ? (TYPE_ABBREV[target] ?? target) : target;
}

function typeCellHtml(abbrev: string, fullTypeLabel: string): string {
    const compact = compactTypeCellLabel(abbrev);
    const escapedFullType = esc(fullTypeLabel);
    return `<span class="si-f-type" title="${escapedFullType}" aria-label="${escapedFullType}">${esc(compact)}</span>`;
}

function compactTypeCellLabel(label: string): string {
    if (label.length <= TYPE_CELL_MAX_CHARS) { return label; }
    const pointerSuffix = label.endsWith('*') ? '*' : '';
    const body = pointerSuffix ? label.slice(0, -1) : label;
    const availableBodyChars = TYPE_CELL_MAX_CHARS - TYPE_CELL_ELLIPSIS.length - pointerSuffix.length;
    if (availableBodyChars <= 1) { return label.slice(0, TYPE_CELL_MAX_CHARS); }
    const headChars = Math.ceil(availableBodyChars / 2);
    const tailChars = availableBodyChars - headChars;
    return `${body.slice(0, headChars)}${TYPE_CELL_ELLIPSIS}${body.slice(-tailChars)}${pointerSuffix}`;
}

function fieldOffsetLabel(r: DecodedField): string {
    if (isBitFieldRow(r)) { return `.${String(r.bitOffset ?? 0)}`; }
    return `+${r.byteOffset.toString(16).toUpperCase().padStart(3, '0')}`;
}

function bitFieldDataAttrs(r: DecodedField): string {
    if (!isBitFieldRow(r)) { return ''; }
    return ` data-bit-start="${r.bitOffset ?? 0}" data-bit-width="${r.bitWidth ?? 0}"`;
}

function valueHtmlForRow(r: DecodedField, valType: ColType, ptr: boolean): string {
    const value = getValForType(r, valType);
    return valueIsRawHtml(valType, ptr) ? value : esc(value);
}

function valueIsRawHtml(valType: ColType, ptr: boolean): boolean {
    if (ptr) { return true; }
    return RAW_HTML_VALUE_TYPES.has(valType);
}

function mkFieldRow(r: DecodedField, bs: number, bc: number, ctx: StructRenderContext, displayName?: string): string {
    const ptr = r.isPointer === true;
    const valKey = fieldValueKey(r, bs);
    const t = valueTypeForRow(r, valKey);
    const valHtml = valueHtmlForRow(r, t, ptr);
    const byteCount = r.bytesHex.length > 0 ? r.bytesHex.split(' ').length : bc;
    const abbrev = fieldTypeAbbrev(r, byteCount);
    const fullTypeLabel = fieldFullTypeLabel(r, byteCount);
    const offsetLabel = fieldOffsetLabel(r);
    const offsetHtml = ctx.hideOffsets
        ? '<span class="si-node-pad" aria-hidden="true"></span>'
        : `<span class="si-f-off">${offsetLabel}</span>`;
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
        `<span class="si-f-name">${esc(displayName ?? leafName(r.fieldName))}</span>` +
        `<span class="si-f-lead"></span>` +
        `<span class="si-f-val si-f-pri${pointerValueClass(ptr)}" data-val-type="${t}" data-bs="${bs}" data-val-key="${esc(valKey)}">${valHtml}</span>` +
        `</span>` +
        `</div>`
    );
}

function fieldRowClasses(hasData: boolean, pointer: boolean): string {
    return `${hasData ? '' : ' si-no-data'}${pointer ? ' si-ptr-field' : ''}`;
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

function groupSummaryLabel(rows: DecodedField[], fallback: string): string {
    if (!isBitUnitGroup(rows)) { return fallback; }
    const first = rows[0];
    if (!first) { return fallback; }
    const raw = completeByteValues(first.bytesHex);
    if (!raw) { return '??'; }

    const value = bytesToValue(raw, S.endian);
    const hex = value.toString(16).toUpperCase().padStart(raw.length * 2, '0');
    return `0x${hex} (${value.toString(10)})`;
}

function completeByteValues(bytesHex: string): number[] | null {
    const rawParts = byteHexParts(bytesHex);
    if (hasMissingByte(rawParts)) { return null; }
    const raw = bytesFromHexParts(rawParts);
    return raw.every(isByteValue) ? raw : null;
}

function isByteValue(value: number): boolean {
    return Number.isFinite(value) && value >= 0 && value <= 0xFF;
}

function buildBitUnitAggregateRow(rows: DecodedField[]): DecodedField | null {
    const first = rows[0];
    if (!first) { return null; }
    const usedWidth = rows.reduce((sum, row) => sum + bitRowWidth(row), 0);
    let slicedValue: string | undefined;
    const rawParts = byteHexParts(first.bytesHex);
    if (canDecodeBitUnit(usedWidth, rawParts, first.hasData)) {
        const raw = bytesFromHexParts(rawParts);
        const value = bytesToValue(raw, S.endian);
        const unitBits = raw.length * 8;
        const mask = (1n << BigInt(usedWidth)) - 1n;
        const sliced = S.bitFieldAllocation === 'lsb'
            ? value & mask
            : (value >> BigInt(Math.max(0, unitBits - usedWidth))) & mask;
        slicedValue = sliced.toString(10);
    }
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
    };
}

function canDecodeBitUnit(usedWidth: number, rawParts: string[], hasData: boolean): boolean {
    return usedWidth > 0 && !hasMissingByte(rawParts) && hasData;
}

function activeBitRangeForHeader(start: number): { startBit: number; endBit: number } | null {
    return matchingBitRange(_selectedBitRange, start) ?? matchingBitRange(_hoveredBitRange, start);
}

function matchingBitRange(range: typeof _selectedBitRange, start: number): { startBit: number; endBit: number } | null {
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
        `<button class="${buttonClass}">${isOpen ? '▾' : '▸'}</button>` +
        `<span class="si-f-body">` +
        `<span class="si-f-name">${esc(headerName)}</span>` +
        `<span class="si-f-lead"></span>` +
        `<span class="si-f-val si-f-pri" data-val-type="hex" data-bs="${start}" data-val-key="${esc(valKey)}">??</span>` +
        `</span>` +
        `</div>`
    );
}

function bitUnitHeaderValueHtml(
    rows: DecodedField[],
    agg: DecodedField,
    valueType: ColType,
    activeRange: { startBit: number; endBit: number } | null,
): string {
    if (valueType === 'bin') { return renderBinaryStorageUnit(agg, activeRange); }
    if (valueType === 'bin-sliced') { return renderBinaryFromBitRows(rows, activeRange); }
    return getValForType(agg, valueType);
}

function bitUnitHeaderDisplayValue(
    rows: DecodedField[],
    agg: DecodedField,
    valueType: ColType,
    start: number,
): string {
    const value = bitUnitHeaderValueHtml(rows, agg, valueType, activeBitRangeForHeader(start));
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
    rows: DecodedField[],
    start: number,
    cnt: number,
    isOpen: boolean,
    headerNameOverride?: string,
    kind: 'group' | 'element' = 'group',
    hideOffset = false,
): string {
    const agg = buildBitUnitAggregateRow(rows);
    const headerName = bitUnitHeaderName(rows, headerNameOverride);
    const { headerClass, buttonClass } = bitUnitHeaderClasses(kind);
    const valKey = bitUnitValKey(start);
    if (!agg) { return emptyBitUnitHeaderHtml(headerClass, buttonClass, headerName, valKey, start, cnt, isOpen); }

    return populatedBitUnitHeaderHtml(rows, agg, headerClass, buttonClass, headerName, valKey, start, cnt, isOpen, hideOffset);
}

function bitUnitHeaderName(rows: DecodedField[], headerNameOverride?: string): string {
    if (headerNameOverride !== undefined) { return headerNameOverride; }
    return groupHeaderName(arrayGroupBaseName(firstBitUnitFieldName(rows)));
}

function firstBitUnitFieldName(rows: DecodedField[]): string {
    return rows[0]?.fieldName ?? '';
}

function populatedBitUnitHeaderHtml(
    rows: DecodedField[],
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
    const t = bitUnitHeaderValueType(valKey);
    const ptrClass = bitUnitPointerClass(agg);
    const valHtml = bitUnitHeaderDisplayValue(rows, agg, t, start);
    const byteCount = bitUnitByteCount(agg, cnt);
    const abbrev = fieldTypeAbbrev(agg, byteCount);
    const fullTypeLabel = fieldFullTypeLabel(agg, byteCount);
    const offsetLabel = fieldOffsetLabel(agg);

    const offsetHtml = hideOffset
        ? '<span class="si-node-pad" aria-hidden="true"></span>'
        : `<span class="si-f-off">${offsetLabel}</span>`;
    return (
        `<div class="${headerClass} si-bitunit-hdr si-field" data-byte-start="${start}" data-byte-cnt="${cnt}" data-val-key="${esc(valKey)}">` +
        offsetHtml +
        typeCellHtml(abbrev, fullTypeLabel) +
        `<button class="${buttonClass}">${isOpen ? '▾' : '▸'}</button>` +
        `<span class="si-f-body">` +
        `<span class="si-f-name">${esc(headerName)}</span>` +
        `<span class="si-f-lead"></span>` +
        `<span class="si-f-val si-f-pri${ptrClass}" data-val-type="${t}" data-bs="${start}" data-val-key="${esc(valKey)}">${valHtml}</span>` +
        `</span>` +
        `</div>`
    );
}

function bitUnitHeaderValueType(valKey: string): ColType {
    return _fieldValTypes.get(valKey) ?? 'bin';
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

function structGroupSummaryLabel(rows: DecodedField[], isBitUnit: boolean, isArray: boolean, summary: string): string {
    return isBitUnit && isArray ? summary : groupSummaryLabel(rows, summary);
}

function structGroupByteCount(rows: DecodedField[], isBitUnit: boolean, isArray: boolean, count: number): number {
    return isBitUnit && isArray ? decodedRowByteCount(rows[0]) * count : sumDecodedRowBytes(rows);
}

function preservePendingStructAddress(): void {
    const curAddrInp = document.getElementById('sa-addr') as HTMLInputElement | null;
    if (!curAddrInp?.value) { return; }
    const value = parseInt(curAddrInp.value, 16);
    if (!isNaN(value)) { S.activeStructAddr = value; }
}

function describeStructGroup(def: StructDef, rows: DecodedField[], baseName: string): StructGroupInfo {
    const declared = structGroupDeclarationInfo(def, rows, baseName);
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
        summaryLabel: structGroupSummaryLabel(rows, isBitUnit, isArray, summary),
        byteCount: structGroupByteCount(rows, isBitUnit, isArray, declared.count),
    };
}

function structGroupDeclarationInfo(def: StructDef, rows: DecodedField[], baseName: string): StructGroupDeclarationInfo {
    const declared = resolveStructFieldByPath(def, baseName, S.structs);
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

function leafRowsHtml(rows: DecodedField[], ctx: StructRenderContext): string {
    const labels = disambiguateLeafNames(rows.map(r => leafName(r.fieldName)));
    return rows.map((row, idx) =>
        mkFieldRow(row, ctx.baseAddr + row.byteOffset, decodedRowByteCount(row), ctx, labels[idx])
    ).join('');
}

function indexedRowsHtml(rows: DecodedField[], ctx: StructRenderContext, baseName: string): string {
    return rows.map(row =>
        mkFieldRow(row, ctx.baseAddr + row.byteOffset, decodedRowByteCount(row), ctx, indexOnlyName(row.fieldName, baseName))
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
        `<button class="si-arr-el-exp-btn">${expandGlyph(isOpen)}</button>` +
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

function expandGlyph(isOpen: boolean): string {
    return isOpen ? '▾' : '▸';
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

function syncCompositeHeaderOffset(hdr: HTMLElement, isOpen: boolean): void {
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

type StructRenderContext = {
    def: StructDef;
    pin: StructPin;
    baseAddr: number;
    keyPrefix: string;
    pointerDepth: number;
    hideOffsets: boolean;
};

function sourceContextDataAttrs(ctx: StructRenderContext): string {
    return ` data-source-struct-id="${esc(ctx.def.id)}" data-source-base-addr="${ctx.baseAddr}"`;
}
type RenderBodyGroup = {
    rows: DecodedField[];
    baseName: string;
    key: string;
    info: StructGroupInfo;
};
type BodyRule = readonly [
    (group: RenderBodyGroup) => boolean,
    (ctx: StructRenderContext, group: RenderBodyGroup) => string,
];

const BODY_RULES: ReadonlyArray<BodyRule> = [
    [
        group => group.info.isStruct && group.info.isArray,
        (ctx, group) => renderStructArrayElements(ctx, group.rows, group.baseName, group.key, group.info.structName),
    ],
    [
        group => group.info.isBitUnit && group.info.isArray,
        (ctx, group) => renderBitUnitArrayElements(group.rows, group.baseName, group.key, ctx),
    ],
    [
        group => group.info.isStruct && !group.info.isArray,
        (ctx, group) => renderStructChildren(ctx, group.rows, group.baseName, group.key),
    ],
    [
        group => group.info.isBitUnit,
        (ctx, group) => renderBitUnitLeafRows(group.rows, ctx),
    ],
    [
        group => !group.info.isStruct && group.info.isArray && !group.info.isString,
        (ctx, group) => indexedRowsHtml(group.rows, ctx, group.baseName),
    ],
];

function renderStructBody(def: StructDef, pin: StructPin): string {
    const rows = decodeStruct(def, pin.addr, getByte, S.endian, S.bitFieldAllocation, S.structs);
    return `<div class="si-fields">${renderStructFieldGroups({
        def,
        pin,
        baseAddr: pin.addr,
        keyPrefix: pin.id,
        pointerDepth: 0,
        hideOffsets: false,
    }, rows)}</div>`;
}

function renderBitUnitLeafRows(unitRows: DecodedField[], ctx: StructRenderContext): string {
    return leafRowsHtml(unitRows, ctx);
}

function renderBitUnitArrayElements(
    unitRows: DecodedField[],
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
        const isElementOpen = _expandedArrayElements.has(elementKey);
        const elementRowsHtml = renderBitUnitLeafRows(element.rows, ctx);
        return (
            `<div class="si-arr-el-grp${isElementOpen ? ' open' : ''}" data-arr-el-key="${esc(elementKey)}">` +
            bitUnitHeaderHtml(element.rows, elementByteStart, elementByteCnt, isElementOpen, `[${element.idx}]`, 'element') +
            `<div class="si-arr-el-body"${isElementOpen ? '' : ' style=\"display:none\"'}>${elementRowsHtml}</div>` +
            `</div>`
        );
    }).join('');
}

function renderStructChildren(ctx: StructRenderContext, structRows: DecodedField[], structBase: string, parentKey: string): string {
    return groupNestedRows(structRows, structBase).map(ng => renderNestedStructGroup(ctx, ng, parentKey)).join('');
}

function renderNestedStructGroup(ctx: StructRenderContext, ng: NestedFieldGroup, parentKey: string): string {
    const info = describeStructGroup(ctx.def, ng.rows, ng.fullBase);
    if (isStructPointerRows(ng.rows)) {
        return renderStructPointerRows(ctx, ng.rows, parentKey, ng.baseRel, info);
    }
    if (!info.isComposite) {
        return leafRowsHtml(ng.rows, ctx);
    }

    const nestedKey = `${parentKey}::${ng.baseRel}`;
    const nestedOpen = _expandedArrayFields.has(nestedKey);
    const nestedStart = ctx.baseAddr + ng.rows[0].byteOffset;
    const nestedBodyHtml = renderNestedStructBody(ctx, {
        rows: ng.rows,
        baseName: ng.fullBase,
        key: nestedKey,
        info,
    });

    return compositeGroupHtml(
        nestedKey,
        nestedOpen,
        nestedStructHeaderHtml(ctx, ng, info, nestedStart, nestedOpen),
        nestedBodyHtml,
    );
}

function nestedStructHeaderHtml(ctx: StructRenderContext, ng: NestedFieldGroup, info: StructGroupInfo, nestedStart: number, nestedOpen: boolean): string {
    if (info.isBitUnit && !info.isArray) {
        return bitUnitHeaderHtml(ng.rows, nestedStart, info.byteCount, nestedOpen, groupHeaderName(ng.baseRel), 'group', ctx.hideOffsets);
    }
    return compositeHeaderHtml(
        nestedOpen,
        nestedStart,
        info.byteCount,
        ng.rows[0].byteOffset,
        groupHeaderName(ng.baseRel),
        info.summaryLabel,
        ctx.hideOffsets,
    );
}

function renderNestedStructBody(
    ctx: StructRenderContext,
    group: RenderBodyGroup,
): string {
    const rule = BODY_RULES.find(([matches]) => matches(group));
    return rule ? rule[1](ctx, group) : leafRowsHtml(group.rows, ctx);
}

function renderStructArrayElements(
    ctx: StructRenderContext,
    rows: DecodedField[],
    baseName: string,
    parentKey: string,
    structName: string,
): string {
    return groupRowsByArrayIndex(rows, baseName).map(element => {
        const elementKey = `${parentKey}::${element.idx}`;
        const isElementOpen = _expandedArrayElements.has(elementKey);
        const childRowsHtml = renderStructChildren(
            ctx,
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

function renderStructFieldGroups(ctx: StructRenderContext, rows: DecodedField[]): string {
    return groupRowsByBase(rows).map(g => renderStructFieldGroup(ctx, g)).join('');
}

function renderStructFieldGroup(ctx: StructRenderContext, g: FieldGroup): string {
    const r0 = g.rows[0];
    const info = describeStructGroup(ctx.def, g.rows, g.baseName);
    if (isStructPointerRows(g.rows)) {
        return renderStructPointerRows(ctx, g.rows, ctx.keyPrefix, g.baseName, info);
    }
    if (!info.isComposite) {
        return leafRowsHtml(g.rows, ctx);
    }

    const key = `${ctx.keyPrefix}::${g.baseName}`;
    const isOpen = _expandedArrayFields.has(key);
    const byteStart = ctx.baseAddr + r0.byteOffset;
    const elHtml = renderStructFieldBody(ctx, {
        rows: g.rows,
        baseName: g.baseName,
        key,
        info,
    });

    return compositeGroupHtml(
        key,
        isOpen,
        structFieldHeaderHtml(ctx, g, info, byteStart, isOpen),
        elHtml,
    );
}

function structFieldHeaderHtml(ctx: StructRenderContext, g: FieldGroup, info: StructGroupInfo, byteStart: number, isOpen: boolean): string {
    if (info.isBitUnit && !info.isArray) {
        return bitUnitHeaderHtml(g.rows, byteStart, info.byteCount, isOpen, undefined, 'group', ctx.hideOffsets);
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

function compositeHeaderHtml(
    isOpen: boolean,
    byteStart: number,
    byteCount: number,
    byteOffset: number,
    name: string,
    summaryLabel: string,
    hideOffset = false,
    includeTitle = false,
): string {
    const title = includeTitle ? ` title="${esc(summaryLabel)}"` : '';
    return (
        `<div class="si-arr-grp-hdr" data-byte-start="${byteStart}" data-byte-cnt="${byteCount}"${hideOffset ? '' : ` data-offset-label="${offsetLabel(byteOffset)}"`}>` +
        compositeHeaderPrefixHtml(isOpen, byteOffset, hideOffset) +
        `<button class="si-arr-exp-btn">${isOpen ? '▾' : '▸'}</button>` +
        `<span class="si-f-body">` +
        `<span class="si-f-name">${esc(name)}</span>` +
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
    ctx: StructRenderContext,
    rows: DecodedField[],
    parentKey: string,
    baseName: string,
    info: StructGroupInfo,
): string {
    if (info.isArray) {
        return renderStructPointerArrayRows(ctx, rows, parentKey, baseName, info);
    }
    return rows.map(row => {
        return renderStructPointerGroup(ctx, row, `${parentKey}::ptr::${row.fieldName}`, groupHeaderName(baseName));
    }).join('');
}

function renderStructPointerArrayRows(
    ctx: StructRenderContext,
    rows: DecodedField[],
    parentKey: string,
    baseName: string,
    info: StructGroupInfo,
): string {
    const key = `${parentKey}::${baseName}`;
    const isOpen = _expandedArrayFields.has(key);
    const first = rows[0];
    const byteStart = ctx.baseAddr + first.byteOffset;
    const bodyHtml = rows.map(row =>
        renderStructPointerGroup(ctx, row, `${key}::ptr::${row.fieldName}`, indexOnlyName(row.fieldName, baseName))
    ).join('');
    return compositeGroupHtml(
        key,
        isOpen,
        compositeHeaderHtml(isOpen, byteStart, info.byteCount, first.byteOffset, groupHeaderName(baseName), info.summary, ctx.hideOffsets, true),
        bodyHtml,
    );
}

function renderStructPointerGroup(ctx: StructRenderContext, row: DecodedField, key: string, name: string): string {
    const target = pointerDerefTarget(row);
    const isOpen = _expandedArrayFields.has(key);
    const childKey = `${key}::child`;
    const child = pointerChildState(ctx, row, target, childKey);
    return compositeGroupHtml(
        key,
        isOpen,
        structPointerHeaderHtml(ctx, row, key, name, target, isOpen),
        structPointerBodyHtml(ctx, row, child),
    );
}

function pointerChildState(ctx: StructRenderContext, row: DecodedField, target: PointerDerefTarget, key: string): PointerChildState {
    const storageStart = ctx.baseAddr + row.byteOffset;
    const expandable = pointerChildExpandable(ctx, target);
    const isOpen = pointerChildIsOpen(key, expandable.ok);
    return {
        key,
        storageStart,
        byteStart: target.addr ?? storageStart,
        byteCount: target.ok ? target.byteCount : decodedRowByteCount(row),
        valKey: fieldValueKey(row, storageStart),
        name: target.ok && target.def ? '{ }' : 'target',
        summary: pointerChildSummary(row, target, expandable),
        canExpand: expandable.ok,
        expandTitle: expandable.ok ? 'Expand' : expandable.reason,
        isOpen,
        allowCreate: row.pointerTargetType === 'struct',
        bodyHtml: pointerChildBodyHtml(ctx, key, target, expandable.ok),
    };
}

function pointerChildIsOpen(key: string, canExpand: boolean): boolean {
    return canExpand && _expandedArrayFields.has(key);
}

function pointerChildBodyHtml(
    ctx: StructRenderContext,
    key: string,
    target: PointerDerefTarget,
    canExpand: boolean,
): string {
    if (!canExpand || !target.ok || !target.def) { return ''; }
    const resolvedTarget = { ...target, def: target.def };
    return renderStructPointerBody(ctx, key, resolvedTarget);
}

function pointerChildSummary(row: DecodedField, target: PointerDerefTarget, expandable: { ok: boolean; reason: string }): string {
    if (!target.ok) { return target.reason; }
    return pointerChildSummaryForResolvedTarget(row, target, expandable);
}

function pointerChildSummaryForResolvedTarget(
    row: DecodedField,
    target: Extract<PointerDerefTarget, { ok: true }>,
    expandable: { ok: boolean; reason: string },
): string {
    if (target.def) { return `${row.pointerTargetStructName ?? target.def.name} @ ${formatHex(target.addr, 8)}`; }
    const scalarSummary = scalarPointerTargetSummary(row, target.addr);
    if (scalarSummary !== null) { return scalarSummary; }
    return expandable.ok ? pointerTargetTypeLabel(row, false) : expandable.reason;
}

function scalarPointerTargetSummary(row: DecodedField, addr: number): string | null {
    const targetType = row.pointerTargetType;
    if (targetType === undefined || targetType === 'struct') { return null; }
    const targetLabel = pointerTargetTypeLabel(row, true);
    const size = fieldByteSize(targetType);
    const bytes: number[] = [];
    for (let offset = 0; offset < size; offset++) {
        const value = getByte(addr + offset);
        if (value === undefined) { return `${targetLabel} @ ${formatHex(addr, 8)} = ??`; }
        bytes.push(value);
    }
    const decoded = decodeField(bytes, targetType, S.endian);
    const value = decoded === '' ? pointerTargetTypeLabel(row, false) : decoded;
    return `${targetLabel} @ ${formatHex(addr, 8)} = ${value}`;
}

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
    canExpand: boolean;
    expandTitle: string;
    isOpen: boolean;
    allowCreate: boolean;
    bodyHtml: string;
};

function pointerDerefTarget(row: DecodedField): PointerDerefTarget {
    const follow = pointerFollowState(row);
    const addr = typeof row.pointerValue === 'number' ? row.pointerValue : null;
    if (!follow.ok) { return { ok: false, reason: follow.reason, addr, byteCount: 1 }; }
    return resolvedPointerTarget(row, addr!);
}

function resolvedPointerTarget(row: DecodedField, addr: number): PointerDerefTarget {
    const def = pointerTargetStructDef(row) ?? null;
    if (def) {
        return { ok: true, addr, byteCount: structByteSize(def, S.structs), def };
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
        `<button class="si-arr-exp-btn">${isOpen ? '▾' : '▸'}</button>` +
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
    const targetStart = target.addr ?? storageStart;
    const byteCount = decodedRowByteCount(row);
    return `<div class="si-arr-grp-hdr si-ptr-hdr si-ptr-field" data-byte-start="${storageStart}" data-byte-cnt="${byteCount}" ` +
        `data-offset-label="${offsetLabel(row.byteOffset)}" data-pointer-storage-start="${storageStart}" data-val-key="${esc(valKey)}"` +
        ` data-pointer-target-start="${targetStart}" data-pointer-target-cnt="${target.ok ? target.byteCount : 0}"` +
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
    const note = target.ok || target.reason === 'null' ? '' : ` <span class="si-f-ptr-note">(${esc(target.reason)})</span>`;
    return `<span class="si-f-ptr-sym">→</span> ` + formatHexHtml(formatHex(addr, 8)) + note;
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
        `<button class="si-arr-exp-btn"${disabled} title="${esc(child.expandTitle)}">${child.isOpen ? '▾' : '▸'}</button>` +
        `<span class="si-f-body">` +
        `<span class="si-f-name">${esc(child.name)}</span>` +
        `<span class="si-f-lead"></span>` +
        `<span class="si-arr-addr">${esc(child.summary)}</span>` +
        `</span>` +
        `</div>`;
}

function renderStructPointerBody(
    ctx: StructRenderContext,
    key: string,
    target: { ok: true; addr: number; byteCount: number; def: StructDef },
): string {
    const rows = decodeStruct(target.def, target.addr, getByte, S.endian, S.bitFieldAllocation, S.structs);
    return renderStructFieldGroups({
        def: target.def,
        pin: ctx.pin,
        baseAddr: target.addr,
        keyPrefix: key,
        pointerDepth: ctx.pointerDepth + 1,
        hideOffsets: false,
    }, rows);
}

function renderStructFieldBody(
    ctx: StructRenderContext,
    group: RenderBodyGroup,
): string {
    const rule = BODY_RULES.find(([matches]) => matches(group));
    return rule ? rule[1](ctx, group) : '';
}

function instanceTypePreviewHtml(def: StructDef | undefined, pin: StructPin): string {
    return def
        ? `<div class="si-type-preview"${_previewedPins.has(pin.id) ? '' : ' style="display:none"'}>` +
                    `<pre class="si-c-preview" data-struct-preview-id="${esc(def.id)}"></pre>` +
          `</div>`
        : '';
}

function instanceEditFormHtml(pin: StructPin): string {
    if (_editingPinId !== pin.id) { return ''; }

    const draftStructId = _editingPinDraftStructId ?? pin.structId;
    const addrHex = pin.addr.toString(16).toUpperCase().padStart(8, '0');
    const structOpts = allStructs(S.structs).map(d =>
        `<option value="${esc(d.id)}"${d.id === draftStructId ? ' selected' : ''}>${esc(d.name)}</option>`
    ).join('');
    const editDef = allStructs(S.structs).find(d => d.id === draftStructId);
    const editPreviewHtml = editDef
        ? `<pre class="si-c-preview" data-struct-preview-id="${esc(editDef.id)}"></pre>`
        : '';

    return (
        `<div class="si-pin-edit-form">` +
        `<div class="sa-form-hdr sa-form-hdr-edit">&#9998; Edit Instance</div>` +
        `<div class="sa-row">` +
        `<input class="si-pe-name sa-name-inp" type="text" maxlength="40" ` +
               `placeholder="instance name" spellcheck="false" autocomplete="off" value="${esc(pin.name)}">` +
        `</div>` +
        `<div class="sa-row">` +
        `<span class="struct-addr-pfx">0x</span>` +
        `<input class="si-pe-addr struct-addr-inp sa-addr-inp" type="text" maxlength="8" ` +
               `autocomplete="off" spellcheck="false" placeholder="08000000" value="${esc(addrHex)}">` +
        `</div>` +
        `<div class="sa-row">` +
        `<select class="si-pe-type struct-sel">${structOpts}</select>` +
        `</div>` +
        editPreviewHtml +
        `<div class="sa-row sa-btn-row">` +
        `<button class="si-pe-save struct-btn struct-btn-apply">Save</button>` +
        `<button class="si-pe-cancel struct-btn struct-btn-cancel">Cancel</button>` +
        `</div>` +
        `</div>`
    );
}

function instanceBodyHtml(def: StructDef | undefined, pin: StructPin, expanded: boolean): string {
    return expanded && def ? renderStructBody(def, pin) : '';
}

function instanceActionsHtml(def: StructDef | undefined, pin: StructPin, index: number): string {
    if (def) {
        return actionBtnsHtml(`data-pin-id="${esc(pin.id)}"`, `data-idx="${index}"`);
    }
    return `<span class="act-btn act-btn-del" data-idx="${index}" title="Delete">&#128465;&#xFE0E;</span>`;
}

function instanceHeaderHtml(
    pin: StructPin,
    index: number,
    def: StructDef | undefined,
    defName: string,
    totalBytes: number,
    addrHex: string,
    expanded: boolean,
): string {
    return (
        `<div class="si-card-hdr">` +
        `<button class="si-expand-btn" data-pin-id="${esc(pin.id)}">${expanded ? '\u25be' : '\u25b8'}</button>` +
        `<div class="si-card-info">` +
        `<span class="si-cname">${esc(pin.name)}</span>` +
        `<div class="si-cmeta-row">` +
        `<span class="si-ctype">${esc(defName)}</span>` +
        `<button class="si-type-btn${_previewedPins.has(pin.id) ? ' active' : ''}" ` +
        `data-pin-id="${esc(pin.id)}" title="View type definition">{&nbsp;}</button>` +
        `<span class="si-caddr">0x${addrHex}\u202f\u00b7\u202f${totalBytes}B</span>` +
        `</div>` +
        pointerSourceSubtitleHtml(pin) +
        `</div>` +
        `<div class="si-card-actions">` +
        instanceActionsHtml(def, pin, index) +
        `</div>` +
        `</div>`
    );
}

function instanceContentHtml(pin: StructPin, editFormHtml: string, typePreviewHtml: string, bodyHtml: string): string {
    return _editingPinId === pin.id ? editFormHtml : editFormHtml + typePreviewHtml + bodyHtml;
}

function buildInstanceCard(pin: StructPin, i: number): string {
    const def        = allStructs(S.structs).find(d => d.id === pin.structId);
    const defName    = def ? def.name : '?';
    const totalBytes = def ? structByteSize(def, S.structs) : 0;
    const addrHex    = pin.addr.toString(16).toUpperCase().padStart(8, '0');
    const expanded   = _expanded.has(pin.id);

    const bodyHtml = instanceBodyHtml(def, pin, expanded);
    const typePreviewHtml = instanceTypePreviewHtml(def, pin);
    const editFormHtml = instanceEditFormHtml(pin);

    return (
        `<div class="si-card${expanded ? ' si-expanded' : ''}" data-pin-id="${esc(pin.id)}" data-idx="${i}">` +
        instanceHeaderHtml(pin, i, def, defName, totalBytes, addrHex, expanded) +
        instanceContentHtml(pin, editFormHtml, typePreviewHtml, bodyHtml) +
        `</div>`
    );
}

function clearArrSep(): void {
    for (const addr of _arrSepAddrs) {
        const ah = addr.toString(16).toUpperCase().padStart(8, '0');
        document.querySelectorAll<HTMLElement>(`[data-addr="${ah}"]`)
            .forEach(el => el.classList.remove('struct-arr-sep'));
    }
    _arrSepAddrs.length = 0;
}

function clearSelRow(): void {
    document.querySelectorAll<HTMLElement>('.si-selected')
        .forEach(el => el.classList.remove('si-selected'));
}

function setTreeLevel(el: HTMLElement, level: number): void {
    el.style.setProperty('--si-level', String(level));
}

function asHtml(el: Element | null): HTMLElement | null {
    if (!el) { return null; }
    const candidate = el as HTMLElement;
    return typeof candidate.classList !== 'undefined' ? candidate : null;
}

function firstDirectChildByClass(parent: HTMLElement, cls: string): HTMLElement | null {
    for (const child of Array.from(parent.children)) {
        const htmlChild = asHtml(child);
        if (htmlChild && htmlChild.classList.contains(cls)) {
            return htmlChild;
        }
    }
    return null;
}

function applyTreeDepthStyles(sec: HTMLElement): void {
    sec.querySelectorAll<HTMLElement>('.si-fields').forEach(fields => {
        annotateTreeBody(fields, 0);
    });
}

function annotateTreeBody(body: HTMLElement, level: number): void {
    setTreeLevel(body, level);
    for (const child of Array.from(body.children)) {
        const htmlChild = asHtml(child);
        if (htmlChild) { annotateTreeChild(htmlChild, level); }
    }
}

function annotateTreeChild(child: HTMLElement, level: number): void {
    if (child.classList.contains('si-field')) {
        setTreeLevel(child, level);
        return;
    }
    if (child.classList.contains('si-arr-grp')) {
        annotateCompositeTreeChild(child, level, 'si-arr-grp-hdr', 'si-arr-grp-body');
        return;
    }
    if (child.classList.contains('si-arr-el-grp')) {
        annotateCompositeTreeChild(child, level, 'si-arr-el-hdr', 'si-arr-el-body');
    }
}

function annotateCompositeTreeChild(child: HTMLElement, level: number, headerClass: string, bodyClass: string): void {
    const hdr = firstDirectChildByClass(child, headerClass);
    if (hdr) { setTreeLevel(hdr, level); }
    const body = firstDirectChildByClass(child, bodyClass);
    if (body) { annotateTreeBody(body, level + 1); }
}

function wireInstanceCards(sec: HTMLElement): void {
    applyTreeDepthStyles(sec);

    // Keep bit hover highlight strictly tied to the current pointer target.
    sec.onmousemove = (ev: MouseEvent) => {
        updateHoveredBitRow(ev, sec);
    };
    sec.onmouseleave = () => {
        if (_hoveredBitRange !== null || _hoveredBitRowKey !== null) {
            _hoveredBitRange = null;
            _hoveredBitRowKey = null;
            applyBitHighlightsInPlace(sec);
        }
    };

    sec.querySelectorAll<HTMLElement>('.si-expand-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.pinId!;
            if (_expanded.has(id)) { _expanded.delete(id); } else { _expanded.add(id); }
            renderStructPins();
        });
    });

    // Array group: arrow button toggles expand; rest of row selects in hex view
    sec.querySelectorAll<HTMLElement>('.si-arr-grp-hdr').forEach(hdr => {
        const expBtn = hdr.querySelector<HTMLElement>('.si-arr-exp-btn')!;
        const start  = parseInt(hdr.dataset.byteStart!);
        const cnt    = parseInt(hdr.dataset.byteCnt!);
        const isBitUnitHdr = hdr.classList.contains('si-bitunit-hdr');
        const isPointerHdr = hdr.classList.contains('si-ptr-hdr') || hdr.classList.contains('si-ptr-child-hdr');

        expBtn.addEventListener('click', e => {
            e.stopPropagation();
            if ((expBtn as HTMLButtonElement).disabled) { return; }
            toggleCompositeGroup(hdr, expBtn, '.si-arr-grp', '.si-arr-grp-body', 'arrKey', _expandedArrayFields);
        });

        hdr.querySelector<HTMLElement>('.si-f-ptr')?.addEventListener('click', e => {
            e.stopPropagation();
            followPointerHeaderValue(hdr);
        });

        wireStructHoverRange(hdr, start, cnt);

        hdr.addEventListener('click', e => {
            if (isPointerHdr) {
                selectPointerHeaderRange(e, hdr, start, cnt);
                return;
            }
            selectArrayGroupHeader(e, hdr, start, cnt, isBitUnitHdr);
        });
    });

    // Nested element: arrow toggles expand; row selects that element range.
    sec.querySelectorAll<HTMLElement>('.si-arr-el-hdr').forEach(hdr => {
        const expBtn = hdr.querySelector<HTMLElement>('.si-arr-el-exp-btn')!;
        const start  = parseInt(hdr.dataset.byteStart!);
        const cnt    = parseInt(hdr.dataset.byteCnt!);

        expBtn.addEventListener('click', e => {
            e.stopPropagation();
            toggleCompositeGroup(hdr, expBtn, '.si-arr-el-grp', '.si-arr-el-body', 'arrElKey', _expandedArrayElements);
        });

        wireStructHoverRange(hdr, start, cnt);

        hdr.addEventListener('click', e => {
            if ((e.target as HTMLElement).closest('.si-arr-el-exp-btn')) { return; }
            clearStructSelectionVisuals();
            if (isNaN(start) || isNaN(cnt)) { return; }
            _selectedArrElemKey = hdr.dataset.arrElKey!;
            _selectedArrKey = null;
            _selectedFieldAddr = null;
            selectStructRange(hdr, start, cnt);
        });
    });

    sec.querySelectorAll<HTMLElement>('.si-card-hdr').forEach(hdr => {
        hdr.addEventListener('click', e => {
            if ((e.target as HTMLElement).closest('.si-expand-btn, .si-card-actions, .si-type-btn')) { return; }
            clearArrSep();
            clearSelRow();
            _selectedBitRange = null;
            _hoveredBitRange = null;
            _selectedBitRowKey = null;
            _hoveredBitRowKey = null;
            _selectedFieldAddr = null;
            _selectedArrKey    = null;
            _selectedArrElemKey = null;
            const card = hdr.closest<HTMLElement>('.si-card')!;
            const idx  = parseInt(card.dataset.idx!);
            const pin  = S.structPins[idx];
            if (!pin) { return; }
            const def  = allStructs(S.structs).find(d => d.id === pin.structId);
            if (!def)  { return; }
            const size = structByteSize(def, S.structs);
            S.selStart = pin.addr;
            S.selEnd   = pin.addr + size - 1;
            S.activeStructAddr = pin.addr;
            _selectedPinId = pin.id;
            sec.querySelectorAll<HTMLElement>('.si-card').forEach(c => c.classList.remove('si-card-selected'));
            card.classList.add('si-card-selected');
            rerender.toMemory();
            import('../memory/memoryView.js').then(m => { m.applySel(); m.scrollTo(pin.addr); });
            import('./sidebar.js').then(m => m.updateInspector());
        });
    });

    // Wire edit + delete action buttons on each instance card
    sec.querySelectorAll<HTMLElement>('.si-card').forEach(card => {
        const actions = card.querySelector<HTMLElement>('.si-card-actions');
        if (!actions) { return; }
        wireActionBtns(
            actions,
            '.act-btn-edit',
            '.act-btn-del',
            btn => {
                _editingPinId = btn.dataset.pinId!;
                const editedPin = S.structPins.find(p => p.id === _editingPinId);
                _editingPinDraftStructId = editedPin?.structId ?? null;
                _expanded.delete(_editingPinId);
                renderStructPins();
            },
            btn => {
                const idx = parseInt(btn.dataset.idx!);
                const pin = S.structPins[idx];
                if (pin) { _expanded.delete(pin.id); }
                S.structPins = S.structPins.filter((_, i) => i !== idx);
                vscode.postMessage({ type: 'saveStructPins', pins: S.structPins });
                renderStructPins();
            },
        );
    });

    sec.querySelectorAll<HTMLElement>('.si-field').forEach(row => {
        const start = parseInt(row.dataset.byteStart!);
        const cnt   = parseInt(row.dataset.byteCnt!);
        const bitStartRaw = row.dataset.bitStart;
        const bitWidthRaw = row.dataset.bitWidth;
        const isBitRow = bitStartRaw !== undefined && bitWidthRaw !== undefined;

        row.addEventListener('mouseenter', () => {
            if (isBitRow) { return; }
            for (let i = 0; i < cnt; i++) {
                const ah = (start + i).toString(16).toUpperCase().padStart(8, '0');
                document.querySelectorAll<HTMLElement>(`[data-addr="${ah}"]`)
                    .forEach(el => el.classList.add('struct-h'));
            }
        });

        row.addEventListener('mouseleave', () => {
            if (isBitRow) { return; }
            document.querySelectorAll<HTMLElement>('.struct-h')
                .forEach(el => el.classList.remove('struct-h'));
        });

        row.addEventListener('click', () => {
            if (isNaN(start) || isNaN(cnt)) { return; }
            if (isBitRow) {
                selectBitRow(row, sec);
                return;
            }
            selectStructFieldRow(row, start, cnt);
        });

        row.querySelector<HTMLElement>('.si-f-ptr')?.addEventListener('click', ev => {
            ev.stopPropagation();
            const card = row.closest<HTMLElement>('.si-card');
            const pinIdx = card ? parseInt(card.dataset.idx!) : -1;
            const valKey = row.dataset.valKey ?? scalarValKey(start);
            followPointerAt(start, pinIdx, valKey, sourceContextOptions(row));
        });
    });

    // Right-click on a field row to open the value menu. Pass the pin index
    // so the menu can decode values when performing copy actions.
    sec.querySelectorAll<HTMLElement>('.si-field').forEach(row => {
        row.addEventListener('contextmenu', ev => {
            ev.preventDefault(); ev.stopPropagation();
            const start = parseInt(row.dataset.byteStart!);
            const card = row.closest<HTMLElement>('.si-card');
            const pinIdx = card ? parseInt(card.dataset.idx!) : -1;
            // Determine if this is a pointer field
            const valCell = row.querySelector<HTMLElement>('.si-f-val');
            const isPointer = valCell?.classList.contains('si-f-ptr');
            const isBitUnitHeader = row.classList.contains('si-bitunit-hdr');
            // Only allow per-element change, not group, for array elements
            const valKey = row.dataset.valKey ?? scalarValKey(start);
            showFieldValMenu(ev.clientX, ev.clientY, start, undefined, pinIdx, {
                isPointer,
                isBitUnitHeader,
                valKey,
                ...sourceContextOptions(row),
            });
        });
    });

    // Right-click on an array group header should allow actions on the
    // entire group (child elements).
    sec.querySelectorAll<HTMLElement>('.si-arr-grp-hdr').forEach(hdr => {
        hdr.addEventListener('contextmenu', ev => {
            if (hdr.classList.contains('si-ptr-hdr') || hdr.classList.contains('si-ptr-child-hdr')) {
                openPointerHeaderValueMenu(ev, hdr);
                return;
            }
            openArrayHeaderValueMenu(ev, hdr);
        });
    });

    wireTypePreviewButtons(sec);
    wirePinEditForm(sec);

    applyBitHighlightsInPlace(sec);
    restoreStructSelection(sec);
}

function wireTypePreviewButtons(sec: HTMLElement): void {
    sec.querySelectorAll<HTMLElement>('.si-type-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            toggleTypePreview(btn);
        });
    });
}

function toggleTypePreview(btn: HTMLElement): void {
    const id = btn.dataset.pinId!;
    const card = btn.closest<HTMLElement>('.si-card')!;
    const preview = card.querySelector<HTMLElement>('.si-type-preview');
    const isOpen = _previewedPins.has(id);
    setTypePreviewOpen(id, btn, preview, !isOpen);
}

function setTypePreviewOpen(id: string, btn: HTMLElement, preview: HTMLElement | null, isOpen: boolean): void {
    if (isOpen) { _previewedPins.add(id); }
    else { _previewedPins.delete(id); }
    btn.classList.toggle('active', isOpen);
    if (preview) { preview.style.display = isOpen ? '' : 'none'; }
}

function wirePinEditForm(sec: HTMLElement): void {
    if (!_editingPinId) { return; }
    const editForm = sec.querySelector<HTMLElement>('.si-pin-edit-form');
    if (!editForm) { return; }

    const pinId = _editingPinId;
    editForm.querySelector<HTMLSelectElement>('.si-pe-type')?.addEventListener('change', e => {
        _editingPinDraftStructId = (e.target as HTMLSelectElement).value || null;
        renderStructPins();
    });
    editForm.querySelector<HTMLElement>('.si-pe-save')!.addEventListener('click', e => {
        e.stopPropagation();
        savePinEditForm(editForm, pinId);
    });
    editForm.querySelector<HTMLElement>('.si-pe-cancel')!.addEventListener('click', e => {
        e.stopPropagation();
        closePinEditForm();
        renderStructPins();
    });
}

function savePinEditForm(editForm: HTMLElement, pinId: string): void {
    const addr = readPinEditAddress(editForm);
    if (addr === null) { return; }
    const idx = S.structPins.findIndex(p => p.id === pinId);
    if (idx >= 0) { applyPinEdit(editForm, idx, addr); }
    closePinEditForm();
    renderStructPins();
}

function readPinEditAddress(editForm: HTMLElement): number | null {
    const addrInput = editForm.querySelector('.si-pe-addr') as HTMLInputElement;
    const addr = parseInt(addrInput.value.trim().replace(/^0x/i, ''), 16);
    if (!isNaN(addr)) { return addr; }
    addrInput.style.borderColor = 'var(--err)';
    return null;
}

function applyPinEdit(editForm: HTMLElement, idx: number, addr: number): void {
    const pin = S.structPins[idx];
    const nameVal = (editForm.querySelector('.si-pe-name') as HTMLInputElement).value.trim();
    const typeVal = (editForm.querySelector('.si-pe-type') as HTMLSelectElement).value;
    S.structPins[idx] = { ...pin, name: nameVal || pin.name, addr, structId: typeVal };
    S.activeStructAddr = addr;
    vscode.postMessage({ type: 'saveStructPins', pins: S.structPins });
}

function closePinEditForm(): void {
    _editingPinId = null;
    _editingPinDraftStructId = null;
}

function restoreStructSelection(sec: HTMLElement): void {
    restoreSelectedPin(sec);
    restoreSelectedValueRow(sec);
}

function restoreSelectedPin(sec: HTMLElement): void {
    if (_selectedPinId === null) { return; }
    sec.querySelectorAll<HTMLElement>('.si-card').forEach(card => {
        if (card.dataset.pinId === _selectedPinId) {
            card.classList.add('si-card-selected');
        }
    });
}

function restoreSelectedValueRow(sec: HTMLElement): void {
    if (restoreSelectedBitRow(sec)) { return; }
    if (restoreSelectedFieldRow(sec)) { return; }
    if (restoreSelectedArrayElement(sec)) { return; }
    restoreSelectedArrayGroup(sec);
}

function restoreSelectedBitRow(sec: HTMLElement): boolean {
    if (_selectedBitRowKey === null) { return false; }
    sec.querySelectorAll<HTMLElement>('.si-field[data-bit-start][data-bit-width]').forEach(row => {
        const meta = parseBitRowMeta(row);
        if (!meta) { return; }
        const key = makeBitRowKey(meta.byteStart, meta.bitStart, meta.bitWidth);
        if (key === _selectedBitRowKey) {
            row.classList.add('si-selected');
        }
    });
    return true;
}

function restoreSelectedFieldRow(sec: HTMLElement): boolean {
    if (_selectedFieldAddr === null) { return false; }
    sec.querySelectorAll<HTMLElement>('.si-field').forEach(row => {
        if (parseInt(row.dataset.byteStart!) === _selectedFieldAddr) {
            row.classList.add('si-selected');
        }
    });
    return true;
}

function restoreSelectedArrayElement(sec: HTMLElement): boolean {
    if (_selectedArrElemKey === null) { return false; }
    sec.querySelectorAll<HTMLElement>('.si-arr-el-hdr').forEach(hdr => {
        if (hdr.dataset.arrElKey === _selectedArrElemKey) {
            hdr.classList.add('si-selected');
        }
    });
    return true;
}

function restoreSelectedArrayGroup(sec: HTMLElement): void {
    if (_selectedArrKey === null) { return; }
    sec.querySelectorAll<HTMLElement>('.si-arr-grp-hdr').forEach(hdr => {
        const grp = hdr.closest<HTMLElement>('.si-arr-grp');
        if (grp?.dataset.arrKey === _selectedArrKey) {
            hdr.classList.add('si-selected');
        }
    });
}

// Floating per-field value-type menu
let _valMenuEl: HTMLElement | null = null;
function hideFieldValMenu(): void {
    if (_valMenuEl) { _valMenuEl.remove(); _valMenuEl = null; }
    if (typeof document === 'undefined') { return; }
    document.removeEventListener('click', hideFieldValMenu);
}

function addFieldValMenuClickAway(): void {
    setTimeout(() => {
        if (typeof document === 'undefined') { return; }
        document.addEventListener('click', hideFieldValMenu);
    }, 0);
}

function createFieldValMenu(innerHtml: string, x: number, y: number): HTMLElement {
    const el = document.createElement('div');
    el.id = 'si-val-menu'; el.className = 'si-val-menu ctx-menu';
    el.innerHTML = innerHtml;
    document.body.appendChild(el);
    positionContextMenu(el, x, y);
    return el;
}

function wireFieldValMenuCommands(el: HTMLElement, onCommand: (cmd: string) => void): void {
    el.querySelectorAll<HTMLElement>('.ctx-row[data-cmd]:not(.disabled)').forEach(row => {
        row.addEventListener('click', ev => {
            ev.stopPropagation();
            onCommand(row.dataset.cmd!);
        });
    });
}

function structPinAtAddress(addr: number, pinIdx: number | undefined, allDefs: StructDef[]): StructPin | undefined {
    if (typeof pinIdx === 'number' && pinIdx >= 0) { return S.structPins[pinIdx]; }
    return S.structPins.find(pin => {
        const def = allDefs.find(candidate => candidate.id === pin.structId);
        if (!def) { return false; }
        const size = structByteSize(def, S.structs);
        return addr >= pin.addr && addr < pin.addr + size;
    });
}

function structRowsAtAddress(addr: number, pinIdx: number | undefined, allDefs: StructDef[]): DecodedField[] {
    const pin = structPinAtAddress(addr, pinIdx, allDefs);
    if (!pin) { return []; }
    const def = allDefs.find(candidate => candidate.id === pin.structId);
    if (!def) { return []; }
    const rows = decodeStruct(def, pin.addr, getByte, S.endian, S.bitFieldAllocation, S.structs);
    return rows.filter(row => pin.addr + row.byteOffset === addr);
}

function sourceRowsAtAddress(
    addr: number,
    pinIdx: number | undefined,
    opts: FieldValMenuOptions,
    allDefs: StructDef[],
): DecodedField[] {
    const source = findCopySourceRows(addr, pinIdx, opts);
    return source
        ? source.rows.filter(row => source.baseAddr + row.byteOffset === addr)
        : structRowsAtAddress(addr, pinIdx, allDefs);
}

function parseBitValueKey(valKey: string): { bitStart: number; bitWidth: number } | null {
    const parts = valKey.split(':');
    const bitStart = parseDatasetInt(parts[2]);
    if (bitStart === null) { return null; }
    const bitWidth = parseDatasetInt(parts[3]);
    if (bitWidth === null) { return null; }
    return { bitStart, bitWidth };
}

function matchesBitValueKey(row: DecodedField, key: { bitStart: number; bitWidth: number }): boolean {
    if (!isBitFieldRow(row)) { return false; }
    if (row.bitOffset !== key.bitStart) { return false; }
    return row.bitWidth === key.bitWidth;
}

function findBitFieldForValueKey(rows: DecodedField[], valKey: string): DecodedField | undefined {
    const key = parseBitValueKey(valKey);
    return key ? rows.find(row => matchesBitValueKey(row, key)) : undefined;
}

type ValueKeyKind = 'default' | 'bit' | 'bitunit';

function valueKeyKind(valKey?: string): ValueKeyKind {
    if (valKey?.startsWith('bitunit:')) { return 'bitunit'; }
    if (valKey?.startsWith('bit:')) { return 'bit'; }
    return 'default';
}

function firstValueKeyField(rows: DecodedField[]): DecodedField | null {
    return rows[0] ?? null;
}

function bitUnitValueKeyField(rows: DecodedField[]): DecodedField | null {
    return buildBitUnitAggregateRow(rows.filter(isBitFieldRow));
}

function bitValueKeyField(rows: DecodedField[], valKey?: string): DecodedField | null {
    return valKey ? (findBitFieldForValueKey(rows, valKey) ?? firstValueKeyField(rows)) : firstValueKeyField(rows);
}

const VALUE_KEY_FIELD: Record<ValueKeyKind, (rows: DecodedField[], valKey?: string) => DecodedField | null> = {
    default: firstValueKeyField,
    bit: bitValueKeyField,
    bitunit: bitUnitValueKeyField,
};

function findFieldForValueKey(rows: DecodedField[], addr: number, valKey?: string): DecodedField | null {
    const atAddr = rows.filter(row => row.byteOffset === addr);
    return VALUE_KEY_FIELD[valueKeyKind(valKey)](atAddr, valKey);
}

function handleArrayHeaderMenuCommand(
    cmd: string,
    bs: number,
    bsList: number[] | undefined,
    keyList: string[] | undefined,
    findFieldAt: (addr: number) => DecodedField | null,
): void {
    if (cmd === 'copy-addr') {
        copyAddressToClipboard(bs);
        return;
    }
    if (!cmd.startsWith('disp-')) { return; }
    if (!hasValueRows(bsList)) { return; }
    applyArrayHeaderDisplayType(cmd.replace('disp-', '') as ColType, bsList, keyList, findFieldAt);
    hideFieldValMenu();
    renderStructPins();
}

function copyAddressToClipboard(bs: number): void {
    copyTextToClipboard(`0x${bs.toString(16).toUpperCase().padStart(8, '0')}`);
    hideFieldValMenu();
}

function hasValueRows(bsList: number[] | undefined): bsList is number[] {
    return Boolean(bsList && bsList.length > 0);
}

function applyArrayHeaderDisplayType(
    t: ColType,
    bsList: number[],
    keyList: string[] | undefined,
    findFieldAt: (addr: number) => DecodedField | null,
): void {
    bsList.forEach((b, idx) => {
        setArrayHeaderDisplayType(t, b, keyList?.[idx], findFieldAt);
    });
}

function setArrayHeaderDisplayType(
    t: ColType,
    byteStart: number,
    keyOverride: string | undefined,
    findFieldAt: (addr: number) => DecodedField | null,
): void {
    const listKey = keyOverride ?? scalarValKey(byteStart);
    const field = findFieldAt(byteStart);
    const implicit = implicitDisplayType(field, listKey.startsWith('bitunit:'));
    if (t === implicit) { _fieldValTypes.delete(listKey); }
    else { _fieldValTypes.set(listKey, t); }
}

function updateHoveredBitRow(ev: MouseEvent, sec: HTMLElement): void {
    const target = ev.target as HTMLElement | null;
    const bitRow = target?.closest<HTMLElement>('.si-field[data-bit-start][data-bit-width]') ?? null;
    const hover = bitRowHoverState(bitRow);
    if (_hoveredBitRowKey === hover.key) { return; }
    _hoveredBitRange = hover.range;
    _hoveredBitRowKey = hover.key;
    applyBitHighlightsInPlace(sec);
}

function bitRowHoverState(bitRow: HTMLElement | null): { range: { parentByteStart: number; startBit: number; endBit: number } | null; key: string | null } {
    if (!bitRow) { return { range: null, key: null }; }
    const meta = parseBitRowMeta(bitRow);
    if (!meta) { return { range: null, key: null }; }
    return bitSelectionState(meta);
}

function bitSelectionState(meta: { byteStart: number; bitStart: number; bitWidth: number }): { range: { parentByteStart: number; startBit: number; endBit: number }; key: string } {
    return {
        range: { parentByteStart: meta.byteStart, startBit: meta.bitStart, endBit: meta.bitStart + meta.bitWidth - 1 },
        key: makeBitRowKey(meta.byteStart, meta.bitStart, meta.bitWidth),
    };
}

function selectBitRow(row: HTMLElement, sec: HTMLElement): void {
    applyBitRowSelection(parseBitRowMeta(row));
    clearFieldSelectionState();
    clearSelRow();
    row.classList.add('si-selected');
    applyBitHighlightsInPlace(sec);
}

function applyBitRowSelection(meta: ReturnType<typeof parseBitRowMeta>): void {
    if (!meta) {
        _selectedBitRange = null;
        _selectedBitRowKey = null;
        return;
    }
    const state = bitSelectionState(meta);
    _selectedBitRange = state.range;
    _selectedBitRowKey = state.key;
}

function clearFieldSelectionState(): void {
    _hoveredBitRange = null;
    _hoveredBitRowKey = null;
    _selectedFieldAddr = null;
    _selectedArrKey = null;
    _selectedArrElemKey = null;
}

function selectStructFieldRow(row: HTMLElement, start: number, cnt: number): void {
    clearArrSep();
    clearSelRow();
    clearBitSelectionState();
    S.selStart = start;
    S.selEnd = start + cnt - 1;
    row.classList.add('si-selected');
    _selectedFieldAddr = start;
    _selectedArrKey = null;
    _selectedArrElemKey = null;
    import('../memory/memoryView.js').then(m => { m.applySel(); m.scrollTo(start); });
    import('./sidebar.js').then(m => m.updateInspector());
    renderStructPins();
}

function clearBitSelectionState(): void {
    _selectedBitRange = null;
    _hoveredBitRange = null;
    _selectedBitRowKey = null;
    _hoveredBitRowKey = null;
}

function selectArrayGroupHeader(e: MouseEvent, hdr: HTMLElement, start: number, cnt: number, isBitUnitHdr: boolean): void {
    if (shouldSkipArrayGroupClick(e, isBitUnitHdr)) { return; }
    clearStructSelectionVisuals();
    if (hasInvalidRange(start, cnt)) { return; }
    const grp = hdr.closest<HTMLElement>('.si-arr-grp')!;
    _selectedArrKey = grp.dataset.arrKey!;
    _selectedArrElemKey = null;
    _selectedFieldAddr = null;
    markArraySeparators(arrayGroupSeparatorRows(grp));
    selectStructRange(hdr, start, cnt);
}

function shouldSkipArrayGroupClick(e: MouseEvent, isBitUnitHdr: boolean): boolean {
    return isBitUnitHdr || Boolean((e.target as HTMLElement).closest('.si-arr-exp-btn'));
}

function hasInvalidRange(start: number, cnt: number): boolean {
    return isNaN(start) || isNaN(cnt);
}

function selectPointerHeaderRange(e: MouseEvent, hdr: HTMLElement, start: number, cnt: number): void {
    if ((e.target as HTMLElement).closest('.si-arr-exp-btn')) { return; }
    clearStructSelectionVisuals();
    if (hasInvalidRange(start, cnt)) { return; }
    selectStructRange(hdr, start, cnt);
}

function followPointerHeaderValue(hdr: HTMLElement): void {
    const storageStart = parseInt(hdr.dataset.pointerStorageStart ?? '');
    const pinIdx = pinIndexFromHeader(hdr);
    const valKey = hdr.dataset.valKey ?? scalarValKey(storageStart);
    followPointerAt(storageStart, pinIdx, valKey, sourceContextOptions(hdr));
}

function arrayGroupSeparatorRows(grp: HTMLElement): HTMLElement[] {
    const elementHeaders = Array.from(grp.querySelectorAll<HTMLElement>('.si-arr-el-hdr'));
    return elementHeaders.length > 0 ? elementHeaders : Array.from(grp.querySelectorAll<HTMLElement>('.si-field'));
}

function openArrayHeaderValueMenu(ev: MouseEvent, hdr: HTMLElement): void {
    if (hdr.classList.contains('si-bitunit-hdr')) { return; }
    ev.preventDefault();
    ev.stopPropagation();
    const directValueRows = directArrayHeaderValueRows(hdr);
    const bsList = directValueRows.map(rowByteStart);
    const start = bsList[0];
    if (start === undefined) { return; }
    const keyList = directValueRows.map(rowValueKey);
    const pinIdx = pinIndexFromHeader(hdr);
    showFieldValMenu(ev.clientX, ev.clientY, start, bsList, pinIdx, { isArrayHeader: true, keyList });
}

function openPointerHeaderValueMenu(ev: MouseEvent, hdr: HTMLElement): void {
    ev.preventDefault();
    ev.stopPropagation();
    const storageStart = parseInt(hdr.dataset.pointerStorageStart ?? '');
    if (isNaN(storageStart)) { return; }
    const pinIdx = pinIndexFromHeader(hdr);
    const valKey = hdr.dataset.valKey ?? scalarValKey(storageStart);
    showFieldValMenu(ev.clientX, ev.clientY, storageStart, undefined, pinIdx, {
        isPointer: true,
        valKey,
        pointerAllowCreate: hdr.dataset.pointerAllowCreate === 'true',
        ...sourceContextOptions(hdr),
    });
}

function directArrayHeaderValueRows(hdr: HTMLElement): HTMLElement[] {
    const body = arrayGroupBody(hdr);
    return body ? Array.from(body.children).flatMap(directValueRowsFromChild) : [];
}

function arrayGroupBody(hdr: HTMLElement): HTMLElement | undefined {
    const grp = hdr.closest<HTMLElement>('.si-arr-grp')!;
    return Array.from(grp.children).find(isArrayGroupBody) as HTMLElement | undefined;
}

function isArrayGroupBody(child: Element): boolean {
    return child.classList.contains('si-arr-grp-body');
}

function directValueRowsFromChild(child: Element): HTMLElement[] {
    const childEl = child as HTMLElement;
    if (childEl.classList.contains('si-field')) { return [childEl]; }
    if (childEl.classList.contains('si-arr-el-grp')) { return nestedValueHeaderRows(childEl); }
    return [];
}

function nestedValueHeaderRows(child: HTMLElement): HTMLElement[] {
    const hdr = Array.from(child.children).find(isNestedValueHeader) as HTMLElement | undefined;
    return hdr ? [hdr] : [];
}

function isNestedValueHeader(child: Element): boolean {
    return child.classList.contains('si-arr-el-hdr') && child.classList.contains('si-field');
}

function rowByteStart(row: HTMLElement): number {
    return parseInt(row.dataset.byteStart!);
}

function rowValueKey(row: HTMLElement): string {
    return row.dataset.valKey ?? scalarValKey(rowByteStart(row));
}

function pinIndexFromHeader(hdr: HTMLElement): number {
    const card = hdr.closest<HTMLElement>('.si-card');
    return card ? parseInt(card.dataset.idx!) : -1;
}

function sourceContextOptions(el: HTMLElement): Pick<FieldValMenuOptions, 'sourceStructId' | 'sourceBaseAddr'> {
    const sourceStructId = el.dataset.sourceStructId;
    const sourceBaseAddr = parseOptionalInt(el.dataset.sourceBaseAddr);
    return sourceStructId && sourceBaseAddr !== undefined ? { sourceStructId, sourceBaseAddr } : {};
}

function parseOptionalInt(raw: string | undefined): number | undefined {
    if (raw === undefined) { return undefined; }
    const parsed = parseInt(raw);
    return isNaN(parsed) ? undefined : parsed;
}

type FieldValMenuOptions = {
    isPointer?: boolean;
    isArrayHeader?: boolean;
    isBitUnitHeader?: boolean;
    valKey?: string;
    keyList?: string[];
    pointerAllowCreate?: boolean;
    sourceStructId?: string;
    sourceBaseAddr?: number;
};

type FieldValMenuContext = {
    bs: number;
    bsList: number[] | undefined;
    pinIdx: number | undefined;
    opts: FieldValMenuOptions;
    key: string;
    types: ColType[];
    cur: ColType | null;
    findFieldAt: (addr: number) => DecodedField | null;
};

function showFieldValMenu(
    x: number,
    y: number,
    bs: number,
    bsList?: number[],
    pinIdx?: number,
    opts: FieldValMenuOptions = {},
): void {
    hideFieldValMenu();
    const ctx = createFieldValMenuContext(bs, bsList, pinIdx, opts);

    if (opts.isArrayHeader) {
        showArrayHeaderFieldValMenu(ctx, x, y);
        return;
    }
    if (opts.isPointer) {
        showPointerFieldValMenu(ctx, x, y);
        return;
    }
    showScalarFieldValMenu(ctx, x, y);
}

function createFieldValMenuContext(
    bs: number,
    bsList: number[] | undefined,
    pinIdx: number | undefined,
    opts: FieldValMenuOptions,
): FieldValMenuContext {
    const allDefs = allStructs(S.structs);
    const findRowsAt = (addr: number): DecodedField[] => sourceRowsAtAddress(addr, pinIdx, opts, allDefs);
    const findFieldAt = (addr: number): DecodedField | null => findRowsAt(addr)[0] ?? null;
    const sampleField = findFieldAt(sampleAddress(bs, bsList));
    const key = opts.valKey ?? scalarValKey(bs);
    return {
        bs,
        bsList,
        pinIdx,
        opts,
        key,
        types: fieldValueMenuTypes(bs, bsList, opts, sampleField, findRowsAt),
        cur: currentFieldValueType(bs, bsList, opts, key, sampleField, findFieldAt),
        findFieldAt,
    };
}

function sampleAddress(bs: number, bsList: number[] | undefined): number {
    return bsList && bsList.length > 0 ? bsList[0] : bs;
}

function fieldValueMenuTypes(
    bs: number,
    bsList: number[] | undefined,
    opts: FieldValMenuOptions,
    sampleField: DecodedField | null,
    findRowsAt: (addr: number) => DecodedField[],
): ColType[] {
    if (opts.isBitUnitHeader) { return bitUnitMenuTypes([bs], findRowsAt); }
    if (arrayHeaderHasBitUnits(opts)) { return bitUnitMenuTypes(bsList ?? [bs], findRowsAt); }
    return sampleFieldValueTypes(sampleField);
}

function arrayHeaderHasBitUnits(opts: FieldValMenuOptions): boolean {
    return !!opts.isArrayHeader && (opts.keyList?.some(k => k.startsWith('bitunit:')) ?? false);
}

function bitUnitMenuTypes(addresses: number[], findRowsAt: (addr: number) => DecodedField[]): ColType[] {
    const hasPartialUnit = addresses.some(addr => !bitUnitUsesFullStorage(findRowsAt(addr)));
    return hasPartialUnit ? ['bin', 'bin-sliced', 'hex', 'dec'] : ['bin', 'hex', 'dec'];
}

function sampleFieldValueTypes(sampleField: DecodedField | null): ColType[] {
    if (!sampleField) { return ['hex', 'dec', 'bin', 'ascii']; }
    const typeMenu = SAMPLE_TYPE_MENUS[sampleField.type];
    if (typeMenu) { return typeMenu; }
    if (isBitFieldRow(sampleField)) { return ['bin', 'hex', 'dec']; }
    return ['hex', 'dec', 'bin', 'ascii'];
}

function currentFieldValueType(
    bs: number,
    bsList: number[] | undefined,
    opts: FieldValMenuOptions,
    key: string,
    sampleField: DecodedField | null,
    findFieldAt: (addr: number) => DecodedField | null,
): ColType | null {
    if (bsList && bsList.length > 0) {
        return commonFieldValueType(bsList, opts.keyList, findFieldAt);
    }
    const implicit = implicitDisplayType(sampleField, !!opts.isBitUnitHeader);
    return _fieldValTypes.get(key) ?? implicit;
}

function commonFieldValueType(
    bsList: number[],
    keyList: string[] | undefined,
    findFieldAt: (addr: number) => DecodedField | null,
): ColType | null {
    const vals = bsList.map((b, idx) => {
        const listKey = keyList?.[idx] ?? scalarValKey(b);
        const field = findFieldAt(b);
        const implicit = implicitDisplayType(field, listKey.startsWith('bitunit:'));
        return _fieldValTypes.get(listKey) ?? implicit;
    });
    return vals.every(v => v === vals[0]) ? vals[0] : null;
}

function menuItemHtml(cmd: string, label: string, hint = ''): string {
    return (
        `<div class="ctx-row" data-cmd="${cmd}">` +
        `<span class="ctx-label">${esc(label)}</span>` +
        (hint ? `<span class="ctx-hint">${esc(hint)}</span>` : '') +
        `</div>`
    );
}

function disabledMenuItemHtml(label: string, hint: string): string {
    return (
        `<div class="ctx-row disabled">` +
        `<span class="ctx-label">${esc(label)}</span>` +
        `<span class="ctx-hint">${esc(hint)}</span>` +
        `</div>`
    );
}

function pointerSourceSubtitleHtml(pin: StructPin): string {
    const source = pin.pointerSources?.[0];
    if (!source) { return ''; }
    const addr = formatHex(source.pointerStorageAddress, 8);
    return `<div class="si-csource">from ${esc(source.sourcePinName)}.${esc(source.sourceFieldPath)} @${esc(addr)}</div>`;
}

function menuSubHtml(label: string, id: string, body: string): string {
    return (
        `<div class="ctx-row ctx-has-sub" data-sub="${id}">` +
        `<span class="ctx-label">${esc(label)}</span>` +
        `<div class="ctx-submenu">${body}</div>` +
        `</div>`
    );
}

function menuSeparatorHtml(): string {
    return `<div class="ctx-sep"></div>`;
}

function displayMenuHtml(types: ColType[], cur: ColType | null): string {
    return types.map(t =>
        `<div class="ctx-row${t === cur ? ' active' : ''}" data-cmd="disp-${t}">` +
        `<span class="ctx-label">${TYPE_LABELS[t]}</span>` +
        `</div>`
    ).join('');
}

function showArrayHeaderFieldValMenu(ctx: FieldValMenuContext, x: number, y: number): void {
    const el = createFieldValMenu(
        menuItemHtml('copy-addr', 'Copy address') +
        menuSeparatorHtml() +
        menuSubHtml('View as', 'disp', displayMenuHtml(ctx.types, ctx.cur)),
        x,
        y,
    );
    wireFieldValMenuCommands(el, cmd => {
        handleArrayHeaderMenuCommand(cmd, ctx.bs, ctx.bsList, ctx.opts.keyList, ctx.findFieldAt);
    });
    finishFieldValMenu(el);
}

function showPointerFieldValMenu(ctx: FieldValMenuContext, x: number, y: number): void {
    const source = pointerMenuSource(ctx);
    const row = source?.row ?? null;
    const el = createFieldValMenu(
        pointerMenuHtml(row, source, ctx.opts.pointerAllowCreate === true),
        x,
        y,
    );
    wireFieldValMenuCommands(el, cmd => handlePointerMenuCommand(cmd, ctx, row, source));
    finishFieldValMenu(el);
}

function pointerMenuHtml(row: DecodedField | null, source: PointerMenuSource | null, allowCreate: boolean): string {
    return menuItemHtml('copy-hex', 'Copy value') +
        menuSeparatorHtml() +
        pointerJumpMenuHtml(row) +
    (allowCreate ? pointerCreateMenuHtml(source) : '');
}

function pointerJumpMenuHtml(row: DecodedField | null): string {
    const jump = pointerFollowState(row);
    return jump.ok
        ? menuItemHtml('jump-ptr', 'Jump to Address')
        : disabledMenuItemHtml('Jump to Address', jump.reason);
}

function pointerCreateMenuHtml(source: PointerMenuSource | null): string {
    const create = structPointerCreateState(source);
    if (create === null) { return ''; }
    return create.ok
        ? menuItemHtml('create-struct-ptr', 'Create Struct Instance')
        : disabledMenuItemHtml('Create Struct Instance', create.reason);
}

function handlePointerMenuCommand(
    cmd: string,
    ctx: FieldValMenuContext,
    row: DecodedField | null,
    source: PointerMenuSource | null,
): void {
    if (cmd === 'jump-ptr') {
        followPointerRow(row);
        hideFieldValMenu();
        return;
    }
    if (cmd === 'create-struct-ptr') {
        createStructInstanceFromPointer(source);
        hideFieldValMenu();
        return;
    }
    copyPointerFieldValue(ctx);
}

type CopySourceRows = { pin: StructPin; rows: DecodedField[]; structId: string; baseAddr: number };
type PointerMenuSource = { pin: StructPin; row: DecodedField; sourceStructId: string; sourceBaseAddr: number };

function pointerMenuSource(ctx: FieldValMenuContext): PointerMenuSource | null {
    const source = findCopySourceRows(ctx.bs, ctx.pinIdx, ctx.opts);
    if (!source) { return null; }
    const row = findFieldForValueKey(source.rows, ctx.bs - source.baseAddr, ctx.opts.valKey);
    return row ? { pin: source.pin, row, sourceStructId: source.structId, sourceBaseAddr: source.baseAddr } : null;
}

function pointerMenuField(ctx: FieldValMenuContext): DecodedField | null {
    return pointerMenuSource(ctx)?.row ?? null;
}

type PointerFollowState = { ok: true } | { ok: false; reason: string };

function pointerFollowState(row: DecodedField | null): PointerFollowState {
    const reason = POINTER_FOLLOW_GUARDS.map(guard => guard(row)).find(Boolean);
    return reason ? { ok: false, reason } : { ok: true };
}

type PointerFollowGuard = (row: DecodedField | null) => string | null;
const POINTER_FOLLOW_GUARDS: PointerFollowGuard[] = [
    row => row?.isPointer ? null : 'not pointer',
    row => row?.hasData && row.pointerValue !== undefined ? null : 'missing',
    row => row?.pointerValue === 0 ? 'null' : null,
    row => pointerTargetFullyMapped(row) ? null : 'unmapped',
];

function pointerTargetFullyMapped(row: DecodedField | null): boolean {
    const target = pointerMapTarget(row);
    if (!target) { return true; }
    return pointerTargetBytes(target.addr, target.byteCount).every(addr => getByte(addr) !== undefined);
}

function pointerMapTarget(row: DecodedField | null): { addr: number; byteCount: number } | null {
    if (!row) { return null; }
    if (!row.isPointer) { return null; }
    if (row.pointerValue === undefined) { return null; }
    return { addr: row.pointerValue, byteCount: pointerMapByteCount(row) };
}

function pointerMapByteCount(row: DecodedField): number {
    const declared = row.pointerTargetByteSize;
    if (declared === undefined) { return 1; }
    return declared > 1 ? declared : 1;
}

function pointerTargetBytes(addr: number, byteCount: number): number[] {
    return Array.from({ length: byteCount }, (_, index) => addr + index);
}

function followPointerAt(byteStart: number, pinIdx: number, valKey: string, opts: FieldValMenuOptions = {}): void {
    const source = findCopySourceRows(byteStart, pinIdx, opts);
    if (!source) { return; }
    const row = findFieldForValueKey(source.rows, byteStart - source.baseAddr, valKey);
    followPointerRow(row);
}

function followPointerRow(row: DecodedField | null): void {
    const target = pointerFollowTarget(row);
    if (!target) { return; }
    selectPointerTarget(target.addr, target.byteCount);
}

function pointerFollowTarget(row: DecodedField | null): { addr: number; byteCount: number; structId?: string } | null {
    if (!pointerFollowState(row).ok) { return null; }
    return buildPointerFollowTarget(row as DecodedField & { pointerValue: number });
}

function buildPointerFollowTarget(row: DecodedField & { pointerValue: number }): { addr: number; byteCount: number; structId?: string } {
    const addr = row.pointerValue;
    return structPointerFollowTarget(row, addr) ?? scalarPointerFollowTarget(row, addr);
}

function structPointerFollowTarget(row: DecodedField, addr: number): { addr: number; byteCount: number; structId: string } | null {
    const def = pointerTargetStructDef(row);
    if (!def || !row.pointerTargetStructId) { return null; }
    return { addr, byteCount: structByteSize(def, S.structs), structId: row.pointerTargetStructId };
}

function pointerTargetStructDef(row: DecodedField): StructDef | undefined {
    if (row.pointerTargetType !== 'struct' || !row.pointerTargetStructId) { return undefined; }
    return allStructs(S.structs).find(candidate => candidate.id === row.pointerTargetStructId);
}

function scalarPointerFollowTarget(row: DecodedField, addr: number): { addr: number; byteCount: number } {
    return { addr, byteCount: Math.max(1, row.pointerTargetByteSize ?? 1) };
}

type StructPointerCreateState =
    | { ok: true; def: StructDef; addr: number; structId: string }
    | { ok: false; reason: string }
    | null;

function structPointerCreateState(source: PointerMenuSource | null): StructPointerCreateState {
    const row = source?.row;
    if (!isStructPointerMenuRow(row)) { return null; }
    return validStructPointerCreateState(row);
}

function isStructPointerMenuRow(row: DecodedField | undefined): row is DecodedField {
    return !!row && row.pointerTargetType === 'struct';
}

function validStructPointerCreateState(row: DecodedField): Exclude<StructPointerCreateState, null> {
    const follow = pointerFollowState(row);
    if (!follow.ok) { return { ok: false, reason: follow.reason }; }
    return resolvedStructPointerCreateState(row);
}

function resolvedStructPointerCreateState(row: DecodedField): Exclude<StructPointerCreateState, null> {
    const structId = row.pointerTargetStructId;
    const def = pointerTargetStructDef(row);
    if (!structId || !def || row.pointerValue === undefined) { return { ok: false, reason: 'unknown target' }; }
    return { ok: true, def, addr: row.pointerValue, structId };
}

function createStructInstanceFromPointer(source: PointerMenuSource | null): void {
    const state = structPointerCreateState(source);
    if (!state?.ok || !source) { return; }
    const pointerSource = makeStructPointerSource(source, state.addr);
    const pin = ensurePointerStructPin(source, state, pointerSource);
    selectCreatedPointerPin(pin, state);
    vscode.postMessage({ type: 'saveStructPins', pins: S.structPins });
    renderStructPins();
}

function ensurePointerStructPin(
    source: PointerMenuSource,
    state: Extract<StructPointerCreateState, { ok: true }>,
    pointerSource: StructPointerSource,
): StructPin {
    const pin = S.structPins.find(candidate => candidate.addr === state.addr && candidate.structId === state.structId);
    if (pin) {
        addPointerSourceToExistingPin(pin, pointerSource);
        return pin;
    }
    return appendPointerStructPin(source, state, pointerSource);
}

function appendPointerStructPin(
    source: PointerMenuSource,
    state: Extract<StructPointerCreateState, { ok: true }>,
    pointerSource: StructPointerSource,
): StructPin {
    const pin = createPointerStructPin(source, state, pointerSource);
    S.structPins = [...S.structPins, pin];
    return pin;
}

function selectCreatedPointerPin(pin: StructPin, state: Extract<StructPointerCreateState, { ok: true }>): void {
    _expanded.add(pin.id);
    _selectedPinId = pin.id;
    S.activeStructAddr = state.addr;
    selectPointerTarget(state.addr, structByteSize(state.def, S.structs));
}

function createPointerStructPin(
    source: PointerMenuSource,
    state: Extract<StructPointerCreateState, { ok: true }>,
    pointerSource: StructPointerSource,
): StructPin {
    return {
        id: `pin_${Date.now()}`,
        structId: state.structId,
        addr: state.addr,
        name: nextPointerStructPinName(source.pin.name, source.row.fieldName, state.addr),
        pointerSources: [pointerSource],
    };
}

function nextPointerStructPinName(sourceName: string, fieldPath: string, targetAddr: number): string {
    const base = `${sourceName}.${fieldPath} @${targetAddr.toString(16).toUpperCase().padStart(8, '0')}`;
    return uniqueStructPinName(base, n => `${base}_${n}`);
}

function makeStructPointerSource(source: PointerMenuSource, targetAddress: number): StructPointerSource {
    return {
        sourcePinId: source.pin.id,
        sourcePinName: source.pin.name,
        sourceStructId: source.sourceStructId,
        sourceFieldPath: source.row.fieldName,
        pointerStorageAddress: source.sourceBaseAddr + source.row.byteOffset,
        targetAddress,
    };
}

function addPointerSourceToExistingPin(pin: StructPin, source: StructPointerSource): void {
    if (pin.pointerSources?.some(existing => samePointerSource(existing, source))) { return; }
    pin.pointerSources = [...(pin.pointerSources ?? []), source];
}

function samePointerSource(a: StructPointerSource, b: StructPointerSource): boolean {
    return pointerSourceIdentity(a).every((value, idx) => value === pointerSourceIdentity(b)[idx]);
}

function pointerSourceIdentity(source: StructPointerSource): Array<string | number> {
    return [
        source.sourcePinId,
        source.sourceStructId,
        source.sourceFieldPath,
        source.pointerStorageAddress,
        source.targetAddress,
    ];
}

function selectPointerTarget(addr: number, byteCount: number): void {
    S.selStart = addr;
    S.selEnd = addr + Math.max(1, byteCount) - 1;
    rerender.toMemory();
    import('../memory/memoryView.js').then(m => { m.applySel(); m.scrollTo(addr); });
    import('./sidebar.js').then(m => m.updateInspector());
}

function showScalarFieldValMenu(ctx: FieldValMenuContext, x: number, y: number): void {
    const el = createFieldValMenu(
        menuSubHtml('Copy as', 'copy', copyMenuHtml(ctx.types)) +
        menuSeparatorHtml() +
        menuSubHtml('View as', 'disp', displayMenuHtml(ctx.types, ctx.cur)),
        x,
        y,
    );
    wireFieldValMenuCommands(el, cmd => handleScalarValueMenuCommand(cmd, ctx));
    finishFieldValMenu(el);
}

function copyMenuHtml(types: ColType[]): string {
    return types.map(t => menuItemHtml(`copy-${t}`, TYPE_LABELS[t], '')).join('');
}

function finishFieldValMenu(el: HTMLElement): void {
    wireStructSubmenus(el);
    addFieldValMenuClickAway();
    _valMenuEl = el;
}

function copyPointerFieldValue(ctx: FieldValMenuContext): void {
    const source = pointerMenuSource(ctx);
    const row = source?.row ?? null;
    copyTextToClipboard(row ? singleLineCopyText(getCopyText(row, 'hex')) : '??');
    hideFieldValMenu();
}

function handleScalarValueMenuCommand(cmd: string, ctx: FieldValMenuContext): void {
    if (cmd.startsWith('copy-')) {
        copyScalarFieldValue(cmd.replace('copy-', '') as ColType, ctx);
        return;
    }
    if (cmd.startsWith('disp-')) {
        setScalarDisplayType(cmd.replace('disp-', '') as ColType, ctx);
    }
}

function copyScalarFieldValue(type: ColType, ctx: FieldValMenuContext): void {
    const source = findCopySourceRows(ctx.bs, ctx.pinIdx, ctx.opts);
    if (!source) { hideFieldValMenu(); return; }
    const text = ctx.bsList && ctx.bsList.length > 0
        ? copyListText(ctx.bsList, ctx.opts.keyList, source.rows, source.baseAddr, type)
        : copySingleText(ctx.bs, ctx.opts.valKey, source.rows, source.baseAddr, type);
    copyTextToClipboard(text);
    hideFieldValMenu();
}

function copyListText(bsList: number[], keyList: string[] | undefined, rows: DecodedField[], pinAddr: number, type: ColType): string {
    return bsList.map((b, idx) => copySingleText(b, keyList?.[idx], rows, pinAddr, type)).join('; ');
}

function copySingleText(bs: number, key: string | undefined, rows: DecodedField[], pinAddr: number, type: ColType): string {
    const row = findFieldForValueKey(rows, bs - pinAddr, key);
    return row ? singleLineCopyText(getCopyText(row, type)) : '??';
}

function setScalarDisplayType(type: ColType, ctx: FieldValMenuContext): void {
    const field = ctx.findFieldAt(ctx.bs);
    const implicit = implicitDisplayType(field, !!ctx.opts.isBitUnitHeader);
    if (type === implicit) { _fieldValTypes.delete(ctx.key); }
    else { _fieldValTypes.set(ctx.key, type); }
    hideFieldValMenu();
    renderStructPins();
}
function wireStructSubmenus(menuEl: HTMLElement): void {
    wireHoverSubmenus(menuEl);
}

function findCopySourcePin(bs: number, pinIdx: number | undefined, defs: StructDef[]): StructPin | undefined {
    if (typeof pinIdx === 'number' && pinIdx >= 0) {
        return S.structPins[pinIdx];
    }
    return S.structPins.find(p => {
        const def = defs.find(d => d.id === p.structId);
        if (!def) { return false; }
        const size = structByteSize(def, S.structs);
        return bs >= p.addr && bs < p.addr + size;
    });
}

function findCopySourceRows(bs: number, pinIdx: number | undefined, opts: FieldValMenuOptions = {}): CopySourceRows | undefined {
    const explicit = findExplicitCopySourceRows(pinIdx, opts);
    if (explicit) { return explicit; }
    const all = allStructs(S.structs);
    const pin = findCopySourcePin(bs, pinIdx, all);
    if (!pin) { return undefined; }
    const def = all.find(d => d.id === pin.structId);
    if (!def) { return undefined; }
    return {
        pin,
        rows: decodeStruct(def, pin.addr, getByte, S.endian, S.bitFieldAllocation, S.structs),
        structId: def.id,
        baseAddr: pin.addr,
    };
}

function findExplicitCopySourceRows(pinIdx: number | undefined, opts: FieldValMenuOptions): CopySourceRows | undefined {
    const context = explicitSourceContext(opts);
    if (!context) { return undefined; }
    const pin = copySourcePinFromIndex(pinIdx);
    const def = structDefById(context.structId);
    if (!pin || !def) { return undefined; }
    return {
        pin,
        rows: decodeStruct(def, context.baseAddr, getByte, S.endian, S.bitFieldAllocation, S.structs),
        structId: def.id,
        baseAddr: context.baseAddr,
    };
}

function explicitSourceContext(opts: FieldValMenuOptions): { structId: string; baseAddr: number } | undefined {
    return opts.sourceStructId && typeof opts.sourceBaseAddr === 'number'
        ? { structId: opts.sourceStructId, baseAddr: opts.sourceBaseAddr }
        : undefined;
}

function copySourcePinFromIndex(pinIdx: number | undefined): StructPin | undefined {
    return typeof pinIdx === 'number' && pinIdx >= 0 ? S.structPins[pinIdx] : undefined;
}

function structDefById(structId: string): StructDef | undefined {
    return allStructs(S.structs).find(d => d.id === structId);
}

function copyTextToClipboard(text: string): void {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(() => fallbackCopyText(text));
    } else {
        fallbackCopyText(text);
    }
}

function toggleCompositeGroup(
    hdr: HTMLElement,
    expBtn: HTMLElement,
    groupSelector: string,
    bodySelector: string,
    keyName: string,
    expandedKeys: Set<string>,
): void {
    const grp = hdr.closest<HTMLElement>(groupSelector)!;
    const key = grp.dataset[keyName]!;
    const body = grp.querySelector<HTMLElement>(bodySelector)!;
    const isOpen = expandedKeys.has(key);
    if (isOpen) {
        expandedKeys.delete(key);
        grp.classList.remove('open');
        body.style.display = 'none';
        expBtn.textContent = '▸';
        syncCompositeHeaderOffset(hdr, false);
        return;
    }
    expandedKeys.add(key);
    grp.classList.add('open');
    body.style.display = '';
    expBtn.textContent = '▾';
    syncCompositeHeaderOffset(hdr, true);
}

function wireStructHoverRange(el: HTMLElement, start: number, count: number): void {
    el.addEventListener('mouseenter', () => {
        for (let i = 0; i < count; i++) {
            highlightAddress(start + i, 'struct-h');
        }
    });
    el.addEventListener('mouseleave', () => {
        document.querySelectorAll<HTMLElement>('.struct-h')
            .forEach(node => node.classList.remove('struct-h'));
    });
}

function highlightAddress(addr: number, className: string): void {
    const ah = addr.toString(16).toUpperCase().padStart(8, '0');
    document.querySelectorAll<HTMLElement>(`[data-addr="${ah}"]`)
        .forEach(el => el.classList.add(className));
}

function clearStructSelectionVisuals(): void {
    clearArrSep();
    clearSelRow();
    _selectedBitRange = null;
    _hoveredBitRange = null;
    _selectedBitRowKey = null;
    _hoveredBitRowKey = null;
}

function markArraySeparators(rows: HTMLElement[]): void {
    rows.forEach((row, i) => {
        if (i === 0) { return; }
        const bs = parseInt(row.dataset.byteStart!);
        if (isNaN(bs)) { return; }
        _arrSepAddrs.push(bs);
        highlightAddress(bs, 'struct-arr-sep');
    });
}

function selectStructRange(el: HTMLElement, start: number, count: number): void {
    S.selStart = start;
    S.selEnd = start + count - 1;
    el.classList.add('si-selected');
    import('../memory/memoryView.js').then(m => { m.applySel(); m.scrollTo(start); });
    import('./sidebar.js').then(m => m.updateInspector());
}

function fallbackCopyText(text: string): void {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
}

// ── Selection sync ────────────────────────────────────────────────

/** Called when the user's byte selection changes. Fills the add-form address if open. */
export function onSelectionChangeForStruct(): void {
    if (typeof document === 'undefined') { return; }
    clearStructSelectionState();
    if (S.selStart === null) { return; }
    S.activeStructAddr = S.selStart;
    updateStructAddressInputs(S.selStart);
}

function clearStructSelectionState(): void {
    clearArrSep();
    clearSelRow();
    _selectedFieldAddr = null;
    _selectedArrKey    = null;
    _selectedArrElemKey = null;
    _selectedPinId     = null;
}

function updateStructAddressInputs(addr: number): void {
    if (S.sidebarTab !== 'struct') { return; }
    const addrHex = addr.toString(16).toUpperCase().padStart(8, '0');
    if (_addingPin) {
        updateAddPinAddressInput(addrHex);
        return;
    }
    if (_editingPinId) { updateEditPinAddressInput(addrHex); }
}

function updateAddPinAddressInput(addrHex: string): void {
    const inp = document.getElementById('sa-addr') as HTMLInputElement | null;
    if (!inp) { return; }
    inp.value = addrHex;
    const confirmBtn = document.getElementById('sa-confirm') as HTMLButtonElement | null;
    if (confirmBtn) { confirmBtn.disabled = !_applyStructId; }
}

function updateEditPinAddressInput(addrHex: string): void {
    const inp = document.querySelector<HTMLInputElement>('.si-pe-addr');
    if (inp) { inp.value = addrHex; }
}
