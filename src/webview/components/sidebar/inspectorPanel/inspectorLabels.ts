// ── Inspector label section — pure helpers ──────────────────────
// DOM-free markup + validation for the Labels section and its inline
// add/edit form (split out of Inspector.ts to keep the component file
// focused on the interaction controller).

import { actionBtnsHtml, esc, fmtB } from '../../../utils';
import type { SegmentLabel, SerializedSegment } from '../../../../core/types';

export const LABEL_COLORS = [
    { name: 'Sky Blue', v: '#4fc3f7' }, { name: 'Green',  v: '#81c784' },
    { name: 'Orange',   v: '#ffb74d' }, { name: 'Red',    v: '#e57373' },
    { name: 'Purple',   v: '#ce93d8' }, { name: 'Teal',   v: '#80cbc4' },
    { name: 'Yellow',   v: '#fff176' }, { name: 'Pink',   v: '#f48fb1' },
];

export type LabelRangeMode = 'len' | 'end';
export type LabelLengthResult =
    | { ok: true; length: number }
    | { ok: false; error: string };
export type LabelDraftResult =
    | { ok: true; name: string; startAddress: number; length: number }
    | { ok: false; error: string };

function labelVisibilityUi(label: SegmentLabel): { itemClass: string; background: string; hiddenFlag: string; title: string; icon: string } {
    if (label.hidden) {
        return {
            itemClass: ' label-hidden',
            background: 'transparent',
            hiddenFlag: '1',
            title: 'Show',
            icon: '&#128065;&#xFE0E;',
        };
    }
    return {
        itemClass: '',
        background: label.color,
        hiddenFlag: '0',
        title: 'Hide',
        icon: '&#128065;',
    };
}

export function labelItemHtml(label: SegmentLabel): string {
    const visibility = labelVisibilityUi(label);
    const hex = (n: number): string => `0x${n.toString(16).toUpperCase().padStart(8, '0')}`;
    return `
            <div class="label-item${visibility.itemClass}" data-id="${label.id}">
                <div class="label-sw" style="background:${visibility.background};border:1px solid ${label.color}"></div>
                <div class="label-inf">
                    <div class="label-nm">${esc(label.name)}</div>
                    <div class="label-rng">${hex(label.startAddress)}&ndash;${hex(label.startAddress + label.length - 1)} &middot; ${fmtB(label.length)}</div>
                </div>
                <button type="button" class="label-act label-vis" data-id="${label.id}" data-hidden="${visibility.hiddenFlag}" title="${visibility.title}" aria-label="${visibility.title}">${visibility.icon}</button>
                ${actionBtnsHtml(`data-id="${label.id}"`, `data-id="${label.id}"`)}
            </div>`;
}

export function labelFormHtml(
    editing: SegmentLabel | undefined,
    swatchHtml: string,
    defaultStart: string,
    defaultRange: string,
    rangeMode: LabelRangeMode,
    chipText: string,
    renameDisplayName?: string,
): string {
    const renaming = renameDisplayName !== undefined;
    const mode = formMode(editing, renaming);
    return `
        <div class="sb-section-label sb-label-form-title">${mode.title}</div>
        <div class="lbl-form">
            ${nameFieldHtml(renameDisplayName ?? editing?.name ?? '')}
            ${startFieldHtml(defaultStart, renaming)}
            ${rangeFieldHtml(defaultRange, rangeMode, chipText, renaming)}
            ${colorFieldHtml(swatchHtml, renaming)}
            <div class="lf-warn" id="lf-warn" role="alert"></div>
            <div class="lf-actions">
                <button class="sb-btn sb-btn-secondary" id="lf-cancel">Cancel</button>
                <button class="sb-btn sb-btn-primary" id="lf-save">${mode.saveLabel}</button>
            </div>
        </div>`;
}

function nameFieldHtml(name: string): string {
    return `
            <div class="lf-field">
                <span class="lf-lbl">Label Name</span>
                <input id="lf-name" class="sb-input" type="text" placeholder="My Segment" value="${esc(name)}">
            </div>`;
}

function startFieldHtml(defaultStart: string, ro: boolean): string {
    return `
            <div class="lf-field">
                <span class="lf-lbl">Start Address</span>
                <input id="lf-start" class="sb-input lf-hex" type="text" placeholder="0x08000000" value="${esc(defaultStart)}"${ro ? ' disabled' : ''}>
            </div>`;
}

function rangeFieldHtml(defaultRange: string, mode: LabelRangeMode, chipText: string, ro: boolean): string {
    const tabs = ro ? '' : `
                    <div class="compact-tabs lf-mode-tabs">
                        <button data-mode="end"${mode === 'end' ? ' class="active"' : ''}>End Address</button>
                        <button data-mode="len"${mode === 'len' ? ' class="active"' : ''}>Size &middot; Length</button>
                    </div>`;
    return `
            <div class="lf-field">
                <span class="lf-lbl">Define End By</span>${tabs}
                <div class="lf-range-row">
                    <input id="lf-range" class="sb-input lf-hex" type="text" placeholder="${mode === 'end' ? '0x0800FFFF' : '512'}" value="${esc(defaultRange)}"${ro ? ' disabled' : ''}>
                    <span class="lf-chip" id="lf-chip"${chipText ? ` title="${esc(chipText)}"` : ''}>${esc(chipText)}</span>
                </div>
            </div>`;
}

function colorFieldHtml(swatchHtml: string, ro: boolean): string {
    return `
            <div class="lf-field">
                <span class="lf-lbl">Color</span>
                <div class="lf-swatches${ro ? ' lf-ro' : ''}">${swatchHtml}</div>
            </div>`;
}

function formMode(editing: SegmentLabel | undefined, rename: boolean): { title: string; saveLabel: string } {
    if (rename) { return { title: 'Rename Segment', saveLabel: 'Save' }; }
    return editing
        ? { title: 'Edit Label', saveLabel: 'Update' }
        : { title: 'New Label', saveLabel: 'Add' };
}

export function defaultLabelColor(editing: SegmentLabel | undefined, fallback: string): string {
    return editing ? editing.color : fallback;
}

export function mergeLabel(labels: SegmentLabel[], editId: string | undefined, label: SegmentLabel): SegmentLabel[] {
    return editId ? labels.map(l => l.id === editId ? label : l) : [...labels, label];
}

export function isValidLabelEnd(start: number, end: number): boolean {
    return !isNaN(start) && !isNaN(end) && end >= start;
}

export function endAddressOrEmpty(start: number, length: number): string {
    if (isNaN(start) || isNaN(length) || length <= 0) { return ''; }
    return `0x${(start + length - 1).toString(16).toUpperCase().padStart(8, '0')}`;
}

export function parseEndAddressLength(raw: string, startAddress: number): LabelLengthResult {
    const end = parseInt(raw.replace(/^0x/i, ''), 16);
    if (isNaN(end) || end < startAddress) { return { ok: false, error: 'Invalid end address.' }; }
    return { ok: true, length: end - startAddress + 1 };
}

export function parseExplicitLength(raw: string): LabelLengthResult {
    const length = /^0x/i.test(raw) ? parseInt(raw, 16) : parseInt(raw, 10);
    if (isNaN(length) || length <= 0) { return { ok: false, error: 'Invalid length.' }; }
    return { ok: true, length };
}

/**
 * Derived counterpart text for the representation the user is NOT editing:
 * End Address mode → human-readable size chip; Length mode → end-address chip.
 * Empty string when the raw value does not (yet) parse against startAddress.
 */
export function labelChipText(mode: LabelRangeMode, startAddress: number, raw: string): string {
    if (isNaN(startAddress)) { return ''; }
    if (mode === 'end') {
        const parsed = parseEndAddressLength(raw, startAddress);
        return parsed.ok ? `(${fmtB(parsed.length)})` : '';
    }
    const parsed = parseExplicitLength(raw);
    return parsed.ok ? endAddressOrEmpty(startAddress, parsed.length) : '';
}

export function isOutsideMappedData(segments: SerializedSegment[], startAddress: number, endAddress: number): boolean {
    return segments.length > 0 && !segments.some(segment =>
        startAddress <= segment.startAddress + segment.data.length - 1 && endAddress >= segment.startAddress
    );
}
