/** Struct Overlay — UI layer
Single section rendered into #s-struct-pins.
Type management (create / edit / delete) is inline within that section.
Pure codec logic lives in struct-codec.ts. */

import { S }        from './state';
import { esc, actionBtnsHtml, wireActionBtns, formatDecimal, formatHex, formatHexHtml, getBigUint64, getBigInt64, asUint64 } from './utils';
import { vscode }   from './api';
import { rerender } from './render';
import { getByte }  from './data';
import {
    FIELD_TYPES,
    fieldByteSize, structByteSize, decodeStruct, allStructs, resolveStructFieldByPath,
    parseStructText, fieldsToText, structToC, validateStructs, MAX_NESTED_DEPTH,
} from './struct-codec.js';
import type { DecodedField } from './struct-codec.js';
import type { BitFieldChild, StructDef, StructField, StructFieldType, StructPin } from './types';

// ── Module state ──────────────────────────────────────────────────

/** Struct id currently selected in the add form. */
let _applyStructId: string | null = null;
/** Set of instance card ids that are expanded. */
const _expanded = new Set<string>();
/** Array field groups that are expanded. Key: `${pinId}::${baseName}`. Collapsed by default. */
const _expandedArrayFields = new Set<string>();
/** Nested element groups that are expanded. Key: `${pinId}::${baseName}::${idx}`. Collapsed by default. */
const _expandedArrayElements = new Set<string>();

type ColType = 'hex' | 'dec' | 'ascii' | 'bin' | 'bin-sliced' | 'ieee';
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
function usedBitsInContainer(f: import('./types').StructField): number {
    if (!Array.isArray(f.bitFields)) {
        return 0;
    }
    return f.bitFields.reduce((sum, child) => sum + child.bitWidth, 0);
}

/** Calculate available bits remaining in a bit-field container. */
function availableBitsInContainer(f: import('./types').StructField): number {
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

function parseBitRowMeta(row: HTMLElement): { byteStart: number; bitStart: number; bitWidth: number } | null {
    const byteStart = parseInt(row.dataset.byteStart ?? '', 10);
    const bitStart = parseInt(row.dataset.bitStart ?? '', 10);
    const bitWidth = parseInt(row.dataset.bitWidth ?? '', 10);
    if (!Number.isFinite(byteStart) || !Number.isFinite(bitStart) || !Number.isFinite(bitWidth) || bitWidth <= 0) {
        return null;
    }
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
    const missing = hasMissingByte(rawParts) || !first.hasData;
    if (!missing) {
        const raw = bytesFromHexParts(rawParts);
        const value = bytesToValue(raw, S.endian);
        const unitBits = raw.length * 8;
        const mask = (1n << BigInt(usedWidth)) - 1n;
        const slicedValue = S.bitFieldAllocation === 'lsb'
            ? value & mask
            : (value >> BigInt(Math.max(0, unitBits - usedWidth))) & mask;
        const bits = slicedValue.toString(2).padStart(usedWidth, '0');
        const spans = [...bits].map((bit, displayIdx) => {
            const bitIdx = S.bitFieldAllocation === 'lsb' ? usedWidth - displayIdx - 1 : displayIdx;
            return renderBitSpan(bit, bitIdx, isBitSelected(bitIdx, selectedRange));
        });
        return renderBinarySpanLines(spans);
    }

    const spans: string[] = [];
    for (let displayIdx = 0; displayIdx < usedWidth; displayIdx++) {
        const bitIdx = S.bitFieldAllocation === 'lsb' ? usedWidth - displayIdx - 1 : displayIdx;
        spans.push(renderUnknownBitSpan(bitIdx, isBitSelected(bitIdx, selectedRange)));
    }

    return renderBinarySpanLines(spans);
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
    const scalarOptions = FIELD_TYPES.map(t =>
        `<option value="${t}"${f.type === t ? ' selected' : ''}>${t}</option>`
    ).join('');
    const structOptions = allStructs()
        .filter(d => d.id !== draftId)
        .map(d => structOptionHtml(f, d))
        .join('');
    return `<optgroup label="Scalar">${scalarOptions}</optgroup>` +
        (structOptions ? `<optgroup label="Struct">${structOptions}</optgroup>` : '');
}

function structOptionHtml(f: StructField, d: StructDef): string {
    const val = `struct:${d.id}`;
    const selected = f.type === 'struct' && f.refStructId === d.id;
    return `<option value="${esc(val)}"${selected ? ' selected' : ''}>struct ${esc(d.name)}</option>`;
}

function isBitContainerField(f: StructField): boolean {
    return isUnsignedScalarType(f.type) && Array.isArray(f.bitFields) && f.bitFields.length > 0;
}

function bitChildrenHtml(f: StructField, isBitContainer: boolean): string {
    if (!isBitContainer) { return ''; }
    const bitFields = f.bitFields ?? [];
    const childRows = bitFields.map((child, ci) => childFieldRowHtml(child, ci, bitFields.length)).join('');
    const remainingBits = availableBitsInContainer(f);
    const addBtnDisabled = remainingBits > 0 ? '' : ' disabled';
    const addBtnTitle = remainingBits > 0 ? 'Add bit-field child' : 'No bits remaining in parent';
    return (
        `<div class="sfe-bf-children"${f.bitFieldsCollapsed === true ? ' style="display:none"' : ''}>` +
        childRows +
        `<button class="sfe-bf-add-child" title="${addBtnTitle}"${addBtnDisabled}>+ Add bit</button>` +
        `</div>`
    );
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
    const isUnsigned = isUnsignedScalarType(f.type);
    const bitBtnClass = isUnsigned && isBitContainer ? ' sfe-bit-btn-on' : '';
    return `<button class="sfe-bit-btn${bitBtnClass}" title="Toggle bit-field details"${disabledAttr(!isUnsigned)}>:N</button>`;
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
function isUnsignedScalarType(type: import('./types').StructFieldType): type is import('./types').StructScalarFieldType {
    return type === 'uint8' || type === 'uint16' || type === 'uint32' || type === 'uint64';
}

/** Get bit capacity for a parent field type. */
function getParentBitCapacity(type: import('./types').StructFieldType): number {
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
        .map(f => allStructs().find(d => d.id === f.refStructId)?.name)
        .filter((n): n is string => typeof n === 'string')
        .map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const typeUnion = [
        'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t',
        'int8_t', 'int16_t', 'int32_t', 'int64_t',
        'float', 'double',
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
            if (tok === '__attribute__((packed))') {
                span.className = 'sc-attr';
            } else if (tok === 'typedef' || tok === 'struct') {
                span.className = 'sc-kw';
            } else {
                span.className = 'sc-type';
            }
            span.textContent = tok;
            parent.appendChild(span);
            lastIdx = idx + tok.length;
        }
        if (lastIdx < code.length) { appendText(parent, code.slice(lastIdx)); }
    };

    const lines = structToC(def).split('\n');
    lines.forEach((line, i) => {
        const ci = line.indexOf('/*');
        const code = ci >= 0 ? line.slice(0, ci) : line;
        const cmt = ci >= 0 ? line.slice(ci) : '';
        const isPad = /\b_pad\w+/.test(code);
        if (isPad) {
            const n = code.match(/_pad\w+\[(\d+)\]/)?.[1] ?? '?';
            const indent = line.slice(0, line.length - line.trimStart().length);
            appendText(out, indent);
            const span = document.createElement('span');
            span.className = 'sc-cmt';
            span.textContent = `/* ${n} byte${n === '1' ? '' : 's'} padding */`;
            out.appendChild(span);
        } else {
            appendTokenizedCode(out, code);
            if (cmt) {
                const span = document.createElement('span');
                span.className = 'sc-cmt';
                span.textContent = cmt;
                out.appendChild(span);
            }
        }
        if (i < lines.length - 1) { appendText(out, '\n'); }
    });

    return out;
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
            : allStructs().find(d => d.id === id);
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
         `<div class="se-field-hdr"><span>Type</span><span>Name</span><span>Bits</span><span>[ ]</span><span></span></div>` +
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
        const rawType = (row.querySelector('.sfe-type-sel') as HTMLSelectElement).value;
        const isStruct = rawType.startsWith('struct:');
        const refStructId = isStruct ? rawType.slice('struct:'.length) : undefined;
        const type = (isStruct ? 'struct' : rawType) as StructFieldType;
        const bitBtnOn = row.querySelector('.sfe-bit-btn')?.classList.contains('sfe-bit-btn-on') ?? false;
        const isUnsigned = !isStruct && (type === 'uint8' || type === 'uint16' || type === 'uint32' || type === 'uint64');
        const childrenContainer = row.querySelector<HTMLElement>('.sfe-bf-children');

        // Parse child bit-field rows if toggled on and unsigned
        let bitFields: import('./types').BitFieldChild[] | undefined;
        if (bitBtnOn && isUnsigned && childrenContainer) {
            const childRows = childrenContainer.querySelectorAll<HTMLElement>('.sfe-bf-child-row');
            const childArray: import('./types').BitFieldChild[] = Array.from(childRows).map(childRow => {
                const childName = sanitizeCIdent(
                    (childRow.querySelector('.sfe-bf-child-name') as HTMLInputElement).value
                ) || `bit${childRow.dataset.childIdx || '0'}`;
                const childWidthRaw = (childRow.querySelector('.sfe-bf-child-width') as HTMLInputElement).value;
                const childWidth = parseInt(childWidthRaw, 10);
                return {
                    name: childName,
                    bitWidth: childWidth > 0 ? Math.min(childWidth, 64) : 1,
                };
            });
            if (childArray.length === 0) {
                childArray.push({ name: 'bit0', bitWidth: 1 });
            }
            bitFields = childArray;
        }

        const count = (() => {
            const cell = row.querySelector<HTMLElement>('.sfe-arr-cell')!;
            if (!cell.classList.contains('is-array')) { return 1; }
            const v = parseInt((row.querySelector('.sfe-count-inp') as HTMLInputElement).value);
            return isNaN(v) || v < 1 ? 1 : Math.min(v, 256);
        })();

        const result: import('./types').StructField = {
            name: sanitizeCIdent((row.querySelector('.sfe-name-inp') as HTMLInputElement).value),
            type,
            refStructId,
            count,
        };
        if (bitFields && bitFields.length > 0) {
            result.bitFields = bitFields;
            if (childrenContainer?.style.display === 'none') { result.bitFieldsCollapsed = true; }
        }
        return result;
    });
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
            syncEditorDraft(sec, draft);
            _editorError = null;
            const idx = parseInt(btn.closest<HTMLElement>('.struct-field-row')!.dataset.idx!);
            if (idx > 0) {
                [draft.fields[idx - 1], draft.fields[idx]] = [draft.fields[idx], draft.fields[idx - 1]];
                renderStructPins();
            }
        });
    });

    sec.querySelectorAll<HTMLElement>('.sfe-move-dn').forEach(btn => {
        btn.addEventListener('click', () => {
            syncEditorDraft(sec, draft);
            _editorError = null;
            const idx = parseInt(btn.closest<HTMLElement>('.struct-field-row')!.dataset.idx!);
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

    sec.querySelectorAll<HTMLInputElement>('.sfe-count-inp').forEach(inp => {
        inp.addEventListener('input', () => {
            inp.value = inp.value.replace(/\D/g, '').slice(0, 3);
            refreshEditorPreview(sec, draft);
        });
    });

    // ── Bit-field :N toggle button ─────────────────────────────────
    sec.querySelectorAll<HTMLElement>('.sfe-bit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const row = btn.closest<HTMLElement>('.struct-field-row')!;
            syncEditorDraft(sec, draft);
            const idx = parseInt(row.dataset.idx!);
            const f = draft.fields[idx];
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
            const pre = sec.querySelector<HTMLElement>('#se-preview pre');
            if (pre) { renderStructCPreview(pre, draft); }
            renderStructPins();  // Re-render to show/hide child rows
        });
    });

    // ── Bit-field child: add ────────────────────────────────────
    sec.querySelectorAll<HTMLElement>('.sfe-bf-add-child').forEach(btn => {
        btn.addEventListener('click', () => {
            const row = btn.closest<HTMLElement>('.struct-field-row')!;
            syncEditorDraft(sec, draft);
            const idx = parseInt(row.dataset.idx!);
            const f = draft.fields[idx];
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
            const childRow = btn.closest<HTMLElement>('.sfe-bf-child-row')!;
            const parentRow = childRow.closest<HTMLElement>('.struct-field-row')!;
            syncEditorDraft(sec, draft);
            const idx = parseInt(parentRow.dataset.idx!);
            const f = draft.fields[idx];
            if (!f?.bitFields) { return; }
            const ci = parseInt(childRow.dataset.childIdx!);
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
            const childRow = btn.closest<HTMLElement>('.sfe-bf-child-row')!;
            const parentRow = childRow.closest<HTMLElement>('.struct-field-row')!;
            syncEditorDraft(sec, draft);
            const idx = parseInt(parentRow.dataset.idx!);
            const f = draft.fields[idx];
            if (!f?.bitFields) { return; }
            const ci = parseInt(childRow.dataset.childIdx!);
            if (ci > 0) {
                [f.bitFields[ci - 1], f.bitFields[ci]] = [f.bitFields[ci], f.bitFields[ci - 1]];
                renderStructPins();
            }
        });
    });

    // ── Bit-field child: reorder down ───────────────────────────
    sec.querySelectorAll<HTMLElement>('.sfe-bf-child-row .sfe-move-dn').forEach(btn => {
        btn.addEventListener('click', () => {
            const childRow = btn.closest<HTMLElement>('.sfe-bf-child-row')!;
            const parentRow = childRow.closest<HTMLElement>('.struct-field-row')!;
            syncEditorDraft(sec, draft);
            const idx = parseInt(parentRow.dataset.idx!);
            const f = draft.fields[idx];
            if (!f?.bitFields) { return; }
            const ci = parseInt(childRow.dataset.childIdx!);
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
            const row = sel.closest<HTMLElement>('.struct-field-row');
            if (row) {
                const bitBtn = row.querySelector<HTMLElement>('.sfe-bit-btn');
                const rawType = sel.value;
                const isStruct = rawType.startsWith('struct:');
                const isUnsigned = !isStruct && (rawType === 'uint8' || rawType === 'uint16' || rawType === 'uint32' || rawType === 'uint64');
                const bitToggled = bitBtn?.classList.contains('sfe-bit-btn-on') ?? false;
                if (bitBtn) { (bitBtn as HTMLButtonElement).disabled = !isUnsigned; }
                // If bit-mode was on and type changed to non-unsigned, turn off bit-mode
                if (bitToggled && !isUnsigned) {
                    bitBtn?.classList.remove('sfe-bit-btn-on');
                    row.classList.remove('has-bit-children');
                    const children = row.querySelector<HTMLElement>('.sfe-bf-children');
                    if (children) { children.remove(); }
                    syncEditorDraft(sec, draft);
                    const idx = parseInt(row.dataset.idx!);
                    const f = draft.fields[idx];
                    if (f) { delete f.bitFields; delete f.bitFieldsCollapsed; }
                }
            }
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
        syncEditorDraft(sec, draft);
        if (draft.fields.length === 0) { return; }

        // Auto-fill struct name if empty, ensuring uniqueness across existing structs
        const nameInp = sec.querySelector<HTMLInputElement>('#se-name')!;
        let name = sanitizeCIdent(nameInp.value.trim());
        if (!name) {
            const otherNames = new Set(S.structs.filter(d => d.id !== draft.id).map(d => d.name));
            let candidate = 'MyStruct';
            let n = 1;
            while (otherNames.has(candidate)) { candidate = `MyStruct${n++}`; }
            name = candidate;
        }

        // Auto-fill empty field names, ensuring uniqueness within the field list
        const takenNames = new Set(draft.fields.map(f => f.name).filter(Boolean));
        const savedFields = draft.fields.map((f, fi) => {
            if (f.name) { return { ...f }; }
            let candidate = `field${fi}`;
            let n = 0;
            while (takenNames.has(candidate)) { candidate = `field${fi}_${n++}`; }
            takenNames.add(candidate);
            return { ...f, name: candidate };
        });

        const def: StructDef = { id: draft.id, name, packed: draft.packed ?? false, fields: savedFields };
        const nextStructs = (() => {
            const idx = S.structs.findIndex(d => d.id === def.id);
            if (idx >= 0) {
                const clone = [...S.structs];
                clone[idx] = def;
                return clone;
            }
            return [...S.structs, def];
        })();
        const validationErrors = validateStructs(nextStructs, MAX_NESTED_DEPTH);
        if (validationErrors.length > 0) {
            _editorError = validationErrors[0];
            renderStructPins();
            return;
        }
        _editorError = null;
        const idx = S.structs.findIndex(d => d.id === def.id);
        if (idx >= 0) { S.structs[idx] = def; } else { S.structs.push(def); }
        vscode.postMessage({ type: 'saveStructs', structs: S.structs });
        const { fromAdd } = _editingType!;
        _editingType = null;
        if (fromAdd) {
            _applyStructId = def.id;
            _addingPin = true;
            _managingTypes = false;
        }
        // fromManage: _managingTypes stays true → re-render shows updated type list
        renderStructPins();
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

// ── Main render function ───────────────────────────────────────────
export function renderStructPins(): void {
    const sec = document.getElementById('s-struct-pins');
    if (!sec) { return; }

    const all = allStructs();

    // Keep _applyStructId valid
    if (_applyStructId && !all.some(d => d.id === _applyStructId)) {
        _applyStructId = all[0]?.id ?? null;
    } else if (!_applyStructId && all.length > 0) {
        _applyStructId = all[0].id;
    }

    // When editing a type, ensure the types panel is visible
    if (_editingType) { _managingTypes = true; }

    // ── Build types panel ──
    const typeRows = all.length === 0
        ? `<div class="sb-empty">No types defined yet.</div>`
        : all.map(d => {
            const fieldCount = d.fields.length;
            const meta = `${fieldCount} field${fieldCount !== 1 ? 's' : ''}`;
            return (
                `<div class="sd-row">` +
                `<span class="sd-name">${esc(d.name)}</span>` +
                `<span class="sd-meta">${meta}</span>` +
                actionBtnsHtml(`data-struct-id="${esc(d.id)}"`, `data-struct-id="${esc(d.id)}"`) +
                `</div>`
            );
        }).join('');

    const instBadge = S.structPins.length > 0 ? `<span class="sb-badge">${S.structPins.length}</span>` : '';

    // ── Inline add form ──
    let addFormHtml = '';
    if (_addingPin) {
        const applyDef = all.find(d => d.id === _applyStructId) ?? null;
        const addrVal  = S.activeStructAddr !== null
            ? S.activeStructAddr.toString(16).toUpperCase().padStart(8, '0') : '';

        let typeRowHtml: string;
        if (all.length === 0) {
            typeRowHtml =
                `<div class="sa-row sa-no-types-row">` +
                `<span class="sa-no-types-msg">No struct types yet — create one first.</span>` +
                `<button id="sa-new-type-btn" class="struct-btn struct-btn-secondary">New type</button>` +
                `</div>`;
        } else {
            const structOpts = all.map(d =>
                `<option value="${esc(d.id)}"${d.id === _applyStructId ? ' selected' : ''}>${esc(d.name)}</option>`
            ).join('');
            const previewHtml = applyDef
                ? `<pre class="si-c-preview" data-struct-preview-id="${esc(applyDef.id)}"></pre>`
                : '';
            typeRowHtml =
                `<div class="sa-row">` +
                `<select id="sa-struct-sel" class="struct-sel">${structOpts}</select>` +
                `<button id="sa-new-type-btn" class="si-add-type-btn" title="New type">\uff0b</button>` +
                `</div>` +
                previewHtml;
        }

        addFormHtml =
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
            typeRowHtml +
            `<div class="sa-row sa-btn-row">` +
            `<button id="sa-confirm" class="struct-btn struct-btn-apply"${!_applyStructId ? ' disabled' : ''}>Confirm</button>` +
            `<button id="sa-cancel" class="struct-btn struct-btn-cancel">Cancel</button>` +
            `</div>` +
            `</div>`;
    }

    const instHtml = S.structPins.length === 0
        ? `<div class="sb-empty">No instances yet. Click [\uff0b Add] to create one.</div>`
        : S.structPins.map((pin, i) => buildInstanceCard(pin, i)).join('');

    // ── Both panels rendered side-by-side; CSS slides between them ──
    sec.innerHTML =
        `<div class="si-panel-clip">` +
        `<div class="si-panel-track${_managingTypes ? ' si-showing-types' : ''}" id="si-track">` +

        // ── Main panel (instances) ──
        `<div class="si-main-panel">` +
        `<div class="si-hdr-row">` +
        `<span class="sb-hdr" style="margin:0">Struct Instances ${instBadge}</span>` +
        `<div class="si-toggle-group" title="Bit-field allocation: which side receives the first declared bit field">` +
        `<span class="si-toggle-label">Bit Layout</span>` +
        `<div class="compact-tabs sa-bit-order-tabs">` +
        `<button id="sa-btn-bit-lsb" class="${S.bitFieldAllocation === 'lsb' ? 'active' : ''}" title="Bit-field allocation: first declared bit field starts at the least significant bit">LSB</button>` +
        `<button id="sa-btn-bit-msb" class="${S.bitFieldAllocation === 'msb' ? 'active' : ''}" title="Bit-field allocation: first declared bit field starts at the most significant bit">MSB</button>` +
        `</div>` +
        `</div>` +
        `<button id="si-add-btn" class="si-add-btn"${_addingPin ? ' disabled' : ''}>\uff0b Add</button>` +
        `<button id="si-types-btn" class="si-icon-btn" title="Manage types">&#9776;</button>` +
        `</div>` +
        addFormHtml +
        `<div id="si-list">${instHtml}</div>` +
        `</div>` +

        // ── Types panel ──
        `<div class="si-types-panel">` +
        `<div class="si-hdr-row">` +
        `<button id="sm-close-btn" class="si-icon-btn" title="${_editingType ? 'Cancel' : 'Back'}">&#8592;</button>` +
        `<span class="sb-hdr" style="margin:0">${_editingType ? (_editingType.existing ? 'Edit Type' : 'New Type') : 'Struct Types'}</span>` +
        (!_editingType ? `<button id="sm-new-btn" class="struct-btn struct-btn-secondary">New type</button>` : '') +
        `</div>` +
        (_editingType ? editorHtml(_editingType.draft, _editingType.existing) : `<div id="sm-list">${typeRows}</div>`) +
        `</div>` +

        `</div>` + // si-panel-track
        `</div>`; // si-panel-clip

    hydrateStructPreviews(sec);

    // ── Types button: slide in (no re-render) ──
    document.getElementById('si-types-btn')?.addEventListener('click', () => {
        _managingTypes = true;
        document.getElementById('si-track')?.classList.add('si-showing-types');
    });

    // ── Close/cancel: if editing a type cancel it; otherwise slide back ──
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

    // ── New type (from types panel) ──
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

    // ── Edit / delete type actions ──
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

    // ── ＋ Add button ──
    document.getElementById('si-add-btn')?.addEventListener('click', () => {
        _addingPin = true;
        renderStructPins();
        document.getElementById('sa-name')?.focus();
    });

    // ── Add-form wiring ──
    if (_addingPin) {
        document.getElementById('sa-struct-sel')?.addEventListener('change', e => {
            _applyStructId = (e.target as HTMLSelectElement).value || null;
            // Preserve any address the user already typed before re-render
            const curAddrInp = document.getElementById('sa-addr') as HTMLInputElement | null;
            if (curAddrInp?.value) {
                const v = parseInt(curAddrInp.value, 16);
                if (!isNaN(v)) { S.activeStructAddr = v; }
            }
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
            if (!_applyStructId) { return; }
            const addrInp = document.getElementById('sa-addr') as HTMLInputElement;
            const nameInp = document.getElementById('sa-name') as HTMLInputElement;
            const addr    = parseInt(addrInp.value.replace(/^0x/i, ''), 16);
            if (isNaN(addr)) { addrInp.style.borderColor = 'var(--err)'; return; }
            addrInp.style.borderColor = '';
            let name = nameInp.value.trim();
            if (!name) {
                const applyDef = S.structs.find(d => d.id === _applyStructId);
                const base = applyDef ? applyDef.name : 'inst';
                const takenPinNames = new Set(S.structPins.map(p => p.name));
                let candidate = `${base}_0`;
                let n = 1;
                while (takenPinNames.has(candidate)) { candidate = `${base}_${n++}`; }
                name = candidate;
            }
            const pin: StructPin = { id: `pin_${Date.now()}`, structId: _applyStructId, addr, name };
            S.structPins       = [...S.structPins, pin];
            S.activeStructAddr = addr;
            _expanded.add(pin.id);
            _addingPin = false;
            vscode.postMessage({ type: 'saveStructPins', pins: S.structPins });
            renderStructPins();
        });
        document.getElementById('sa-cancel')?.addEventListener('click', () => {
            _addingPin = false;
            renderStructPins();
        });
    }

    // ── Bit-field allocation tabs ──
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

    wireInstanceCards(sec);

    // ── If a type is being edited, wire up the editor inside the types panel ──
    if (_editingType) {
        wireEditorInSec(sec);
        sec.querySelector<HTMLInputElement>('#se-name')?.focus();
    }
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

function renderBitFieldValue(r: DecodedField, valType: ColType): string {
    const width = r.bitWidth ?? 1;
    const v = BigInt(r.bitValueUnsigned ?? '0');
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
    const width = r.bitWidth ?? 1;
    const v = BigInt(r.bitValueUnsigned ?? '0');
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
    if (r.type === 'pointer') { return renderPointerValue(dv, le); }
    if (r.type === 'ascii') { return renderAsciiValue(r, valType, bytes); }
    if (isBinaryDisplay(valType)) { return renderPlainBinaryBits(binaryBitsForValue(bytes, endian)); }
    if (valType === 'ieee') { return renderIeeeValue(r, bytes, endian); }
    if (valType === 'ascii') { return `'${asciiFromBytes(bytes)}'`; }
    return renderNumericValue(r, valType, dv, le);
}

function renderPointerValue(dv: DataView, le: boolean): string {
    const v = dv.getUint32(0, le) >>> 0;
    return `<span class="si-f-ptr-sym">\u2192</span>\u2009` + formatHexHtml(formatHex(v, 8));
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
    if (r.type !== 'float32' && r.type !== 'float64') { return r.decoded; }
    const parts = getFloatParts(bytes, r.type as 'float32' | 'float64', endian);
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
    const size = type === 'float32' ? 4 : 8;
    if (bytes.length < size || bytes.some(b => b < 0)) { return null; }
    const buf = new ArrayBuffer(size);
    const dv = new DataView(buf);
    bytes.forEach((b, i) => dv.setUint8(i, b));
    const le = endian === 'le';
        if (type === 'float32') { 
        const raw = dv.getUint32(0, le) >>> 0;
        const sign = (raw >>> 31) & 1;
        const exp = (raw >>> 23) & 0xFF;
        const mant = raw & 0x7FFFFF;
        const exponentBits = exp.toString(2).padStart(8, '0');
        const mantissaBits = mant.toString(2).padStart(23, '0');
        const exponentHex = `0x${exp.toString(16).toUpperCase().padStart(2, '0')}`;
        const mantissaHex = `0x${mant.toString(16).toUpperCase().padStart(6, '0')}`;
        const rawHex = `0x${raw.toString(16).toUpperCase().padStart(8, '0')}`;
        let className = 'normal';
        if (exp === 0) { className = mant === 0 ? 'zero' : 'subnormal'; }
        else if (exp === 0xFF) { className = mant === 0 ? 'infinity' : 'NaN'; }
        const binStr = `${sign} | ${exponentBits} | ${mantissaBits}`;
        return { sign, exp, mant, exponentBits, mantissaBits, exponentHex, mantissaHex, rawHex, className, binStr };
    } else {
        const raw = dv.getBigUint64(0, le);
        const sign = Number((raw >> 63n) & 1n);
        const exp = Number((raw >> 52n) & 0x7FFn);
        const mant = raw & ((1n << 52n) - 1n);
        const exponentBits = exp.toString(2).padStart(11, '0');
        const mantissaBits = mant.toString(2).padStart(52, '0');
        const exponentHex = `0x${exp.toString(16).toUpperCase().padStart(3, '0')}`;
        const mantissaHex = `0x${mant.toString(16).toUpperCase().padStart(13, '0')}`;
        const rawHex = `0x${raw.toString(16).toUpperCase().padStart(16, '0')}`;
        let className = 'normal';
        if (exp === 0) { className = mant === 0n ? 'zero' : 'subnormal'; }
        else if (exp === 0x7FF) { className = mant === 0n ? 'infinity' : 'NaN'; }
        const binStr = `${sign} | ${exponentBits} | ${mantissaBits}`;
        return { sign, exp, mant, exponentBits, mantissaBits, exponentHex, mantissaHex, rawHex, className, binStr };
    }
}

/** Get a plain-text representation suitable for copying. */
function getCopyText(r: DecodedField, valType: ColType): string {
    if (!r.hasData) { return '??'; }
    if (isBitFieldRow(r)) { return copyBitFieldValue(r, valType); }
    if (r.type === 'ascii') { return r.decoded; }
    return copyNonAsciiFieldValue(r, valType);
}

function copyNonAsciiFieldValue(r: DecodedField, valType: ColType): string {
    const bytes = fieldBytes(r);
    const endian = S.endian;
    const le = endian === 'le';
    if (r.type === 'pointer') {
        const dv = dataViewForBytes(bytes);
        const v = dv.getUint32(0, le) >>> 0;
        return hexPad(v, 8);
    }
    if (valType === 'bin-sliced' && typeof r.bitWidth === 'number' && r.bitValueUnsigned !== undefined) {
        return formatPlainBinaryBits(BigInt(r.bitValueUnsigned).toString(2).padStart(r.bitWidth, '0'));
    }
    if (isBinaryDisplay(valType)) {
        return formatPlainBinaryBits(binaryBitsForValue(bytes, endian));
    }
    if (valType === 'ieee') {
        return copyIeeeValue(r, bytes, endian);
    }
    if (valType === 'ascii') { return asciiFromBytes(bytes); }
    return copyNumericValue(r, valType, dataViewForBytes(bytes), le);
}

function hexPad(v: number, pad: number): string {
    return `0x${(v >>> 0).toString(16).toUpperCase().padStart(pad, '0')}`;
}

function hexPadBig(v: bigint, pad: number): string {
    return `0x${v.toString(16).toUpperCase().padStart(pad, '0')}`;
}

function copyIeeeValue(r: DecodedField, bytes: number[], endian: 'le' | 'be'): string {
    if (r.type !== 'float32' && r.type !== 'float64') { return r.decoded; }
    const parts = getFloatParts(bytes, r.type as 'float32' | 'float64', endian);
    if (!parts) { return '??'; }
    return `sign: ${parts.sign}; exponent: ${parts.exponentHex}; mantissa: ${parts.mantissaHex}; class: ${parts.className}`;
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

function fieldValueKey(r: DecodedField, byteStart: number): string {
    return isBitFieldRow(r)
        ? bitChildValKey(byteStart, r.bitOffset ?? 0, r.bitWidth ?? 0)
        : scalarValKey(byteStart);
}

function defaultValueTypeForRow(r: DecodedField): ColType {
    if (isBitFieldRow(r)) { return 'bin'; }
    if (r.type === 'float32' || r.type === 'float64') { return 'dec'; }
    if (r.type === 'ascii') { return 'ascii'; }
    return _defaultValType;
}

function valueTypeForRow(r: DecodedField, valKey: string): ColType {
    return _fieldValTypes.get(valKey) ?? defaultValueTypeForRow(r);
}

function fieldTypeAbbrev(r: DecodedField, byteCount: number): string {
    if (isBitFieldRow(r)) { return `bit:${r.bitWidth}`; }
    const abbrevBase = TYPE_ABBREV[r.type] ?? r.type;
    return r.type === 'ascii' ? `${abbrevBase}[${byteCount}]` : abbrevBase;
}

function fieldFullTypeLabel(r: DecodedField, byteCount: number): string {
    if (isBitFieldRow(r)) { return `bit:${r.bitWidth}`; }
    return r.type === 'ascii' ? `ascii[${byteCount}]` : r.type;
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
    return (valType === 'bin' || valType === 'bin-sliced' || valType === 'ieee' || valType === 'hex' || ptr)
        ? value
        : esc(value);
}

function mkFieldRow(r: DecodedField, bs: number, bc: number, displayName?: string): string {
    const nd  = !r.hasData ? ' si-no-data' : '';
    const ptr = r.type === 'pointer';
    const valKey = fieldValueKey(r, bs);
    const t = valueTypeForRow(r, valKey);
    const valHtml = valueHtmlForRow(r, t, ptr);
    const byteCount = r.bytesHex.length > 0 ? r.bytesHex.split(' ').length : bc;
    const abbrev = fieldTypeAbbrev(r, byteCount);
    const fullTypeLabel = fieldFullTypeLabel(r, byteCount);
    const offsetLabel = fieldOffsetLabel(r);
    return (
        `<div class="si-field${nd}${ptr ? ' si-ptr-field' : ''}" ` +
        `data-byte-start="${bs}" data-byte-cnt="${bc}" data-val-key="${esc(valKey)}"` +
        bitFieldDataAttrs(r) +
        `>` +
        `<span class="si-f-off">${offsetLabel}</span>` +
        `<span class="si-f-type" title="${esc(fullTypeLabel)}">${abbrev}</span>` +
        `<span class="si-toggle-pad" aria-hidden="true"></span>` +
        `<span class="si-f-body">` +
        `<span class="si-f-name">${esc(displayName ?? leafName(r.fieldName))}</span>` +
        `<span class="si-f-lead"></span>` +
        `<span class="si-f-val si-f-pri${ptr ? ' si-f-ptr' : ''}" data-val-type="${t}" data-bs="${bs}" data-val-key="${esc(valKey)}">${valHtml}</span>` +
        `</span>` +
        `</div>`
    );
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
    const rawParts = byteHexParts(first.bytesHex);
    if (hasMissingByte(rawParts)) { return '??'; }
    const raw = bytesFromHexParts(rawParts);
    if (raw.some(v => !Number.isFinite(v) || v < 0 || v > 0xFF)) { return '??'; }

    const value = bytesToValue(raw, S.endian);
    const hex = value.toString(16).toUpperCase().padStart(raw.length * 2, '0');
    return `0x${hex} (${value.toString(10)})`;
}

function buildBitUnitAggregateRow(rows: DecodedField[]): DecodedField | null {
    const first = rows[0];
    if (!first) { return null; }
    const usedWidth = rows.reduce((sum, row) => sum + bitRowWidth(row), 0);
    let slicedValue: string | undefined;
    const rawParts = byteHexParts(first.bytesHex);
    if (usedWidth > 0 && !hasMissingByte(rawParts) && first.hasData) {
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

function activeBitRangeForHeader(start: number): { startBit: number; endBit: number } | null {
    if (_selectedBitRange && _selectedBitRange.parentByteStart === start) {
        return { startBit: _selectedBitRange.startBit, endBit: _selectedBitRange.endBit };
    }
    if (_hoveredBitRange && _hoveredBitRange.parentByteStart === start) {
        return { startBit: _hoveredBitRange.startBit, endBit: _hoveredBitRange.endBit };
    }
    return null;
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
        `<span class="si-f-type">u8</span>` +
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
    return RAW_BIT_UNIT_VALUE_TYPES.has(valueType) || agg.type === 'pointer';
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
): string {
    const agg = buildBitUnitAggregateRow(rows);
    const headerName = headerNameOverride ?? groupHeaderName(arrayGroupBaseName(rows[0]?.fieldName ?? ''));
    const { headerClass, buttonClass } = bitUnitHeaderClasses(kind);
    const valKey = bitUnitValKey(start);
    if (!agg) {
        return emptyBitUnitHeaderHtml(headerClass, buttonClass, headerName, valKey, start, cnt, isOpen);
    }

    const t = _fieldValTypes.get(valKey) ?? 'bin';
    const ptr = agg.type === 'pointer';
    const valHtml = bitUnitHeaderDisplayValue(rows, agg, t, start);
    const byteCount = bitUnitByteCount(agg, cnt);
    const abbrev = fieldTypeAbbrev(agg, byteCount);
    const fullTypeLabel = fieldFullTypeLabel(agg, byteCount);
    const offsetLabel = fieldOffsetLabel(agg);

    return (
        `<div class="${headerClass} si-bitunit-hdr si-field" data-byte-start="${start}" data-byte-cnt="${cnt}" data-val-key="${esc(valKey)}">` +
        `<span class="si-f-off">${offsetLabel}</span>` +
        `<span class="si-f-type" title="${esc(fullTypeLabel)}">${abbrev}</span>` +
        `<button class="${buttonClass}">${isOpen ? '▾' : '▸'}</button>` +
        `<span class="si-f-body">` +
        `<span class="si-f-name">${esc(headerName)}</span>` +
        `<span class="si-f-lead"></span>` +
        `<span class="si-f-val si-f-pri${ptr ? ' si-f-ptr' : ''}" data-val-type="${t}" data-bs="${start}" data-val-key="${esc(valKey)}">${valHtml}</span>` +
        `</span>` +
        `</div>`
    );
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
        const dot = fieldPath.indexOf('.');
        return dot >= 0 ? fieldPath.slice(0, dot) : fieldPath;
    }
    const first = matches[0];
    if (first.index === undefined) { return fieldPath; }
    const firstArrayIdx = first.index;
    const firstDot = fieldPath.indexOf('.');
    if (firstDot >= 0 && firstDot < firstArrayIdx) {
        return fieldPath.slice(0, firstDot);
    }
    return fieldPath.slice(0, first.index);
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

function structGroupSummaryLabel(rows: DecodedField[], isBitUnit: boolean, isArray: boolean, summary: string): string {
    return isBitUnit && isArray ? summary : groupSummaryLabel(rows, summary);
}

function structGroupByteCount(rows: DecodedField[], isBitUnit: boolean, isArray: boolean, count: number): number {
    return isBitUnit && isArray ? decodedRowByteCount(rows[0]) * count : sumDecodedRowBytes(rows);
}

function describeStructGroup(def: StructDef, rows: DecodedField[], baseName: string): StructGroupInfo {
    const first = rows[0];
    const declared = resolveStructFieldByPath(def, baseName);
    let declaredType: StructFieldType = first.type;
    let count = rows.length;
    let structName = 'struct';
    if (declared) {
        declaredType = declared.field.type;
        count = declared.field.count;
        structName = declared.structName ?? structName;
    }
    const isArray = count > 1;
    const isStruct = declaredType === 'struct';
    const isString = declaredType === 'ascii';
    const isBitUnit = isBitUnitGroup(rows);
    const isComposite = isCompositeStructGroup(isBitUnit, isStruct, isArray, isString);
    const summary = structGroupSummary(declaredType, isArray, count, structName);
    return {
        declaredType,
        count,
        isArray,
        isStruct,
        isString,
        isBitUnit,
        isComposite,
        structName,
        summary,
        summaryLabel: structGroupSummaryLabel(rows, isBitUnit, isArray, summary),
        byteCount: structGroupByteCount(rows, isBitUnit, isArray, count),
    };
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
        const last = groups[groups.length - 1];
        if (last && last.idx === idx) { last.rows.push(row); }
        else { groups.push({ idx, rows: [row] }); }
    }
    return groups;
}

function groupNestedRows(rows: DecodedField[], structBase: string): NestedFieldGroup[] {
    const structPrefix = `${structBase}.`;
    const groups: NestedFieldGroup[] = [];
    for (const row of rows) {
        const relPath = row.fieldName.startsWith(structPrefix)
            ? row.fieldName.slice(structPrefix.length)
            : row.fieldName;
        const baseRel = arrayGroupBaseName(relPath);
        const fullBase = `${structBase}.${baseRel}`;
        const last = groups[groups.length - 1];
        if (last && last.fullBase === fullBase) { last.rows.push(row); }
        else { groups.push({ baseRel, fullBase, rows: [row] }); }
    }
    return groups;
}

function leafRowsHtml(rows: DecodedField[], baseAddr: number): string {
    const labels = disambiguateLeafNames(rows.map(r => leafName(r.fieldName)));
    return rows.map((row, idx) =>
        mkFieldRow(row, baseAddr + row.byteOffset, decodedRowByteCount(row), labels[idx])
    ).join('');
}

function indexedRowsHtml(rows: DecodedField[], baseAddr: number, baseName: string): string {
    return rows.map(row =>
        mkFieldRow(row, baseAddr + row.byteOffset, decodedRowByteCount(row), indexOnlyName(row.fieldName, baseName))
    ).join('');
}

function structArrayElementHtml(
    element: IndexedFieldGroup,
    elementKey: string,
    baseAddr: number,
    byteCnt: number,
    isOpen: boolean,
    summary: string,
    bodyHtml: string,
): string {
    const first = element.rows[0];
    const byteStart = baseAddr + first.byteOffset;
    return (
        `<div class="si-arr-el-grp${isOpen ? ' open' : ''}" data-arr-el-key="${esc(elementKey)}">` +
        `<div class="si-arr-el-hdr" data-arr-el-key="${esc(elementKey)}" data-byte-start="${byteStart}" data-byte-cnt="${byteCnt}" data-offset-label="${offsetLabel(first.byteOffset)}">` +
        compositeHeaderPrefixHtml(isOpen, first.byteOffset) +
        `<button class="si-arr-el-exp-btn">${isOpen ? '▾' : '▸'}</button>` +
        `<span class="si-f-body">` +
        `<span class="si-f-name">[${element.idx}]</span>` +
        `<span class="si-f-lead"></span>` +
        `<span class="si-arr-addr">${esc(summary)}</span>` +
        `</span>` +
        `</div>` +
        `<div class="si-arr-el-body"${isOpen ? '' : ' style=\"display:none\"'}>${bodyHtml}</div>` +
        `</div>`
    );
}

function offsetLabel(byteOffset: number): string {
    return `+${byteOffset.toString(16).toUpperCase().padStart(3, '0')}`;
}

function compositeHeaderPrefixHtml(isOpen: boolean, byteOffset: number): string {
    if (isOpen) {
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

    const existingOffset = hdr.querySelector<HTMLElement>(':scope > .si-f-off');
    const existingPad = hdr.querySelector<HTMLElement>(':scope > .si-node-pad');
    const typePad = hdr.querySelector<HTMLElement>(':scope > .si-node-type-pad');
    if (isOpen) {
        existingOffset?.remove();
        if (!existingPad && typePad) {
            typePad.insertAdjacentHTML('beforebegin', '<span class="si-node-pad" aria-hidden="true"></span>');
        }
        return;
    }

    const label = hdr.dataset.offsetLabel;
    if (!label) { return; }
    existingPad?.remove();
    if (!existingOffset && typePad) {
        typePad.insertAdjacentHTML('beforebegin', `<span class="si-f-off">${esc(label)}</span>`);
    }
}

type StructRenderContext = { def: StructDef; pin: StructPin };
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
        (ctx, group) => indexedRowsHtml(group.rows, ctx.pin.addr, group.baseName),
    ],
];

function renderStructBody(def: StructDef, pin: StructPin): string {
    const rows = decodeStruct(def, pin.addr, getByte, S.endian, S.bitFieldAllocation);
    return `<div class="si-fields">${renderStructFieldGroups({ def, pin }, rows)}</div>`;
}

function renderBitUnitLeafRows(unitRows: DecodedField[], ctx: StructRenderContext): string {
    return leafRowsHtml(unitRows, ctx.pin.addr);
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
        const elementByteStart = ctx.pin.addr + first.byteOffset;
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
    if (!info.isComposite) {
        return leafRowsHtml(ng.rows, ctx.pin.addr);
    }

    const nestedKey = `${parentKey}::${ng.baseRel}`;
    const nestedOpen = _expandedArrayFields.has(nestedKey);
    const nestedStart = ctx.pin.addr + ng.rows[0].byteOffset;
    const nestedBodyHtml = renderNestedStructBody(ctx, {
        rows: ng.rows,
        baseName: ng.fullBase,
        key: nestedKey,
        info,
    });

    return (
        `<div class="si-arr-grp${nestedOpen ? ' open' : ''}" data-arr-key="${esc(nestedKey)}">` +
        (info.isBitUnit && !info.isArray
            ? bitUnitHeaderHtml(ng.rows, nestedStart, info.byteCount, nestedOpen, groupHeaderName(ng.baseRel))
            : `<div class="si-arr-grp-hdr" data-byte-start="${nestedStart}" data-byte-cnt="${info.byteCount}" data-offset-label="${offsetLabel(ng.rows[0].byteOffset)}">` +
              compositeHeaderPrefixHtml(nestedOpen, ng.rows[0].byteOffset) +
              `<button class="si-arr-exp-btn">${nestedOpen ? '▾' : '▸'}</button>` +
              `<span class="si-f-body">` +
              `<span class="si-f-name">${esc(groupHeaderName(ng.baseRel))}</span>` +
              `<span class="si-f-lead"></span>` +
              `<span class="si-arr-addr">${esc(info.summaryLabel)}</span>` +
              `</span>` +
              `</div>`
        ) +
        `<div class="si-arr-grp-body"${nestedOpen ? '' : ' style=\"display:none\"'}>${nestedBodyHtml}</div>` +
        `</div>`
    );
}

function renderNestedStructBody(
    ctx: StructRenderContext,
    group: RenderBodyGroup,
): string {
    const rule = BODY_RULES.find(([matches]) => matches(group));
    return rule ? rule[1](ctx, group) : leafRowsHtml(group.rows, ctx.pin.addr);
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
            ctx.pin.addr,
            sumDecodedRowBytes(element.rows),
            isElementOpen,
            structName,
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
    if (!info.isComposite) {
        return leafRowsHtml(g.rows, ctx.pin.addr);
    }

    const key = `${ctx.pin.id}::${g.baseName}`;
    const isOpen = _expandedArrayFields.has(key);
    const byteStart = ctx.pin.addr + r0.byteOffset;
    const elHtml = renderStructFieldBody(ctx, {
        rows: g.rows,
        baseName: g.baseName,
        key,
        info,
    });

    return (
        `<div class="si-arr-grp${isOpen ? ' open' : ''}" data-arr-key="${esc(key)}">` +
        (info.isBitUnit && !info.isArray
            ? bitUnitHeaderHtml(g.rows, byteStart, info.byteCount, isOpen)
            : `<div class="si-arr-grp-hdr" ` +
              `data-byte-start="${byteStart}" data-byte-cnt="${info.byteCount}" data-offset-label="${offsetLabel(r0.byteOffset)}">` +
              compositeHeaderPrefixHtml(isOpen, r0.byteOffset) +
              `<button class="si-arr-exp-btn">${isOpen ? '▾' : '▸'}</button>` +
              `<span class="si-f-body">` +
              `<span class="si-f-name">${esc(groupHeaderName(g.baseName))}</span>` +
              `<span class="si-f-lead"></span>` +
              `<span class="si-arr-addr" title="${esc(info.summaryLabel)}">${esc(info.summaryLabel)}</span>` +
              `</span>` +
              `</div>`
        ) +
        `<div class="si-arr-grp-body"${isOpen ? '' : ' style=\"display:none\"'}>${elHtml}</div>` +
        `</div>`
    );
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
    const structOpts = allStructs().map(d =>
        `<option value="${esc(d.id)}"${d.id === draftStructId ? ' selected' : ''}>${esc(d.name)}</option>`
    ).join('');
    const editDef = allStructs().find(d => d.id === draftStructId);
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
    const def        = allStructs().find(d => d.id === pin.structId);
    const defName    = def ? def.name : '?';
    const totalBytes = def ? structByteSize(def) : 0;
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
    const annotateBody = (body: HTMLElement, level: number) => {
        setTreeLevel(body, level);
        for (const child of Array.from(body.children)) {
            const htmlChild = asHtml(child);
            if (!htmlChild) { continue; }
            if (htmlChild.classList.contains('si-field')) {
                setTreeLevel(htmlChild, level);
                continue;
            }
            if (htmlChild.classList.contains('si-arr-grp')) {
                const hdr = firstDirectChildByClass(htmlChild, 'si-arr-grp-hdr');
                if (hdr) { setTreeLevel(hdr, level); }
                const childBody = firstDirectChildByClass(htmlChild, 'si-arr-grp-body');
                if (childBody) { annotateBody(childBody, level + 1); }
                continue;
            }
            if (htmlChild.classList.contains('si-arr-el-grp')) {
                const hdr = firstDirectChildByClass(htmlChild, 'si-arr-el-hdr');
                if (hdr) { setTreeLevel(hdr, level); }
                const childBody = firstDirectChildByClass(htmlChild, 'si-arr-el-body');
                if (childBody) { annotateBody(childBody, level + 1); }
            }
        }
    };

    sec.querySelectorAll<HTMLElement>('.si-fields').forEach(fields => {
        setTreeLevel(fields, 0);
        for (const child of Array.from(fields.children)) {
            const htmlChild = asHtml(child);
            if (!htmlChild) { continue; }
            if (htmlChild.classList.contains('si-field')) {
                setTreeLevel(htmlChild, 0);
                continue;
            }
            if (htmlChild.classList.contains('si-arr-grp')) {
                const hdr = firstDirectChildByClass(htmlChild, 'si-arr-grp-hdr');
                if (hdr) { setTreeLevel(hdr, 0); }
                const body = firstDirectChildByClass(htmlChild, 'si-arr-grp-body');
                if (body) { annotateBody(body, 1); }
                continue;
            }
            if (htmlChild.classList.contains('si-arr-el-grp')) {
                const hdr = firstDirectChildByClass(htmlChild, 'si-arr-el-hdr');
                if (hdr) { setTreeLevel(hdr, 0); }
                const body = firstDirectChildByClass(htmlChild, 'si-arr-el-body');
                if (body) { annotateBody(body, 1); }
            }
        }
    });
}

function wireInstanceCards(sec: HTMLElement): void {
    applyTreeDepthStyles(sec);

    // Keep bit hover highlight strictly tied to the current pointer target.
    sec.onmousemove = (ev: MouseEvent) => {
        const target = ev.target as HTMLElement | null;
        const bitRow = target?.closest<HTMLElement>('.si-field[data-bit-start][data-bit-width]') ?? null;
        let next: { parentByteStart: number; startBit: number; endBit: number } | null = null;
        let nextKey: string | null = null;
        if (bitRow) {
            const meta = parseBitRowMeta(bitRow);
            if (meta) {
                next = { parentByteStart: meta.byteStart, startBit: meta.bitStart, endBit: meta.bitStart + meta.bitWidth - 1 };
                nextKey = makeBitRowKey(meta.byteStart, meta.bitStart, meta.bitWidth);
            }
        }
        if (_hoveredBitRowKey !== nextKey) {
            _hoveredBitRange = next;
            _hoveredBitRowKey = nextKey;
            applyBitHighlightsInPlace(sec);
        }
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

        expBtn.addEventListener('click', e => {
            e.stopPropagation();
            const grp  = hdr.closest<HTMLElement>('.si-arr-grp')!;
            const key  = grp.dataset.arrKey!;
            const body = grp.querySelector<HTMLElement>('.si-arr-grp-body')!;
            const isOpen = _expandedArrayFields.has(key);
            if (isOpen) {
                _expandedArrayFields.delete(key);
                grp.classList.remove('open');
                body.style.display = 'none';
                expBtn.textContent = '▸';
                syncCompositeHeaderOffset(hdr, false);
            } else {
                _expandedArrayFields.add(key);
                grp.classList.add('open');
                body.style.display = '';
                expBtn.textContent = '▾';
                syncCompositeHeaderOffset(hdr, true);
            }
        });

        hdr.addEventListener('mouseenter', () => {
            for (let i = 0; i < cnt; i++) {
                const ah = (start + i).toString(16).toUpperCase().padStart(8, '0');
                document.querySelectorAll<HTMLElement>(`[data-addr="${ah}"]`)
                    .forEach(el => el.classList.add('struct-h'));
            }
        });
        hdr.addEventListener('mouseleave', () => {
            document.querySelectorAll<HTMLElement>('.struct-h')
                .forEach(el => el.classList.remove('struct-h'));
        });

        hdr.addEventListener('click', e => {
            if ((e.target as HTMLElement).closest('.si-arr-exp-btn')) { return; }
            if (isBitUnitHdr) { return; }
            clearArrSep();
            clearSelRow();
            _selectedBitRange = null;
            _hoveredBitRange = null;
            _selectedBitRowKey = null;
            _hoveredBitRowKey = null;
            if (isNaN(start) || isNaN(cnt)) { return; }
            const grp = hdr.closest<HTMLElement>('.si-arr-grp')!;
            _selectedArrKey    = grp.dataset.arrKey!;
            _selectedArrElemKey = null;
            _selectedFieldAddr = null;
            // Mark each nested element's first byte (except element 0) for visual separation.
            const elementHeaders = grp.querySelectorAll<HTMLElement>('.si-arr-el-hdr');
            if (elementHeaders.length > 0) {
                Array.from(elementHeaders).forEach((elHdr, i) => {
                    if (i === 0) { return; }
                    const bs = parseInt(elHdr.dataset.byteStart!);
                    if (isNaN(bs)) { return; }
                    _arrSepAddrs.push(bs);
                    const ah = bs.toString(16).toUpperCase().padStart(8, '0');
                    document.querySelectorAll<HTMLElement>(`[data-addr="${ah}"]`)
                        .forEach(el => el.classList.add('struct-arr-sep'));
                });
            } else {
                grp.querySelectorAll<HTMLElement>('.si-field').forEach((row, i) => {
                    if (i === 0) { return; }
                    const bs = parseInt(row.dataset.byteStart!);
                    if (isNaN(bs)) { return; }
                    _arrSepAddrs.push(bs);
                    const ah = bs.toString(16).toUpperCase().padStart(8, '0');
                    document.querySelectorAll<HTMLElement>(`[data-addr="${ah}"]`)
                        .forEach(el => el.classList.add('struct-arr-sep'));
                });
            }
            S.selStart = start;
            S.selEnd   = start + cnt - 1;
            hdr.classList.add('si-selected');
            import('./memoryView.js').then(m => { m.applySel(); m.scrollTo(start); });
            import('./sidebar.js').then(m => m.updateInspector());
        });
    });

    // Nested element: arrow toggles expand; row selects that element range.
    sec.querySelectorAll<HTMLElement>('.si-arr-el-hdr').forEach(hdr => {
        const expBtn = hdr.querySelector<HTMLElement>('.si-arr-el-exp-btn')!;
        const start  = parseInt(hdr.dataset.byteStart!);
        const cnt    = parseInt(hdr.dataset.byteCnt!);

        expBtn.addEventListener('click', e => {
            e.stopPropagation();
            const grp = hdr.closest<HTMLElement>('.si-arr-el-grp')!;
            const key = grp.dataset.arrElKey!;
            const body = grp.querySelector<HTMLElement>('.si-arr-el-body')!;
            const isOpen = _expandedArrayElements.has(key);
            if (isOpen) {
                _expandedArrayElements.delete(key);
                grp.classList.remove('open');
                body.style.display = 'none';
                expBtn.textContent = '▸';
                syncCompositeHeaderOffset(hdr, false);
            } else {
                _expandedArrayElements.add(key);
                grp.classList.add('open');
                body.style.display = '';
                expBtn.textContent = '▾';
                syncCompositeHeaderOffset(hdr, true);
            }
        });

        hdr.addEventListener('mouseenter', () => {
            for (let i = 0; i < cnt; i++) {
                const ah = (start + i).toString(16).toUpperCase().padStart(8, '0');
                document.querySelectorAll<HTMLElement>(`[data-addr="${ah}"]`)
                    .forEach(el => el.classList.add('struct-h'));
            }
        });
        hdr.addEventListener('mouseleave', () => {
            document.querySelectorAll<HTMLElement>('.struct-h')
                .forEach(el => el.classList.remove('struct-h'));
        });

        hdr.addEventListener('click', e => {
            if ((e.target as HTMLElement).closest('.si-arr-el-exp-btn')) { return; }
            clearArrSep();
            clearSelRow();
            _selectedBitRange = null;
            _hoveredBitRange = null;
            _selectedBitRowKey = null;
            _hoveredBitRowKey = null;
            if (isNaN(start) || isNaN(cnt)) { return; }
            _selectedArrElemKey = hdr.dataset.arrElKey!;
            _selectedArrKey = null;
            _selectedFieldAddr = null;
            S.selStart = start;
            S.selEnd   = start + cnt - 1;
            hdr.classList.add('si-selected');
            import('./memoryView.js').then(m => { m.applySel(); m.scrollTo(start); });
            import('./sidebar.js').then(m => m.updateInspector());
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
            const def  = allStructs().find(d => d.id === pin.structId);
            if (!def)  { return; }
            const size = structByteSize(def);
            S.selStart = pin.addr;
            S.selEnd   = pin.addr + size - 1;
            S.activeStructAddr = pin.addr;
            _selectedPinId = pin.id;
            sec.querySelectorAll<HTMLElement>('.si-card').forEach(c => c.classList.remove('si-card-selected'));
            card.classList.add('si-card-selected');
            rerender.toMemory();
            import('./memoryView.js').then(m => { m.applySel(); m.scrollTo(pin.addr); });
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
                const meta = parseBitRowMeta(row);
                if (meta) {
                    _selectedBitRange = { parentByteStart: meta.byteStart, startBit: meta.bitStart, endBit: meta.bitStart + meta.bitWidth - 1 };
                    _selectedBitRowKey = makeBitRowKey(meta.byteStart, meta.bitStart, meta.bitWidth);
                } else {
                    _selectedBitRange = null;
                    _selectedBitRowKey = null;
                }
                _hoveredBitRange = null;
                _hoveredBitRowKey = null;
                _selectedFieldAddr = null;
                _selectedArrKey = null;
                _selectedArrElemKey = null;
                clearSelRow();
                row.classList.add('si-selected');
                applyBitHighlightsInPlace(sec);
                return;
            }
            clearArrSep();
            clearSelRow();
            _selectedBitRange = null;
            _hoveredBitRange = null;
            _selectedBitRowKey = null;
            _hoveredBitRowKey = null;
            S.selStart = start;
            S.selEnd   = start + cnt - 1;
            row.classList.add('si-selected');
            _selectedFieldAddr = start;
            _selectedArrKey    = null;
            _selectedArrElemKey = null;
            import('./memoryView.js').then(m => { m.applySel(); m.scrollTo(start); });
            import('./sidebar.js').then(m => m.updateInspector());
            renderStructPins();
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
            showFieldValMenu(ev.clientX, ev.clientY, start, undefined, pinIdx, { isPointer, isBitUnitHeader, valKey });
        });
    });

    // Right-click on an array group header should allow actions on the
    // entire group (child elements).
    sec.querySelectorAll<HTMLElement>('.si-arr-grp-hdr').forEach(hdr => {
        hdr.addEventListener('contextmenu', ev => {
            if (hdr.classList.contains('si-bitunit-hdr')) { return; }
            ev.preventDefault(); ev.stopPropagation();
            const grp = hdr.closest<HTMLElement>('.si-arr-grp')!;
            const body = Array.from(grp.children).find(child =>
                child.classList.contains('si-arr-grp-body')
            ) as HTMLElement | undefined;
            const directValueRows = body
                ? Array.from(body.children).flatMap(child => {
                    const childEl = child as HTMLElement;
                    if (childEl.classList.contains('si-field')) { return [childEl]; }
                    if (childEl.classList.contains('si-arr-el-grp')) {
                        const hdr = Array.from(child.children).find(grandchild =>
                            grandchild.classList.contains('si-arr-el-hdr') &&
                            grandchild.classList.contains('si-field')
                        ) as HTMLElement | undefined;
                        return hdr ? [hdr] : [];
                    }
                    return [];
                })
                : [];
            const bsList = directValueRows.map(r => parseInt(r.dataset.byteStart!));
            const keyList = directValueRows.map(r => r.dataset.valKey ?? scalarValKey(parseInt(r.dataset.byteStart!)));
            const card = hdr.closest<HTMLElement>('.si-card');
            const pinIdx = card ? parseInt(card.dataset.idx!) : -1;
            const start = bsList[0];
            if (start === undefined) { return; }
            showFieldValMenu(ev.clientX, ev.clientY, start, bsList, pinIdx, { isArrayHeader: true, keyList });
        });
    });

    // Type-definition preview toggle inside card header
    sec.querySelectorAll<HTMLElement>('.si-type-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const id = btn.dataset.pinId!;
            const card = btn.closest<HTMLElement>('.si-card')!;
            const preview = card.querySelector<HTMLElement>('.si-type-preview');
            if (_previewedPins.has(id)) {
                _previewedPins.delete(id);
                btn.classList.remove('active');
                if (preview) { preview.style.display = 'none'; }
            } else {
                _previewedPins.add(id);
                btn.classList.add('active');
                if (preview) { preview.style.display = ''; }
            }
        });
    });

    // Inline pin-edit form wiring
    if (_editingPinId) {
        const editForm = sec.querySelector<HTMLElement>('.si-pin-edit-form');
        if (editForm) {
            const pinId = _editingPinId;
            editForm.querySelector<HTMLSelectElement>('.si-pe-type')?.addEventListener('change', e => {
                _editingPinDraftStructId = (e.target as HTMLSelectElement).value || null;
                renderStructPins();
            });
            editForm.querySelector<HTMLElement>('.si-pe-save')!.addEventListener('click', e => {
                e.stopPropagation();
                const nameVal = (editForm.querySelector('.si-pe-name') as HTMLInputElement).value.trim();
                const addrVal = (editForm.querySelector('.si-pe-addr') as HTMLInputElement).value.trim();
                const typeVal = (editForm.querySelector('.si-pe-type') as HTMLSelectElement).value;
                const addr = parseInt(addrVal.replace(/^0x/i, ''), 16);
                if (isNaN(addr)) {
                    (editForm.querySelector('.si-pe-addr') as HTMLInputElement).style.borderColor = 'var(--err)';
                    return;
                }
                const idx = S.structPins.findIndex(p => p.id === pinId);
                if (idx >= 0) {
                    const pin = S.structPins[idx];
                    S.structPins[idx] = {
                        ...pin,
                        name: nameVal || pin.name,
                        addr,
                        structId: typeVal,
                    };
                    S.activeStructAddr = addr;
                    vscode.postMessage({ type: 'saveStructPins', pins: S.structPins });
                }
                _editingPinId = null;
                _editingPinDraftStructId = null;
                renderStructPins();
            });
            editForm.querySelector<HTMLElement>('.si-pe-cancel')!.addEventListener('click', e => {
                e.stopPropagation();
                _editingPinId = null;
                _editingPinDraftStructId = null;
                renderStructPins();
            });
        }
    }

    applyBitHighlightsInPlace(sec);

    // Re-apply selection highlight after DOM rebuild
    if (_selectedPinId !== null) {
        sec.querySelectorAll<HTMLElement>('.si-card').forEach(card => {
            if (card.dataset.pinId === _selectedPinId) {
                card.classList.add('si-card-selected');
            }
        });
    }
    if (_selectedBitRowKey !== null) {
        sec.querySelectorAll<HTMLElement>('.si-field[data-bit-start][data-bit-width]').forEach(row => {
            const meta = parseBitRowMeta(row);
            if (!meta) { return; }
            const key = makeBitRowKey(meta.byteStart, meta.bitStart, meta.bitWidth);
            if (key === _selectedBitRowKey) {
                row.classList.add('si-selected');
            }
        });
    } else if (_selectedFieldAddr !== null) {
        sec.querySelectorAll<HTMLElement>('.si-field').forEach(row => {
            if (parseInt(row.dataset.byteStart!) === _selectedFieldAddr) {
                row.classList.add('si-selected');
            }
        });
    } else if (_selectedArrElemKey !== null) {
        sec.querySelectorAll<HTMLElement>('.si-arr-el-hdr').forEach(hdr => {
            if (hdr.dataset.arrElKey === _selectedArrElemKey) {
                hdr.classList.add('si-selected');
            }
        });
    } else if (_selectedArrKey !== null) {
        sec.querySelectorAll<HTMLElement>('.si-arr-grp-hdr').forEach(hdr => {
            const grp = hdr.closest<HTMLElement>('.si-arr-grp');
            if (grp?.dataset.arrKey === _selectedArrKey) {
                hdr.classList.add('si-selected');
            }
        });
    }
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

function showFieldValMenu(
    x: number,
    y: number,
    bs: number,
    bsList?: number[],
    pinIdx?: number,
    opts?: {
        isPointer?: boolean,
        isArrayHeader?: boolean,
        isBitUnitHeader?: boolean,
        valKey?: string,
        keyList?: string[],
    },
): void {
    hideFieldValMenu();
    // Determine candidate display types based on the field's native type.
    const sampleAddr = (bsList && bsList.length > 0) ? bsList[0] : bs;
    const allDefs = allStructs();
    const findRowsAt = (addr: number): DecodedField[] => {
        let pin: StructPin | undefined;
        if (typeof pinIdx === 'number' && pinIdx >= 0) { pin = S.structPins[pinIdx]; }
        else {
            pin = S.structPins.find(p => {
                const def = allDefs.find(d => d.id === p.structId);
                if (!def) { return false; }
                const size = structByteSize(def);
                return addr >= p.addr && addr < p.addr + size;
            });
        }
        if (!pin) { return []; }
        const def = allDefs.find(d => d.id === pin.structId);
        if (!def) { return []; }
        const rows = decodeStruct(def, pin.addr, getByte, S.endian, S.bitFieldAllocation);
        return rows.filter(rr => pin!.addr + rr.byteOffset === addr);
    };
    const findFieldAt = (addr: number): DecodedField | null => {
        return findRowsAt(addr)[0] ?? null;
    };
    const findFieldForKey = (rows: DecodedField[], addr: number, valKey?: string): DecodedField | null => {
        const atAddr = rows.filter(rr => rr.byteOffset === addr);
        if (!valKey) { return atAddr[0] ?? null; }
        if (valKey.startsWith('bit:')) {
            const parts = valKey.split(':');
            const bitStart = parseInt(parts[2] ?? '', 10);
            const bitWidth = parseInt(parts[3] ?? '', 10);
            return atAddr.find(rr =>
                isBitFieldRow(rr) &&
                rr.bitOffset === bitStart &&
                rr.bitWidth === bitWidth
            ) ?? atAddr[0] ?? null;
        }
        if (valKey.startsWith('bitunit:')) {
            return buildBitUnitAggregateRow(atAddr.filter(isBitFieldRow));
        }
        return atAddr[0] ?? null;
    };
    const sampleField = findFieldAt(sampleAddr);
    const sampleType = sampleField?.type ?? null;
    const isBitSample = sampleField ? isBitFieldRow(sampleField) : false;
    const isFloatSample = sampleType === 'float32' || sampleType === 'float64';
    const isAsciiSample = sampleType === 'ascii';
    const key = opts?.valKey ?? scalarValKey(bs);
    const arrayHasBitUnits = opts?.isArrayHeader && opts.keyList?.some(k => k.startsWith('bitunit:'));
    const bitUnitTypes = (addresses: number[]): ColType[] => {
        const hasPartialUnit = addresses.some(addr => !bitUnitUsesFullStorage(findRowsAt(addr)));
        return hasPartialUnit ? ['bin', 'bin-sliced', 'hex', 'dec'] : ['bin', 'hex', 'dec'];
    };
    const types: ColType[] = opts?.isBitUnitHeader
        ? bitUnitTypes([bs])
        : arrayHasBitUnits
            ? bitUnitTypes(bsList ?? [bs])
            : isFloatSample
                ? ['hex', 'dec', 'ieee', 'bin']
                : isAsciiSample
                    ? ['ascii', 'hex', 'bin']
                    : isBitSample
                        ? ['bin', 'hex', 'dec']
                        : ['hex', 'dec', 'bin', 'ascii'];
    let cur: ColType | null = null;
    if (bsList && bsList.length > 0) {
        const vals = bsList.map((b, idx) => {
            const listKey = opts?.keyList?.[idx] ?? scalarValKey(b);
            const field = findFieldAt(b);
            const ft = field?.type ?? null;
            const implicit = (listKey.startsWith('bitunit:') || (field && isBitFieldRow(field)))
                ? 'bin'
                : (ft === 'float32' || ft === 'float64') ? 'dec' : (ft === 'ascii' ? 'ascii' : _defaultValType);
            return _fieldValTypes.get(listKey) ?? implicit;
        });
        const allSame = vals.every(v => v === vals[0]);
        cur = allSame ? (vals[0] as ColType) : null;
    } else {
        cur = _fieldValTypes.get(key) ?? ((isBitSample || opts?.isBitUnitHeader) ? 'bin' : _defaultValType);
    }

    // Helpers for menu
    const item = (cmd: string, label: string, hint = '') =>
        `<div class="ctx-row" data-cmd="${cmd}">` +
        `<span class="ctx-label">${esc(label)}</span>` +
        (hint ? `<span class="ctx-hint">${esc(hint)}</span>` : '') +
        `</div>`;
    const sep = `<div class="ctx-sep"></div>`;
    const sub = (label: string, id: string, body: string) =>
        `<div class="ctx-row ctx-has-sub" data-sub="${id}">` +
        `<span class="ctx-label">${esc(label)}</span>` +
        `<div class="ctx-submenu">${body}</div>` +
        `</div>`;

    // Array header: copy start address + view-as for all elements
    if (opts?.isArrayHeader) {
        const TYPE_LABELS_FULL: Record<ColType, string> = { hex: 'Hex', dec: 'Decimal', bin: 'Binary', 'bin-sliced': 'Binary (bit fields only)', ascii: 'ASCII', ieee: 'IEEE754' };
        const dispMenu = types.map(t =>
            `<div class="ctx-row${t === cur ? ' active' : ''}" data-cmd="disp-${t}">` +
            `<span class="ctx-label">${TYPE_LABELS_FULL[t]}</span>` +
            `</div>`
        ).join('');
        const el = document.createElement('div');
        el.id = 'si-val-menu'; el.className = 'si-val-menu ctx-menu';
        el.innerHTML =
            item('copy-addr', 'Copy address') +
            sep +
            sub('View as', 'disp', dispMenu);
        document.body.appendChild(el);
        const mw = el.offsetWidth || 200; const mh = el.offsetHeight || 80;
        el.style.left = `${Math.min(x, window.innerWidth - mw - 8)}px`;
        el.style.top  = `${Math.min(y, window.innerHeight - mh - 8)}px`;
        el.querySelectorAll<HTMLElement>('.ctx-row[data-cmd]').forEach(row => {
            row.addEventListener('click', ev => {
                ev.stopPropagation();
                const cmd = row.dataset.cmd!;
                if (cmd === 'copy-addr') {
                    const addrStr = `0x${bs.toString(16).toUpperCase().padStart(8, '0')}`;
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(addrStr).catch(() => {
                            const ta = document.createElement('textarea');
                            ta.value = addrStr; document.body.appendChild(ta); ta.select();
                            document.execCommand('copy'); ta.remove();
                        });
                    } else {
                        const ta = document.createElement('textarea');
                        ta.value = addrStr; document.body.appendChild(ta); ta.select();
                        document.execCommand('copy'); ta.remove();
                    }
                    hideFieldValMenu();
                    return;
                }
                if (cmd.startsWith('disp-') && bsList && bsList.length > 0) {
                    const t = cmd.replace('disp-', '') as ColType;
                    bsList.forEach((b, idx) => {
                        const listKey = opts?.keyList?.[idx] ?? scalarValKey(b);
                        const field = findFieldAt(b);
                        const ft = field?.type ?? null;
                        const implicit = (listKey.startsWith('bitunit:') || (field && isBitFieldRow(field)))
                            ? 'bin'
                            : (ft === 'float32' || ft === 'float64') ? 'dec' : (ft === 'ascii' ? 'ascii' : _defaultValType);
                        if (t === implicit) { _fieldValTypes.delete(listKey); }
                        else { _fieldValTypes.set(listKey, t); }
                    });
                    hideFieldValMenu();
                    renderStructPins();
                }
            });
        });
        wireStructSubmenus(el);
        addFieldValMenuClickAway();
        _valMenuEl = el;
        return;
    }

    // Pointer: only allow copy address value
    if (opts?.isPointer) {
        const el = document.createElement('div');
        el.id = 'si-val-menu'; el.className = 'si-val-menu ctx-menu';
        el.innerHTML = item('copy-hex', 'Copy value');
        document.body.appendChild(el);
        const mw = el.offsetWidth || 180; const mh = el.offsetHeight || 60;
        el.style.left = `${Math.min(x, window.innerWidth - mw - 8)}px`;
        el.style.top  = `${Math.min(y, window.innerHeight - mh - 8)}px`;
        el.querySelectorAll<HTMLElement>('.ctx-row[data-cmd]').forEach(row => {
            row.addEventListener('click', ev => {
                ev.stopPropagation();
                // Always copy as hex address
                let pin: StructPin | undefined;
                const all = allStructs();
                if (typeof pinIdx === 'number' && pinIdx >= 0) {
                    pin = S.structPins[pinIdx];
                } else {
                    pin = S.structPins.find(p => {
                        const def = all.find(d => d.id === p.structId);
                        if (!def) { return false; }
                        const size = structByteSize(def);
                        return bs >= p.addr && bs < p.addr + size;
                    });
                }
                if (!pin) { hideFieldValMenu(); return; }
                const def = all.find(d => d.id === pin!.structId);
                if (!def) { hideFieldValMenu(); return; }
                const rows = decodeStruct(def, pin.addr, getByte, S.endian, S.bitFieldAllocation);
                const r = findFieldForKey(rows, bs - pin.addr, opts?.valKey);
                const toCopy = r ? singleLineCopyText(getCopyText(r, 'hex')) : '??';
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(toCopy).catch(() => {
                        const ta = document.createElement('textarea');
                        ta.value = toCopy; document.body.appendChild(ta); ta.select();
                        document.execCommand('copy'); ta.remove();
                    });
                } else {
                    const ta = document.createElement('textarea');
                    ta.value = toCopy; document.body.appendChild(ta); ta.select();
                    document.execCommand('copy'); ta.remove();
                }
                hideFieldValMenu();
                return;
            });
        });
        addFieldValMenuClickAway();
        _valMenuEl = el;
        return;
    }

    const TYPE_LABELS: Record<ColType, string> = { hex: 'Hex', dec: 'Decimal', bin: 'Binary', 'bin-sliced': 'Binary (bit fields only)', ascii: 'ASCII', ieee: 'IEEE754' };

    // Copy submenu
    const copyMenu = types.map(t =>
        item(`copy-${t}`, TYPE_LABELS[t], '')
    ).join('');

    // Display type submenu
    const dispMenu = types.map(t =>
        `<div class="ctx-row${t===cur ? ' active' : ''}" data-cmd="disp-${t}">` +
        `<span class="ctx-label">${TYPE_LABELS[t]}</span>` +
        `</div>`
    ).join('');
    // Compose menu
    const el = document.createElement('div');
    el.id = 'si-val-menu'; el.className = 'si-val-menu ctx-menu';
    el.innerHTML =
        sub('Copy as', 'copy', copyMenu) +
        sep +
        sub('View as', 'disp', dispMenu);

    document.body.appendChild(el);
    const mw = el.offsetWidth || 220; const mh = el.offsetHeight || 120;
    el.style.left = `${Math.min(x, window.innerWidth - mw - 8)}px`;
    el.style.top  = `${Math.min(y, window.innerHeight - mh - 8)}px`;

    // Wire leaf-item clicks
    el.querySelectorAll<HTMLElement>('.ctx-row[data-cmd]').forEach(row => {
        row.addEventListener('click', ev => {
            ev.stopPropagation();
            const cmd = row.dataset.cmd!;
            // Copy actions
            if (cmd.startsWith('copy-')) {
                const t = cmd.replace('copy-', '') as ColType;
                let pin: StructPin | undefined;
                const all = allStructs();
                if (typeof pinIdx === 'number' && pinIdx >= 0) {
                    pin = S.structPins[pinIdx];
                } else {
                    pin = S.structPins.find(p => {
                        const def = all.find(d => d.id === p.structId);
                        if (!def) { return false; }
                        const size = structByteSize(def);
                        return bs >= p.addr && bs < p.addr + size;
                    });
                }
                if (!pin) { hideFieldValMenu(); return; }
                const def = all.find(d => d.id === pin!.structId);
                if (!def) { hideFieldValMenu(); return; }
                const rows = decodeStruct(def, pin.addr, getByte, S.endian, S.bitFieldAllocation);
                const toCopy = (bsList && bsList.length > 0)
                    ? bsList.map((b, idx) => {
                        const listKey = opts?.keyList?.[idx];
                        const r = findFieldForKey(rows, b - pin!.addr, listKey);
                        return r ? singleLineCopyText(getCopyText(r, t)) : '??';
                      }).join('; ')
                    : (() => {
                        const r = findFieldForKey(rows, bs - pin!.addr, opts?.valKey);
                        return r ? singleLineCopyText(getCopyText(r, t)) : '??';
                      })();
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(toCopy).catch(() => {
                        const ta = document.createElement('textarea');
                        ta.value = toCopy; document.body.appendChild(ta); ta.select();
                        document.execCommand('copy'); ta.remove();
                    });
                } else {
                    const ta = document.createElement('textarea');
                    ta.value = toCopy; document.body.appendChild(ta); ta.select();
                    document.execCommand('copy'); ta.remove();
                }
                hideFieldValMenu();
                return;
            }
            // Display type actions
            if (cmd.startsWith('disp-')) {
                const t = cmd.replace('disp-', '') as ColType;
                const field = findFieldAt(bs);
                const ft = field?.type ?? null;
                const implicit = opts?.isBitUnitHeader || (field && isBitFieldRow(field))
                    ? 'bin'
                    : (ft === 'float32' || ft === 'float64') ? 'dec' : (ft === 'ascii' ? 'ascii' : _defaultValType);
                if (t === implicit) { _fieldValTypes.delete(key); }
                else { _fieldValTypes.set(key, t); }
                hideFieldValMenu();
                renderStructPins();
                return;
            }
        });
    });

    // Wire submenus (hover logic)
    wireStructSubmenus(el);

    // Hide when clicking outside
    addFieldValMenuClickAway();
    _valMenuEl = el;
}
function wireStructSubmenus(menuEl: HTMLElement): void {
    let closeTimer: ReturnType<typeof setTimeout> | null = null;
    let activeSub: HTMLElement | null = null;
    const openSub = (sub: HTMLElement, row: HTMLElement) => {
        if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
        if (activeSub && activeSub !== sub) { activeSub.style.display = 'none'; }
        activeSub = sub;
        sub.style.display = 'block';
        // Viewport edge: flip left if no room on right
        const rr = row.getBoundingClientRect();
        const sw = sub.offsetWidth || 220;
        if (rr.right + sw > window.innerWidth - 8) {
            sub.style.left = 'auto'; sub.style.right = '100%';
        } else {
            sub.style.left = '100%'; sub.style.right = 'auto';
        }
    };
    const scheduledClose = (sub: HTMLElement) => {
        closeTimer = setTimeout(() => {
            sub.style.display = 'none';
            if (activeSub === sub) { activeSub = null; }
        }, 100);
    };
    menuEl.querySelectorAll<HTMLElement>('.ctx-has-sub').forEach(row => {
        const sub = row.querySelector<HTMLElement>('.ctx-submenu');
        if (!sub) { return; }
        row.addEventListener('mouseenter', () => openSub(sub, row));
        row.addEventListener('mouseleave', e => {
            if (!sub.contains(e.relatedTarget as Node)) { scheduledClose(sub); }
        });
        sub.addEventListener('mouseenter', () => {
            if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
        });
        sub.addEventListener('mouseleave', e => {
            if (!row.contains(e.relatedTarget as Node)) { scheduledClose(sub); }
        });
    });
}

// ── Selection sync ────────────────────────────────────────────────

/** Called when the user's byte selection changes. Fills the add-form address if open. */
export function onSelectionChangeForStruct(): void {
    if (typeof document === 'undefined') { return; }
    clearArrSep();
    clearSelRow();
    _selectedFieldAddr = null;
    _selectedArrKey    = null;
    _selectedArrElemKey = null;
    _selectedPinId     = null;
    if (S.selStart === null) { return; }
    S.activeStructAddr = S.selStart;
    if (S.sidebarTab === 'struct') {
        const addrHex = S.selStart.toString(16).toUpperCase().padStart(8, '0');
        if (_addingPin) {
            const inp = document.getElementById('sa-addr') as HTMLInputElement | null;
            if (inp) {
                inp.value = addrHex;
                const confirmBtn = document.getElementById('sa-confirm') as HTMLButtonElement | null;
                if (confirmBtn) { confirmBtn.disabled = !_applyStructId; }
            }
        } else if (_editingPinId) {
            const inp = document.querySelector<HTMLInputElement>('.si-pe-addr');
            if (inp) { inp.value = addrHex; }
        }
    }
}
