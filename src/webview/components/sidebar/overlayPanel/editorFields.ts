/** Overlay panel — editor field-row markup helpers.
Extracted verbatim from overlayPanel.ts (pure move). */
import { esc } from '../../../utils';
import { FIELD_TYPES, allTypes, isUnsignedScalarType, normalizeTypeField, typeDefKind } from '../../../../core/overlay/overlayCodec.js';
import type { BitFieldChild, TypeDef, TypeField } from '../../../../core/types';

/** Max chars for a `struct <name>` option label before truncating (full name in `title`). */
const TYPE_OPTION_MAX_CHARS = 28;

function fieldTypeOptionsHtml(f: TypeField, draftId: string, types: readonly TypeDef[]): string {
    f = normalizeTypeField(f);
    const scalarOptions = FIELD_TYPES.map(t =>
        `<option value="${t}"${f.type === t ? ' selected' : ''}>${t}</option>`
    ).join('');
    const typeOptions = allTypes(types)
        .filter(d => typeDefKind(d) === 'struct' && d.id !== draftId)
        .map(d => typeOptionHtml(f, d))
        .join('');
    const bitFieldOptions = allTypes(types)
        .filter(d => typeDefKind(d) === 'bitfield' && d.id !== draftId)
        .map(d => bitFieldOptionHtml(f, d))
        .join('');
    const enumOptions = allTypes(types)
        .filter(d => typeDefKind(d) === 'enum' && d.id !== draftId)
        .map(d => enumOptionHtml(f, d))
        .join('');
    return `<optgroup label="Scalar">${scalarOptions}</optgroup>` +
        (typeOptions ? `<optgroup label="Struct">${typeOptions}</optgroup>` : '') +
        (bitFieldOptions ? `<optgroup label="Bit-field">${bitFieldOptions}</optgroup>` : '') +
        (enumOptions ? `<optgroup label="Enum">${enumOptions}</optgroup>` : '');
}

function typeOptionHtml(f: TypeField, d: TypeDef): string {
    f = normalizeTypeField(f);
    const val = `struct:${d.id}`;
    const selected = isTypeSelected(f, d);
    const full = `struct ${d.name}`;
    // Truncate very long nested type names in the type select; the full
    // name stays available via the option's title tooltip.
    const label = truncatedTypeOptionLabel(full);
    const titleAttr = typeOptionTitleAttr(label, full);
    return `<option value="${esc(val)}"${selected ? ' selected' : ''}${titleAttr}>${esc(label)}</option>`;
}

function bitFieldOptionHtml(f: TypeField, d: TypeDef): string {
    f = normalizeTypeField(f);
    const val = `bitfield:${d.id}`;
    const selected = f.type === 'bitfield' && f.refTypeId === d.id;
    const full = `bitfield ${d.name}`;
    const label = truncatedTypeOptionLabel(full);
    const titleAttr = typeOptionTitleAttr(label, full);
    return `<option value="${esc(val)}"${selected ? ' selected' : ''}${titleAttr}>${esc(label)}</option>`;
}

function enumOptionHtml(f: TypeField, d: TypeDef): string {
    f = normalizeTypeField(f);
    const val = `enum:${d.id}`;
    const selected = f.type === 'enum' && f.refTypeId === d.id;
    const full = `enum ${d.name}`;
    const label = truncatedTypeOptionLabel(full);
    const titleAttr = typeOptionTitleAttr(label, full);
    return `<option value="${esc(val)}"${selected ? ' selected' : ''}${titleAttr}>${esc(label)}</option>`;
}

function isTypeSelected(f: TypeField, d: TypeDef): boolean {
    return f.type === 'struct' && f.refTypeId === d.id;
}

function truncatedTypeOptionLabel(full: string): string {
    return full.length > TYPE_OPTION_MAX_CHARS
        ? `${full.slice(0, TYPE_OPTION_MAX_CHARS)}\u2026`
        : full;
}

function typeOptionTitleAttr(label: string, full: string): string {
    return label !== full ? ` title="${esc(full)}"` : '';
}

function isBitContainerField(f: TypeField): boolean {
    f = normalizeTypeField(f);
    if (f.isPointer) { return false; }
    return isUnsignedScalarType(f.type) && Array.isArray(f.bitFields) && f.bitFields.length > 0;
}

/** A field that references a standalone `kind: 'bitfield'` def. */
function isBitFieldRefField(f: TypeField): boolean {
    f = normalizeTypeField(f);
    return f.type === 'bitfield' && f.isPointer !== true;
}

/** A field that references a standalone `kind: 'enum'` def. */
function isEnumRefField(f: TypeField): boolean {
    f = normalizeTypeField(f);
    return f.type === 'enum' && f.isPointer !== true;
}

/** Fields that can never be pointers: bit-field containers/refs and enum refs. */
export function isPointerBlocked(field: TypeField): boolean {
    return isBitContainerField(field) || isBitFieldRefField(field) || isEnumRefField(field);
}

export function bitChildButtonState(remainingBits: number): { addBtnDisabled: string; addBtnTitle: string } {
    return {
        addBtnDisabled: remainingBits > 0 ? '' : ' disabled',
        addBtnTitle: remainingBits > 0 ? 'Add bit-field child' : 'No bits remaining in parent',
    };
}

function deleteFieldCellHtml(isOnly: boolean): string {
    return isOnly
        ? `<span class="ofe-del-placeholder"></span>`
        : `<button class="ofe-del-btn" title="Remove field" aria-label="Remove field">\u2715</button>`;
}

function disabledAttr(isDisabled: boolean): string {
    return isDisabled ? ' disabled' : '';
}

function activeClassAttr(isActive: boolean): string {
    return isActive ? ' active' : '';
}

function arrayToggleLabel(isArr: boolean): string {
        return isArr ? 'Remove array' : 'Make array';
    }

function fieldHiddenCellHtml(f: TypeField): string {
        const title = 'Hide this field in the Instances view';
        return (
            `<span class="ofe-hidden-cell" title="${title}">` +
            `<input type="checkbox" class="ofe-hidden-chk" title="${title}" aria-label="${title}"${f.hidden === true ? ' checked' : ''}>` +
            `</span>`
        );
    }

function fieldArrayCellHtml(f: TypeField): string {
        const isArr = f.count > 1;
        const toggleLabel = arrayToggleLabel(isArr);
        return (
            `<div class="ofe-arr-cell${isArr ? ' is-array' : ''}">` +
            `<button class="ofe-arr-toggle${activeClassAttr(isArr)}" title="${toggleLabel}" aria-label="${toggleLabel}">[ ]</button>` +
            `<input class="ofe-count-inp sb-input sb-input-sm" type="text" inputmode="numeric" ` +
                   `value="${isArr ? f.count : ''}" placeholder="N">` +
            `</div>`
        );
    }

/** Pointer declaration is exposed via the per-field `*` button and context menu (see wireEditorInSec). */

function fieldMoveButtonsHtml(i: number, total: number): string {
    return (
        `<div class="ofe-move-btns">` +
        `<button class="ofe-move-btn ofe-move-up" title="Move up" aria-label="Move up"${disabledAttr(i === 0)}>&#x2191;</button>` +
        `<button class="ofe-move-btn ofe-move-dn" title="Move down" aria-label="Move down"${disabledAttr(i === total - 1)}>&#x2193;</button>` +
        `</div>`
    );
}

export function overrideSelectHtml(
    value: 'le' | 'be' | 'lsb' | 'msb' | undefined,
    kind: 'endian' | 'allocation',
    cls: string,
    id?: string,
    inherited?: string,
): string {
    // Auto = inherit: the Auto option's title (and the select's when Auto is
    // selected) shows the effective inherited source, e.g. "Auto — inherits BE".
    const autoTitle = overrideAutoTitle(value, inherited);
    const options = overrideLabels(kind)
        .map(([val, label]) => overrideOptionHtml(val, label, value, autoTitle))
        .join('');
    const idAttr = id ? ` id="${id}"` : '';
    const title = autoTitle ?? overrideHelpTitle(kind);
    return `<select class="${cls}"${idAttr} title="${title}" aria-label="${title}">${options}</select>`;
}

function overrideLabels(kind: 'endian' | 'allocation'): Array<[string, string]> {
    return kind === 'endian'
        ? [['', 'Auto'], ['le', 'LE'], ['be', 'BE']]
        : [['', 'Auto'], ['lsb', 'LSB'], ['msb', 'MSB']];
}

export function overrideAutoTitle(value: 'le' | 'be' | 'lsb' | 'msb' | undefined, inherited?: string): string | undefined {
    if (value !== undefined || !inherited) { return undefined; }
    return `Auto \u2014 inherits ${inherited}`;
}

function overrideOptionHtml(
    val: string,
    label: string,
    value: 'le' | 'be' | 'lsb' | 'msb' | undefined,
    autoTitle?: string,
): string {
    const titleAttr = val === '' && autoTitle ? ` title="${esc(autoTitle)}"` : '';
    return `<option value="${val}"${value === val ? ' selected' : ''}${titleAttr}>${label}</option>`;
}

export function overrideHelpTitle(kind: 'endian' | 'allocation'): string {
    return kind === 'endian'
        ? 'Byte order for this field (first explicit value up the chain wins)'
        : 'Bit allocation for this field (first explicit value up the chain wins)';
}

function fieldIsPointerActive(f: TypeField): boolean {
    return f.isPointer === true || f.type === 'void';
}

export function fieldRowHtml(
    f: TypeField,
    i: number,
    isOnly: boolean,
    total: number,
    draftId: string,
    types: readonly TypeDef[],
    inheritedEndian: string,
    inheritedAlloc: string,
): string {
    const typeOpts = fieldTypeOptionsHtml(f, draftId, types);
    const blocksPointer = isPointerBlocked(f);
    const showsAlloc = isBitFieldRefField(f);
    const delCell = deleteFieldCellHtml(isOnly);

    return (
        `<div class="field-row" data-idx="${i}" data-ptr="${f.isPointer ? '1' : ''}">` +
        `<select class="ofe-type-sel">${typeOpts}</select>` +
        `<button class="ofe-ptr-btn${activeClassAttr(fieldIsPointerActive(f))}" ` +
               `title="Toggle pointer field" aria-label="Toggle pointer field"${disabledAttr(blocksPointer)}>*</button>` +
        `<input class="ofe-name-inp sb-input sb-input-sm" type="text" value="${esc(f.name)}" maxlength="64" ` +
               `placeholder="fieldName" spellcheck="false" autocomplete="off">` +
        overrideSelectHtml(f.endian, 'endian', 'ofe-endian-sel', undefined, inheritedEndian) +
        (showsAlloc
            ? overrideSelectHtml(f.allocation, 'allocation', 'ofe-alloc-sel', undefined, inheritedAlloc)
            : `<span class="ofe-alloc-placeholder"></span>`) +
        fieldHiddenCellHtml(f) +
        fieldArrayCellHtml(f) +
        fieldMoveButtonsHtml(i, total) +
        delCell +
        `</div>`
    );
}

/** Render a single bit-field child row inside a bit-field container parent. */
export function childFieldRowHtml(child: BitFieldChild, ci: number, total: number, types: readonly TypeDef[]): string {
    const upDis  = ci === 0        ? ' disabled' : '';
    const dnDis  = ci === total - 1 ? ' disabled' : '';
    const delCell = total <= 1
        ? `<span class="ofe-del-placeholder"></span>`
        : `<button class="ofe-bf-del-child" title="Remove child" aria-label="Remove child">\u2715</button>`;
    return (
        `<div class="ofe-bf-child-row" data-child-idx="${ci}">` +
        `<span class="ofe-bf-child-indent"></span>` +
        `<input class="ofe-bf-child-name sb-input sb-input-sm" type="text" value="${esc(child.name)}" maxlength="64" ` +
               `aria-label="Bit name" placeholder="bit${ci}" spellcheck="false" autocomplete="off">` +
        `<input class="ofe-bf-child-width sb-input sb-input-sm" type="text" inputmode="numeric" value="${child.bitWidth}" ` +
               `aria-label="Bit width in bits" placeholder="N" maxlength="2">` +
        `<span class="ofe-bf-child-unit">bit</span>` +
        bitChildEnumSelectHtml(child, types) +
        bitChildHiddenCellHtml(child) +
        `<div class="ofe-bf-child-move">` +
        `<button class="ofe-move-btn ofe-move-up" title="Move up" aria-label="Move up"${upDis}>&#x2191;</button>` +
        `<button class="ofe-move-btn ofe-move-dn" title="Move down" aria-label="Move down"${dnDis}>&#x2193;</button>` +
        `</div>` +
        delCell +
        `</div>`
    );
}

/** Optional enum ref for a bit-field child: labels this bit value with the def's entries. */
function bitChildEnumSelectHtml(child: BitFieldChild, types: readonly TypeDef[]): string {
    const enums = allTypes(types).filter(d => typeDefKind(d) === 'enum');
    const options = [`<option value="">\u2014</option>`]
        .concat(enums.map(d =>
            `<option value="${esc(d.id)}"${child.refTypeId === d.id ? ' selected' : ''}>${esc(truncatedTypeOptionLabel(d.name))}</option>`
        ))
        .join('');
    return `<select class="ofe-bf-child-enum" title="Enum labels for this bit value" aria-label="Enum labels for this bit value">${options}</select>`;
}

/** Per-child "hide this bit in the Instances view" checkbox (instance-view only). */
function bitChildHiddenCellHtml(child: BitFieldChild): string {
    const title = 'Hide this bit in the Instances view';
    return (
        `<span class="ofe-bf-child-hidden-cell" title="${title}">` +
        `<input type="checkbox" class="ofe-hidden-chk ofe-bf-child-hidden" title="${title}" aria-label="${title}"${child.hidden === true ? ' checked' : ''}>` +
        `</span>`
    );
}
