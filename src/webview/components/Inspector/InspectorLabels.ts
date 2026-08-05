// ── Inspector label section — pure helpers ──────────────────────
// DOM-free markup + validation for the Labels section and its inline
// add/edit form (split out of Inspector.ts to keep the component file
// focused on the interaction controller).

import { actionBtnsHtml, esc, fmtB } from '../../utils';
import type { SegmentLabel, SerializedSegment } from '../../../core/types';

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

function disabledActionStyle(disabled: boolean): string {
    return disabled ? 'style="opacity:.3;pointer-events:none"' : '';
}

export function labelItemHtml(label: SegmentLabel, index: number, count: number): string {
    const visibility = labelVisibilityUi(label);
    return `
            <div class="label-item${visibility.itemClass}" data-id="${label.id}">
                <div class="label-sw" style="background:${visibility.background};border:1px solid ${label.color}"></div>
                <div class="label-inf">
                    <div class="label-nm">${esc(label.name)}</div>
                    <div class="label-rng">0x${label.startAddress.toString(16).toUpperCase().padStart(8, '0')} &middot; ${fmtB(label.length)}</div>
                </div>
                <span class="label-act label-vis" data-id="${label.id}" data-hidden="${visibility.hiddenFlag}" title="${visibility.title}">${visibility.icon}</span>
                <span class="label-act label-up"  data-id="${label.id}" title="Move up"   ${disabledActionStyle(index === 0)}>&#8593;</span>
                <span class="label-act label-dn"  data-id="${label.id}" title="Move down" ${disabledActionStyle(index === count - 1)}>&#8595;</span>
                ${actionBtnsHtml(`data-id="${label.id}"`, `data-id="${label.id}"`)}
            </div>`;
}

export function labelFormHtml(editing: SegmentLabel | undefined, swatchHtml: string, defaultStart: string, defaultRange: string): string {
    const mode = editing
        ? { title: 'Edit Label', saveLabel: 'Update' }
        : { title: 'New Label', saveLabel: 'Add' };
    return `
        <div class="sb-hdr">${mode.title}</div>
        <div class="lbl-form">
            <div class="lf-field">
                <span class="lf-lbl">Name</span>
                <input id="lf-name" class="lf-input" type="text" placeholder="My Segment" value="${esc(editing?.name ?? '')}">
            </div>
            <div class="lf-field">
                <span class="lf-lbl">Start address</span>
                <input id="lf-start" class="lf-input" type="text" placeholder="0x08000000" value="${esc(defaultStart)}">
            </div>
            <div class="lf-field">
                <span class="lf-lbl">Range</span>
                <div class="lf-range-row">
                    <div class="lf-mode-grp">
                        <button class="lf-mode active" data-mode="len">Length</button>
                        <button class="lf-mode" data-mode="end">End addr</button>
                    </div>
                    <input id="lf-range" class="lf-input" type="text" placeholder="512" value="${esc(defaultRange)}">
                </div>
            </div>
            <div class="lf-field">
                <span class="lf-lbl">Color</span>
                <div class="lf-swatches">${swatchHtml}</div>
            </div>
            <div class="lf-warn" id="lf-warn"></div>
            <div class="lf-actions">
                <button class="lf-btn lf-save" id="lf-save">${mode.saveLabel}</button>
                <button class="lf-btn lf-cancel" id="lf-cancel">Cancel</button>
            </div>
        </div>`;
}

export function labelsBadgeHtml(count: number): string {
    return count > 0 ? `<span class="sb-badge">${count}</span>` : '';
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

export function isOutsideMappedData(segments: SerializedSegment[], startAddress: number, endAddress: number): boolean {
    return segments.length > 0 && !segments.some(segment =>
        startAddress <= segment.startAddress + segment.data.length - 1 && endAddress >= segment.startAddress
    );
}
