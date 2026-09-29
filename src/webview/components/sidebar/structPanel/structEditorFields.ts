/** Struct panel — editor field-row markup helpers.
Extracted verbatim from structPanel.ts (pure move). */
import { esc } from '../../../utils';
import { FIELD_TYPES, allStructs, isUnsignedScalarType, normalizeStructField, structDefKind } from '../../../../core/structCodec.js';
import type { BitFieldChild, StructDef, StructField } from '../../../../core/types';

/** Max chars for a `struct <name>` option label before truncating (full name in `title`). */
const TYPE_OPTION_MAX_CHARS = 28;

export function fieldTypeOptionsHtml(f: StructField, draftId: string, structs: readonly StructDef[]): string {
    f = normalizeStructField(f);
    const scalarOptions = FIELD_TYPES.map(t =>
        `<option value="${t}"${f.type === t ? ' selected' : ''}>${t}</option>`
    ).join('');
    const structOptions = allStructs(structs)
        .filter(d => structDefKind(d) === 'struct' && d.id !== draftId)
        .map(d => structOptionHtml(f, d))
        .join('');
    const bitFieldOptions = allStructs(structs)
        .filter(d => structDefKind(d) === 'bitfield' && d.id !== draftId)
        .map(d => bitFieldOptionHtml(f, d))
        .join('');
    const enumOptions = allStructs(structs)
        .filter(d => structDefKind(d) === 'enum' && d.id !== draftId)
        .map(d => enumOptionHtml(f, d))
        .join('');
    return `<optgroup label="Scalar">${scalarOptions}</optgroup>` +
        (structOptions ? `<optgroup label="Struct">${structOptions}</optgroup>` : '') +
        (bitFieldOptions ? `<optgroup label="Bit-field">${bitFieldOptions}</optgroup>` : '') +
        (enumOptions ? `<optgroup label="Enum">${enumOptions}</optgroup>` : '');
}

export function structOptionHtml(f: StructField, d: StructDef): string {
    f = normalizeStructField(f);
    const val = `struct:${d.id}`;
    const selected = isStructTypeSelected(f, d);
    const full = `struct ${d.name}`;
    // Truncate very long nested-struct names in the type select; the full
    // name stays available via the option's title tooltip.
    const label = truncatedStructOptionLabel(full);
    const titleAttr = structOptionTitleAttr(label, full);
    return `<option value="${esc(val)}"${selected ? ' selected' : ''}${titleAttr}>${esc(label)}</option>`;
}

export function bitFieldOptionHtml(f: StructField, d: StructDef): string {
    f = normalizeStructField(f);
    const val = `bitfield:${d.id}`;
    const selected = f.type === 'bitfield' && f.refStructId === d.id;
    const full = `bitfield ${d.name}`;
    const label = truncatedStructOptionLabel(full);
    const titleAttr = structOptionTitleAttr(label, full);
    return `<option value="${esc(val)}"${selected ? ' selected' : ''}${titleAttr}>${esc(label)}</option>`;
}

export function enumOptionHtml(f: StructField, d: StructDef): string {
    f = normalizeStructField(f);
    const val = `enum:${d.id}`;
    const selected = f.type === 'enum' && f.refStructId === d.id;
    const full = `enum ${d.name}`;
    const label = truncatedStructOptionLabel(full);
    const titleAttr = structOptionTitleAttr(label, full);
    return `<option value="${esc(val)}"${selected ? ' selected' : ''}${titleAttr}>${esc(label)}</option>`;
}

export function isStructTypeSelected(f: StructField, d: StructDef): boolean {
    return f.type === 'struct' && f.refStructId === d.id;
}

export function truncatedStructOptionLabel(full: string): string {
    return full.length > TYPE_OPTION_MAX_CHARS
        ? `${full.slice(0, TYPE_OPTION_MAX_CHARS)}\u2026`
        : full;
}

export function structOptionTitleAttr(label: string, full: string): string {
    return label !== full ? ` title="${esc(full)}"` : '';
}

export function isBitContainerField(f: StructField): boolean {
    f = normalizeStructField(f);
    if (f.isPointer) { return false; }
    return isUnsignedScalarType(f.type) && Array.isArray(f.bitFields) && f.bitFields.length > 0;
}

/** A field that references a standalone `kind: 'bitfield'` def. */
export function isBitFieldRefField(f: StructField): boolean {
    f = normalizeStructField(f);
    return f.type === 'bitfield' && f.isPointer !== true;
}

/** A field that references a standalone `kind: 'enum'` def. */
export function isEnumRefField(f: StructField): boolean {
    f = normalizeStructField(f);
    return f.type === 'enum' && f.isPointer !== true;
}

/** Fields that can never be pointers: bit-field containers/refs and enum refs. */
export function isPointerBlocked(field: StructField): boolean {
    return isBitContainerField(field) || isBitFieldRefField(field) || isEnumRefField(field);
}

export function bitChildButtonState(remainingBits: number): { addBtnDisabled: string; addBtnTitle: string } {
    return {
        addBtnDisabled: remainingBits > 0 ? '' : ' disabled',
        addBtnTitle: remainingBits > 0 ? 'Add bit-field child' : 'No bits remaining in parent',
    };
}

export function deleteFieldCellHtml(isOnly: boolean): string {
    return isOnly
        ? `<span class="sfe-del-placeholder"></span>`
        : `<button class="sfe-del-btn" title="Remove field" aria-label="Remove field">\u2715</button>`;
}

export function disabledAttr(isDisabled: boolean): string {
    return isDisabled ? ' disabled' : '';
}

export function activeClassAttr(isActive: boolean): string {
    return isActive ? ' active' : '';
}

export function arrayToggleLabel(isArr: boolean): string {
        return isArr ? 'Remove array' : 'Make array';
    }

export function fieldHiddenCellHtml(f: StructField): string {
        const title = 'Hide this field in the Struct Instances view';
        return (
            `<span class="sfe-hidden-cell" title="${title}">` +
            `<input type="checkbox" class="sfe-hidden-chk" title="${title}" aria-label="${title}"${f.hidden === true ? ' checked' : ''}>` +
            `</span>`
        );
    }

export function fieldArrayCellHtml(f: StructField): string {
        const isArr = f.count > 1;
        const toggleLabel = arrayToggleLabel(isArr);
        return (
            `<div class="sfe-arr-cell${isArr ? ' is-array' : ''}">` +
            `<button class="sfe-arr-toggle${activeClassAttr(isArr)}" title="${toggleLabel}" aria-label="${toggleLabel}">[ ]</button>` +
            `<input class="sfe-count-inp sb-input sb-input-sm" type="text" inputmode="numeric" ` +
                   `value="${isArr ? f.count : ''}" placeholder="N">` +
            `</div>`
        );
    }

/** Pointer declaration is exposed via the per-field `*` button and context menu (see wireEditorInSec). */

export function fieldMoveButtonsHtml(i: number, total: number): string {
    return (
        `<div class="sfe-move-btns">` +
        `<button class="sfe-move-btn sfe-move-up" title="Move up" aria-label="Move up"${disabledAttr(i === 0)}>&#x2191;</button>` +
        `<button class="sfe-move-btn sfe-move-dn" title="Move down" aria-label="Move down"${disabledAttr(i === total - 1)}>&#x2193;</button>` +
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

export function overrideLabels(kind: 'endian' | 'allocation'): Array<[string, string]> {
    return kind === 'endian'
        ? [['', 'Auto'], ['le', 'LE'], ['be', 'BE']]
        : [['', 'Auto'], ['lsb', 'LSB'], ['msb', 'MSB']];
}

export function overrideAutoTitle(value: 'le' | 'be' | 'lsb' | 'msb' | undefined, inherited?: string): string | undefined {
    if (value !== undefined || !inherited) { return undefined; }
    return `Auto \u2014 inherits ${inherited}`;
}

export function overrideOptionHtml(
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

export function fieldIsPointerActive(f: StructField): boolean {
    return f.isPointer === true || f.type === 'void';
}

export function fieldRowHtml(
    f: StructField,
    i: number,
    isOnly: boolean,
    total: number,
    draftId: string,
    structs: readonly StructDef[],
    inheritedEndian: string,
    inheritedAlloc: string,
): string {
    const typeOpts = fieldTypeOptionsHtml(f, draftId, structs);
    const blocksPointer = isPointerBlocked(f);
    const showsAlloc = isBitFieldRefField(f);
    const delCell = deleteFieldCellHtml(isOnly);

    return (
        `<div class="struct-field-row" data-idx="${i}" data-ptr="${f.isPointer ? '1' : ''}">` +
        `<select class="sfe-type-sel">${typeOpts}</select>` +
        `<button class="sfe-ptr-btn${activeClassAttr(fieldIsPointerActive(f))}" ` +
               `title="Toggle pointer field" aria-label="Toggle pointer field"${disabledAttr(blocksPointer)}>*</button>` +
        `<input class="sfe-name-inp sb-input sb-input-sm" type="text" value="${esc(f.name)}" maxlength="64" ` +
               `placeholder="fieldName" spellcheck="false" autocomplete="off">` +
        overrideSelectHtml(f.endian, 'endian', 'sfe-endian-sel', undefined, inheritedEndian) +
        (showsAlloc
            ? overrideSelectHtml(f.allocation, 'allocation', 'sfe-alloc-sel', undefined, inheritedAlloc)
            : `<span class="sfe-alloc-placeholder"></span>`) +
        fieldHiddenCellHtml(f) +
        fieldArrayCellHtml(f) +
        fieldMoveButtonsHtml(i, total) +
        delCell +
        `</div>`
    );
}

/** Render a single bit-field child row inside a bit-field container parent. */
export function childFieldRowHtml(child: BitFieldChild, ci: number, total: number, structs: readonly StructDef[]): string {
    const upDis  = ci === 0        ? ' disabled' : '';
    const dnDis  = ci === total - 1 ? ' disabled' : '';
    const delCell = total <= 1
        ? `<span class="sfe-del-placeholder"></span>`
        : `<button class="sfe-bf-del-child" title="Remove child" aria-label="Remove child">\u2715</button>`;
    return (
        `<div class="sfe-bf-child-row" data-child-idx="${ci}">` +
        `<span class="sfe-bf-child-indent"></span>` +
        `<input class="sfe-bf-child-name sb-input sb-input-sm" type="text" value="${esc(child.name)}" maxlength="64" ` +
               `placeholder="bit${ci}" spellcheck="false" autocomplete="off">` +
        `<input class="sfe-bf-child-width sb-input sb-input-sm" type="text" inputmode="numeric" value="${child.bitWidth}" ` +
               `placeholder="N" maxlength="2">` +
        `<span class="sfe-bf-child-unit">bit</span>` +
        bitChildEnumSelectHtml(child, structs) +
        `<div class="sfe-bf-child-move">` +
        `<button class="sfe-move-btn sfe-move-up" title="Move up" aria-label="Move up"${upDis}>&#x2191;</button>` +
        `<button class="sfe-move-btn sfe-move-dn" title="Move down" aria-label="Move down"${dnDis}>&#x2193;</button>` +
        `</div>` +
        delCell +
        `</div>`
    );
}

/** Optional enum ref for a bit-field child: labels this bit value with the def's entries. */
export function bitChildEnumSelectHtml(child: BitFieldChild, structs: readonly StructDef[]): string {
    const enums = allStructs(structs).filter(d => structDefKind(d) === 'enum');
    const options = [`<option value="">\u2014</option>`]
        .concat(enums.map(d =>
            `<option value="${esc(d.id)}"${child.refStructId === d.id ? ' selected' : ''}>${esc(truncatedStructOptionLabel(d.name))}</option>`
        ))
        .join('');
    return `<select class="sfe-bf-child-enum" title="Enum labels for this bit value" aria-label="Enum labels for this bit value">${options}</select>`;
}

