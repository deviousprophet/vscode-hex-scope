/** Struct Overlay — UI layer. Self-contained Struct sidebar panel.
Owns the pins/instances track + types/editor track, all their UI state
(add/edit struct definitions, C preview, add/edit/delete pins, decoded
instance rows incl. bit units / arrays / pointers, bit-field allocation
toggle, expansion state, field-value menus, pointer follow/create).
Data is pushed via setters; actions report via callbacks. This module
never imports the `S` global, never posts provider messages, and never
touches the render registry. Pure codec logic lives in structCodec.ts. */

import { esc, actionBtnsHtml, wireActionBtns, formatDecimal, formatHex, formatHexHtml, getBigUint64, getBigInt64, asUint64, positionContextMenu, wireHoverSubmenus } from '../../../utils';
import {
    makeStructPin,
    parseStructPinAddressInput,
    uniqueStructPinName as uniquePinName,
    upsertPointerStructPin,
    withEditedStructPin,
    withoutStructDefinition,
    withoutStructPin,
} from './structPinsModel';
import {
    FIELD_TYPES,
    fieldByteSize, structByteSize, decodeField, decodeStruct, allStructs, resolveStructFieldByPath,
    parseStructText, fieldsToText, structToC, validateStructs, MAX_NESTED_DEPTH,
    normalizeStructField,
} from '../../../../core/structCodec.js';
import type { DecodedField } from '../../../../core/structCodec.js';
import type { BitFieldAllocation, BitFieldChild, StructDef, StructField, StructFieldType, StructPin } from '../../../../core/types';
import './structPanel.css';

export interface StructCallbacks {
    /** Required — host memory adapter for byte reads (keeps byte access host-owned, like Inspector). */
    readByte: (addr: number) => number | undefined;
    /** Any struct-definition mutation (save/delete struct) → host persists + syncs. */
    onStructsChange?: (structs: StructDef[]) => void;
    /** Any pin mutation (add/edit/delete/pointer-create) → host persists + syncs. */
    onPinsChange?: (pins: StructPin[]) => void;
    /** Both changed in one action (e.g. delete struct cascades pins). */
    onStateChange?: (structs: StructDef[], pins: StructPin[]) => void;
    /** Struct row/range selection → host sets S.selStart/selEnd + rerender.jumpTo + rerender.inspector. */
    onSelectRange?: (start: number, count: number) => void;
    /** Hex-row highlight: apply class at address range (moved highlightAddress). */
    onHighlightHex?: (addrs: number[], cls: string) => void;
    /** Hex-row highlight: remove class everywhere (moved clearArrSep / struct-h clear). */
    onClearHighlightHex?: (cls: string) => void;
}

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











type NumericValueFormatter = (valType: ColType, dv: DataView, le: boolean) => string;

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

type StructRenderContext = {
    def: StructDef;
    pin: StructPin;
    baseAddr: number;
    keyPrefix: string;
    pointerDepth: number;
    hideOffsets: boolean;
};

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

type ValueKeyKind = 'default' | 'bit' | 'bitunit';

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

type CopySourceRows = { pin: StructPin; rows: DecodedField[]; structId: string; baseAddr: number };
type PointerMenuSource = { pin: StructPin; row: DecodedField; sourceStructId: string; sourceBaseAddr: number };

type PointerFollowState = { ok: true } | { ok: false; reason: string };

type PointerFollowGuard = (row: DecodedField | null) => string | null;

type StructPointerCreateState =
    | { ok: true; def: StructDef; addr: number; structId: string }
    | { ok: false; reason: string }
    | null;

export class StructPanel {
    private readonly cb: StructCallbacks;
    private _root: HTMLElement | null = null;
    private _structs: StructDef[] = [];
    private _pins: StructPin[] = [];
    private _endian: 'le' | 'be' = 'le';
    private _bitFieldAllocation: BitFieldAllocation = 'msb';
    private _activeStructAddr: number | null = null;
    /** Whether the struct tab is the active sidebar tab (host pushes; guards add/edit address input sync). */
    private _tabActive = false;
    private _valMenuEl: HTMLElement | null = null;

    // ── UI/transient state (component-owned) ──────────────────────

    /** Struct id currently selected in the add form. */
    private _applyStructId: string | null = null;
    /** Set of instance card ids that are expanded. */
    private _expanded = new Set<string>();
    /** Array field groups that are expanded. Key: `${pinId}::${baseName}`. Collapsed by default. */
    private _expandedArrayFields = new Set<string>();
    /** Nested element groups that are expanded. Key: `${pinId}::${baseName}::${idx}`. Collapsed by default. */
    private _expandedArrayElements = new Set<string>();
    /** Default display type for value cells (per-field default). */
    private _defaultValType: ColType = 'hex';
/** Per-value display override keyed by stable row identity. */
private _fieldValTypes = new Map<string, ColType>();
/** Whether the inline add-instance form is open. */
private _addingPin = false;
/** Byte start address of the currently highlighted field row. */
private _selectedFieldAddr: number | null = null;
/** Array group key of the currently highlighted array header. */
private _selectedArrKey: string | null = null;
/** Nested array element key of the currently highlighted element header. */
private _selectedArrElemKey: string | null = null;
/** Selected bit-field range to highlight on its parent bit-unit value. */
private _selectedBitRange: { parentByteStart: number; startBit: number; endBit: number } | null = null;
/** Hovered bit-field range to preview highlight on parent bit-unit value. */
private _hoveredBitRange: { parentByteStart: number; startBit: number; endBit: number } | null = null;
/** Selected bit-field child row identity: `${byteStart}:${bitStart}:${bitWidth}`. */
private _selectedBitRowKey: string | null = null;
/** Hovered bit-field child row identity: `${byteStart}:${bitStart}:${bitWidth}`. */
private _hoveredBitRowKey: string | null = null;
/** Byte start addresses marked with struct-arr-sep in the hex view. */
private _arrSepAddrs: number[] = [];
/** Pin id of the currently selected instance card. */
private _selectedPinId: string | null = null;
/** Pins whose type-definition preview is open inside the card. */
private _previewedPins = new Set<string>();
/** Whether the manage-types list view is open. */
private _managingTypes = false;
/** Pin id currently being edited inline (name/addr/type). */
private _editingPinId: string | null = null;
/** Struct type id selected in the inline instance-edit form (may differ from the saved pin). */
private _editingPinDraftStructId: string | null = null;
/**
 * When non-null the section is in "type editor" mode.
 * `existing` is null for new types, or the original def being edited.
 * `draft`    holds the working copy being modified.
 * `fromAdd`  is true when the editor was opened from the add-instance form.
 * `fromManage` is true when opened from the manage-types list.
 */
private _editingType: { draft: StructDef; existing: StructDef | null; fromAdd: boolean; fromManage: boolean } | null = null;
private _editorError: string | null = null;

constructor(cb: StructCallbacks) {
    this.cb = cb;
}

/** Renders both tracks into the given root (was renderStructPins onto #s-struct-pins). */
mount(root: HTMLElement): void {
    this._root = root;
    this.render();
}

/** Re-renders the whole panel from pushed state (was renderStructPins). No-op until mounted. */
render(): void {
    const sec = this._root;
    if (!sec) { return; }

    const all = allStructs(this._structs);
    this.prepareStructPanelState(all);
    sec.innerHTML = this.structPinsPanelHtml(all);

    this.hydrateStructPreviews(sec);
    this.wireStructPinsPanel(sec);

    this.wireInstanceCards(sec);

    if (this._editingType) {
        this.wireEditorInSec(sec);
        sec.querySelector<HTMLInputElement>('#se-name')?.focus();
    }
}

/** Push both tracks' data (after full render / external change) and re-render. */
setData(structs: StructDef[], pins: StructPin[]): void {
    this._structs = structs;
    this._pins = pins;
    this.render();
}

/** Shared byte-order decode source (host pushes S.endian). */
setEndian(endian: 'le' | 'be'): void {
    this._endian = endian;
    this.render();
}

/** Bit-field allocation source (host pushes S.bitFieldAllocation). */
setBitFieldAllocation(alloc: BitFieldAllocation): void {
    this._bitFieldAllocation = alloc;
    this.render();
}

/** Hex-view byte selection → clear stale struct selection + sync add/edit form (was onSelectionChangeForStruct). */
setSelection(start: number | null): void {
    if (typeof document === 'undefined') { return; }
    this.clearStructSelectionState();
    if (start === null) { return; }
    this._activeStructAddr = start;
    this.updateStructAddressInputs(start);
}

/** Host pushes the active sidebar tab (guards add/edit address input sync to the visible struct tab). */
setTabActive(active: boolean): void {
    this._tabActive = active;
}

/** Resets all transient view state and re-renders. Call when switching away and back (was resetStructViewState). */
resetViewState(): void {
    this._editingType             = null;
    this._addingPin               = false;
    this._managingTypes           = false;
    this._editingPinId            = null;
    this._editingPinDraftStructId = null;
    this._selectedArrElemKey      = null;
    this._selectedBitRange        = null;
    this._hoveredBitRange         = null;
    this._selectedBitRowKey       = null;
    this._hoveredBitRowKey        = null;
    this.render();
}

// ── Inline type editor helpers ────────────────────────────────────

private sanitizeCIdent(raw: string): string {
    return raw.replace(/[^A-Za-z0-9_]/g, '').replace(/^(\d)/, '_$1');
}

private isBitFieldRow(r: DecodedField): boolean {
    return r.isBitField === true && typeof r.bitWidth === 'number';
}

/** Calculate total bits used by all children in a bit-field container. */
private usedBitsInContainer(f: import('../../../../core/types').StructField): number {
    if (!Array.isArray(f.bitFields)) {
        return 0;
    }
    return f.bitFields.reduce((sum, child) => sum + child.bitWidth, 0);
}

/** Calculate available bits remaining in a bit-field container. */
private availableBitsInContainer(f: import('../../../../core/types').StructField): number {
    if (!this.isUnsignedScalarType(f.type)) { return 0; }
    const typeBytes = fieldByteSize(f.type);
    const totalBits = typeBytes * 8;
    const usedBits = this.usedBitsInContainer(f);
    return totalBits - usedBits;
}

private renderBitSpan(bit: string, idx: number, selected: boolean): string {
    const sel = selected ? ' sel' : '';
    return `<span class="si-bit ${bit === '1' ? 'one' : 'zero'}${sel}" data-bit-idx="${idx}">${bit}</span>`;
}

private renderUnknownBitSpan(bitIdx: number, selected: boolean): string {
    return `<span class="si-bit unknown${selected ? ' sel' : ''}" data-bit-idx="${bitIdx}">?</span>`;
}

private isBitSelected(
    bitIdx: number,
    selectedRange?: { startBit: number; endBit: number } | null,
): boolean {
    return !!selectedRange && bitIdx >= selectedRange.startBit && bitIdx <= selectedRange.endBit;
}

private byteHexParts(bytesHex: string): string[] {
    return bytesHex.split(' ').map(p => p.trim()).filter(Boolean);
}

private hasMissingByte(parts: string[]): boolean {
    return parts.length === 0 || parts.some(p => p === '??');
}

private bytesFromHexParts(parts: string[]): number[] {
    return parts.map(h => parseInt(h, 16));
}

private bytesToValue(raw: number[], endian: 'le' | 'be'): bigint {
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

private makeBitRowKey(byteStart: number, bitStart: number, bitWidth: number): string {
    return `${byteStart}:${bitStart}:${bitWidth}`;
}

private scalarValKey(byteStart: number): string {
    return `byte:${byteStart}`;
}

private bitChildValKey(byteStart: number, bitStart: number, bitWidth: number): string {
    return `bit:${this.makeBitRowKey(byteStart, bitStart, bitWidth)}`;
}

private bitUnitValKey(byteStart: number): string {
    return `bitunit:${byteStart}`;
}

private bitRowWidth(row: DecodedField | null | undefined): number {
    return this.isBitFieldRow(row as DecodedField) ? row?.bitWidth ?? 0 : 0;
}

private bitUnitUsesFullStorage(rows: DecodedField[]): boolean {
    const first = rows[0];
    if (!first || !this.isBitFieldRow(first)) { return false; }
    const usedBits = rows.reduce((sum, row) => sum + this.bitRowWidth(row), 0);
    const storageBits = (first.bitStorageByteSize ?? fieldByteSize(first.type)) * 8;
    return usedBits >= storageBits;
}

private binaryGroupsLowBitsFirst(bits: string): string[] {
    const groups: string[] = [];
    for (let end = bits.length; end > 0; end -= 4) {
        groups.unshift(bits.slice(Math.max(0, end - 4), end));
    }
    return groups;
}

private renderBinarySpanLines(spans: string[]): string {
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

private binaryBitsForValue(bytes: number[], endian: 'le' | 'be'): string {
    return this.bytesToValue(bytes, endian).toString(2).padStart(bytes.length * 8, '0');
}

private renderPlainBinaryBits(bits: string): string {
    return this.renderBinarySpanLines([...bits].map((bit, idx) => this.renderBitSpan(bit, idx, false)));
}

private formatPlainBinaryBits(bits: string): string {
    const groups = bits.match(/.{1,4}/g) || [];
    return groups.join(' ');
}

private singleLineCopyText(text: string): string {
    return text.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

private parseDatasetInt(value: string | undefined): number | null {
    const parsed = parseInt(value ?? '', 10);
    return Number.isFinite(parsed) ? parsed : null;
}

private parsePositiveDatasetInt(value: string | undefined): number | null {
    const parsed = this.parseDatasetInt(value);
    return parsed !== null && parsed > 0 ? parsed : null;
}

private parseBitRowMeta(row: HTMLElement): { byteStart: number; bitStart: number; bitWidth: number } | null {
    const byteStart = this.parseDatasetInt(row.dataset.byteStart);
    if (byteStart === null) { return null; }
    const bitStart = this.parseDatasetInt(row.dataset.bitStart);
    if (bitStart === null) { return null; }
    const bitWidth = this.parsePositiveDatasetInt(row.dataset.bitWidth);
    if (bitWidth === null) { return null; }
    return { byteStart, bitStart, bitWidth };
}

private applyBitHighlightsInPlace(sec: HTMLElement): void {
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

    applyRange(this._selectedBitRange, 'sel');
    applyRange(this._hoveredBitRange, 'hov');
}

private renderBinaryFromBitRows(
    rows: DecodedField[],
    selectedRange?: { startBit: number; endBit: number } | null,
): string {
    const usedWidth = rows.reduce((sum, r) => sum + Math.max(0, r.bitWidth ?? 0), 0);
    const first = rows[0];
    if (!first || usedWidth <= 0) {
        return '<span class="si-bin-wrap"></span>';
    }
    const rawParts = this.byteHexParts(first.bytesHex);
    if (this.hasBitRowData(first, rawParts)) {
        return this.renderKnownBitRowBits(rawParts, usedWidth, selectedRange);
    }
    return this.renderUnknownBitRowBits(usedWidth, selectedRange);
}

private hasBitRowData(first: DecodedField, rawParts: string[]): boolean {
    return first.hasData && !this.hasMissingByte(rawParts);
}

private renderKnownBitRowBits(rawParts: string[], usedWidth: number, selectedRange?: { startBit: number; endBit: number } | null): string {
    const bits = this.slicedBitRowBits(rawParts, usedWidth);
    const spans = [...bits].map((bit, displayIdx) => {
        const bitIdx = this.displayBitIndex(displayIdx, usedWidth);
        return this.renderBitSpan(bit, bitIdx, this.isBitSelected(bitIdx, selectedRange));
    });
    return this.renderBinarySpanLines(spans);
}

private slicedBitRowBits(rawParts: string[], usedWidth: number): string {
    const raw = this.bytesFromHexParts(rawParts);
    const value = this.bytesToValue(raw, this._endian);
    const unitBits = raw.length * 8;
    const mask = (1n << BigInt(usedWidth)) - 1n;
    const slicedValue = this._bitFieldAllocation === 'lsb'
        ? value & mask
        : (value >> BigInt(Math.max(0, unitBits - usedWidth))) & mask;
    return slicedValue.toString(2).padStart(usedWidth, '0');
}

private renderUnknownBitRowBits(usedWidth: number, selectedRange?: { startBit: number; endBit: number } | null): string {
    const spans = Array.from({ length: usedWidth }, (_, displayIdx) => {
        const bitIdx = this.displayBitIndex(displayIdx, usedWidth);
        return this.renderUnknownBitSpan(bitIdx, this.isBitSelected(bitIdx, selectedRange));
    });
    return this.renderBinarySpanLines(spans);
}

private displayBitIndex(displayIdx: number, usedWidth: number): number {
    return this._bitFieldAllocation === 'lsb' ? usedWidth - displayIdx - 1 : displayIdx;
}

private renderBinaryStorageUnit(
    r: DecodedField,
    selectedRange?: { startBit: number; endBit: number } | null,
): string {
    const rawParts = this.byteHexParts(r.bytesHex);
    if (this.hasMissingByte(rawParts)) {
        const byteCount = r.bitStorageByteSize ?? (rawParts.length || 1);
        const bitCount = byteCount * 8;
        const spans = Array.from({ length: bitCount }, (_, displayIdx) => {
            const numericBitIdx = bitCount - displayIdx - 1;
            const bitIdx = this._bitFieldAllocation === 'lsb' ? numericBitIdx : displayIdx;
            return this.renderUnknownBitSpan(bitIdx, this.isBitSelected(bitIdx, selectedRange));
        });
        return this.renderBinarySpanLines(spans);
    }

    const bytes = this.bytesFromHexParts(rawParts);
    const bitCount = bytes.length * 8;
    const bits = this.binaryBitsForValue(bytes, this._endian);
    const spans = [...bits].map((bit, displayIdx) => {
        const numericBitIdx = bitCount - displayIdx - 1;
        const storageBitIdx = this._bitFieldAllocation === 'lsb' ? numericBitIdx : displayIdx;
        return this.renderBitSpan(bit, storageBitIdx, this.isBitSelected(storageBitIdx, selectedRange));
    });

    return this.renderBinarySpanLines(spans);
}

private fieldTypeOptionsHtml(f: StructField, draftId: string): string {
    f = normalizeStructField(f);
    const scalarOptions = FIELD_TYPES.map(t =>
        `<option value="${t}"${f.type === t ? ' selected' : ''}>${t}</option>`
    ).join('');
    const structOptions = allStructs(this._structs)
        .filter(d => d.id !== draftId)
        .map(d => this.structOptionHtml(f, d))
        .join('');
    return `<optgroup label="Scalar">${scalarOptions}</optgroup>` +
        (structOptions ? `<optgroup label="Struct">${structOptions}</optgroup>` : '');
}

private structOptionHtml(f: StructField, d: StructDef): string {
    f = normalizeStructField(f);
    const val = `struct:${d.id}`;
    const selected = f.type === 'struct' && f.refStructId === d.id;
    return `<option value="${esc(val)}"${selected ? ' selected' : ''}>struct ${esc(d.name)}</option>`;
}

private isBitContainerField(f: StructField): boolean {
    f = normalizeStructField(f);
    if (f.isPointer) { return false; }
    return this.isUnsignedScalarType(f.type) && Array.isArray(f.bitFields) && f.bitFields.length > 0;
}

private bitChildrenHtml(f: StructField, isBitContainer: boolean): string {
    if (!isBitContainer) { return ''; }
    const bitFields = f.bitFields ?? [];
    const childRows = bitFields.map((child, ci) => this.childFieldRowHtml(child, ci, bitFields.length)).join('');
    const remainingBits = this.availableBitsInContainer(f);
    const { addBtnDisabled, addBtnTitle } = this.bitChildButtonState(remainingBits);
    return (
        `<div class="sfe-bf-children"${f.bitFieldsCollapsed === true ? ' style="display:none"' : ''}>` +
        childRows +
        `<button class="sfe-bf-add-child" title="${addBtnTitle}"${addBtnDisabled}>+ Add bit</button>` +
        `</div>`
    );
}

private bitChildButtonState(remainingBits: number): { addBtnDisabled: string; addBtnTitle: string } {
    return {
        addBtnDisabled: remainingBits > 0 ? '' : ' disabled',
        addBtnTitle: remainingBits > 0 ? 'Add bit-field child' : 'No bits remaining in parent',
    };
}

private deleteFieldCellHtml(isOnly: boolean): string {
    return isOnly
        ? `<span class="sfe-del-placeholder"></span>`
        : `<button class="sfe-del-btn" title="Remove field">\u2715</button>`;
}

private disabledAttr(isDisabled: boolean): string {
    return isDisabled ? ' disabled' : '';
}

private activeClassAttr(isActive: boolean): string {
    return isActive ? ' active' : '';
}

private fieldArrayCellHtml(f: StructField): string {
    const isArr = f.count > 1;
    return (
        `<div class="sfe-arr-cell${isArr ? ' is-array' : ''}">` +
        `<button class="sfe-arr-toggle${this.activeClassAttr(isArr)}" title="${isArr ? 'Remove array' : 'Make array'}">[ ]</button>` +
        `<input class="sfe-count-inp" type="text" inputmode="numeric" ` +
               `value="${isArr ? f.count : ''}" placeholder="N" maxlength="3">` +
        `</div>`
    );
}

private fieldBitToggleHtml(f: StructField, isBitContainer: boolean): string {
    f = normalizeStructField(f);
    const isUnsigned = this.isUnsignedScalarType(f.type);
    const bitBtnClass = isUnsigned && isBitContainer ? ' sfe-bit-btn-on' : '';
    return `<button class="sfe-bit-btn${bitBtnClass}" title="Toggle bit-field details"${this.disabledAttr(!isUnsigned || f.isPointer === true)}>:N</button>`;
}

private fieldPointerToggleHtml(f: StructField, isBitContainer: boolean): string {
    f = normalizeStructField(f);
    const active = f.isPointer === true;
    const disabled = isBitContainer;
    return `<button class="sfe-ptr-btn${this.activeClassAttr(active)}" title="Toggle pointer field"${this.disabledAttr(disabled)}>*</button>`;
}

private fieldMoveButtonsHtml(i: number, total: number): string {
    return (
        `<div class="sfe-move-btns">` +
        `<button class="sfe-move-btn sfe-move-up" title="Move up" aria-label="Move up"${this.disabledAttr(i === 0)}>&#x2191;</button>` +
        `<button class="sfe-move-btn sfe-move-dn" title="Move down" aria-label="Move down"${this.disabledAttr(i === total - 1)}>&#x2193;</button>` +
        `</div>`
    );
}

private fieldRowHtml(
    f: StructField,
    i: number,
    isOnly: boolean,
    total: number,
    draftId: string,
): string {
    const typeOpts = this.fieldTypeOptionsHtml(f, draftId);
    const isBitContainer = this.isBitContainerField(f);
    const delCell = this.deleteFieldCellHtml(isOnly);
    const childrenHtml = this.bitChildrenHtml(f, isBitContainer);

    return (
        `<div class="struct-field-row${isBitContainer ? ' has-bit-children' : ''}" data-idx="${i}">` +
        `<select class="sfe-type-sel">${typeOpts}</select>` +
        this.fieldPointerToggleHtml(f, isBitContainer) +
        `<input class="sfe-name-inp" type="text" value="${esc(f.name)}" maxlength="64" ` +
               `placeholder="fieldName" spellcheck="false" autocomplete="off">` +
        this.fieldBitToggleHtml(f, isBitContainer) +
        this.fieldArrayCellHtml(f) +
        this.fieldMoveButtonsHtml(i, total) +
        delCell +
        childrenHtml +
        `</div>`
    );
}

/** Render a single bit-field child row inside a bit-field container parent. */
private childFieldRowHtml(child: BitFieldChild, ci: number, total: number): string {
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
        `<button class="sfe-move-btn sfe-move-up" title="Move up" aria-label="Move up"${upDis}>&#x2191;</button>` +
        `<button class="sfe-move-btn sfe-move-dn" title="Move down" aria-label="Move down"${dnDis}>&#x2193;</button>` +
        `</div>` +
        delCell +
        `</div>`
    );
}

/** Check if a field type is an unsigned scalar (eligible for bit-field container). */
private isUnsignedScalarType(type: import('../../../../core/types').StructFieldType): type is import('../../../../core/types').StructScalarFieldType {
    return type === 'uint8' || type === 'uint16' || type === 'uint32' || type === 'uint64';
}

/** Get bit capacity for a parent field type. */
private getParentBitCapacity(type: import('../../../../core/types').StructFieldType): number {
    return fieldByteSize(type as any) * 8;
}

// ── C syntax-highlighted struct preview ─────────────────────────────────────

private readonly SC_KW   = /\b(typedef|struct)\b/g;
private readonly SC_ATTR = /__attribute__\(\(packed\)\)/g;

private buildStructCPreviewNodes(def: StructDef): DocumentFragment {
    const out = document.createDocumentFragment();
    const nameEscRe = (def.name || 'MyStruct').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const nestedTypeNames = def.fields
        .filter(f => f.type === 'struct' && f.refStructId)
        .map(f => allStructs(this._structs).find(d => d.id === f.refStructId)?.name)
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
        const tokenRe = new RegExp(`${this.SC_ATTR.source}|${this.SC_KW.source}|${scTyp.source}`, 'g');
        let lastIdx = 0;
        let m: RegExpExecArray | null;
        while ((m = tokenRe.exec(code)) !== null) {
            const idx = m.index;
            if (idx > lastIdx) { appendText(parent, code.slice(lastIdx, idx)); }
            const tok = m[0];
            const span = document.createElement('span');
            span.className = this.structCodeTokenClass(tok);
            span.textContent = tok;
            parent.appendChild(span);
            lastIdx = idx + tok.length;
        }
        if (lastIdx < code.length) { appendText(parent, code.slice(lastIdx)); }
    };

    const lines = structToC(def, this._structs).split('\n');
    lines.forEach((line, i) => {
        this.appendStructPreviewLine(out, line, i, lines.length, appendTokenizedCode);
    });

    return out;
}

private appendStructPreviewLine(
    out: DocumentFragment,
    line: string,
    idx: number,
    lineCount: number,
    appendTokenizedCode: (parent: DocumentFragment | HTMLElement, code: string) => void,
): void {
    const parts = this.structPreviewLineParts(line);
    if (this.isPaddingPreviewLine(parts.code)) {
        this.appendPaddingPreviewLine(out, line, parts.code);
    } else {
        appendTokenizedCode(out, parts.code);
        this.appendPreviewComment(out, parts.cmt);
    }
    this.appendPreviewLineBreak(out, idx, lineCount);
}

private structPreviewLineParts(line: string): { code: string; cmt: string } {
    const ci = line.indexOf('/*');
    if (ci < 0) { return { code: line, cmt: '' }; }
    return { code: line.slice(0, ci), cmt: line.slice(ci) };
}

private isPaddingPreviewLine(code: string): boolean {
    return /\b_pad\w+/.test(code);
}

private appendPreviewLineBreak(out: DocumentFragment, idx: number, lineCount: number): void {
    if (idx < lineCount - 1) { this.appendPreviewText(out, '\n'); }
}

private appendPaddingPreviewLine(out: DocumentFragment, line: string, code: string): void {
    const n = code.match(/_pad\w+\[(\d+)\]/)?.[1] ?? '?';
    const indent = line.slice(0, line.length - line.trimStart().length);
    this.appendPreviewText(out, indent);
    this.appendPreviewComment(out, `/* ${n} byte${n === '1' ? '' : 's'} padding */`);
}

private appendPreviewComment(out: DocumentFragment, cmt: string): void {
    if (!cmt) { return; }
    const span = document.createElement('span');
    span.className = 'sc-cmt';
    span.textContent = cmt;
    out.appendChild(span);
}

private appendPreviewText(parent: DocumentFragment | HTMLElement, text: string): void {
    parent.appendChild(document.createTextNode(text));
}

private structCodeTokenClass(tok: string): string {
    if (tok === '__attribute__((packed))') { return 'sc-attr'; }
    if (tok === 'typedef' || tok === 'struct') { return 'sc-kw'; }
    return 'sc-type';
}

private renderStructCPreview(pre: HTMLElement, def: StructDef): void {
    pre.replaceChildren(this.buildStructCPreviewNodes(def));
}

private hydrateStructPreviews(root: HTMLElement): void {
    root.querySelectorAll<HTMLElement>('.si-c-preview[data-struct-preview-id]').forEach(pre => {
        const id = pre.dataset.structPreviewId;
        if (!id) { return; }
        const def = (this._editingType?.draft.id === id)
            ? this._editingType.draft
            : allStructs(this._structs).find(d => d.id === id);
        if (!def) {
            pre.textContent = '';
            return;
        }
        this.renderStructCPreview(pre, def);
    });
}

private editorHtml(draft: StructDef, existing: StructDef | null): string {
    const n = draft.fields.length;
    const fieldRows = draft.fields.map((f, i) => this.fieldRowHtml(f, i, n === 1, n, draft.id)).join('');
    const errorHtml = this._editorError ? `<div class="se-error">${esc(this._editorError)}</div>` : '';
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

private syncEditorDraft(sec: HTMLElement, draft: StructDef): void {
    draft.name   = this.sanitizeCIdent((sec.querySelector<HTMLInputElement>('#se-name'))?.value.trim() ?? '');
    draft.packed = sec.querySelector('#se-packed')?.classList.contains('active') ?? false;
    const rows = sec.querySelectorAll<HTMLElement>('.struct-field-row');
    draft.fields = Array.from(rows).map(row => {
        return this.readEditorFieldRow(row);
    });
}

private readEditorFieldRow(row: HTMLElement): StructField {
    const typeInfo = this.readEditorFieldType(row);
    const childrenContainer = row.querySelector<HTMLElement>('.sfe-bf-children');
    const result: StructField = {
        name: this.sanitizeCIdent((row.querySelector('.sfe-name-inp') as HTMLInputElement).value),
        type: typeInfo.type,
        refStructId: typeInfo.refStructId,
        isPointer: typeInfo.isPointer || undefined,
        count: this.readEditorArrayCount(row),
    };
    this.applyEditorBitFields(result, this.readEditorBitFields(row, typeInfo.isUnsigned, childrenContainer), childrenContainer);
    return result;
}

private readEditorFieldType(row: HTMLElement): { type: StructFieldType; refStructId: string | undefined; isUnsigned: boolean; isPointer: boolean } {
    const rawType = (row.querySelector('.sfe-type-sel') as HTMLSelectElement).value;
    const parsed = this.parseEditorFieldType(rawType);
    const ptrActive = row.querySelector<HTMLElement>('.sfe-ptr-btn')?.classList.contains('active') ?? false;
    return {
        ...parsed,
        isUnsigned: this.isUnsignedEditorParsedType(parsed),
        isPointer: ptrActive || parsed.type === 'void',
    };
}

private parseEditorFieldType(rawType: string): { type: StructFieldType; refStructId: string | undefined } {
    return rawType.startsWith('struct:')
        ? { type: 'struct', refStructId: rawType.slice('struct:'.length) }
        : { type: rawType as StructFieldType, refStructId: undefined };
}

private isUnsignedEditorParsedType(parsed: { type: StructFieldType; refStructId: string | undefined }): boolean {
    return parsed.type !== 'struct' && this.isUnsignedScalarType(parsed.type);
}

private readEditorBitFields(row: HTMLElement, isUnsigned: boolean, childrenContainer: HTMLElement | null): BitFieldChild[] | undefined {
    if (!this.isEditorBitFieldEnabled(row, isUnsigned, childrenContainer)) { return undefined; }
    const childRows = childrenContainer.querySelectorAll<HTMLElement>('.sfe-bf-child-row');
    const childArray = Array.from(childRows).map(childRow => this.readEditorBitFieldChild(childRow));
    return childArray.length > 0 ? childArray : [{ name: 'bit0', bitWidth: 1 }];
}

private isEditorBitFieldEnabled(row: HTMLElement, isUnsigned: boolean, childrenContainer: HTMLElement | null): childrenContainer is HTMLElement {
    if (!isUnsigned || !childrenContainer) { return false; }
    return row.querySelector('.sfe-bit-btn')?.classList.contains('sfe-bit-btn-on') ?? false;
}

private readEditorBitFieldChild(childRow: HTMLElement): BitFieldChild {
    const childName = this.sanitizeCIdent(
        (childRow.querySelector('.sfe-bf-child-name') as HTMLInputElement).value
    ) || `bit${childRow.dataset.childIdx || '0'}`;
    const childWidthRaw = (childRow.querySelector('.sfe-bf-child-width') as HTMLInputElement).value;
    const childWidth = parseInt(childWidthRaw, 10);
    return {
        name: childName,
        bitWidth: childWidth > 0 ? Math.min(childWidth, 64) : 1,
    };
}

private readEditorArrayCount(row: HTMLElement): number {
    const cell = row.querySelector<HTMLElement>('.sfe-arr-cell')!;
    if (!cell.classList.contains('is-array')) { return 1; }
    const v = parseInt((row.querySelector('.sfe-count-inp') as HTMLInputElement).value);
    return isNaN(v) || v < 1 ? 1 : Math.min(v, 256);
}

private applyEditorBitFields(result: StructField, bitFields: BitFieldChild[] | undefined, childrenContainer: HTMLElement | null): void {
    if (!bitFields || bitFields.length === 0) { return; }
    result.bitFields = bitFields;
    if (childrenContainer?.style.display === 'none') { result.bitFieldsCollapsed = true; }
}

private wireEditorInSec(sec: HTMLElement): void {
    if (!this._editingType) { return; }
    const { draft } = this._editingType;

    sec.querySelector('#se-packed')!.addEventListener('click', () => {
        const btn = sec.querySelector('#se-packed')!;
        const nowPacked = !btn.classList.contains('active');
        btn.classList.toggle('active', nowPacked);
        draft.packed = nowPacked;
        refreshEditorPreview(sec, draft);
    });

    const refreshEditorPreview = (s: HTMLElement, d: StructDef): void => {
        this.syncEditorDraft(s, d);
        const pre = s.querySelector<HTMLElement>('#se-preview pre');
        if (pre) { this.renderStructCPreview(pre, d); }
    };

    const syncedFieldForButton = (btn: HTMLElement): { row: HTMLElement; idx: number; field: StructField | undefined } => {
        const row = btn.closest<HTMLElement>('.struct-field-row')!;
        this.syncEditorDraft(sec, draft);
        const idx = parseInt(row.dataset.idx!);
        return { row, idx, field: draft.fields[idx] };
    };

    type StructFieldWithBits = StructField & { bitFields: NonNullable<StructField['bitFields']> };
    const syncedBitFieldChild = (btn: HTMLElement): { childRow: HTMLElement; field: StructFieldWithBits; childIdx: number } | null => {
        const childRow = btn.closest<HTMLElement>('.sfe-bf-child-row')!;
        const parentRow = childRow.closest<HTMLElement>('.struct-field-row')!;
        this.syncEditorDraft(sec, draft);
        const idx = parseInt(parentRow.dataset.idx!);
        const field = draft.fields[idx];
        if (!field?.bitFields) { return null; }
        return { childRow, field: field as StructFieldWithBits, childIdx: parseInt(childRow.dataset.childIdx!) };
    };

    sec.querySelector('#se-add')!.addEventListener('click', () => {
        this.syncEditorDraft(sec, draft);
        this._editorError = null;
        draft.fields.push({ name: `field${draft.fields.length}`, type: 'uint8', count: 1 });
        this.render();
    });

    sec.querySelectorAll<HTMLElement>('.sfe-del-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            this.syncEditorDraft(sec, draft);
            this._editorError = null;
            const row = btn.closest<HTMLElement>('.struct-field-row')!;
            draft.fields.splice(parseInt(row.dataset.idx!), 1);
            this.render();
        });
    });

    sec.querySelectorAll<HTMLElement>('.sfe-move-up').forEach(btn => {
        btn.addEventListener('click', () => {
            const { idx } = syncedFieldForButton(btn);
            this._editorError = null;
            if (idx > 0) {
                [draft.fields[idx - 1], draft.fields[idx]] = [draft.fields[idx], draft.fields[idx - 1]];
                this.render();
            }
        });
    });

    sec.querySelectorAll<HTMLElement>('.sfe-move-dn').forEach(btn => {
        btn.addEventListener('click', () => {
            const { idx } = syncedFieldForButton(btn);
            this._editorError = null;
            if (idx < draft.fields.length - 1) {
                [draft.fields[idx], draft.fields[idx + 1]] = [draft.fields[idx + 1], draft.fields[idx]];
                this.render();
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
            this.handlePointerToggleClick(sec, draft, btn);
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
            this.renderBitFieldTogglePreview(sec, draft);
            this.render();  // Re-render to show/hide child rows
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
            this.render();
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
            this.render();
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
                this.render();
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
                this.render();
            }
        });
    });

    sec.querySelectorAll<HTMLInputElement>('.sfe-name-inp').forEach(inp => {
        inp.addEventListener('input', () => { refreshEditorPreview(sec, draft); });
        inp.addEventListener('blur', () => {
            const clean = this.sanitizeCIdent(inp.value);
            if (clean !== inp.value) { inp.value = clean || 'field'; }
            refreshEditorPreview(sec, draft);
        });
    });

    sec.querySelectorAll<HTMLSelectElement>('.sfe-type-sel').forEach(sel => {
        sel.addEventListener('change', () => {
            this.handleFieldTypeChange(sec, draft, sel);
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
        const clean = this.sanitizeCIdent(inp.value);
        if (clean !== inp.value) { inp.value = clean; }
        refreshEditorPreview(sec, draft);
    });

    sec.querySelector('#se-save')!.addEventListener('click', () => {
        this.saveEditorDraft(sec, draft);
    });

    sec.querySelector('#se-cancel')!.addEventListener('click', () => {
        this._editorError = null;
        const { fromAdd } = this._editingType!;
        this._editingType = null;
        if (fromAdd) {
            this._addingPin = true;
            this._managingTypes = false;
        }
        this.render();
    });
}

private saveEditorDraft(sec: HTMLElement, draft: StructDef): void {
    this.syncEditorDraft(sec, draft);
    if (draft.fields.length === 0) { return; }

    const def = this.editorDraftToStructDef(sec, draft);
    const validationErrors = validateStructs(this.upsertStructList(this._structs, def), MAX_NESTED_DEPTH);
    if (validationErrors.length > 0) {
        this._editorError = validationErrors[0];
        this.render();
        return;
    }

    this._editorError = null;
    this._structs = this.upsertStructList(this._structs, def);
    this.cb.onStructsChange?.(this._structs);
    this.closeEditorAfterSave(def.id);
    this.render();
}

private editorDraftToStructDef(sec: HTMLElement, draft: StructDef): StructDef {
    return {
        id: draft.id,
        name: this.readEditorStructName(sec, draft.id),
        packed: draft.packed ?? false,
        fields: draft.fields.map((field, idx) => this.withSavedFieldName(field, idx, draft.fields)),
    };
}

private readEditorStructName(sec: HTMLElement, draftId: string): string {
    const nameInp = sec.querySelector<HTMLInputElement>('#se-name')!;
    const name = this.sanitizeCIdent(nameInp.value.trim());
    return name || this.nextStructName(draftId);
}

private nextStructName(draftId: string): string {
    const otherNames = new Set(this._structs.filter(d => d.id !== draftId).map(d => d.name));
    let candidate = 'MyStruct';
    let n = 1;
    while (otherNames.has(candidate)) { candidate = `MyStruct${n++}`; }
    return candidate;
}

private withSavedFieldName(field: StructField, idx: number, fields: StructField[]): StructField {
    if (field.name) { return { ...field }; }
    const takenNames = new Set(fields.map(f => f.name).filter(Boolean));
    let candidate = `field${idx}`;
    let n = 0;
    while (takenNames.has(candidate)) { candidate = `field${idx}_${n++}`; }
    return { ...field, name: candidate };
}

private upsertStructList(structs: StructDef[], def: StructDef): StructDef[] {
    const idx = structs.findIndex(d => d.id === def.id);
    if (idx < 0) { return [...structs, def]; }
    const clone = [...structs];
    clone[idx] = def;
    return clone;
}

private closeEditorAfterSave(defId: string): void {
    const { fromAdd } = this._editingType!;
    this._editingType = null;
    if (!fromAdd) { return; }
    this._applyStructId = defId;
    this._addingPin = true;
    this._managingTypes = false;
}

private handleFieldTypeChange(sec: HTMLElement, draft: StructDef, sel: HTMLSelectElement): void {
    const row = sel.closest<HTMLElement>('.struct-field-row');
    if (!row) { return; }
    const bitBtn = row.querySelector<HTMLElement>('.sfe-bit-btn');
    const ptrBtn = row.querySelector<HTMLElement>('.sfe-ptr-btn');
    const isPointer = this.fieldTypeSelectionIsPointer(sel, ptrBtn);
    const isUnsigned = this.isUnsignedEditorType(sel.value) && !isPointer;
    this.setBitButtonEnabled(bitBtn, isUnsigned);
    this.clearInvalidBitChildren(sec, draft, row, bitBtn, isUnsigned);
}

private handlePointerToggleClick(sec: HTMLElement, draft: StructDef, btn: HTMLElement): void {
    const { row, field } = this.syncEditorFieldForButton(sec, draft, btn);
    if (!this.canTogglePointerField(field, btn)) { return; }
    this._editorError = null;
    const active = !btn.classList.contains('active');
    btn.classList.toggle('active', active);
    field.isPointer = active || field.type === 'void' ? true : undefined;
    this.clearPointerBitChildren(sec, draft, row, active);
    this.render();
}

private canTogglePointerField(field: StructField | undefined, btn: HTMLElement): field is StructField {
    return Boolean(field) && !btn.hasAttribute('disabled');
}

private syncEditorFieldForButton(sec: HTMLElement, draft: StructDef, btn: HTMLElement): { row: HTMLElement; field: StructField | undefined } {
    const row = btn.closest<HTMLElement>('.struct-field-row')!;
    this.syncEditorDraft(sec, draft);
    return { row, field: draft.fields[parseInt(row.dataset.idx!)] };
}

private clearPointerBitChildren(sec: HTMLElement, draft: StructDef, row: HTMLElement, active: boolean): void {
    if (!active) { return; }
    this.clearBitFieldChildren(sec, draft, row, row.querySelector<HTMLElement>('.sfe-bit-btn'));
}

private fieldTypeSelectionIsPointer(sel: HTMLSelectElement, ptrBtn: HTMLElement | null): boolean {
    if (sel.value === 'void') { ptrBtn?.classList.add('active'); }
    return ptrBtn?.classList.contains('active') || sel.value === 'void';
}

private setBitButtonEnabled(bitBtn: HTMLElement | null, isUnsigned: boolean): void {
    if (bitBtn) { (bitBtn as HTMLButtonElement).disabled = !isUnsigned; }
}

private clearInvalidBitChildren(sec: HTMLElement, draft: StructDef, row: HTMLElement, bitBtn: HTMLElement | null, isUnsigned: boolean): void {
    if (this.shouldClearBitChildren(bitBtn, isUnsigned)) { this.clearBitFieldChildren(sec, draft, row, bitBtn); }
}

private isUnsignedEditorType(rawType: string): boolean {
    return !rawType.startsWith('struct:') && this.isUnsignedScalarType(rawType as import('../../../../core/types').StructFieldType);
}

private shouldClearBitChildren(bitBtn: HTMLElement | null, isUnsigned: boolean): boolean {
    return !isUnsigned && Boolean(bitBtn?.classList.contains('sfe-bit-btn-on'));
}

private clearBitFieldChildren(sec: HTMLElement, draft: StructDef, row: HTMLElement, bitBtn: HTMLElement | null): void {
    bitBtn?.classList.remove('sfe-bit-btn-on');
    row.classList.remove('has-bit-children');
    row.querySelector<HTMLElement>('.sfe-bf-children')?.remove();
    this.syncEditorDraft(sec, draft);
    this.clearDraftBitFields(draft, row);
}

private clearDraftBitFields(draft: StructDef, row: HTMLElement): void {
    const idx = parseInt(row.dataset.idx!);
    const field = draft.fields[idx];
    if (field) {
        delete field.bitFields;
        delete field.bitFieldsCollapsed;
    }
}

private prepareStructPanelState(all: StructDef[]): void {
    this._applyStructId = this.nextApplyStructId(all);
    this._managingTypes = this._editingType ? true : this._managingTypes;
}

private nextApplyStructId(all: StructDef[]): string | null {
    const fallbackId = all.length > 0 ? all[0].id : null;
    if (!this._applyStructId) { return fallbackId; }
    return all.some(d => d.id === this._applyStructId) ? this._applyStructId : fallbackId;
}

private structPinsPanelHtml(all: StructDef[]): string {
    const typeRows = this.typeRowsHtml(all);
    const addFormHtml = this._addingPin ? this.addStructPinFormHtml(all) : '';
    const instHtml = this.instanceCardsHtml();
    const instBadge = this._pins.length > 0 ? `<span class="sb-badge">${this._pins.length}</span>` : '';

    return (
        `<div class="si-panel-clip">` +
        `<div class="si-panel-track${this._managingTypes ? ' si-showing-types' : ''}" id="si-track">` +
        this.structInstancesPanelHtml(instBadge, addFormHtml, instHtml) +
        this.structTypesPanelHtml(typeRows) +
        `</div>` +
        `</div>`
    );
}

private typeRowsHtml(all: StructDef[]): string {
    if (all.length === 0) { return `<div class="sb-empty">No types defined yet.</div>`; }
    return all.map(def => this.structTypeRowHtml(def)).join('');
}

private structTypeRowHtml(def: StructDef): string {
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

private addStructPinFormHtml(all: StructDef[]): string {
    const addrVal = this._activeStructAddr !== null
        ? this._activeStructAddr.toString(16).toUpperCase().padStart(8, '0')
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
        this.addStructPinTypeRowHtml(all) +
        `<div class="sa-row sa-btn-row">` +
        `<button id="sa-confirm" class="struct-btn struct-btn-apply"${!this._applyStructId ? ' disabled' : ''}>Confirm</button>` +
        `<button id="sa-cancel" class="struct-btn struct-btn-cancel">Cancel</button>` +
        `</div>` +
        `</div>`
    );
}

private addStructPinTypeRowHtml(all: StructDef[]): string {
    if (all.length === 0) {
        return (
            `<div class="sa-row sa-no-types-row">` +
            `<span class="sa-no-types-msg">No struct types yet — create one first.</span>` +
            `<button id="sa-new-type-btn" class="struct-btn struct-btn-secondary">New type</button>` +
            `</div>`
        );
    }

    const structOpts = all.map(d =>
        `<option value="${esc(d.id)}"${d.id === this._applyStructId ? ' selected' : ''}>${esc(d.name)}</option>`
    ).join('');
    const applyDef = all.find(d => d.id === this._applyStructId);
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

private instanceCardsHtml(): string {
    return this._pins.length === 0
        ? `<div class="sb-empty">No instances yet. Click [\uff0b Add] to create one.</div>`
        : this._pins.map((pin, i) => this.buildInstanceCard(pin, i)).join('');
}

private structInstancesPanelHtml(instBadge: string, addFormHtml: string, instHtml: string): string {
    return (
        `<div class="si-main-panel">` +
        `<div class="si-hdr-row">` +
        `<span class="sb-hdr">Struct Instances ${instBadge}</span>` +
        this.bitLayoutToggleHtml() +
        `<button id="si-add-btn" class="si-add-btn"${this._addingPin ? ' disabled' : ''}>\uff0b Add</button>` +
        `<button id="si-types-btn" class="si-icon-btn" title="Manage types">&#9776;</button>` +
        `</div>` +
        addFormHtml +
        `<div id="si-list">${instHtml}</div>` +
        `</div>`
    );
}

private bitLayoutToggleHtml(): string {
    return (
        `<div class="si-toggle-group" title="Bit-field allocation: which side receives the first declared bit field">` +
        `<div class="compact-tabs sa-bit-order-tabs">` +
        `<button id="sa-btn-bit-lsb" class="${this._bitFieldAllocation === 'lsb' ? 'active' : ''}" title="Bit-field allocation: first declared bit field starts at the least significant bit">LSB</button>` +
        `<button id="sa-btn-bit-msb" class="${this._bitFieldAllocation === 'msb' ? 'active' : ''}" title="Bit-field allocation: first declared bit field starts at the most significant bit">MSB</button>` +
        `</div>` +
        `</div>`
    );
}

private structTypesPanelHtml(typeRows: string): string {
    return (
        `<div class="si-types-panel">` +
        `<div class="si-hdr-row">` +
        `<button id="sm-close-btn" class="si-icon-btn" title="${this.typePanelCloseTitle()}">&#8592;</button>` +
        `<span class="sb-hdr">${this.typePanelTitle()}</span>` +
        this.typePanelNewButtonHtml() +
        `</div>` +
        this.typePanelBodyHtml(typeRows) +
        `</div>`
    );
}

private typePanelCloseTitle(): string {
    return this._editingType ? 'Cancel' : 'Back';
}

private typePanelTitle(): string {
    if (!this._editingType) { return 'Struct Types'; }
    return this._editingType.existing ? 'Edit Type' : 'New Type';
}

private typePanelNewButtonHtml(): string {
    return this._editingType ? '' : `<button id="sm-new-btn" class="struct-btn struct-btn-secondary">New type</button>`;
}

private typePanelBodyHtml(typeRows: string): string {
    if (!this._editingType) { return `<div id="sm-list">${typeRows}</div>`; }
    return this.editorHtml(this._editingType.draft, this._editingType.existing);
}

private wireStructPinsPanel(sec: HTMLElement): void {
    this.wireTypesPanelControls(sec);
    this.wireAddStructPinControls(sec);
    this.wireBitLayoutTabs(sec);
}

private wireTypesPanelControls(sec: HTMLElement): void {
    sec.querySelector('#si-types-btn')?.addEventListener('click', () => {
        this._managingTypes = true;
        sec.querySelector('#si-track')?.classList.add('si-showing-types');
    });

    sec.querySelector('#sm-close-btn')?.addEventListener('click', () => {
        if (this._editingType) {
            const { fromAdd } = this._editingType;
            this._editingType = null;
            if (fromAdd) {
                this._addingPin = true;
                this._managingTypes = false;
            }
            // fromManage: stay on types panel (re-render shows type list)
            this.render();
        } else {
            this._managingTypes = false;
            sec.querySelector('#si-track')?.classList.remove('si-showing-types');
        }
    });

    sec.querySelector('#sm-new-btn')?.addEventListener('click', () => {
        this._editorError = null;
        const draftId = `user_${Date.now()}`;
        this._editingType = {
            draft: { id: draftId, name: '', packed: false, fields: [{ name: 'field0', type: 'uint32', count: 1 }] },
            existing: null,
            fromAdd: false,
            fromManage: true,
        };
        this.render();
    });

    const typesPanel = sec.querySelector<HTMLElement>('.si-types-panel')!;
    wireActionBtns(
        typesPanel,
        '.act-btn-edit',
        '.act-btn-del',
        btn => {
            this._editorError = null;
            const existing = this._structs.find(d => d.id === btn.dataset.structId) ?? null;
            if (!existing) { return; }
            this._editingType = {
                draft: { id: existing.id, name: existing.name, packed: existing.packed ?? false, fields: existing.fields.map(f => ({ ...f })) },
                existing,
                fromAdd: false,
                fromManage: true,
            };
            this.render();
        },
        btn => {
            const id = btn.dataset.structId!;
            const next = withoutStructDefinition(this._structs, this._pins, id);
            this._structs = next.structs;
            this._pins = next.pins;
            if (this._applyStructId === id) { this._applyStructId = null; }
            this.cb.onStateChange?.(this._structs, this._pins);
            this.render();
        },
    );
}

private wireAddStructPinControls(sec: HTMLElement): void {
    sec.querySelector('#si-add-btn')?.addEventListener('click', () => {
        this._addingPin = true;
        this.render();
        sec.querySelector<HTMLInputElement>('#sa-name')?.focus();
    });

    if (!this._addingPin) { return; }

    sec.querySelector('#sa-struct-sel')?.addEventListener('change', e => {
        this._applyStructId = (e.target as HTMLSelectElement).value || null;
        this.preservePendingStructAddress();
        this.render();
    });
    sec.querySelector('#sa-new-type-btn')?.addEventListener('click', () => {
        this._editorError = null;
        this._addingPin = false;
        const draftId = `user_${Date.now()}`;
        this._editingType = {
            draft: { id: draftId, name: '', packed: false, fields: [{ name: 'field0', type: 'uint32', count: 1 }] },
            existing: null,
            fromAdd: true,
            fromManage: false,
        };
        this.render();
    });
    sec.querySelector('#sa-addr')?.addEventListener('input', () => {
        const addrInp = sec.querySelector<HTMLInputElement>('#sa-addr');
        const confirmBtn = sec.querySelector<HTMLButtonElement>('#sa-confirm');
        if (!addrInp || !confirmBtn) { return; }
        const hasAddr = addrInp.value.trim().length > 0;
        confirmBtn.disabled = !this._applyStructId || !hasAddr;
    });
    sec.querySelector('#sa-confirm')?.addEventListener('click', () => {
        this.confirmAddStructPin();
    });
    sec.querySelector('#sa-cancel')?.addEventListener('click', () => {
        this._addingPin = false;
        this.render();
    });
}

private wireBitLayoutTabs(sec: HTMLElement): void {
    sec.querySelector('#sa-btn-bit-lsb')?.addEventListener('click', () => {
        this._bitFieldAllocation = 'lsb';
        sec.querySelector('#sa-btn-bit-lsb')?.classList.add('active');
        sec.querySelector('#sa-btn-bit-msb')?.classList.remove('active');
        if (this._expanded.size > 0) { this.render(); }
    });
    sec.querySelector('#sa-btn-bit-msb')?.addEventListener('click', () => {
        this._bitFieldAllocation = 'msb';
        sec.querySelector('#sa-btn-bit-msb')?.classList.add('active');
        sec.querySelector('#sa-btn-bit-lsb')?.classList.remove('active');
        if (this._expanded.size > 0) { this.render(); }
    });
}

private confirmAddStructPin(): void {
    const addrInp = this._root?.querySelector<HTMLInputElement>('#sa-addr');
    const nameInp = this._root?.querySelector<HTMLInputElement>('#sa-name');
    if (!this.canAddPin(addrInp, nameInp)) { return; }
    const addr = this.parseStructApplyAddress(addrInp!);
    if (addr === null) { return; }
    const name = this.structApplyName(nameInp!);
    const pin = makeStructPin({ structId: this._applyStructId!, addr, name }, this.makePinId);
    this._pins       = [...this._pins, pin];
    this._activeStructAddr = addr;
    this._expanded.add(pin.id);
    this._addingPin = false;
    this.cb.onPinsChange?.(this._pins);
    this.render();
}

private canAddPin(addrInp: HTMLInputElement | null | undefined, nameInp: HTMLInputElement | null | undefined): boolean {
    return !!this._applyStructId && !!addrInp && !!nameInp;
}

private parseStructApplyAddress(addrInp: HTMLInputElement): number | null {
    const addr = parseInt(addrInp.value.replace(/^0x/i, ''), 16);
    if (!isNaN(addr)) {
        addrInp.style.borderColor = '';
        return addr;
    }
    addrInp.style.borderColor = 'var(--err)';
    return null;
}

private structApplyName(nameInp: HTMLInputElement): string {
    const name = nameInp.value.trim();
    return name || this.nextStructApplyName();
}

private nextStructApplyName(): string {
    const applyDef = this._structs.find(d => d.id === this._applyStructId);
    const base = applyDef ? applyDef.name : 'inst';
    return this.uniqueStructPinName(`${base}_0`, n => `${base}_${n}`);
}

private uniqueStructPinName(initialName: string, nextName: (n: number) => string): string {
    return uniquePinName(this._pins, initialName, nextName);
}

private makePinId(): string {
    return `pin_${Date.now()}`;
}

/** Get a display string for a field given the requested column display type. */
private getValForType(r: DecodedField, valType: ColType): string {
    if (!r.hasData) { return '??'; }
    if (this.isBitFieldRow(r)) { return this.renderBitFieldValue(r, valType); }

    const bytes = this.fieldBytes(r);
    const endian = this._endian;
    const dv = this.dataViewForBytes(bytes);
    return this.renderScalarValue(r, valType, bytes, dv, endian);
}

private fieldBytes(r: DecodedField): number[] {
    return r.bytesHex.split(' ').map(h => parseInt(h, 16));
}

private dataViewForBytes(bytes: number[]): DataView {
    const buf = new ArrayBuffer(bytes.length);
    const dv = new DataView(buf);
    bytes.forEach((b, i) => dv.setUint8(i, b));
    return dv;
}

private isBinaryDisplay(valType: ColType): boolean {
    return valType === 'bin' || valType === 'bin-sliced';
}

private renderBitFieldTogglePreview(sec: HTMLElement, draft: StructDef): void {
    const pre = sec.querySelector<HTMLElement>('#se-preview pre');
    if (pre) { this.renderStructCPreview(pre, draft); }
}

private bitFieldDisplaySource(r: DecodedField): { width: number; value: bigint } {
    return {
        width: r.bitWidth ?? 1,
        value: BigInt(r.bitValueUnsigned ?? '0'),
    };
}

private renderBitFieldValue(r: DecodedField, valType: ColType): string {
    const { width, value: v } = this.bitFieldDisplaySource(r);
    if (valType === 'hex') {
        return formatHexHtml(formatHex(v, Math.max(1, Math.ceil(width / 4))));
    }
    if (this.isBinaryDisplay(valType)) {
        const groups = this.binaryGroupsLowBitsFirst(v.toString(2).padStart(width, '0'));
        const html = groups.map(g => [...g].map(bit =>
            `<span class="si-bit ${bit === '1' ? 'one' : 'zero'}">${bit}</span>`
        ).join('')).join(' ');
        return `<span class="si-bin-wrap">${html}</span>`;
    }
    return v.toString(10);
}

private copyBitFieldValue(r: DecodedField, valType: ColType): string {
    const { width, value: v } = this.bitFieldDisplaySource(r);
    if (valType === 'hex') {
        return `0x${v.toString(16).toUpperCase().padStart(Math.max(1, Math.ceil(width / 4)), '0')}`;
    }
    if (this.isBinaryDisplay(valType)) {
        return this.binaryGroupsLowBitsFirst(v.toString(2).padStart(width, '0')).join(' ');
    }
    return v.toString(10);
}

private renderScalarValue(
    r: DecodedField,
    valType: ColType,
    bytes: number[],
    dv: DataView,
    endian: 'le' | 'be',
): string {
    const le = endian === 'le';
    const special = this.renderSpecialScalarValue(r, valType, bytes, dv, endian, le);
    if (special !== null) { return special; }
    return this.renderNumericValue(r, valType, dv, le);
}

private renderSpecialScalarValue(
    r: DecodedField,
    valType: ColType,
    bytes: number[],
    dv: DataView,
    endian: 'le' | 'be',
    le: boolean,
): string | null {
    const byType = this.renderSpecialScalarByType(r, valType, bytes, dv, le);
    if (byType !== null) { return byType; }
    return this.renderSpecialScalarByValueType(r, valType, bytes, endian);
}

private renderSpecialScalarByType(
    r: DecodedField,
    valType: ColType,
    bytes: number[],
    dv: DataView,
    le: boolean,
): string | null {
    if (r.isPointer) { return this.renderPointerValue(r, dv, le); }
    if (r.type === 'ascii') { return this.renderAsciiValue(r, valType, bytes); }
    return null;
}

private renderSpecialScalarByValueType(
    r: DecodedField,
    valType: ColType,
    bytes: number[],
    endian: 'le' | 'be',
): string | null {
    if (this.isBinaryDisplay(valType)) { return this.renderPlainBinaryBits(this.binaryBitsForValue(bytes, endian)); }
    if (valType === 'ieee') { return this.renderIeeeValue(r, bytes, endian); }
    if (valType === 'ascii') { return `'${this.asciiFromBytes(bytes)}'`; }
    return null;
}

private renderPointerValue(r: DecodedField, dv: DataView, le: boolean): string {
    const v = r.pointerValue ?? (dv.getUint32(0, le) >>> 0);
    const note = v !== 0 && this.cb.readByte(v) === undefined ? ` <span class="si-f-ptr-note">(unmapped)</span>` : '';
    return `<span class="si-f-ptr-sym">\u2192</span>\u2009` + formatHexHtml(formatHex(v, 8)) + note;
}

private renderAsciiValue(r: DecodedField, valType: ColType, bytes: number[]): string {
    if (valType === 'hex') {
        const hex = bytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join('');
        return formatHexHtml(`0x${hex}`);
    }
    if (this.isBinaryDisplay(valType)) {
        return this.renderPlainBinaryBits(bytes.map(b => b.toString(2).padStart(8, '0')).join(''));
    }
    const s = r.decoded === '??' ? '' : r.decoded;
    return `'${s}'`;
}

private renderIeeeValue(r: DecodedField, bytes: number[], endian: 'le' | 'be'): string {
    const parts = this.getFloatPartsForField(r, bytes, endian);
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



private readonly RENDER_NUMERIC_VALUE: Partial<Record<DecodedField['type'], NumericValueFormatter>> = {
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
            : this.formatFloat(v, 6);
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
            : this.formatFloat(v, 16);
    },
};

private renderNumericValue(r: DecodedField, valType: ColType, dv: DataView, le: boolean): string {
    return this.RENDER_NUMERIC_VALUE[r.type]?.(valType, dv, le) ?? r.decoded;
}

private formatFloat(v: number, digits: number): string {
    return isNaN(v) ? 'NaN' : !isFinite(v) ? String(v) : v.toExponential(digits);
}

private asciiFromBytes(bytes: number[]): string {
    return bytes.map(b => b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.').join('');
}

/** Parse IEEE754 parts from raw bytes for float32/float64. Returns null on missing/invalid bytes. */
private getFloatParts(bytes: number[], type: 'float32' | 'float64', endian: 'le' | 'be') {
    const size = this.FLOAT_BYTE_SIZE[type];
    if (!this.hasFloatBytes(bytes, size)) { return null; }
    const dv = this.floatDataView(bytes, size);
    const le = endian === 'le';
    return this.FLOAT_PART_READERS[type](dv, le);
}

private readonly FLOAT_BYTE_SIZE: Record<'float32' | 'float64', number> = { float32: 4, float64: 8 };
private readonly FLOAT_PART_READERS = { float32: (dv: DataView, le: boolean) => this.getFloat32Parts(dv, le), float64: (dv: DataView, le: boolean) => this.getFloat64Parts(dv, le) };

private hasFloatBytes(bytes: number[], size: number): boolean {
    return bytes.length >= size && bytes.every(b => this.isPresentByte(b));
}

private isPresentByte(byte: number): boolean {
    return byte >= 0;
}

private floatDataView(bytes: number[], size: number): DataView {
    const buf = new ArrayBuffer(size);
    const dv = new DataView(buf);
    bytes.forEach((b, i) => dv.setUint8(i, b));
    return dv;
}

private getFloat32Parts(dv: DataView, le: boolean) {
    const raw = dv.getUint32(0, le) >>> 0;
    const sign = (raw >>> 31) & 1;
    const exp = (raw >>> 23) & 0xFF;
    const mant = raw & 0x7FFFFF;
    const exponentBits = exp.toString(2).padStart(8, '0');
    const mantissaBits = mant.toString(2).padStart(23, '0');
    const exponentHex = `0x${exp.toString(16).toUpperCase().padStart(2, '0')}`;
    const mantissaHex = `0x${mant.toString(16).toUpperCase().padStart(6, '0')}`;
    const rawHex = `0x${raw.toString(16).toUpperCase().padStart(8, '0')}`;
    const className = this.float32ClassName(exp, mant);
    const binStr = `${sign} | ${exponentBits} | ${mantissaBits}`;
    return { sign, exp, mant, exponentBits, mantissaBits, exponentHex, mantissaHex, rawHex, className, binStr };
}

private float32ClassName(exp: number, mant: number): string {
    return this.floatClassName(exp, mant === 0, 0xFF);
}

private getFloat64Parts(dv: DataView, le: boolean) {
    const raw = dv.getBigUint64(0, le);
    const sign = Number((raw >> 63n) & 1n);
    const exp = Number((raw >> 52n) & 0x7FFn);
    const mant = raw & ((1n << 52n) - 1n);
    const exponentBits = exp.toString(2).padStart(11, '0');
    const mantissaBits = mant.toString(2).padStart(52, '0');
    const exponentHex = `0x${exp.toString(16).toUpperCase().padStart(3, '0')}`;
    const mantissaHex = `0x${mant.toString(16).toUpperCase().padStart(13, '0')}`;
    const rawHex = `0x${raw.toString(16).toUpperCase().padStart(16, '0')}`;
    const className = this.float64ClassName(exp, mant);
    const binStr = `${sign} | ${exponentBits} | ${mantissaBits}`;
    return { sign, exp, mant, exponentBits, mantissaBits, exponentHex, mantissaHex, rawHex, className, binStr };
}

private float64ClassName(exp: number, mant: bigint): string {
    return this.floatClassName(exp, mant === 0n, 0x7FF);
}

private floatClassName(exp: number, isZeroMant: boolean, infinityExp: number): string {
    return ({
        0: isZeroMant ? 'zero' : 'subnormal',
        [infinityExp]: isZeroMant ? 'infinity' : 'NaN',
    })[exp] ?? 'normal';
}

/** Get a plain-text representation suitable for copying. */
private getCopyText(r: DecodedField, valType: ColType): string {
    if (!r.hasData) { return '??'; }
    return this.copySpecialRowText(r, valType) ?? this.copyNonAsciiFieldValue(r, valType);
}

private copySpecialRowText(r: DecodedField, valType: ColType): string | null {
    const copier = this.SPECIAL_ROW_COPIERS.find(entry => entry.matches(r));
    return copier ? copier.copy(r, valType) : null;
}

private readonly SPECIAL_ROW_COPIERS: Array<{
    matches: (row: DecodedField) => boolean;
    copy: (row: DecodedField, valType: ColType) => string;
}> = [
    { matches: row => this.isBitFieldRow(row), copy: (row, valType) => this.copyBitFieldValue(row, valType) },
    { matches: row => row.isPointer === true, copy: row => this.copyPointerRowText(row) },
    { matches: row => row.type === 'ascii', copy: row => row.decoded },
];

private copyPointerRowText(r: DecodedField): string {
    return r.pointerValue === undefined ? '??' : formatHex(r.pointerValue, 8);
}

private copyNonAsciiFieldValue(r: DecodedField, valType: ColType): string {
    const bytes = this.fieldBytes(r);
    const endian = this._endian;
    const le = endian === 'le';
    const special = this.copySpecialFieldValue(r, valType, bytes, endian, le);
    if (special !== null) { return special; }
    return this.copyNumericValue(r, valType, this.dataViewForBytes(bytes), le);
}

private copySpecialFieldValue(
    r: DecodedField,
    valType: ColType,
    bytes: number[],
    endian: 'le' | 'be',
    le: boolean,
): string | null {
    const byType = this.copySpecialFieldByType(r, valType, bytes, le);
    if (byType !== null) { return byType; }
    return this.copySpecialFieldByValueType(r, valType, bytes, endian);
}

private copySpecialFieldByType(r: DecodedField, valType: ColType, bytes: number[], le: boolean): string | null {
    if (r.isPointer) { return this.copyPointerValue(bytes, le); }
    if (this.hasSlicedBitCopyValue(r, valType)) { return this.copySlicedBitValue(r); }
    return null;
}

private copySpecialFieldByValueType(
    r: DecodedField,
    valType: ColType,
    bytes: number[],
    endian: 'le' | 'be',
): string | null {
    if (this.isBinaryDisplay(valType)) { return this.formatPlainBinaryBits(this.binaryBitsForValue(bytes, endian)); }
    if (valType === 'ieee') { return this.copyIeeeValue(r, bytes, endian); }
    if (valType === 'ascii') { return this.asciiFromBytes(bytes); }
    return null;
}

private copyPointerValue(bytes: number[], le: boolean): string {
    const v = this.dataViewForBytes(bytes).getUint32(0, le) >>> 0;
    return this.hexPad(v, 8);
}

private hasSlicedBitCopyValue(r: DecodedField, valType: ColType): boolean {
    return valType === 'bin-sliced' && typeof r.bitWidth === 'number' && r.bitValueUnsigned !== undefined;
}

private copySlicedBitValue(r: DecodedField): string {
    return this.formatPlainBinaryBits(BigInt(r.bitValueUnsigned!).toString(2).padStart(r.bitWidth!, '0'));
}

private hexPad(v: number, pad: number): string {
    return `0x${(v >>> 0).toString(16).toUpperCase().padStart(pad, '0')}`;
}

private hexPadBig(v: bigint, pad: number): string {
    return `0x${v.toString(16).toUpperCase().padStart(pad, '0')}`;
}

private copyIeeeValue(r: DecodedField, bytes: number[], endian: 'le' | 'be'): string {
    const parts = this.getFloatPartsForField(r, bytes, endian);
    if (!parts) { return '??'; }
    return `sign: ${parts.sign}; exponent: ${parts.exponentHex}; mantissa: ${parts.mantissaHex}; class: ${parts.className}`;
}

private getFloatPartsForField(r: DecodedField, bytes: number[], endian: 'le' | 'be'): ReturnType<typeof this.getFloatParts> {
    if (r.type !== 'float32' && r.type !== 'float64') { return null; }
    return this.getFloatParts(bytes, r.type, endian);
}

private readonly IMPLICIT_DISPLAY_BY_TYPE: Partial<Record<DecodedField['type'], ColType>> = {
    float32: 'dec',
    float64: 'dec',
    ascii: 'ascii',
};

private fieldImplicitDisplayType(field: DecodedField | null | undefined): ColType {
    return field ? this.definedFieldImplicitDisplayType(field) : this._defaultValType;
}

private definedFieldImplicitDisplayType(field: DecodedField): ColType {
    if (this.isBitFieldRow(field)) { return 'bin'; }
    return field.isPointer ? 'hex' : (this.IMPLICIT_DISPLAY_BY_TYPE[field.type] ?? this._defaultValType);
}

private implicitDisplayType(field: DecodedField | null | undefined, forceBinary = false): ColType {
    return forceBinary ? 'bin' : this.fieldImplicitDisplayType(field);
}

private readonly COPY_NUMERIC_VALUE: Partial<Record<DecodedField['type'], NumericValueFormatter>> = {
    uint8:  (valType, dv)     => { const v = dv.getUint8(0);            return valType === 'hex' ? this.hexPad(v, 2) : String(v); },
    int8:   (valType, dv)     => { const v = dv.getInt8(0);             return valType === 'hex' ? this.hexPad(dv.getUint8(0), 2) : String(v); },
    uint16: (valType, dv, le) => { const v = dv.getUint16(0, le);       return valType === 'hex' ? this.hexPad(v, 4) : String(v); },
    int16:  (valType, dv, le) => { const v = dv.getInt16(0, le);        return valType === 'hex' ? this.hexPad(dv.getUint16(0, le), 4) : String(v); },
    uint32: (valType, dv, le) => { const v = dv.getUint32(0, le) >>> 0; return valType === 'hex' ? this.hexPad(v, 8) : String(v); },
    int32:  (valType, dv, le) => { const v = dv.getInt32(0, le);        return valType === 'hex' ? this.hexPad(dv.getUint32(0, le), 8) : String(v); },
    float32: (valType, dv, le) => {
        const v = dv.getFloat32(0, le);
        return valType === 'hex'
            ? this.hexPad(dv.getUint32(0, le) >>> 0, 8)
            : this.formatFloat(v, 6);
    },
    uint64: (valType, dv, le) => {
        const v = dv.getBigUint64(0, le);
        return valType === 'hex' ? this.hexPadBig(v, 16) : v.toString(10);
    },
    int64: (valType, dv, le) => {
        const v = dv.getBigInt64(0, le);
        return valType === 'hex' ? this.hexPadBig(BigInt.asUintN(64, v as bigint), 16) : v.toString(10);
    },
    float64: (valType, dv, le) => {
        const v = dv.getFloat64(0, le);
        return valType === 'hex'
            ? this.hexPadBig(dv.getBigUint64(0, le), 16)
            : this.formatFloat(v, 16);
    },
};

private copyNumericValue(r: DecodedField, valType: ColType, dv: DataView, le: boolean): string {
    return this.COPY_NUMERIC_VALUE[r.type]?.(valType, dv, le) ?? r.decoded;
}

private readonly TYPE_ABBREV: Record<string, string> = {
    ascii: 'str',
    uint8: 'u8',  uint16: 'u16', uint32: 'u32', uint64: 'u64',
    int8:  'i8',  int16:  'i16', int32:  'i32', int64:  'i64',
    float32: 'f32', float64: 'f64', pointer: 'ptr',
};
private readonly TYPE_CELL_MAX_CHARS = 14;
private readonly TYPE_CELL_ELLIPSIS = '...';

private fieldValueKey(r: DecodedField, byteStart: number): string {
    return this.isBitFieldRow(r)
        ? this.bitChildValKey(byteStart, r.bitOffset ?? 0, r.bitWidth ?? 0)
        : this.scalarValKey(byteStart);
}

private defaultValueTypeForRow(r: DecodedField): ColType {
    if (this.isBitFieldRow(r)) { return 'bin'; }
    if (FLOAT_FIELD_TYPES.has(r.type)) { return 'dec'; }
    if (r.type === 'ascii') { return 'ascii'; }
    return this._defaultValType;
}

private valueTypeForRow(r: DecodedField, valKey: string): ColType {
    return this._fieldValTypes.get(valKey) ?? this.defaultValueTypeForRow(r);
}

private fieldTypeAbbrev(r: DecodedField, byteCount: number): string {
    const special = this.specialFieldTypeLabel(r, true);
    if (special) { return special; }
    const abbrevBase = this.TYPE_ABBREV[r.type] ?? r.type;
    return r.type === 'ascii' ? `${abbrevBase}[${byteCount}]` : abbrevBase;
}

private fieldFullTypeLabel(r: DecodedField, byteCount: number): string {
    const special = this.specialFieldTypeLabel(r, false);
    if (special) { return special; }
    return r.type === 'ascii' ? `ascii[${byteCount}]` : r.type;
}

private specialFieldTypeLabel(r: DecodedField, abbreviated: boolean): string | null {
    if (this.isBitFieldRow(r)) { return `bit:${r.bitWidth}`; }
    return r.isPointer ? `${this.pointerTargetTypeLabel(r, abbreviated)}*` : null;
}

private pointerTargetTypeLabel(r: DecodedField, abbreviated: boolean): string {
    const target = r.pointerTargetType ?? r.type;
    return this.POINTER_TARGET_LABELS[target]?.(r, abbreviated) ?? this.scalarPointerTargetLabel(target, abbreviated);
}

private readonly POINTER_TARGET_LABELS: Partial<Record<StructFieldType, (row: DecodedField, abbreviated: boolean) => string>> = {
    struct: row => row.pointerTargetStructName ?? 'struct',
    ascii: () => 'char',
    void: () => 'void',
};

private scalarPointerTargetLabel(target: StructFieldType, abbreviated: boolean): string {
    return abbreviated ? (this.TYPE_ABBREV[target] ?? target) : target;
}

private typeCellHtml(abbrev: string, fullTypeLabel: string): string {
    const compact = this.compactTypeCellLabel(abbrev);
    const escapedFullType = esc(fullTypeLabel);
    return `<span class="si-f-type" title="${escapedFullType}" aria-label="${escapedFullType}">${esc(compact)}</span>`;
}

private compactTypeCellLabel(label: string): string {
    return label.length <= this.TYPE_CELL_MAX_CHARS ? label : this.compactLongTypeCellLabel(label);
}

private compactLongTypeCellLabel(label: string): string {
    const pointerSuffix = this.pointerLabelSuffix(label);
    const body = label.slice(0, label.length - pointerSuffix.length);
    const availableBodyChars = this.TYPE_CELL_MAX_CHARS - this.TYPE_CELL_ELLIPSIS.length - pointerSuffix.length;
    const headChars = Math.ceil(availableBodyChars / 2);
    const tailChars = availableBodyChars - headChars;
    return `${body.slice(0, headChars)}${this.TYPE_CELL_ELLIPSIS}${body.slice(-tailChars)}${pointerSuffix}`;
}

private pointerLabelSuffix(label: string): string {
    return label.endsWith('*') ? '*' : '';
}

private fieldOffsetLabel(r: DecodedField): string {
    if (this.isBitFieldRow(r)) { return `.${String(r.bitOffset ?? 0)}`; }
    return `+${r.byteOffset.toString(16).toUpperCase().padStart(3, '0')}`;
}

private bitFieldDataAttrs(r: DecodedField): string {
    if (!this.isBitFieldRow(r)) { return ''; }
    return ` data-bit-start="${r.bitOffset ?? 0}" data-bit-width="${r.bitWidth ?? 0}"`;
}

private valueHtmlForRow(r: DecodedField, valType: ColType, ptr: boolean): string {
    const value = this.getValForType(r, valType);
    return this.valueIsRawHtml(valType, ptr) ? value : esc(value);
}

private valueIsRawHtml(valType: ColType, ptr: boolean): boolean {
    if (ptr) { return true; }
    return RAW_HTML_VALUE_TYPES.has(valType);
}

private mkFieldRow(r: DecodedField, bs: number, bc: number, ctx: StructRenderContext, displayName?: string): string {
    const ptr = r.isPointer === true;
    const valKey = this.fieldValueKey(r, bs);
    const t = this.valueTypeForRow(r, valKey);
    const valHtml = this.valueHtmlForRow(r, t, ptr);
    const byteCount = r.bytesHex.length > 0 ? r.bytesHex.split(' ').length : bc;
    const abbrev = this.fieldTypeAbbrev(r, byteCount);
    const fullTypeLabel = this.fieldFullTypeLabel(r, byteCount);
    const offsetLabel = this.fieldOffsetLabel(r);
    const offsetHtml = ctx.hideOffsets
        ? '<span class="si-node-pad" aria-hidden="true"></span>'
        : `<span class="si-f-off">${offsetLabel}</span>`;
    return (
        `<div class="si-field${this.fieldRowClasses(r.hasData, ptr)}" ` +
        `data-byte-start="${bs}" data-byte-cnt="${bc}" data-val-key="${esc(valKey)}"` +
        this.sourceContextDataAttrs(ctx) +
        this.bitFieldDataAttrs(r) +
        `>` +
        offsetHtml +
        this.typeCellHtml(abbrev, fullTypeLabel) +
        `<span class="si-toggle-pad" aria-hidden="true"></span>` +
        `<span class="si-f-body">` +
        `<span class="si-f-name">${esc(displayName ?? this.leafName(r.fieldName))}</span>` +
        `<span class="si-f-lead"></span>` +
        `<span class="si-f-val si-f-pri${this.pointerValueClass(ptr)}" data-val-type="${t}" data-bs="${bs}" data-val-key="${esc(valKey)}">${valHtml}</span>` +
        `</span>` +
        `</div>`
    );
}

private fieldRowClasses(hasData: boolean, pointer: boolean): string {
    return `${hasData ? '' : ' si-no-data'}${pointer ? ' si-ptr-field' : ''}`;
}

private pointerValueClass(pointer: boolean): string {
    return pointer ? ' si-f-ptr' : '';
}

private parseArrayIndex(fieldPath: string, baseName: string): number | null {
    const escBase = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = fieldPath.match(new RegExp(`^${escBase}\\[(\\d+)\\]`));
    if (!m) { return null; }
    const idx = parseInt(m[1], 10);
    return isNaN(idx) ? null : idx;
}

private indexOnlyName(fieldPath: string, baseName: string): string {
    const idx = this.parseArrayIndex(fieldPath, baseName);
    return idx === null ? this.leafName(fieldPath) : `[${idx}]`;
}

private leafName(fieldPath: string): string {
    const parts = fieldPath.split('.').filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : fieldPath;
}

private displayFieldName(fieldPath: string): string {
    return this.leafName(fieldPath).replace(/\[\d+\]$/, '');
}

private isBitUnitGroup(rows: DecodedField[]): boolean {
    return rows.length > 0 && rows.every(r => this.isBitFieldRow(r));
}

private groupHeaderName(baseName: string): string {
    return this.displayFieldName(baseName);
}

private groupSummaryLabel(rows: DecodedField[], fallback: string): string {
    if (!this.isBitUnitGroup(rows)) { return fallback; }
    const first = rows[0];
    if (!first) { return fallback; }
    const raw = this.completeByteValues(first.bytesHex);
    if (!raw) { return '??'; }

    const value = this.bytesToValue(raw, this._endian);
    const hex = value.toString(16).toUpperCase().padStart(raw.length * 2, '0');
    return `0x${hex} (${value.toString(10)})`;
}

private completeByteValues(bytesHex: string): number[] | null {
    const rawParts = this.byteHexParts(bytesHex);
    if (this.hasMissingByte(rawParts)) { return null; }
    const raw = this.bytesFromHexParts(rawParts);
    return raw.every(v => this.isByteValue(v)) ? raw : null;
}

private isByteValue(value: number): boolean {
    return Number.isFinite(value) && value >= 0 && value <= 0xFF;
}

private buildBitUnitAggregateRow(rows: DecodedField[]): DecodedField | null {
    const first = rows[0];
    if (!first) { return null; }
    const usedWidth = rows.reduce((sum, row) => sum + this.bitRowWidth(row), 0);
    let slicedValue: string | undefined;
    const rawParts = this.byteHexParts(first.bytesHex);
    if (this.canDecodeBitUnit(usedWidth, rawParts, first.hasData)) {
        const raw = this.bytesFromHexParts(rawParts);
        const value = this.bytesToValue(raw, this._endian);
        const unitBits = raw.length * 8;
        const mask = (1n << BigInt(usedWidth)) - 1n;
        const sliced = this._bitFieldAllocation === 'lsb'
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

private canDecodeBitUnit(usedWidth: number, rawParts: string[], hasData: boolean): boolean {
    return usedWidth > 0 && !this.hasMissingByte(rawParts) && hasData;
}

private activeBitRangeForHeader(start: number): { startBit: number; endBit: number } | null {
    return this.matchingBitRange(this._selectedBitRange, start) ?? this.matchingBitRange(this._hoveredBitRange, start);
}

private matchingBitRange(range: typeof this._selectedBitRange, start: number): { startBit: number; endBit: number } | null {
    if (!range || range.parentByteStart !== start) { return null; }
    return { startBit: range.startBit, endBit: range.endBit };
}

private bitUnitHeaderClasses(kind: 'group' | 'element'): { headerClass: string; buttonClass: string } {
    return {
        headerClass: kind === 'element' ? 'si-arr-el-hdr' : 'si-arr-grp-hdr',
        buttonClass: kind === 'element' ? 'si-arr-el-exp-btn' : 'si-arr-exp-btn',
    };
}

private emptyBitUnitHeaderHtml(
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
        this.typeCellHtml('u8', 'uint8') +
        `<button class="${buttonClass}">${isOpen ? '▾' : '▸'}</button>` +
        `<span class="si-f-body">` +
        `<span class="si-f-name">${esc(headerName)}</span>` +
        `<span class="si-f-lead"></span>` +
        `<span class="si-f-val si-f-pri" data-val-type="hex" data-bs="${start}" data-val-key="${esc(valKey)}">??</span>` +
        `</span>` +
        `</div>`
    );
}

private bitUnitHeaderValueHtml(
    rows: DecodedField[],
    agg: DecodedField,
    valueType: ColType,
    activeRange: { startBit: number; endBit: number } | null,
): string {
    if (valueType === 'bin') { return this.renderBinaryStorageUnit(agg, activeRange); }
    if (valueType === 'bin-sliced') { return this.renderBinaryFromBitRows(rows, activeRange); }
    return this.getValForType(agg, valueType);
}

private bitUnitHeaderDisplayValue(
    rows: DecodedField[],
    agg: DecodedField,
    valueType: ColType,
    start: number,
): string {
    const value = this.bitUnitHeaderValueHtml(rows, agg, valueType, this.activeBitRangeForHeader(start));
    return this.shouldUseRawHeaderValue(valueType, agg) ? value : esc(value);
}

private readonly RAW_BIT_UNIT_VALUE_TYPES = new Set<ColType>(['bin', 'bin-sliced', 'ieee', 'hex']);

private shouldUseRawHeaderValue(valueType: ColType, agg: DecodedField): boolean {
    return this.RAW_BIT_UNIT_VALUE_TYPES.has(valueType) || agg.isPointer === true;
}

private bitUnitByteCount(agg: DecodedField, fallback: number): number {
    return agg.bytesHex.length > 0 ? agg.bytesHex.split(' ').length : fallback;
}

private bitUnitHeaderHtml(
    rows: DecodedField[],
    start: number,
    cnt: number,
    isOpen: boolean,
    headerNameOverride?: string,
    kind: 'group' | 'element' = 'group',
    hideOffset = false,
): string {
    const agg = this.buildBitUnitAggregateRow(rows);
    const headerName = this.bitUnitHeaderName(rows, headerNameOverride);
    const { headerClass, buttonClass } = this.bitUnitHeaderClasses(kind);
    const valKey = this.bitUnitValKey(start);
    if (!agg) { return this.emptyBitUnitHeaderHtml(headerClass, buttonClass, headerName, valKey, start, cnt, isOpen); }

    return this.populatedBitUnitHeaderHtml(rows, agg, headerClass, buttonClass, headerName, valKey, start, cnt, isOpen, hideOffset);
}

private bitUnitHeaderName(rows: DecodedField[], headerNameOverride?: string): string {
    if (headerNameOverride !== undefined) { return headerNameOverride; }
    return this.groupHeaderName(this.arrayGroupBaseName(this.firstBitUnitFieldName(rows)));
}

private firstBitUnitFieldName(rows: DecodedField[]): string {
    return rows[0]?.fieldName ?? '';
}

private populatedBitUnitHeaderHtml(
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
    const t = this.bitUnitHeaderValueType(valKey);
    const ptrClass = this.bitUnitPointerClass(agg);
    const valHtml = this.bitUnitHeaderDisplayValue(rows, agg, t, start);
    const byteCount = this.bitUnitByteCount(agg, cnt);
    const abbrev = this.fieldTypeAbbrev(agg, byteCount);
    const fullTypeLabel = this.fieldFullTypeLabel(agg, byteCount);
    const offsetLabel = this.fieldOffsetLabel(agg);

    const offsetHtml = hideOffset
        ? '<span class="si-node-pad" aria-hidden="true"></span>'
        : `<span class="si-f-off">${offsetLabel}</span>`;
    return (
        `<div class="${headerClass} si-bitunit-hdr si-field" data-byte-start="${start}" data-byte-cnt="${cnt}" data-val-key="${esc(valKey)}">` +
        offsetHtml +
        this.typeCellHtml(abbrev, fullTypeLabel) +
        `<button class="${buttonClass}">${isOpen ? '▾' : '▸'}</button>` +
        `<span class="si-f-body">` +
        `<span class="si-f-name">${esc(headerName)}</span>` +
        `<span class="si-f-lead"></span>` +
        `<span class="si-f-val si-f-pri${ptrClass}" data-val-type="${t}" data-bs="${start}" data-val-key="${esc(valKey)}">${valHtml}</span>` +
        `</span>` +
        `</div>`
    );
}

private bitUnitHeaderValueType(valKey: string): ColType {
    return this._fieldValTypes.get(valKey) ?? 'bin';
}

private bitUnitPointerClass(agg: DecodedField): string {
    return agg.isPointer === true ? ' si-f-ptr' : '';
}

private disambiguateLeafNames(names: string[]): string[] {
    const seen = new Map<string, number>();
    return names.map(name => {
        const count = (seen.get(name) ?? 0) + 1;
        seen.set(name, count);
        return count === 1 ? name : `${name}#${count}`;
    });
}

private arrayGroupBaseName(fieldPath: string): string {
    // Group by the first local segment (before first dot), even when arrays are present.
    // This keeps nested fields under their owning parent node.
    const matches = [...fieldPath.matchAll(/\[\d+\]/g)];
    if (matches.length === 0) {
        return this.baseNameBeforeDot(fieldPath);
    }
    const first = matches[0];
    if (first.index === undefined) { return fieldPath; }
    const firstArrayIdx = first.index;
    const firstDot = fieldPath.indexOf('.');
    if (this.dotPrecedesArray(firstDot, firstArrayIdx)) { return fieldPath.slice(0, firstDot); }
    return fieldPath.slice(0, first.index);
}

private baseNameBeforeDot(fieldPath: string): string {
    const dot = fieldPath.indexOf('.');
    return dot >= 0 ? fieldPath.slice(0, dot) : fieldPath;
}

private dotPrecedesArray(dot: number, arrayIdx: number): boolean {
    return dot >= 0 && dot < arrayIdx;
}

private bitUnitArrayBaseName(fieldPath: string): string {
    return fieldPath.replace(/\[\d+\]$/, '');
}



private decodedRowByteCount(r: DecodedField): number {
    if (this.isBitFieldRow(r)) { return r.bitStorageByteSize ?? 1; }
    return r.bytesHex.length > 0 ? r.bytesHex.split(' ').length : fieldByteSize(r.type);
}

private sumDecodedRowBytes(rows: DecodedField[]): number {
    return rows.reduce((sum, row) => sum + this.decodedRowByteCount(row), 0);
}

private isCompositeStructGroup(isBitUnit: boolean, isStruct: boolean, isArray: boolean, isString: boolean): boolean {
    if (isBitUnit || isStruct) { return true; }
    return isArray && !isString;
}

private structGroupSummary(type: StructFieldType, isArray: boolean, count: number, structName: string): string {
    if (type === 'struct') {
        return isArray ? `${structName}[${count}]` : structName;
    }
    const scalarType = this.TYPE_ABBREV[type] ?? type;
    return `${scalarType}[${count}]`;
}

private pointerGroupSummary(type: StructFieldType, isArray: boolean, count: number, structName: string): string {
    const base = type === 'struct' ? structName : this.pointerScalarSummaryBase(type);
    return isArray ? `${base}*[${count}]` : `${base}*`;
}

private pointerScalarSummaryBase(type: StructFieldType): string {
    if (type === 'ascii') { return 'char'; }
    return this.TYPE_ABBREV[type] ?? type;
}

private structGroupSummaryLabel(rows: DecodedField[], isBitUnit: boolean, isArray: boolean, summary: string): string {
    return isBitUnit && isArray ? summary : this.groupSummaryLabel(rows, summary);
}

private structGroupByteCount(rows: DecodedField[], isBitUnit: boolean, isArray: boolean, count: number): number {
    return isBitUnit && isArray ? this.decodedRowByteCount(rows[0]) * count : this.sumDecodedRowBytes(rows);
}

private preservePendingStructAddress(): void {
    const value = this.pendingStructAddressValue();
    if (value !== null) { this._activeStructAddr = value; }
}

private pendingStructAddressValue(): number | null {
    const curAddrInp = this.pendingAddrInput();
    if (!curAddrInp) { return null; }
    const value = parseInt(curAddrInp.value, 16);
    if (isNaN(value)) { return null; }
    return value;
}

private pendingAddrInput(): HTMLInputElement | null {
    return this._root?.querySelector<HTMLInputElement>('#sa-addr') ?? null;
}

private describeStructGroup(def: StructDef, rows: DecodedField[], baseName: string): StructGroupInfo {
    const declared = this.structGroupDeclarationInfo(def, rows, baseName);
    const isArray = declared.count > 1;
    const isStruct = declared.declaredType === 'struct' && !declared.isPointer;
    const isString = declared.declaredType === 'ascii' && !declared.isPointer;
    const isBitUnit = this.isBitUnitGroup(rows);
    const isComposite = this.isCompositeStructGroup(isBitUnit, isStruct, isArray, isString);
    const summary = this.groupSummaryForDeclaration(declared, isArray);
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
        summaryLabel: this.structGroupSummaryLabel(rows, isBitUnit, isArray, summary),
        byteCount: this.structGroupByteCount(rows, isBitUnit, isArray, declared.count),
    };
}

private structGroupDeclarationInfo(def: StructDef, rows: DecodedField[], baseName: string): StructGroupDeclarationInfo {
    const declared = resolveStructFieldByPath(def, baseName, this._structs);
    return declared ? this.resolvedStructGroupDeclarationInfo(declared) : this.inferredStructGroupDeclarationInfo(rows);
}

private resolvedStructGroupDeclarationInfo(declared: { field: StructField; structName?: string }): StructGroupDeclarationInfo {
    return {
        declaredType: declared.field.type,
        count: declared.field.count,
        structName: declared.structName ?? 'struct',
        isPointer: normalizeStructField(declared.field).isPointer === true,
    };
}

private inferredStructGroupDeclarationInfo(rows: DecodedField[]): StructGroupDeclarationInfo {
    const first = rows[0];
    return {
        declaredType: first.type,
        count: rows.length,
        structName: 'struct',
        isPointer: first.isPointer === true,
    };
}

private groupSummaryForDeclaration(declared: StructGroupDeclarationInfo, isArray: boolean): string {
    return declared.isPointer
        ? this.pointerGroupSummary(declared.declaredType, isArray, declared.count, declared.structName)
        : this.structGroupSummary(declared.declaredType, isArray, declared.count, declared.structName);
}

private groupRowsByBase(rows: DecodedField[]): FieldGroup[] {
    const groups: FieldGroup[] = [];
    for (const row of rows) {
        const base = this.arrayGroupBaseName(row.fieldName);
        const last = groups[groups.length - 1];
        if (last && last.baseName === base) { last.rows.push(row); }
        else { groups.push({ baseName: base, rows: [row] }); }
    }
    return groups;
}

private groupRowsByArrayIndex(rows: DecodedField[], baseName: string): IndexedFieldGroup[] {
    const groups: IndexedFieldGroup[] = [];
    for (const row of rows) {
        const idx = this.parseArrayIndex(row.fieldName, baseName);
        if (idx === null) { continue; }
        this.appendIndexedFieldRow(groups, idx, row);
    }
    return groups;
}

private appendIndexedFieldRow(groups: IndexedFieldGroup[], idx: number, row: DecodedField): void {
    const last = groups[groups.length - 1];
    if (last && last.idx === idx) { last.rows.push(row); }
    else { groups.push({ idx, rows: [row] }); }
}

private groupNestedRows(rows: DecodedField[], structBase: string): NestedFieldGroup[] {
    const structPrefix = `${structBase}.`;
    const groups: NestedFieldGroup[] = [];
    for (const row of rows) {
        const relPath = this.relativeStructFieldPath(row.fieldName, structPrefix);
        const baseRel = this.arrayGroupBaseName(relPath);
        const fullBase = `${structBase}.${baseRel}`;
        const last = groups[groups.length - 1];
        if (last && last.fullBase === fullBase) { last.rows.push(row); }
        else { groups.push({ baseRel, fullBase, rows: [row] }); }
    }
    return groups;
}

private relativeStructFieldPath(fieldName: string, structPrefix: string): string {
    return fieldName.startsWith(structPrefix) ? fieldName.slice(structPrefix.length) : fieldName;
}

private leafRowsHtml(rows: DecodedField[], ctx: StructRenderContext): string {
    const labels = this.disambiguateLeafNames(rows.map(r => this.leafName(r.fieldName)));
    return rows.map((row, idx) =>
        this.mkFieldRow(row, ctx.baseAddr + row.byteOffset, this.decodedRowByteCount(row), ctx, labels[idx])
    ).join('');
}

private indexedRowsHtml(rows: DecodedField[], ctx: StructRenderContext, baseName: string): string {
    return rows.map(row =>
        this.mkFieldRow(row, ctx.baseAddr + row.byteOffset, this.decodedRowByteCount(row), ctx, this.indexOnlyName(row.fieldName, baseName))
    ).join('');
}

private structArrayElementHtml(
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
    const groupClass = this.structArrayElementGroupClass(isOpen);
    const offsetAttr = this.structArrayElementOffsetAttr(first.byteOffset, hideOffsets);
    const bodyStyle = this.structArrayElementBodyStyle(isOpen);
    return (
        `<div class="${groupClass}" data-arr-el-key="${esc(elementKey)}">` +
        `<div class="si-arr-el-hdr" data-arr-el-key="${esc(elementKey)}" data-byte-start="${byteStart}" data-byte-cnt="${byteCnt}"${offsetAttr}>` +
        this.compositeHeaderPrefixHtml(isOpen, first.byteOffset, hideOffsets) +
        `<button class="si-arr-el-exp-btn">${this.expandGlyph(isOpen)}</button>` +
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

private structArrayElementGroupClass(isOpen: boolean): string {
    return isOpen ? 'si-arr-el-grp open' : 'si-arr-el-grp';
}

private structArrayElementOffsetAttr(byteOffset: number, hideOffsets: boolean): string {
    return hideOffsets ? '' : ` data-offset-label="${this.offsetLabel(byteOffset)}"`;
}

private structArrayElementBodyStyle(isOpen: boolean): string {
    return isOpen ? '' : ' style="display:none"';
}

private expandGlyph(isOpen: boolean): string {
    return isOpen ? '▾' : '▸';
}

private offsetLabel(byteOffset: number): string {
    return `+${byteOffset.toString(16).toUpperCase().padStart(3, '0')}`;
}

private compositeHeaderPrefixHtml(isOpen: boolean, byteOffset: number, hideOffset = false): string {
    if (isOpen || hideOffset) {
        return (
            `<span class="si-node-pad" aria-hidden="true"></span>` +
            `<span class="si-node-type-pad" aria-hidden="true"></span>`
        );
    }
    return (
        `<span class="si-f-off">${this.offsetLabel(byteOffset)}</span>` +
        `<span class="si-node-type-pad" aria-hidden="true"></span>`
    );
}

private syncCompositeHeaderOffset(hdr: HTMLElement, isOpen: boolean): void {
    if (hdr.classList.contains('si-bitunit-hdr')) { return; }
    if (hdr.classList.contains('si-ptr-hdr')) { return; }

    const existingOffset = hdr.querySelector<HTMLElement>(':scope > .si-f-off');
    const existingPad = hdr.querySelector<HTMLElement>(':scope > .si-node-pad');
    const typePad = hdr.querySelector<HTMLElement>(':scope > .si-node-type-pad');
    if (isOpen) {
        this.syncOpenCompositeHeaderOffset(existingOffset, existingPad, typePad);
        return;
    }

    this.syncClosedCompositeHeaderOffset(hdr.dataset.offsetLabel, existingOffset, existingPad, typePad);
}

private syncOpenCompositeHeaderOffset(
    existingOffset: HTMLElement | null,
    existingPad: HTMLElement | null,
    typePad: HTMLElement | null,
): void {
    existingOffset?.remove();
    if (!existingPad && typePad) {
        typePad.insertAdjacentHTML('beforebegin', '<span class="si-node-pad" aria-hidden="true"></span>');
    }
}

private syncClosedCompositeHeaderOffset(
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



private sourceContextDataAttrs(ctx: StructRenderContext): string {
    return ` data-source-struct-id="${esc(ctx.def.id)}" data-source-base-addr="${ctx.baseAddr}"`;
}


private readonly BODY_RULES: ReadonlyArray<BodyRule> = [
    [
        group => group.info.isStruct && group.info.isArray,
        (ctx, group) => this.renderStructArrayElements(ctx, group.rows, group.baseName, group.key, group.info.structName),
    ],
    [
        group => group.info.isBitUnit && group.info.isArray,
        (ctx, group) => this.renderBitUnitArrayElements(group.rows, group.baseName, group.key, ctx),
    ],
    [
        group => group.info.isStruct && !group.info.isArray,
        (ctx, group) => this.renderStructChildren(ctx, group.rows, group.baseName, group.key),
    ],
    [
        group => group.info.isBitUnit,
        (ctx, group) => this.renderBitUnitLeafRows(group.rows, ctx),
    ],
    [
        group => !group.info.isStruct && group.info.isArray && !group.info.isString,
        (ctx, group) => this.indexedRowsHtml(group.rows, ctx, group.baseName),
    ],
];

private renderStructBody(def: StructDef, pin: StructPin): string {
    const rows = decodeStruct(def, pin.addr, this.cb.readByte, this._endian, this._bitFieldAllocation, this._structs);
    return `<div class="si-fields">${this.renderStructFieldGroups({
        def,
        pin,
        baseAddr: pin.addr,
        keyPrefix: pin.id,
        pointerDepth: 0,
        hideOffsets: false,
    }, rows)}</div>`;
}

private renderBitUnitLeafRows(unitRows: DecodedField[], ctx: StructRenderContext): string {
    return this.leafRowsHtml(unitRows, ctx);
}

private renderBitUnitArrayElements(
    unitRows: DecodedField[],
    baseName: string,
    parentKey: string,
    ctx: StructRenderContext,
): string {
    const arrayBase = this.bitUnitArrayBaseName(baseName);
    return this.groupRowsByArrayIndex(unitRows, arrayBase).map(element => {
        const first = element.rows[0];
        const elementByteStart = ctx.baseAddr + first.byteOffset;
        const elementByteCnt = this.decodedRowByteCount(first);
        const elementKey = `${parentKey}::${element.idx}`;
        const isElementOpen = this._expandedArrayElements.has(elementKey);
        const elementRowsHtml = this.renderBitUnitLeafRows(element.rows, ctx);
        return (
            `<div class="si-arr-el-grp${isElementOpen ? ' open' : ''}" data-arr-el-key="${esc(elementKey)}">` +
            this.bitUnitHeaderHtml(element.rows, elementByteStart, elementByteCnt, isElementOpen, `[${element.idx}]`, 'element') +
            `<div class="si-arr-el-body"${isElementOpen ? '' : ' style=\"display:none\"'}>${elementRowsHtml}</div>` +
            `</div>`
        );
    }).join('');
}

private renderStructChildren(ctx: StructRenderContext, structRows: DecodedField[], structBase: string, parentKey: string): string {
    return this.groupNestedRows(structRows, structBase).map(ng => this.renderNestedStructGroup(ctx, ng, parentKey)).join('');
}

private renderNestedStructGroup(ctx: StructRenderContext, ng: NestedFieldGroup, parentKey: string): string {
    const info = this.describeStructGroup(ctx.def, ng.rows, ng.fullBase);
    if (this.isStructPointerRows(ng.rows)) {
        return this.renderStructPointerRows(ctx, ng.rows, parentKey, ng.baseRel, info);
    }
    if (!info.isComposite) {
        return this.leafRowsHtml(ng.rows, ctx);
    }

    const nestedKey = `${parentKey}::${ng.baseRel}`;
    const nestedOpen = this._expandedArrayFields.has(nestedKey);
    const nestedStart = ctx.baseAddr + ng.rows[0].byteOffset;
    const nestedBodyHtml = this.renderNestedStructBody(ctx, {
        rows: ng.rows,
        baseName: ng.fullBase,
        key: nestedKey,
        info,
    });

    return this.compositeGroupHtml(
        nestedKey,
        nestedOpen,
        this.nestedStructHeaderHtml(ctx, ng, info, nestedStart, nestedOpen),
        nestedBodyHtml,
    );
}

private nestedStructHeaderHtml(ctx: StructRenderContext, ng: NestedFieldGroup, info: StructGroupInfo, nestedStart: number, nestedOpen: boolean): string {
    if (info.isBitUnit && !info.isArray) {
        return this.bitUnitHeaderHtml(ng.rows, nestedStart, info.byteCount, nestedOpen, this.groupHeaderName(ng.baseRel), 'group', ctx.hideOffsets);
    }
    return this.compositeHeaderHtml(
        nestedOpen,
        nestedStart,
        info.byteCount,
        ng.rows[0].byteOffset,
        this.groupHeaderName(ng.baseRel),
        info.summaryLabel,
        ctx.hideOffsets,
    );
}

private bodyRuleFor(group: RenderBodyGroup): ((ctx: StructRenderContext, group: RenderBodyGroup) => string) | undefined {
    return this.BODY_RULES.find(([matches]) => matches(group))?.[1];
}

private renderNestedStructBody(
    ctx: StructRenderContext,
    group: RenderBodyGroup,
): string {
    const rule = this.bodyRuleFor(group);
    return rule ? rule(ctx, group) : this.leafRowsHtml(group.rows, ctx);
}

private renderStructArrayElements(
    ctx: StructRenderContext,
    rows: DecodedField[],
    baseName: string,
    parentKey: string,
    structName: string,
): string {
    return this.groupRowsByArrayIndex(rows, baseName).map(element => {
        const elementKey = `${parentKey}::${element.idx}`;
        const isElementOpen = this._expandedArrayElements.has(elementKey);
        const childRowsHtml = this.renderStructChildren(
            ctx,
            element.rows,
            `${baseName}[${element.idx}]`,
            elementKey,
        );
        return this.structArrayElementHtml(
            element,
            elementKey,
            ctx.baseAddr,
            this.sumDecodedRowBytes(element.rows),
            isElementOpen,
            structName,
            ctx.hideOffsets,
            childRowsHtml,
        );
    }).join('');
}

private renderStructFieldGroups(ctx: StructRenderContext, rows: DecodedField[]): string {
    return this.groupRowsByBase(rows).map(g => this.renderStructFieldGroup(ctx, g)).join('');
}

private renderStructFieldGroup(ctx: StructRenderContext, g: FieldGroup): string {
    const r0 = g.rows[0];
    const info = this.describeStructGroup(ctx.def, g.rows, g.baseName);
    if (this.isStructPointerRows(g.rows)) {
        return this.renderStructPointerRows(ctx, g.rows, ctx.keyPrefix, g.baseName, info);
    }
    if (!info.isComposite) {
        return this.leafRowsHtml(g.rows, ctx);
    }

    const key = `${ctx.keyPrefix}::${g.baseName}`;
    const isOpen = this._expandedArrayFields.has(key);
    const byteStart = ctx.baseAddr + r0.byteOffset;
    const elHtml = this.renderStructFieldBody(ctx, {
        rows: g.rows,
        baseName: g.baseName,
        key,
        info,
    });

    return this.compositeGroupHtml(
        key,
        isOpen,
        this.structFieldHeaderHtml(ctx, g, info, byteStart, isOpen),
        elHtml,
    );
}

private structFieldHeaderHtml(ctx: StructRenderContext, g: FieldGroup, info: StructGroupInfo, byteStart: number, isOpen: boolean): string {
    if (info.isBitUnit && !info.isArray) {
        return this.bitUnitHeaderHtml(g.rows, byteStart, info.byteCount, isOpen, undefined, 'group', ctx.hideOffsets);
    }
    return this.compositeHeaderHtml(
        isOpen,
        byteStart,
        info.byteCount,
        g.rows[0].byteOffset,
        this.groupHeaderName(g.baseName),
        info.summaryLabel,
        ctx.hideOffsets,
        true,
    );
}

private compositeGroupHtml(key: string, isOpen: boolean, headerHtml: string, bodyHtml: string): string {
    return (
        `<div class="si-arr-grp${isOpen ? ' open' : ''}" data-arr-key="${esc(key)}">` +
        headerHtml +
        `<div class="si-arr-grp-body"${isOpen ? '' : ' style=\"display:none\"'}>${bodyHtml}</div>` +
        `</div>`
    );
}

private compositeHeaderHtml(
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
        `<div class="si-arr-grp-hdr" data-byte-start="${byteStart}" data-byte-cnt="${byteCount}"${hideOffset ? '' : ` data-offset-label="${this.offsetLabel(byteOffset)}"`}>` +
        this.compositeHeaderPrefixHtml(isOpen, byteOffset, hideOffset) +
        `<button class="si-arr-exp-btn">${isOpen ? '▾' : '▸'}</button>` +
        `<span class="si-f-body">` +
        `<span class="si-f-name">${esc(name)}</span>` +
        `<span class="si-f-lead"></span>` +
        `<span class="si-arr-addr"${title}>${esc(summaryLabel)}</span>` +
        `</span>` +
        `</div>`
    );
}

private isStructPointerRows(rows: DecodedField[]): boolean {
    return rows.length > 0 && rows.every(row => row.isPointer === true);
}

private renderStructPointerRows(
    ctx: StructRenderContext,
    rows: DecodedField[],
    parentKey: string,
    baseName: string,
    info: StructGroupInfo,
): string {
    if (info.isArray) {
        return this.renderStructPointerArrayRows(ctx, rows, parentKey, baseName, info);
    }
    return rows.map(row => {
        return this.renderStructPointerGroup(ctx, row, `${parentKey}::ptr::${row.fieldName}`, this.groupHeaderName(baseName));
    }).join('');
}

private renderStructPointerArrayRows(
    ctx: StructRenderContext,
    rows: DecodedField[],
    parentKey: string,
    baseName: string,
    info: StructGroupInfo,
): string {
    const key = `${parentKey}::${baseName}`;
    const isOpen = this._expandedArrayFields.has(key);
    const first = rows[0];
    const byteStart = ctx.baseAddr + first.byteOffset;
    const bodyHtml = rows.map(row =>
        this.renderStructPointerGroup(ctx, row, `${key}::ptr::${row.fieldName}`, this.indexOnlyName(row.fieldName, baseName))
    ).join('');
    return this.compositeGroupHtml(
        key,
        isOpen,
        this.compositeHeaderHtml(isOpen, byteStart, info.byteCount, first.byteOffset, this.groupHeaderName(baseName), info.summary, ctx.hideOffsets, true),
        bodyHtml,
    );
}

private renderStructPointerGroup(ctx: StructRenderContext, row: DecodedField, key: string, name: string): string {
    const target = this.pointerDerefTarget(row);
    if (!target.ok || !this.pointerHasInlinePreview(row, target)) {
        return this.structPointerLeafHtml(ctx, row, key, name, target);
    }
    const isOpen = this._expandedArrayFields.has(key);
    const childKey = `${key}::child`;
    return this.compositeGroupHtml(
        key,
        isOpen,
        this.structPointerHeaderHtml(ctx, row, key, name, target, isOpen),
        this.structPointerTargetBodyHtml(ctx, row, target, childKey),
    );
}

private pointerHasInlinePreview(row: DecodedField, target: PointerDerefTarget): target is Extract<PointerDerefTarget, { ok: true }> {
    if (!target.ok) { return false; }
    if (target.def) { return true; }
    return this.scalarPointerTargetType(row) !== 'void';
}

private structPointerLeafHtml(
    ctx: StructRenderContext,
    row: DecodedField,
    key: string,
    name: string,
    target: PointerDerefTarget,
): string {
    const storageStart = ctx.baseAddr + row.byteOffset;
    const valKey = this.fieldValueKey(row, storageStart);
    return (
        this.structPointerLeafOpenTag(ctx, row, target, key, storageStart, valKey) +
        this.structPointerHeaderPrefixHtml(row, ctx.hideOffsets) +
        `<span class="si-toggle-pad" aria-hidden="true"></span>` +
        this.structPointerHeaderBodyHtml(row, target, name, storageStart, valKey) +
        `</div>`
    );
}

private structPointerLeafOpenTag(
    ctx: StructRenderContext,
    row: DecodedField,
    target: PointerDerefTarget,
    key: string,
    storageStart: number,
    valKey: string,
): string {
    return this.structPointerOpenTag(ctx, row, target, key, storageStart, valKey, 'si-field si-ptr-hdr si-ptr-field', 0);
}

private pointerChildState(ctx: StructRenderContext, row: DecodedField, target: Extract<PointerDerefTarget, { ok: true }>, key: string): PointerChildState {
    const storageStart = ctx.baseAddr + row.byteOffset;
    const expandable = this.pointerChildExpandable(ctx, target);
    const isOpen = this.pointerChildIsOpen(key, expandable.ok);
    return {
        key,
        storageStart,
        byteStart: target.addr,
        byteCount: target.byteCount,
        valKey: this.fieldValueKey(row, storageStart),
        name: this.pointerChildName(target),
        summary: this.pointerChildSummary(row, target),
        summaryTitle: this.pointerChildSummaryTitle(row, target),
        canExpand: expandable.ok,
        expandTitle: expandable.ok ? 'Expand' : expandable.reason,
        isOpen,
        allowCreate: row.pointerTargetType === 'struct',
        bodyHtml: this.pointerChildBodyHtml(ctx, key, target, expandable.ok),
    };
}

private pointerChildName(target: Extract<PointerDerefTarget, { ok: true }>): string {
    return target.def ? '{ }' : '';
}

private pointerChildIsOpen(key: string, canExpand: boolean): boolean {
    return canExpand && this._expandedArrayFields.has(key);
}

private pointerChildBodyHtml(
    ctx: StructRenderContext,
    key: string,
    target: PointerDerefTarget,
    canExpand: boolean,
): string {
    if (!canExpand || !target.ok || !target.def) { return ''; }
    const resolvedTarget = { ...target, def: target.def };
    return this.renderStructPointerBody(ctx, key, resolvedTarget);
}

private pointerChildSummary(row: DecodedField, target: Extract<PointerDerefTarget, { ok: true }>): string {
    return target.def ? this.structPointerTargetSummary(row, target.addr, target.def) : this.pointerTargetTypeLabel(row, false);
}

private pointerChildSummaryTitle(row: DecodedField, target: Extract<PointerDerefTarget, { ok: true }>): string {
    const targetName = target.def ? row.pointerTargetStructName ?? target.def.name : this.pointerTargetTypeLabel(row, false);
    return `${targetName} @ ${formatHex(target.addr, 8)}`;
}

private structPointerTargetSummary(
    row: DecodedField,
    addr: number,
    def: StructDef,
): string {
    return `${row.pointerTargetStructName ?? def.name} @ ${formatHex(addr, 8)}`;
}

private scalarPointerTargetType(row: DecodedField): Exclude<StructFieldType, 'struct'> | null {
    const targetType = row.pointerTargetType;
    return targetType === undefined || targetType === 'struct' ? null : targetType;
}

private readScalarPointerTargetBytes(
    row: DecodedField,
    targetType: Exclude<StructFieldType, 'struct'>,
    addr: number,
): number[] | null {
    const size = Math.max(1, row.pointerTargetByteSize ?? fieldByteSize(targetType));
    const bytes: number[] = [];
    for (let offset = 0; offset < size; offset++) {
        const value = this.cb.readByte(addr + offset);
        if (value === undefined) { return null; }
        bytes.push(value);
    }
    return bytes;
}

private scalarPointerTargetRow(row: DecodedField, targetType: Exclude<StructFieldType, 'struct'>, bytes: number[]): DecodedField {
    return {
        fieldName: `${row.fieldName}.*`,
        type: targetType,
        arrayIdx: 0,
        byteOffset: 0,
        bytesHex: bytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' '),
        decoded: decodeField(bytes, targetType, this._endian),
        hasData: true,
    };
}





private pointerDerefTarget(row: DecodedField): PointerDerefTarget {
    const follow = this.pointerFollowState(row);
    const addr = typeof row.pointerValue === 'number' ? row.pointerValue : null;
    if (!follow.ok) { return { ok: false, reason: follow.reason, addr, byteCount: 1 }; }
    return this.resolvedPointerTarget(row, addr!);
}

private resolvedPointerTarget(row: DecodedField, addr: number): PointerDerefTarget {
    const def = this.pointerTargetStructDef(row) ?? null;
    if (def) {
        return { ok: true, addr, byteCount: structByteSize(def, this._structs), def };
    }
    return { ok: true, addr, byteCount: Math.max(1, row.pointerTargetByteSize ?? 1), def: null };
}

private pointerChildExpandable(
    ctx: StructRenderContext,
    target: PointerDerefTarget,
): { ok: true; reason: string } | { ok: false; reason: string } {
    if (!target.ok) { return { ok: false, reason: target.reason }; }
    if (!target.def) { return { ok: false, reason: 'non-struct target' }; }
    if (ctx.pointerDepth >= MAX_INLINE_POINTER_HOPS) { return { ok: false, reason: 'max depth' }; }
    return { ok: true, reason: 'Expand' };
}

private structPointerHeaderHtml(
    ctx: StructRenderContext,
    row: DecodedField,
    key: string,
    name: string,
    target: PointerDerefTarget,
    isOpen: boolean,
): string {
    const storageStart = ctx.baseAddr + row.byteOffset;
    const valKey = this.fieldValueKey(row, storageStart);
    return (
        this.structPointerHeaderOpenTag(ctx, row, target, key, storageStart, valKey) +
        this.structPointerHeaderPrefixHtml(row, ctx.hideOffsets) +
        `<button class="si-arr-exp-btn">${isOpen ? '▾' : '▸'}</button>` +
        this.structPointerHeaderBodyHtml(row, target, name, storageStart, valKey) +
        `</div>`
    );
}

private structPointerHeaderPrefixHtml(row: DecodedField, hideOffset: boolean): string {
    const byteCount = this.decodedRowByteCount(row);
    const abbrev = this.fieldTypeAbbrev(row, byteCount);
    const fullTypeLabel = this.fieldFullTypeLabel(row, byteCount);
    const offsetHtml = hideOffset
        ? '<span class="si-node-pad" aria-hidden="true"></span>'
        : `<span class="si-f-off">${this.offsetLabel(row.byteOffset)}</span>`;
    return offsetHtml + this.typeCellHtml(abbrev, fullTypeLabel);
}

private structPointerHeaderOpenTag(
    ctx: StructRenderContext,
    row: DecodedField,
    target: PointerDerefTarget,
    key: string,
    storageStart: number,
    valKey: string,
): string {
    const targetCnt = target.ok ? target.byteCount : 0;
    return this.structPointerOpenTag(ctx, row, target, key, storageStart, valKey, 'si-arr-grp-hdr si-ptr-hdr si-ptr-field', targetCnt);
}

private structPointerOpenTag(
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
    const byteCount = this.decodedRowByteCount(row);
    return `<div class="${className}" data-byte-start="${storageStart}" data-byte-cnt="${byteCount}" ` +
        `data-offset-label="${this.offsetLabel(row.byteOffset)}" data-pointer-storage-start="${storageStart}" data-val-key="${esc(valKey)}"` +
        ` data-pointer-target-start="${targetStart}" data-pointer-target-cnt="${targetCnt}"` +
        ` data-pointer-allow-create="false"` +
        this.sourceContextDataAttrs(ctx) +
        ` data-arr-key="${esc(key)}">`;
}

private structPointerHeaderBodyHtml(
    row: DecodedField,
    target: PointerDerefTarget,
    name: string,
    storageStart: number,
    valKey: string,
): string {
    return `<span class="si-f-body">` +
        `<span class="si-f-name">${esc(name)}</span>` +
        `<span class="si-f-lead"></span>` +
        `<span class="si-f-val si-f-pri si-f-ptr" data-val-type="hex" data-bs="${storageStart}" data-val-key="${esc(valKey)}">${this.pointerValueDisplayHtml(row, target)}</span>` +
        `</span>`;
}

private pointerValueDisplayHtml(row: DecodedField, target: PointerDerefTarget): string {
    const addr = target.addr ?? 0;
    const addrHtml = formatHexHtml(formatHex(addr, 8));
    return target.ok ? `<span class="si-f-ptr-sym">→</span> ${addrHtml}` : this.pointerStatusAddressHtml(target, addrHtml);
}

private pointerStatusAddressHtml(target: Extract<PointerDerefTarget, { ok: false }>, addrHtml: string): string {
    return `<span class="si-f-ptr-note">(${esc(target.reason)})</span> ${addrHtml}`;
}

private structPointerBodyHtml(ctx: StructRenderContext, row: DecodedField, child: PointerChildState): string {
    return (
        `<div class="si-arr-grp${child.isOpen ? ' open' : ''}" data-arr-key="${esc(child.key)}">` +
        this.pointerChildHeaderHtml(ctx, row, child) +
        `<div class="si-arr-grp-body"${child.isOpen ? '' : ' style=\"display:none\"'}>${child.bodyHtml}</div>` +
        `</div>`
    );
}

private pointerChildHeaderHtml(ctx: StructRenderContext, row: DecodedField, child: PointerChildState): string {
    const storageStart = child.storageStart;
    const disabled = child.canExpand ? '' : ' disabled';
    return `<div class="si-arr-grp-hdr si-ptr-child-hdr si-ptr-field" data-byte-start="${child.byteStart}" data-byte-cnt="${child.byteCount}" ` +
        `data-pointer-storage-start="${storageStart}" data-val-key="${esc(child.valKey)}" data-pointer-allow-create="${child.allowCreate ? 'true' : 'false'}"` +
        this.sourceContextDataAttrs(ctx) +
        ` data-arr-key="${esc(child.key)}">` +
        this.compositeHeaderPrefixHtml(child.isOpen, row.byteOffset, true) +
        `<button class="si-arr-exp-btn"${disabled} title="${esc(child.expandTitle)}">${child.isOpen ? '▾' : '▸'}</button>` +
        `<span class="si-f-body">` +
        `<span class="si-f-name">${esc(child.name)}</span>` +
        `<span class="si-f-lead"></span>` +
        `<span class="si-arr-addr" title="${esc(child.summaryTitle)}">${esc(child.summary)}</span>` +
        `</span>` +
        `</div>`;
}

private structPointerTargetBodyHtml(
    ctx: StructRenderContext,
    row: DecodedField,
    target: Extract<PointerDerefTarget, { ok: true }>,
    childKey: string,
): string {
    if (!target.def) { return this.scalarPointerTargetFieldHtml(ctx, row, target); }
    const child = this.pointerChildState(ctx, row, target, childKey);
    return this.structPointerBodyHtml(ctx, row, child);
}

private scalarPointerTargetFieldHtml(
    ctx: StructRenderContext,
    row: DecodedField,
    target: Extract<PointerDerefTarget, { ok: true }>,
): string {
    const targetRow = this.scalarPointerTargetDecodedRow(row, target.addr);
    return targetRow ? this.mkFieldRow(targetRow, target.addr, target.byteCount, this.scalarPointerTargetContext(ctx, target), '*') : '';
}

private scalarPointerTargetDecodedRow(row: DecodedField, addr: number): DecodedField | null {
    const targetType = this.scalarPointerTargetType(row);
    if (!targetType || targetType === 'void') { return null; }
    const bytes = this.readScalarPointerTargetBytes(row, targetType, addr);
    return bytes ? this.scalarPointerTargetRow(row, targetType, bytes) : null;
}

private scalarPointerTargetContext(
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

private renderStructPointerBody(
    ctx: StructRenderContext,
    key: string,
    target: { ok: true; addr: number; byteCount: number; def: StructDef },
): string {
    const rows = decodeStruct(target.def, target.addr, this.cb.readByte, this._endian, this._bitFieldAllocation, this._structs);
    return this.renderStructFieldGroups({
        def: target.def,
        pin: ctx.pin,
        baseAddr: target.addr,
        keyPrefix: key,
        pointerDepth: ctx.pointerDepth + 1,
        hideOffsets: false,
    }, rows);
}

private renderStructFieldBody(
    ctx: StructRenderContext,
    group: RenderBodyGroup,
): string {
    const rule = this.bodyRuleFor(group);
    return rule ? rule(ctx, group) : '';
}

private instanceTypePreviewHtml(def: StructDef | undefined, pin: StructPin): string {
    return def
        ? `<div class="si-type-preview"${this._previewedPins.has(pin.id) ? '' : ' style="display:none"'}>` +
                    `<pre class="si-c-preview" data-struct-preview-id="${esc(def.id)}"></pre>` +
          `</div>`
        : '';
}

private instanceEditFormHtml(pin: StructPin): string {
    if (this._editingPinId !== pin.id) { return ''; }

    const draftStructId = this._editingPinDraftStructId ?? pin.structId;
    const addrHex = pin.addr.toString(16).toUpperCase().padStart(8, '0');
    const structOpts = allStructs(this._structs).map(d =>
        `<option value="${esc(d.id)}"${d.id === draftStructId ? ' selected' : ''}>${esc(d.name)}</option>`
    ).join('');
    const editDef = allStructs(this._structs).find(d => d.id === draftStructId);
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

private instanceBodyHtml(def: StructDef | undefined, pin: StructPin, expanded: boolean): string {
    return expanded && def ? this.renderStructBody(def, pin) : '';
}

private instanceActionsHtml(def: StructDef | undefined, pin: StructPin, index: number): string {
    if (def) {
        return actionBtnsHtml(`data-pin-id="${esc(pin.id)}"`, `data-idx="${index}"`);
    }
    return `<span class="act-btn act-btn-del" data-idx="${index}" title="Delete">&#128465;&#xFE0E;</span>`;
}

private instanceHeaderHtml(
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
        `<button class="si-type-btn${this._previewedPins.has(pin.id) ? ' active' : ''}" ` +
        `data-pin-id="${esc(pin.id)}" title="View type definition">{&nbsp;}</button>` +
        `<span class="si-caddr">0x${addrHex}\u202f\u00b7\u202f${totalBytes}B</span>` +
        `</div>` +
        this.pointerSourceSubtitleHtml(pin) +
        `</div>` +
        `<div class="si-card-actions">` +
        this.instanceActionsHtml(def, pin, index) +
        `</div>` +
        `</div>`
    );
}

private instanceContentHtml(pin: StructPin, editFormHtml: string, typePreviewHtml: string, bodyHtml: string): string {
    return this._editingPinId === pin.id ? editFormHtml : editFormHtml + typePreviewHtml + bodyHtml;
}

private buildInstanceCard(pin: StructPin, i: number): string {
    const def        = allStructs(this._structs).find(d => d.id === pin.structId);
    const defName    = def ? def.name : '?';
    const totalBytes = def ? structByteSize(def, this._structs) : 0;
    const addrHex    = pin.addr.toString(16).toUpperCase().padStart(8, '0');
    const expanded   = this._expanded.has(pin.id);

    const bodyHtml = this.instanceBodyHtml(def, pin, expanded);
    const typePreviewHtml = this.instanceTypePreviewHtml(def, pin);
    const editFormHtml = this.instanceEditFormHtml(pin);

    return (
        `<div class="si-card${expanded ? ' si-expanded' : ''}" data-pin-id="${esc(pin.id)}" data-idx="${i}">` +
        this.instanceHeaderHtml(pin, i, def, defName, totalBytes, addrHex, expanded) +
        this.instanceContentHtml(pin, editFormHtml, typePreviewHtml, bodyHtml) +
        `</div>`
    );
}

private clearArrSep(): void {
    this.cb.onClearHighlightHex?.('struct-arr-sep');
    this._arrSepAddrs.length = 0;
}

private clearSelRow(): void {
    this._root?.querySelectorAll<HTMLElement>('.si-selected')
        .forEach(el => el.classList.remove('si-selected'));
}

private setTreeLevel(el: HTMLElement, level: number): void {
    el.style.setProperty('--si-level', String(level));
}

private asHtml(el: Element | null): HTMLElement | null {
    if (!el) { return null; }
    const candidate = el as HTMLElement;
    return typeof candidate.classList !== 'undefined' ? candidate : null;
}

private firstDirectChildByClass(parent: HTMLElement, cls: string): HTMLElement | null {
    for (const child of Array.from(parent.children)) {
        const htmlChild = this.asHtml(child);
        if (htmlChild && htmlChild.classList.contains(cls)) {
            return htmlChild;
        }
    }
    return null;
}

private applyTreeDepthStyles(sec: HTMLElement): void {
    sec.querySelectorAll<HTMLElement>('.si-fields').forEach(fields => {
        this.annotateTreeBody(fields, 0);
    });
}

private annotateTreeBody(body: HTMLElement, level: number): void {
    this.setTreeLevel(body, level);
    for (const child of Array.from(body.children)) {
        const htmlChild = this.asHtml(child);
        if (htmlChild) { this.annotateTreeChild(htmlChild, level); }
    }
}

private annotateTreeChild(child: HTMLElement, level: number): void {
    if (child.classList.contains('si-field')) {
        this.setTreeLevel(child, level);
        return;
    }
    if (child.classList.contains('si-arr-grp')) {
        this.annotateCompositeTreeChild(child, level, 'si-arr-grp-hdr', 'si-arr-grp-body');
        return;
    }
    if (child.classList.contains('si-arr-el-grp')) {
        this.annotateCompositeTreeChild(child, level, 'si-arr-el-hdr', 'si-arr-el-body');
    }
}

private annotateCompositeTreeChild(child: HTMLElement, level: number, headerClass: string, bodyClass: string): void {
    const hdr = this.firstDirectChildByClass(child, headerClass);
    if (hdr) { this.setTreeLevel(hdr, level); }
    const body = this.firstDirectChildByClass(child, bodyClass);
    if (body) { this.annotateTreeBody(body, level + 1); }
}

private wireInstanceCards(sec: HTMLElement): void {
    this.applyTreeDepthStyles(sec);

    // Keep bit hover highlight strictly tied to the current pointer target.
    sec.onmousemove = (ev: MouseEvent) => {
        this.updateHoveredBitRow(ev, sec);
    };
    sec.onmouseleave = () => {
        if (this._hoveredBitRange !== null || this._hoveredBitRowKey !== null) {
            this._hoveredBitRange = null;
            this._hoveredBitRowKey = null;
            this.applyBitHighlightsInPlace(sec);
        }
    };

    sec.querySelectorAll<HTMLElement>('.si-expand-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.pinId!;
            if (this._expanded.has(id)) { this._expanded.delete(id); } else { this._expanded.add(id); }
            this.render();
        });
    });

    // Array group: arrow button toggles expand; rest of row selects in hex view
    sec.querySelectorAll<HTMLElement>('.si-arr-grp-hdr').forEach(hdr => {
        const expBtn = hdr.querySelector<HTMLElement>('.si-arr-exp-btn');
        const start  = parseInt(hdr.dataset.byteStart!);
        const cnt    = parseInt(hdr.dataset.byteCnt!);
        const isBitUnitHdr = hdr.classList.contains('si-bitunit-hdr');
        const isPointerHdr = hdr.classList.contains('si-ptr-hdr') || hdr.classList.contains('si-ptr-child-hdr');

        if (expBtn) {
            expBtn.addEventListener('click', e => {
                e.stopPropagation();
                if ((expBtn as HTMLButtonElement).disabled) { return; }
                this.toggleCompositeGroup(hdr, expBtn, '.si-arr-grp', '.si-arr-grp-body', 'arrKey', this._expandedArrayFields);
            });
        }

        hdr.querySelector<HTMLElement>('.si-f-ptr')?.addEventListener('click', e => {
            e.stopPropagation();
            this.followPointerHeaderValue(hdr);
        });

        this.wireStructHoverRange(hdr, start, cnt);

        hdr.addEventListener('click', e => {
            if (isPointerHdr) {
                this.selectPointerHeaderRange(e, hdr, start, cnt);
                return;
            }
            this.selectArrayGroupHeader(e, hdr, start, cnt, isBitUnitHdr);
        });
    });

    // Nested element: arrow toggles expand; row selects that element range.
    sec.querySelectorAll<HTMLElement>('.si-arr-el-hdr').forEach(hdr => {
        const expBtn = hdr.querySelector<HTMLElement>('.si-arr-el-exp-btn')!;
        const start  = parseInt(hdr.dataset.byteStart!);
        const cnt    = parseInt(hdr.dataset.byteCnt!);

        expBtn.addEventListener('click', e => {
            e.stopPropagation();
            this.toggleCompositeGroup(hdr, expBtn, '.si-arr-el-grp', '.si-arr-el-body', 'arrElKey', this._expandedArrayElements);
        });

        this.wireStructHoverRange(hdr, start, cnt);

        hdr.addEventListener('click', e => {
            if ((e.target as HTMLElement).closest('.si-arr-el-exp-btn')) { return; }
            this.clearStructSelectionVisuals();
            if (isNaN(start) || isNaN(cnt)) { return; }
            this._selectedArrElemKey = hdr.dataset.arrElKey!;
            this._selectedArrKey = null;
            this._selectedFieldAddr = null;
            this.selectStructRange(hdr, start, cnt);
        });
    });

    sec.querySelectorAll<HTMLElement>('.si-card-hdr').forEach(hdr => {
        hdr.addEventListener('click', e => this.onCardHeaderClick(sec, hdr, e));
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
                this._editingPinId = btn.dataset.pinId!;
                const editedPin = this._pins.find(p => p.id === this._editingPinId);
                this._editingPinDraftStructId = editedPin?.structId ?? null;
                this._expanded.delete(this._editingPinId);
                this.render();
            },
            btn => {
                const idx = parseInt(btn.dataset.idx!);
                const pin = this._pins[idx];
                if (pin) { this._expanded.delete(pin.id); }
                this._pins = withoutStructPin(this._pins, idx);
                this.cb.onPinsChange?.(this._pins);
                this.render();
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
            const addrs: number[] = [];
            for (let i = 0; i < cnt; i++) { addrs.push(start + i); }
            this.cb.onHighlightHex?.(addrs, 'struct-h');
        });

        row.addEventListener('mouseleave', () => {
            if (isBitRow) { return; }
            this.cb.onClearHighlightHex?.('struct-h');
        });

        row.addEventListener('click', () => {
            if (isNaN(start) || isNaN(cnt)) { return; }
            if (isBitRow) {
                this.selectBitRow(row, sec);
                return;
            }
            this.selectStructFieldRow(row, start, cnt);
        });

        row.querySelector<HTMLElement>('.si-f-ptr')?.addEventListener('click', ev => {
            ev.stopPropagation();
            const card = row.closest<HTMLElement>('.si-card');
            const pinIdx = card ? parseInt(card.dataset.idx!) : -1;
            const valKey = row.dataset.valKey ?? this.scalarValKey(start);
            this.followPointerAt(start, pinIdx, valKey, this.sourceContextOptions(row));
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
            const valKey = row.dataset.valKey ?? this.scalarValKey(start);
            this.showFieldValMenu(ev.clientX, ev.clientY, start, undefined, pinIdx, {
                isPointer,
                isBitUnitHeader,
                valKey,
                ...this.sourceContextOptions(row),
            });
        });
    });

    // Right-click on an array group header should allow actions on the
    // entire group (child elements).
    sec.querySelectorAll<HTMLElement>('.si-arr-grp-hdr').forEach(hdr => {
        hdr.addEventListener('contextmenu', ev => {
            if (hdr.classList.contains('si-ptr-hdr') || hdr.classList.contains('si-ptr-child-hdr')) {
                this.openPointerHeaderValueMenu(ev, hdr);
                return;
            }
            this.openArrayHeaderValueMenu(ev, hdr);
        });
    });

    this.wireTypePreviewButtons(sec);
    this.wirePinEditForm(sec);

    this.applyBitHighlightsInPlace(sec);
    this.restoreStructSelection(sec);
}

private onCardHeaderClick(sec: HTMLElement, hdr: HTMLElement, e: Event): void {
    if ((e.target as HTMLElement).closest('.si-expand-btn, .si-card-actions, .si-type-btn')) { return; }
    this.clearArrSep();
    this.clearSelRow();
    this._selectedBitRange = null;
    this._hoveredBitRange = null;
    this._selectedBitRowKey = null;
    this._hoveredBitRowKey = null;
    this._selectedFieldAddr = null;
    this._selectedArrKey    = null;
    this._selectedArrElemKey = null;
    const sel = this.cardSelection(hdr);
    if (!sel) { return; }
    const size = structByteSize(sel.def, this._structs);
    this._activeStructAddr = sel.pin.addr;
    this._selectedPinId = sel.pin.id;
    sec.querySelectorAll<HTMLElement>('.si-card').forEach(c => c.classList.remove('si-card-selected'));
    sel.card.classList.add('si-card-selected');
    this.cb.onSelectRange?.(sel.pin.addr, size);
}

private cardSelection(hdr: HTMLElement): { card: HTMLElement; pin: StructPin; def: StructDef } | null {
    const card = hdr.closest<HTMLElement>('.si-card');
    if (!card) { return null; }
    const idx = parseInt(card.dataset.idx!);
    const pin = this._pins[idx];
    if (!pin) { return null; }
    const def = allStructs(this._structs).find(d => d.id === pin.structId);
    if (!def) { return null; }
    return { card, pin, def };
}

private wireTypePreviewButtons(sec: HTMLElement): void {
    sec.querySelectorAll<HTMLElement>('.si-type-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            this.toggleTypePreview(btn);
        });
    });
}

private toggleTypePreview(btn: HTMLElement): void {
    const id = btn.dataset.pinId!;
    const card = btn.closest<HTMLElement>('.si-card')!;
    const preview = card.querySelector<HTMLElement>('.si-type-preview');
    const isOpen = this._previewedPins.has(id);
    this.setTypePreviewOpen(id, btn, preview, !isOpen);
}

private setTypePreviewOpen(id: string, btn: HTMLElement, preview: HTMLElement | null, isOpen: boolean): void {
    if (isOpen) { this._previewedPins.add(id); }
    else { this._previewedPins.delete(id); }
    btn.classList.toggle('active', isOpen);
    if (preview) { preview.style.display = isOpen ? '' : 'none'; }
}

private wirePinEditForm(sec: HTMLElement): void {
    if (!this._editingPinId) { return; }
    const editForm = sec.querySelector<HTMLElement>('.si-pin-edit-form');
    if (!editForm) { return; }

    const pinId = this._editingPinId;
    editForm.querySelector<HTMLSelectElement>('.si-pe-type')?.addEventListener('change', e => {
        this._editingPinDraftStructId = (e.target as HTMLSelectElement).value || null;
        this.render();
    });
    editForm.querySelector<HTMLElement>('.si-pe-save')!.addEventListener('click', e => {
        e.stopPropagation();
        this.savePinEditForm(editForm, pinId);
    });
    editForm.querySelector<HTMLElement>('.si-pe-cancel')!.addEventListener('click', e => {
        e.stopPropagation();
        this.closePinEditForm();
        this.render();
    });
}

private savePinEditForm(editForm: HTMLElement, pinId: string): void {
    const addr = this.readPinEditAddress(editForm);
    if (addr === null) { return; }
    const idx = this._pins.findIndex(p => p.id === pinId);
    if (idx >= 0) { this.applyPinEdit(editForm, idx, addr); }
    this.closePinEditForm();
    this.render();
}

private readPinEditAddress(editForm: HTMLElement): number | null {
    const addrInput = editForm.querySelector('.si-pe-addr') as HTMLInputElement;
    const addr = parseStructPinAddressInput(addrInput.value);
    if (addr !== null) { addrInput.style.borderColor = ''; return addr; }
    addrInput.style.borderColor = 'var(--err)';
    return null;
}

private applyPinEdit(editForm: HTMLElement, idx: number, addr: number): void {
    const pin = this._pins[idx];
    const nameVal = (editForm.querySelector('.si-pe-name') as HTMLInputElement).value.trim();
    const typeVal = (editForm.querySelector('.si-pe-type') as HTMLSelectElement).value;
    this._pins = withEditedStructPin(this._pins, idx, { name: nameVal || pin.name, addr, structId: typeVal });
    this._activeStructAddr = addr;
    this.cb.onPinsChange?.(this._pins);
}

private closePinEditForm(): void {
    this._editingPinId = null;
    this._editingPinDraftStructId = null;
}

private restoreStructSelection(sec: HTMLElement): void {
    this.restoreSelectedPin(sec);
    this.restoreSelectedValueRow(sec);
}

private restoreSelectedPin(sec: HTMLElement): void {
    if (this._selectedPinId === null) { return; }
    sec.querySelectorAll<HTMLElement>('.si-card').forEach(card => {
        if (card.dataset.pinId === this._selectedPinId) {
            card.classList.add('si-card-selected');
        }
    });
}

private restoreSelectedValueRow(sec: HTMLElement): void {
    if (this.restoreSelectedBitRow(sec)) { return; }
    if (this.restoreSelectedFieldRow(sec)) { return; }
    if (this.restoreSelectedArrayElement(sec)) { return; }
    this.restoreSelectedArrayGroup(sec);
}

private restoreSelectedBitRow(sec: HTMLElement): boolean {
    if (this._selectedBitRowKey === null) { return false; }
    sec.querySelectorAll<HTMLElement>('.si-field[data-bit-start][data-bit-width]').forEach(row => {
        const meta = this.parseBitRowMeta(row);
        if (!meta) { return; }
        const key = this.makeBitRowKey(meta.byteStart, meta.bitStart, meta.bitWidth);
        if (key === this._selectedBitRowKey) {
            row.classList.add('si-selected');
        }
    });
    return true;
}

private restoreSelectedFieldRow(sec: HTMLElement): boolean {
    if (this._selectedFieldAddr === null) { return false; }
    sec.querySelectorAll<HTMLElement>('.si-field').forEach(row => {
        if (parseInt(row.dataset.byteStart!) === this._selectedFieldAddr) {
            row.classList.add('si-selected');
        }
    });
    return true;
}

private restoreSelectedArrayElement(sec: HTMLElement): boolean {
    if (this._selectedArrElemKey === null) { return false; }
    sec.querySelectorAll<HTMLElement>('.si-arr-el-hdr').forEach(hdr => {
        if (hdr.dataset.arrElKey === this._selectedArrElemKey) {
            hdr.classList.add('si-selected');
        }
    });
    return true;
}

private restoreSelectedArrayGroup(sec: HTMLElement): void {
    if (this._selectedArrKey === null) { return; }
    sec.querySelectorAll<HTMLElement>('.si-arr-grp-hdr').forEach(hdr => {
        const grp = hdr.closest<HTMLElement>('.si-arr-grp');
        if (grp?.dataset.arrKey === this._selectedArrKey) {
            hdr.classList.add('si-selected');
        }
    });
}
// Floating per-field value-type menu

private hideFieldValMenu = (): void => {
    if (this._valMenuEl) { this._valMenuEl.remove(); this._valMenuEl = null; }
    if (typeof document === 'undefined') { return; }
    document.removeEventListener('click', this.hideFieldValMenu);
};

private addFieldValMenuClickAway(): void {
    setTimeout(() => {
        if (typeof document === 'undefined') { return; }
        document.addEventListener('click', this.hideFieldValMenu);
    }, 0);
}

private createFieldValMenu(innerHtml: string, x: number, y: number): HTMLElement {
    const el = document.createElement('div');
    el.id = 'si-val-menu'; el.className = 'si-val-menu ctx-menu';
    el.innerHTML = innerHtml;
    document.body.appendChild(el);
    positionContextMenu(el, x, y);
    return el;
}

private wireFieldValMenuCommands(el: HTMLElement, onCommand: (cmd: string) => void): void {
    el.querySelectorAll<HTMLElement>('.ctx-row[data-cmd]:not(.disabled)').forEach(row => {
        row.addEventListener('click', ev => {
            ev.stopPropagation();
            onCommand(row.dataset.cmd!);
        });
    });
}

private structPinAtAddress(addr: number, pinIdx: number | undefined, allDefs: StructDef[]): StructPin | undefined {
    if (typeof pinIdx === 'number' && pinIdx >= 0) { return this._pins[pinIdx]; }
    return this._pins.find(pin => {
        const def = allDefs.find(candidate => candidate.id === pin.structId);
        if (!def) { return false; }
        const size = structByteSize(def, this._structs);
        return addr >= pin.addr && addr < pin.addr + size;
    });
}

private structRowsAtAddress(addr: number, pinIdx: number | undefined, allDefs: StructDef[]): DecodedField[] {
    const pin = this.structPinAtAddress(addr, pinIdx, allDefs);
    if (!pin) { return []; }
    const def = allDefs.find(candidate => candidate.id === pin.structId);
    if (!def) { return []; }
    const rows = decodeStruct(def, pin.addr, this.cb.readByte, this._endian, this._bitFieldAllocation, this._structs);
    return rows.filter(row => pin.addr + row.byteOffset === addr);
}

private sourceRowsAtAddress(
    addr: number,
    pinIdx: number | undefined,
    opts: FieldValMenuOptions,
    allDefs: StructDef[],
): DecodedField[] {
    const source = this.findCopySourceRows(addr, pinIdx, opts);
    return source
        ? source.rows.filter(row => source.baseAddr + row.byteOffset === addr)
        : this.structRowsAtAddress(addr, pinIdx, allDefs);
}

private parseBitValueKey(valKey: string): { bitStart: number; bitWidth: number } | null {
    const parts = valKey.split(':');
    const bitStart = this.parseDatasetInt(parts[2]);
    if (bitStart === null) { return null; }
    const bitWidth = this.parseDatasetInt(parts[3]);
    if (bitWidth === null) { return null; }
    return { bitStart, bitWidth };
}

private matchesBitValueKey(row: DecodedField, key: { bitStart: number; bitWidth: number }): boolean {
    if (!this.isBitFieldRow(row)) { return false; }
    if (row.bitOffset !== key.bitStart) { return false; }
    return row.bitWidth === key.bitWidth;
}

private findBitFieldForValueKey(rows: DecodedField[], valKey: string): DecodedField | undefined {
    const key = this.parseBitValueKey(valKey);
    return key ? rows.find(row => this.matchesBitValueKey(row, key)) : undefined;
}



private valueKeyKind(valKey?: string): ValueKeyKind {
    if (valKey?.startsWith('bitunit:')) { return 'bitunit'; }
    if (valKey?.startsWith('bit:')) { return 'bit'; }
    return 'default';
}

private firstValueKeyField(rows: DecodedField[]): DecodedField | null {
    return rows[0] ?? null;
}

private bitUnitValueKeyField(rows: DecodedField[]): DecodedField | null {
    return this.buildBitUnitAggregateRow(rows.filter(r => this.isBitFieldRow(r)));
}

private bitValueKeyField(rows: DecodedField[], valKey?: string): DecodedField | null {
    return valKey ? (this.findBitFieldForValueKey(rows, valKey) ?? this.firstValueKeyField(rows)) : this.firstValueKeyField(rows);
}

private readonly VALUE_KEY_FIELD: Record<ValueKeyKind, (rows: DecodedField[], valKey?: string) => DecodedField | null> = {
    default: rows => this.firstValueKeyField(rows),
    bit: (rows, valKey) => this.bitValueKeyField(rows, valKey),
    bitunit: rows => this.bitUnitValueKeyField(rows),
};

private findFieldForValueKey(rows: DecodedField[], addr: number, valKey?: string): DecodedField | null {
    const atAddr = rows.filter(row => row.byteOffset === addr);
    return this.VALUE_KEY_FIELD[this.valueKeyKind(valKey)](atAddr, valKey);
}

private handleArrayHeaderMenuCommand(
    cmd: string,
    bs: number,
    bsList: number[] | undefined,
    keyList: string[] | undefined,
    findFieldAt: (addr: number) => DecodedField | null,
): void {
    if (cmd === 'copy-addr') {
        this.copyAddressToClipboard(bs);
        return;
    }
    if (!cmd.startsWith('disp-')) { return; }
    if (!this.hasValueRows(bsList)) { return; }
    this.applyArrayHeaderDisplayType(cmd.replace('disp-', '') as ColType, bsList, keyList, findFieldAt);
    this.hideFieldValMenu();
    this.render();
}

private copyAddressToClipboard(bs: number): void {
    this.copyTextToClipboard(`0x${bs.toString(16).toUpperCase().padStart(8, '0')}`);
    this.hideFieldValMenu();
}

private hasValueRows(bsList: number[] | undefined): bsList is number[] {
    return Boolean(bsList && bsList.length > 0);
}

private applyArrayHeaderDisplayType(
    t: ColType,
    bsList: number[],
    keyList: string[] | undefined,
    findFieldAt: (addr: number) => DecodedField | null,
): void {
    bsList.forEach((b, idx) => {
        this.setArrayHeaderDisplayType(t, b, keyList?.[idx], findFieldAt);
    });
}

private setArrayHeaderDisplayType(
    t: ColType,
    byteStart: number,
    keyOverride: string | undefined,
    findFieldAt: (addr: number) => DecodedField | null,
): void {
    const listKey = keyOverride ?? this.scalarValKey(byteStart);
    const field = findFieldAt(byteStart);
    const implicit = this.implicitDisplayType(field, listKey.startsWith('bitunit:'));
    if (t === implicit) { this._fieldValTypes.delete(listKey); }
    else { this._fieldValTypes.set(listKey, t); }
}

private updateHoveredBitRow(ev: MouseEvent, sec: HTMLElement): void {
    const target = ev.target as HTMLElement | null;
    const bitRow = target?.closest<HTMLElement>('.si-field[data-bit-start][data-bit-width]') ?? null;
    const hover = this.bitRowHoverState(bitRow);
    if (this._hoveredBitRowKey === hover.key) { return; }
    this._hoveredBitRange = hover.range;
    this._hoveredBitRowKey = hover.key;
    this.applyBitHighlightsInPlace(sec);
}

private bitRowHoverState(bitRow: HTMLElement | null): { range: { parentByteStart: number; startBit: number; endBit: number } | null; key: string | null } {
    if (!bitRow) { return { range: null, key: null }; }
    const meta = this.parseBitRowMeta(bitRow);
    if (!meta) { return { range: null, key: null }; }
    return this.bitSelectionState(meta);
}

private bitSelectionState(meta: { byteStart: number; bitStart: number; bitWidth: number }): { range: { parentByteStart: number; startBit: number; endBit: number }; key: string } {
    return {
        range: { parentByteStart: meta.byteStart, startBit: meta.bitStart, endBit: meta.bitStart + meta.bitWidth - 1 },
        key: this.makeBitRowKey(meta.byteStart, meta.bitStart, meta.bitWidth),
    };
}

private selectBitRow(row: HTMLElement, sec: HTMLElement): void {
    this.applyBitRowSelection(this.parseBitRowMeta(row));
    this.clearFieldSelectionState();
    this.clearSelRow();
    row.classList.add('si-selected');
    this.applyBitHighlightsInPlace(sec);
}

private applyBitRowSelection(meta: ReturnType<typeof this.parseBitRowMeta>): void {
    if (!meta) {
        this._selectedBitRange = null;
        this._selectedBitRowKey = null;
        return;
    }
    const state = this.bitSelectionState(meta);
    this._selectedBitRange = state.range;
    this._selectedBitRowKey = state.key;
}

private clearFieldSelectionState(): void {
    this._hoveredBitRange = null;
    this._hoveredBitRowKey = null;
    this._selectedFieldAddr = null;
    this._selectedArrKey = null;
    this._selectedArrElemKey = null;
}

private selectStructFieldRow(row: HTMLElement, start: number, cnt: number): void {
    this.clearArrSep();
    this.clearSelRow();
    this.clearBitSelectionState();
    row.classList.add('si-selected');
    this._selectedFieldAddr = start;
    this._selectedArrKey = null;
    this._selectedArrElemKey = null;
    this.cb.onSelectRange?.(start, cnt);
    this.render();
}

private clearBitSelectionState(): void {
    this._selectedBitRange = null;
    this._hoveredBitRange = null;
    this._selectedBitRowKey = null;
    this._hoveredBitRowKey = null;
}

private selectArrayGroupHeader(e: MouseEvent, hdr: HTMLElement, start: number, cnt: number, isBitUnitHdr: boolean): void {
    if (this.shouldSkipArrayGroupClick(e, isBitUnitHdr)) { return; }
    this.clearStructSelectionVisuals();
    if (this.hasInvalidRange(start, cnt)) { return; }
    const grp = hdr.closest<HTMLElement>('.si-arr-grp')!;
    this._selectedArrKey = grp.dataset.arrKey!;
    this._selectedArrElemKey = null;
    this._selectedFieldAddr = null;
    this.markArraySeparators(this.arrayGroupSeparatorRows(grp));
    this.selectStructRange(hdr, start, cnt);
}

private shouldSkipArrayGroupClick(e: MouseEvent, isBitUnitHdr: boolean): boolean {
    return isBitUnitHdr || Boolean((e.target as HTMLElement).closest('.si-arr-exp-btn'));
}

private hasInvalidRange(start: number, cnt: number): boolean {
    return isNaN(start) || isNaN(cnt);
}

private selectPointerHeaderRange(e: MouseEvent, hdr: HTMLElement, start: number, cnt: number): void {
    if ((e.target as HTMLElement).closest('.si-arr-exp-btn')) { return; }
    this.clearStructSelectionVisuals();
    if (this.hasInvalidRange(start, cnt)) { return; }
    this.selectStructRange(hdr, start, cnt);
}

private followPointerHeaderValue(hdr: HTMLElement): void {
    const storageStart = parseInt(hdr.dataset.pointerStorageStart ?? '');
    const pinIdx = this.pinIndexFromHeader(hdr);
    const valKey = hdr.dataset.valKey ?? this.scalarValKey(storageStart);
    this.followPointerAt(storageStart, pinIdx, valKey, this.sourceContextOptions(hdr));
}

private arrayGroupSeparatorRows(grp: HTMLElement): HTMLElement[] {
    const elementHeaders = Array.from(grp.querySelectorAll<HTMLElement>('.si-arr-el-hdr'));
    return elementHeaders.length > 0 ? elementHeaders : Array.from(grp.querySelectorAll<HTMLElement>('.si-field'));
}

private openArrayHeaderValueMenu(ev: MouseEvent, hdr: HTMLElement): void {
    if (hdr.classList.contains('si-bitunit-hdr')) { return; }
    ev.preventDefault();
    ev.stopPropagation();
    const directValueRows = this.directArrayHeaderValueRows(hdr);
    const bsList = directValueRows.map(r => this.rowByteStart(r));
    const start = bsList[0];
    if (start === undefined) { return; }
    const keyList = directValueRows.map(r => this.rowValueKey(r));
    const pinIdx = this.pinIndexFromHeader(hdr);
    this.showFieldValMenu(ev.clientX, ev.clientY, start, bsList, pinIdx, { isArrayHeader: true, keyList });
}

private openPointerHeaderValueMenu(ev: MouseEvent, hdr: HTMLElement): void {
    ev.preventDefault();
    ev.stopPropagation();
    const storageStart = parseInt(hdr.dataset.pointerStorageStart ?? '');
    if (isNaN(storageStart)) { return; }
    const pinIdx = this.pinIndexFromHeader(hdr);
    const valKey = hdr.dataset.valKey ?? this.scalarValKey(storageStart);
    this.showFieldValMenu(ev.clientX, ev.clientY, storageStart, undefined, pinIdx, {
        isPointer: true,
        valKey,
        pointerAllowCreate: hdr.dataset.pointerAllowCreate === 'true',
        ...this.sourceContextOptions(hdr),
    });
}

private directArrayHeaderValueRows(hdr: HTMLElement): HTMLElement[] {
    const body = this.arrayGroupBody(hdr);
    return body ? Array.from(body.children).flatMap(c => this.directValueRowsFromChild(c)) : [];
}

private arrayGroupBody(hdr: HTMLElement): HTMLElement | undefined {
    const grp = hdr.closest<HTMLElement>('.si-arr-grp')!;
    return Array.from(grp.children).find(c => this.isArrayGroupBody(c)) as HTMLElement | undefined;
}

private isArrayGroupBody(child: Element): boolean {
    return child.classList.contains('si-arr-grp-body');
}

private directValueRowsFromChild(child: Element): HTMLElement[] {
    const childEl = child as HTMLElement;
    if (childEl.classList.contains('si-field')) { return [childEl]; }
    if (childEl.classList.contains('si-arr-el-grp')) { return this.nestedValueHeaderRows(childEl); }
    return [];
}

private nestedValueHeaderRows(child: HTMLElement): HTMLElement[] {
    const hdr = Array.from(child.children).find(c => this.isNestedValueHeader(c)) as HTMLElement | undefined;
    return hdr ? [hdr] : [];
}

private isNestedValueHeader(child: Element): boolean {
    return child.classList.contains('si-arr-el-hdr') && child.classList.contains('si-field');
}

private rowByteStart(row: HTMLElement): number {
    return parseInt(row.dataset.byteStart!);
}

private rowValueKey(row: HTMLElement): string {
    return row.dataset.valKey ?? this.scalarValKey(this.rowByteStart(row));
}

private pinIndexFromHeader(hdr: HTMLElement): number {
    const card = hdr.closest<HTMLElement>('.si-card');
    return card ? parseInt(card.dataset.idx!) : -1;
}

private sourceContextOptions(el: HTMLElement): Pick<FieldValMenuOptions, 'sourceStructId' | 'sourceBaseAddr'> {
    const sourceStructId = el.dataset.sourceStructId;
    const sourceBaseAddr = this.parseOptionalInt(el.dataset.sourceBaseAddr);
    return sourceStructId && sourceBaseAddr !== undefined ? { sourceStructId, sourceBaseAddr } : {};
}

private parseOptionalInt(raw: string | undefined): number | undefined {
    if (raw === undefined) { return undefined; }
    const parsed = parseInt(raw);
    return isNaN(parsed) ? undefined : parsed;
}





private showFieldValMenu(
    x: number,
    y: number,
    bs: number,
    bsList?: number[],
    pinIdx?: number,
    opts: FieldValMenuOptions = {},
): void {
    this.hideFieldValMenu();
    const ctx = this.createFieldValMenuContext(bs, bsList, pinIdx, opts);

    if (opts.isArrayHeader) {
        this.showArrayHeaderFieldValMenu(ctx, x, y);
        return;
    }
    if (opts.isPointer) {
        this.showPointerFieldValMenu(ctx, x, y);
        return;
    }
    this.showScalarFieldValMenu(ctx, x, y);
}

private createFieldValMenuContext(
    bs: number,
    bsList: number[] | undefined,
    pinIdx: number | undefined,
    opts: FieldValMenuOptions,
): FieldValMenuContext {
    const allDefs = allStructs(this._structs);
    const findRowsAt = (addr: number): DecodedField[] => this.sourceRowsAtAddress(addr, pinIdx, opts, allDefs);
    const findFieldAt = (addr: number): DecodedField | null => findRowsAt(addr)[0] ?? null;
    const sampleField = findFieldAt(this.sampleAddress(bs, bsList));
    const key = opts.valKey ?? this.scalarValKey(bs);
    return {
        bs,
        bsList,
        pinIdx,
        opts,
        key,
        types: this.fieldValueMenuTypes(bs, bsList, opts, sampleField, findRowsAt),
        cur: this.currentFieldValueType(bs, bsList, opts, key, sampleField, findFieldAt),
        findFieldAt,
    };
}

private sampleAddress(bs: number, bsList: number[] | undefined): number {
    return bsList && bsList.length > 0 ? bsList[0] : bs;
}

private fieldValueMenuTypes(
    bs: number,
    bsList: number[] | undefined,
    opts: FieldValMenuOptions,
    sampleField: DecodedField | null,
    findRowsAt: (addr: number) => DecodedField[],
): ColType[] {
    if (opts.isBitUnitHeader) { return this.bitUnitMenuTypes([bs], findRowsAt); }
    if (this.arrayHeaderHasBitUnits(opts)) { return this.bitUnitMenuTypes(bsList ?? [bs], findRowsAt); }
    return this.sampleFieldValueTypes(sampleField);
}

private arrayHeaderHasBitUnits(opts: FieldValMenuOptions): boolean {
    return !!opts.isArrayHeader && (opts.keyList?.some(k => k.startsWith('bitunit:')) ?? false);
}

private bitUnitMenuTypes(addresses: number[], findRowsAt: (addr: number) => DecodedField[]): ColType[] {
    const hasPartialUnit = addresses.some(addr => !this.bitUnitUsesFullStorage(findRowsAt(addr)));
    return hasPartialUnit ? ['bin', 'bin-sliced', 'hex', 'dec'] : ['bin', 'hex', 'dec'];
}

private sampleFieldValueTypes(sampleField: DecodedField | null): ColType[] {
    if (!sampleField) { return ['hex', 'dec', 'bin', 'ascii']; }
    const typeMenu = SAMPLE_TYPE_MENUS[sampleField.type];
    if (typeMenu) { return typeMenu; }
    if (this.isBitFieldRow(sampleField)) { return ['bin', 'hex', 'dec']; }
    return ['hex', 'dec', 'bin', 'ascii'];
}

private currentFieldValueType(
    bs: number,
    bsList: number[] | undefined,
    opts: FieldValMenuOptions,
    key: string,
    sampleField: DecodedField | null,
    findFieldAt: (addr: number) => DecodedField | null,
): ColType | null {
    if (bsList && bsList.length > 0) {
        return this.commonFieldValueType(bsList, opts.keyList, findFieldAt);
    }
    const implicit = this.implicitDisplayType(sampleField, !!opts.isBitUnitHeader);
    return this._fieldValTypes.get(key) ?? implicit;
}

private commonFieldValueType(
    bsList: number[],
    keyList: string[] | undefined,
    findFieldAt: (addr: number) => DecodedField | null,
): ColType | null {
    const vals = bsList.map((b, idx) => {
        const listKey = keyList?.[idx] ?? this.scalarValKey(b);
        const field = findFieldAt(b);
        const implicit = this.implicitDisplayType(field, listKey.startsWith('bitunit:'));
        return this._fieldValTypes.get(listKey) ?? implicit;
    });
    return vals.every(v => v === vals[0]) ? vals[0] : null;
}

private menuItemHtml(cmd: string, label: string, hint = ''): string {
    return (
        `<div class="ctx-row" data-cmd="${cmd}">` +
        `<span class="ctx-label">${esc(label)}</span>` +
        (hint ? `<span class="ctx-hint">${esc(hint)}</span>` : '') +
        `</div>`
    );
}

private disabledMenuItemHtml(label: string, hint: string): string {
    return (
        `<div class="ctx-row disabled">` +
        `<span class="ctx-label">${esc(label)}</span>` +
        `<span class="ctx-hint">${esc(hint)}</span>` +
        `</div>`
    );
}

private pointerSourceSubtitleHtml(pin: StructPin): string {
    const source = pin.pointerSources?.[0];
    if (!source) { return ''; }
    const addr = formatHex(source.pointerStorageAddress, 8);
    return `<div class="si-csource">from ${esc(source.sourcePinName)}.${esc(source.sourceFieldPath)} @${esc(addr)}</div>`;
}

private menuSubHtml(label: string, id: string, body: string): string {
    return (
        `<div class="ctx-row ctx-has-sub" data-sub="${id}">` +
        `<span class="ctx-label">${esc(label)}</span>` +
        `<div class="ctx-submenu">${body}</div>` +
        `</div>`
    );
}

private menuSeparatorHtml(): string {
    return `<div class="ctx-sep"></div>`;
}

private displayMenuHtml(types: ColType[], cur: ColType | null): string {
    return types.map(t =>
        `<div class="ctx-row${t === cur ? ' active' : ''}" data-cmd="disp-${t}">` +
        `<span class="ctx-label">${TYPE_LABELS[t]}</span>` +
        `</div>`
    ).join('');
}

/** Build a View-as menu from a leading prefix block and route commands through onCommand. */
private createViewAsMenu(prefixHtml: string, x: number, y: number, ctx: FieldValMenuContext, onCommand: (cmd: string) => void): void {
    const el = this.createFieldValMenu(
        prefixHtml +
        this.menuSeparatorHtml() +
        this.menuSubHtml('View as', 'disp', this.displayMenuHtml(ctx.types, ctx.cur)),
        x,
        y,
    );
    this.wireFieldValMenuCommands(el, cmd => onCommand(cmd));
    this.finishFieldValMenu(el);
}

private showArrayHeaderFieldValMenu(ctx: FieldValMenuContext, x: number, y: number): void {
    this.createViewAsMenu(
        this.menuItemHtml('copy-addr', 'Copy address'),
        x,
        y,
        ctx,
        cmd => this.handleArrayHeaderMenuCommand(cmd, ctx.bs, ctx.bsList, ctx.opts.keyList, ctx.findFieldAt),
    );
}

private showPointerFieldValMenu(ctx: FieldValMenuContext, x: number, y: number): void {
    const source = this.pointerMenuSource(ctx);
    const row = source?.row ?? null;
    const el = this.createFieldValMenu(
        this.pointerMenuHtml(row, source, ctx.opts.pointerAllowCreate === true),
        x,
        y,
    );
    this.wireFieldValMenuCommands(el, cmd => this.handlePointerMenuCommand(cmd, ctx, row, source));
    this.finishFieldValMenu(el);
}

private pointerMenuHtml(row: DecodedField | null, source: PointerMenuSource | null, allowCreate: boolean): string {
    return this.menuItemHtml('copy-hex', 'Copy value') +
        this.menuSeparatorHtml() +
        this.pointerJumpMenuHtml(row) +
    (allowCreate ? this.pointerCreateMenuHtml(source) : '');
}

private pointerJumpMenuHtml(row: DecodedField | null): string {
    const jump = this.pointerFollowState(row);
    return jump.ok
        ? this.menuItemHtml('jump-ptr', 'Jump to Address')
        : this.disabledMenuItemHtml('Jump to Address', jump.reason);
}

private pointerCreateMenuHtml(source: PointerMenuSource | null): string {
    const create = this.structPointerCreateState(source);
    if (create === null) { return ''; }
    return create.ok
        ? this.menuItemHtml('create-struct-ptr', 'Create Struct Instance')
        : this.disabledMenuItemHtml('Create Struct Instance', create.reason);
}

private handlePointerMenuCommand(
    cmd: string,
    ctx: FieldValMenuContext,
    row: DecodedField | null,
    source: PointerMenuSource | null,
): void {
    if (cmd === 'jump-ptr') {
        this.followPointerRow(row);
        this.hideFieldValMenu();
        return;
    }
    if (cmd === 'create-struct-ptr') {
        this.createStructInstanceFromPointer(source);
        this.hideFieldValMenu();
        return;
    }
    this.copyPointerFieldValue(ctx);
}



private pointerMenuSource(ctx: FieldValMenuContext): PointerMenuSource | null {
    const source = this.findCopySourceRows(ctx.bs, ctx.pinIdx, ctx.opts);
    if (!source) { return null; }
    const row = this.findFieldForValueKey(source.rows, ctx.bs - source.baseAddr, ctx.opts.valKey);
    return row ? { pin: source.pin, row, sourceStructId: source.structId, sourceBaseAddr: source.baseAddr } : null;
}

private pointerMenuField(ctx: FieldValMenuContext): DecodedField | null {
    return this.pointerMenuSource(ctx)?.row ?? null;
}



private pointerFollowState(row: DecodedField | null): PointerFollowState {
    const reason = this.POINTER_FOLLOW_GUARDS.map(guard => guard(row)).find(Boolean);
    return reason ? { ok: false, reason } : { ok: true };
}


private readonly POINTER_FOLLOW_GUARDS: PointerFollowGuard[] = [
    row => row?.isPointer ? null : 'not pointer',
    row => row?.hasData && row.pointerValue !== undefined ? null : 'missing',
    row => row?.pointerValue === 0 ? 'null' : null,
    row => this.pointerTargetFullyMapped(row) ? null : 'unmapped',
];

private pointerTargetFullyMapped(row: DecodedField | null): boolean {
    const target = this.pointerMapTarget(row);
    if (!target) { return true; }
    return this.pointerTargetBytes(target.addr, target.byteCount).every(addr => this.cb.readByte(addr) !== undefined);
}

private pointerMapTarget(row: DecodedField | null): { addr: number; byteCount: number } | null {
    if (!row) { return null; }
    if (!row.isPointer) { return null; }
    if (row.pointerValue === undefined) { return null; }
    return { addr: row.pointerValue, byteCount: this.pointerMapByteCount(row) };
}

private pointerMapByteCount(row: DecodedField): number {
    const declared = row.pointerTargetByteSize;
    if (declared === undefined) { return 1; }
    return declared > 1 ? declared : 1;
}

private pointerTargetBytes(addr: number, byteCount: number): number[] {
    return Array.from({ length: byteCount }, (_, index) => addr + index);
}

private followPointerAt(byteStart: number, pinIdx: number, valKey: string, opts: FieldValMenuOptions = {}): void {
    const source = this.findCopySourceRows(byteStart, pinIdx, opts);
    if (!source) { return; }
    const row = this.findFieldForValueKey(source.rows, byteStart - source.baseAddr, valKey);
    this.followPointerRow(row);
}

private followPointerRow(row: DecodedField | null): void {
    const target = this.pointerFollowTarget(row);
    if (!target) { return; }
    this.selectPointerTarget(target.addr, target.byteCount);
}

private pointerFollowTarget(row: DecodedField | null): { addr: number; byteCount: number; structId?: string } | null {
    if (!this.pointerFollowState(row).ok) { return null; }
    return this.buildPointerFollowTarget(row as DecodedField & { pointerValue: number });
}

private buildPointerFollowTarget(row: DecodedField & { pointerValue: number }): { addr: number; byteCount: number; structId?: string } {
    const addr = row.pointerValue;
    return this.structPointerFollowTarget(row, addr) ?? this.scalarPointerFollowTarget(row, addr);
}

private structPointerFollowTarget(row: DecodedField, addr: number): { addr: number; byteCount: number; structId: string } | null {
    const def = this.pointerTargetStructDef(row);
    if (!def || !row.pointerTargetStructId) { return null; }
    return { addr, byteCount: structByteSize(def, this._structs), structId: row.pointerTargetStructId };
}

private pointerTargetStructDef(row: DecodedField): StructDef | undefined {
    if (row.pointerTargetType !== 'struct' || !row.pointerTargetStructId) { return undefined; }
    return allStructs(this._structs).find(candidate => candidate.id === row.pointerTargetStructId);
}

private scalarPointerFollowTarget(row: DecodedField, addr: number): { addr: number; byteCount: number } {
    return { addr, byteCount: Math.max(1, row.pointerTargetByteSize ?? 1) };
}



private structPointerCreateState(source: PointerMenuSource | null): StructPointerCreateState {
    const row = source?.row;
    if (!this.isStructPointerMenuRow(row)) { return null; }
    return this.validStructPointerCreateState(row);
}

private isStructPointerMenuRow(row: DecodedField | undefined): row is DecodedField {
    return !!row && row.pointerTargetType === 'struct';
}

private validStructPointerCreateState(row: DecodedField): Exclude<StructPointerCreateState, null> {
    const follow = this.pointerFollowState(row);
    if (!follow.ok) { return { ok: false, reason: follow.reason }; }
    return this.resolvedStructPointerCreateState(row);
}

private resolvedStructPointerCreateState(row: DecodedField): Exclude<StructPointerCreateState, null> {
    const structId = row.pointerTargetStructId;
    const def = this.pointerTargetStructDef(row);
    if (!structId || !def || row.pointerValue === undefined) { return { ok: false, reason: 'unknown target' }; }
    return { ok: true, def, addr: row.pointerValue, structId };
}

private createStructInstanceFromPointer(source: PointerMenuSource | null): void {
    const state = this.structPointerCreateState(source);
    if (!source || !state?.ok) { return; }
    this.applyPointerInstance(source, state);
}

private applyPointerInstance(source: PointerMenuSource, state: Extract<StructPointerCreateState, { ok: true }>): void {
    const result = upsertPointerStructPin(this._pins, {
        sourcePin: source.pin,
        sourceStructId: source.sourceStructId,
        sourceFieldPath: source.row.fieldName,
        sourceFieldByteOffset: source.row.byteOffset,
        sourceBaseAddr: source.sourceBaseAddr,
        targetAddress: state.addr,
        targetStructId: state.structId,
    }, this.makePinId);
    this._pins = result.pins;
    const pin = result.pin;
    this.selectCreatedPointerPin(pin, state);
    this.cb.onPinsChange?.(this._pins);
    this.render();
}

private selectCreatedPointerPin(pin: StructPin, state: Extract<StructPointerCreateState, { ok: true }>): void {
    this._expanded.add(pin.id);
    this._selectedPinId = pin.id;
    this._activeStructAddr = state.addr;
    this.selectPointerTarget(state.addr, structByteSize(state.def, this._structs));
}


private selectPointerTarget(addr: number, byteCount: number): void {
    this.cb.onSelectRange?.(addr, Math.max(1, byteCount));
}

private showScalarFieldValMenu(ctx: FieldValMenuContext, x: number, y: number): void {
    this.createViewAsMenu(
        this.menuSubHtml('Copy as', 'copy', this.copyMenuHtml(ctx.types)),
        x,
        y,
        ctx,
        cmd => this.handleScalarValueMenuCommand(cmd, ctx),
    );
}

private copyMenuHtml(types: ColType[]): string {
    return types.map(t => this.menuItemHtml(`copy-${t}`, TYPE_LABELS[t], '')).join('');
}

private finishFieldValMenu(el: HTMLElement): void {
    this.wireStructSubmenus(el);
    this.addFieldValMenuClickAway();
    this._valMenuEl = el;
}

private copyPointerFieldValue(ctx: FieldValMenuContext): void {
    const source = this.pointerMenuSource(ctx);
    const row = source?.row ?? null;
    this.copyTextToClipboard(row ? this.singleLineCopyText(this.getCopyText(row, 'hex')) : '??');
    this.hideFieldValMenu();
}

private handleScalarValueMenuCommand(cmd: string, ctx: FieldValMenuContext): void {
    if (cmd.startsWith('copy-')) {
        this.copyScalarFieldValue(cmd.replace('copy-', '') as ColType, ctx);
        return;
    }
    if (cmd.startsWith('disp-')) {
        this.setScalarDisplayType(cmd.replace('disp-', '') as ColType, ctx);
    }
}

private copyScalarFieldValue(type: ColType, ctx: FieldValMenuContext): void {
    const source = this.findCopySourceRows(ctx.bs, ctx.pinIdx, ctx.opts);
    if (!source) { this.hideFieldValMenu(); return; }
    const text = ctx.bsList && ctx.bsList.length > 0
        ? this.copyListText(ctx.bsList, ctx.opts.keyList, source.rows, source.baseAddr, type)
        : this.copySingleText(ctx.bs, ctx.opts.valKey, source.rows, source.baseAddr, type);
    this.copyTextToClipboard(text);
    this.hideFieldValMenu();
}

private copyListText(bsList: number[], keyList: string[] | undefined, rows: DecodedField[], pinAddr: number, type: ColType): string {
    return bsList.map((b, idx) => this.copySingleText(b, keyList?.[idx], rows, pinAddr, type)).join('; ');
}

private copySingleText(bs: number, key: string | undefined, rows: DecodedField[], pinAddr: number, type: ColType): string {
    const row = this.findFieldForValueKey(rows, bs - pinAddr, key);
    return row ? this.singleLineCopyText(this.getCopyText(row, type)) : '??';
}

private setScalarDisplayType(type: ColType, ctx: FieldValMenuContext): void {
    const field = ctx.findFieldAt(ctx.bs);
    const implicit = this.implicitDisplayType(field, !!ctx.opts.isBitUnitHeader);
    if (type === implicit) { this._fieldValTypes.delete(ctx.key); }
    else { this._fieldValTypes.set(ctx.key, type); }
    this.hideFieldValMenu();
    this.render();
}
private wireStructSubmenus(menuEl: HTMLElement): void {
    wireHoverSubmenus(menuEl);
}

private findCopySourcePin(bs: number, pinIdx: number | undefined, defs: StructDef[]): StructPin | undefined {
    if (typeof pinIdx === 'number' && pinIdx >= 0) {
        return this._pins[pinIdx];
    }
    return this._pins.find(p => {
        const def = defs.find(d => d.id === p.structId);
        if (!def) { return false; }
        const size = structByteSize(def, this._structs);
        return bs >= p.addr && bs < p.addr + size;
    });
}

private findCopySourceRows(bs: number, pinIdx: number | undefined, opts: FieldValMenuOptions = {}): CopySourceRows | undefined {
    const explicit = this.findExplicitCopySourceRows(pinIdx, opts);
    if (explicit) { return explicit; }
    const all = allStructs(this._structs);
    const pin = this.findCopySourcePin(bs, pinIdx, all);
    if (!pin) { return undefined; }
    const def = all.find(d => d.id === pin.structId);
    if (!def) { return undefined; }
    return {
        pin,
        rows: decodeStruct(def, pin.addr, this.cb.readByte, this._endian, this._bitFieldAllocation, this._structs),
        structId: def.id,
        baseAddr: pin.addr,
    };
}

private findExplicitCopySourceRows(pinIdx: number | undefined, opts: FieldValMenuOptions): CopySourceRows | undefined {
    const context = this.explicitSourceContext(opts);
    if (!context) { return undefined; }
    const pin = this.copySourcePinFromIndex(pinIdx);
    const def = this.structDefById(context.structId);
    if (!pin || !def) { return undefined; }
    return {
        pin,
        rows: decodeStruct(def, context.baseAddr, this.cb.readByte, this._endian, this._bitFieldAllocation, this._structs),
        structId: def.id,
        baseAddr: context.baseAddr,
    };
}

private explicitSourceContext(opts: FieldValMenuOptions): { structId: string; baseAddr: number } | undefined {
    return opts.sourceStructId && typeof opts.sourceBaseAddr === 'number'
        ? { structId: opts.sourceStructId, baseAddr: opts.sourceBaseAddr }
        : undefined;
}

private copySourcePinFromIndex(pinIdx: number | undefined): StructPin | undefined {
    return typeof pinIdx === 'number' && pinIdx >= 0 ? this._pins[pinIdx] : undefined;
}

private structDefById(structId: string): StructDef | undefined {
    return allStructs(this._structs).find(d => d.id === structId);
}

private copyTextToClipboard(text: string): void {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(() => this.fallbackCopyText(text));
    } else {
        this.fallbackCopyText(text);
    }
}

private toggleCompositeGroup(
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
        this.syncCompositeHeaderOffset(hdr, false);
        return;
    }
    expandedKeys.add(key);
    grp.classList.add('open');
    body.style.display = '';
    expBtn.textContent = '▾';
    this.syncCompositeHeaderOffset(hdr, true);
}

private wireStructHoverRange(el: HTMLElement, start: number, count: number): void {
    el.addEventListener('mouseenter', () => {
        const addrs: number[] = [];
        for (let i = 0; i < count; i++) { addrs.push(start + i); }
        this.cb.onHighlightHex?.(addrs, 'struct-h');
    });
    el.addEventListener('mouseleave', () => {
        this.cb.onClearHighlightHex?.('struct-h');
    });
}

private highlightAddress(addr: number, className: string): void {
    this.cb.onHighlightHex?.([addr], className);
}

private clearStructSelectionVisuals(): void {
    this.clearArrSep();
    this.clearSelRow();
    this._selectedBitRange = null;
    this._hoveredBitRange = null;
    this._selectedBitRowKey = null;
    this._hoveredBitRowKey = null;
}

private markArraySeparators(rows: HTMLElement[]): void {
    const addrs: number[] = [];
    rows.forEach((row, i) => {
        if (i === 0) { return; }
        const bs = parseInt(row.dataset.byteStart!);
        if (isNaN(bs)) { return; }
        this._arrSepAddrs.push(bs);
        addrs.push(bs);
    });
    this.cb.onHighlightHex?.(addrs, 'struct-arr-sep');
}

private selectStructRange(el: HTMLElement, start: number, count: number): void {
    el.classList.add('si-selected');
    this.cb.onSelectRange?.(start, count);
}

private fallbackCopyText(text: string): void {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
}

// ── Selection sync ────────────────────────────────────────────────

private clearStructSelectionState(): void {
    this.clearArrSep();
    this.clearSelRow();
    this._selectedFieldAddr = null;
    this._selectedArrKey    = null;
    this._selectedArrElemKey = null;
    this._selectedPinId     = null;
}

private updateStructAddressInputs(addr: number): void {
    if (!this._tabActive) { return; }
    const addrHex = addr.toString(16).toUpperCase().padStart(8, '0');
    if (this._addingPin) {
        this.updateAddPinAddressInput(addrHex);
        return;
    }
    if (this._editingPinId) { this.updateEditPinAddressInput(addrHex); }
}

private updateAddPinAddressInput(addrHex: string): void {
    const inp = this.addPinAddressInput();
    if (!inp) { return; }
    inp.value = addrHex;
    const confirmBtn = this.addPinConfirmButton();
    if (confirmBtn) { confirmBtn.disabled = !this._applyStructId; }
}

private addPinAddressInput(): HTMLInputElement | null {
    return this._root?.querySelector<HTMLInputElement>('#sa-addr') ?? null;
}

private addPinConfirmButton(): HTMLButtonElement | null {
    return this._root?.querySelector<HTMLButtonElement>('#sa-confirm') ?? null;
}

private updateEditPinAddressInput(addrHex: string): void {
    const inp = this._root?.querySelector<HTMLInputElement>('.si-pe-addr');
    if (inp) { inp.value = addrHex; }
}
}
