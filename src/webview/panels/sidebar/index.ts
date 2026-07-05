// ── Sidebar panels ────────────────────────────────────────────────
// Inspector · Bit View · Multi-Byte interpreter · Parsed Segments · Segment Labels

import { S } from '../../state';
import { esc, fmtB, actionBtnsHtml, wireActionBtns } from '../../utils';
import { postProviderMessage } from '../../api';
import { rerender } from '../../render';
import { buildMemRows } from '../../data';
import type { SerializedSegment } from '../../../core/types';

// ── Inspector ────────────────────────────────────────────────────

export { renderBits, renderInspector, updateInspector } from '../inspector/index';

function segmentAddress(address: number): string {
    return `0x${address.toString(16).toUpperCase().padStart(8, '0')}`;
}

function sortedSegments(): SerializedSegment[] {
    if (!S.parseResult) { return []; }
    return [...S.parseResult.segments].sort((a, b) => a.startAddress - b.startAddress);
}

function segmentBadgeHtml(segments: SerializedSegment[]): string {
    return segments.length > 0 ? `<span class="sb-badge">${segments.length}</span>` : '';
}

function segmentItemHtml(segment: SerializedSegment, index: number): string {
    const endAddress = segment.startAddress + segment.data.length - 1;
    const start = segmentAddress(segment.startAddress);
    return `
        <div class="segment-item" data-start="${segment.startAddress}" role="button" tabindex="0"
             title="Jump to ${start}" aria-label="Jump to Segment ${index + 1} at ${start}">
            <div class="segment-nm">Segment ${index + 1}</div>
            <div class="segment-rng">${start}&ndash;${segmentAddress(endAddress)} &middot; ${fmtB(segment.data.length)}</div>
        </div>`;
}

function segmentItemsHtml(segments: SerializedSegment[]): string {
    if (segments.length === 0) { return '<div class="sb-empty">No segments</div>'; }
    return segments.map(segmentItemHtml).join('');
}

function setupSegmentCollapse(sec: HTMLElement): void {
    if (sec.dataset.collapsed === undefined) { sec.dataset.collapsed = 'false'; }
    sec.classList.toggle('collapsed', sec.dataset.collapsed === 'true');

    sec.querySelector<HTMLElement>('.sb-hdr')!.addEventListener('click', () => {
        const now = sec.dataset.collapsed === 'true' ? 'false' : 'true';
        sec.dataset.collapsed = now;
        sec.classList.toggle('collapsed', now === 'true');
    });
}

function jumpToSegment(item: HTMLElement): void {
    const startAddress = Number(item.dataset.start);
    if (Number.isFinite(startAddress)) { rerender.jumpTo(startAddress); }
}

function handleSegmentKeydown(event: KeyboardEvent, item: HTMLElement): void {
    if (event.key !== 'Enter' && event.key !== ' ') { return; }
    event.preventDefault();
    jumpToSegment(item);
}

function wireSegmentNavigation(sec: HTMLElement): void {
    sec.querySelectorAll<HTMLElement>('.segment-item').forEach(item => {
        item.addEventListener('click', () => jumpToSegment(item));
        item.addEventListener('keydown', event => handleSegmentKeydown(event, item));
    });
}

export function renderSegments(): void {
    const sec = document.getElementById('s-segments')!;
    const segments = sortedSegments();
    sec.innerHTML = `
        <div class="sb-hdr">Segments ${segmentBadgeHtml(segments)}</div>
        <div class="sb-body">${segmentItemsHtml(segments)}</div>`;
    setupSegmentCollapse(sec);
    wireSegmentNavigation(sec);
}

// ── Labels ────────────────────────────────────────────────────────

export function renderLabels(): void {
    const sec   = document.getElementById('s-labels')!;
    const badge = labelBadgeHtml();
    const items = labelItemsHtml(S.labels);

    sec.innerHTML = `
        <div class="sb-hdr">Labels ${badge}</div>
        <div class="sb-body">${items}
        <button class="add-lbl-btn" id="btn-add-lbl">+ Add Segment Label</button>
        </div>`;

    // Persist collapsed state on the section element; default collapsed
    if (sec.dataset.collapsed === undefined) { sec.dataset.collapsed = 'true'; }
    sec.classList.toggle('collapsed', sec.dataset.collapsed === 'true');

    // Header toggles collapse state
    const lh = sec.querySelector<HTMLElement>('.sb-hdr');
    if (lh) {
        lh.addEventListener('click', () => {
            const now = sec.dataset.collapsed === 'true' ? 'false' : 'true';
            sec.dataset.collapsed = now;
            sec.classList.toggle('collapsed', now === 'true');
        });
    }

    wireActionBtns(
        sec,
        '.act-btn-edit',
        '.act-btn-del',
        el => renderLabelForm(el.dataset.id),
        el => {
            S.labels = S.labels.filter(l => l.id !== el.dataset.id);
            postProviderMessage({ type: 'saveLabels', labels: S.labels });
            buildMemRows();
            rerender.labels();
            if (S.currentView === 'memory') { rerender.memory(); }
        },
    );

    // Toggle visibility
    sec.querySelectorAll<HTMLElement>('.label-vis').forEach(el => {
        el.addEventListener('click', () => {
            const id     = el.dataset.id!;
            const hidden = el.dataset.hidden === '1' ? false : true;
            S.labels = S.labels.map(l => l.id === id ? { ...l, hidden } : l);
            persistLabelsAndRender();
        });
    });

    // Move up
    sec.querySelectorAll<HTMLElement>('.label-up').forEach(el => {
        el.addEventListener('click', () => {
            const idx = S.labels.findIndex(l => l.id === el.dataset.id);
            if (idx <= 0) { return; }
            const next = [...S.labels];
            [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
            S.labels = next;
            persistLabelsAndRender();
        });
    });

    // Move down
    sec.querySelectorAll<HTMLElement>('.label-dn').forEach(el => {
        el.addEventListener('click', () => {
            const idx = S.labels.findIndex(l => l.id === el.dataset.id);
            if (idx < 0 || idx >= S.labels.length - 1) { return; }
            const next = [...S.labels];
            [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
            S.labels = next;
            persistLabelsAndRender();
        });
    });

    // Jump to label address on row click (but not when clicking action buttons)
    sec.querySelectorAll<HTMLElement>('.label-item').forEach(item => {
        item.style.cursor = 'pointer';
        item.addEventListener('click', e => {
            if ((e.target as HTMLElement).closest('.label-act')) { return; }
            const id  = item.dataset.id!;
            const lbl = S.labels.find(l => l.id === id);
            if (lbl) { rerender.jumpTo(lbl.startAddress); }
        });
    });

    // Add — open inline form
    document.getElementById('btn-add-lbl')?.addEventListener('click', () => renderLabelForm());
}

function labelItemsHtml(labels: LabelState[]): string {
    return labels.length === 0
        ? '<div class="sb-empty">No labels defined</div>'
        : labels.map((label, index) => labelItemHtml(label, index, labels.length)).join('');
}

function labelVisibilityUi(label: LabelState): { itemClass: string; background: string; hiddenFlag: string; title: string; icon: string } {
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

function labelItemHtml(label: LabelState, index: number, count: number): string {
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

function labelBadgeHtml(): string {
    return S.labels.length > 0 ? `<span class="sb-badge">${S.labels.length}</span>` : '';
}

function persistLabelsAndRender(): void {
    postProviderMessage({ type: 'saveLabels', labels: S.labels });
    buildMemRows();
    rerender.labels();
    if (S.currentView === 'memory') { rerender.memory(); }
}

// ── Label inline form ─────────────────────────────────────────────

type LabelRangeMode = 'len' | 'end';
type LabelState = typeof S.labels[number];
type LabelLengthResult =
    | { ok: true; length: number }
    | { ok: false; error: string };
type LabelDraftResult =
    | { ok: true; name: string; startAddress: number; length: number }
    | { ok: false; error: string };

const LABEL_COLORS = [
    { name: 'Sky Blue', v: '#4fc3f7' }, { name: 'Green',  v: '#81c784' },
    { name: 'Orange',   v: '#ffb74d' }, { name: 'Red',    v: '#e57373' },
    { name: 'Purple',   v: '#ce93d8' }, { name: 'Teal',   v: '#80cbc4' },
    { name: 'Yellow',   v: '#fff176' }, { name: 'Pink',   v: '#f48fb1' },
];

function labelAddrHex(n: number): string {
    return `0x${n.toString(16).toUpperCase().padStart(8, '0')}`;
}

function nextLabelName(): string {
    const taken = new Set(S.labels.map(l => l.name));
    let candidate = 'Label_0';
    let n = 1;
    while (taken.has(candidate)) { candidate = `Label_${n++}`; }
    return candidate;
}

function labelWarnEl(): HTMLElement {
    return document.getElementById('lf-warn')! as HTMLElement;
}

function labelNameEl(): HTMLInputElement {
    return document.getElementById('lf-name')! as HTMLInputElement;
}

function labelStartEl(): HTMLInputElement {
    return document.getElementById('lf-start')! as HTMLInputElement;
}

function labelRangeEl(): HTMLInputElement {
    return document.getElementById('lf-range')! as HTMLInputElement;
}

function clearLabelWarning(): void {
    labelWarnEl().textContent = '';
}

function defaultLabelStart(editing: LabelState | undefined): string {
    if (editing) { return labelAddrHex(editing.startAddress); }
    return S.selStart !== null ? labelAddrHex(S.selStart) : '';
}

function defaultLabelRange(editing: LabelState | undefined): string {
    if (editing) { return `${editing.length}`; }
    return S.selStart !== null && S.selEnd !== null ? `${S.selEnd - S.selStart + 1}` : '';
}

function labelSwatchesHtml(chosenColor: string): string {
    return LABEL_COLORS.map(c =>
        `<span class="lf-swatch${c.v === chosenColor ? ' selected' : ''}" data-color="${c.v}" style="background:${c.v}" title="${c.name}"></span>`
    ).join('');
}

function wireLabelColorSwatches(sec: HTMLElement, onColor: (color: string) => void): void {
    sec.querySelectorAll<HTMLElement>('.lf-swatch').forEach(sw => {
        sw.addEventListener('click', () => {
            sec.querySelectorAll('.lf-swatch').forEach(s => s.classList.remove('selected'));
            sw.classList.add('selected');
            onColor(sw.dataset.color!);
        });
    });
}

function switchLabelRangeMode(
    sec: HTMLElement,
    btn: HTMLElement,
    currentMode: LabelRangeMode,
    editing: LabelState | undefined,
): LabelRangeMode {
    if (btn.classList.contains('active')) { return currentMode; }
    sec.querySelectorAll('.lf-mode').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const nextMode = btn.dataset.mode as LabelRangeMode;
    const start = parseInt(labelStartEl().value.replace(/^0x/i, ''), 16);
    updateLabelRangeValue(currentMode, nextMode, start, editing);
    return nextMode;
}

function updateLabelRangeValue(
    currentMode: LabelRangeMode,
    nextMode: LabelRangeMode,
    start: number,
    editing: LabelState | undefined,
): void {
    if (currentMode === 'len' && nextMode === 'end') {
        showEndAddressRange(start);
        return;
    }

    showLengthRange(start, editing);
}

function showEndAddressRange(start: number): void {
    const rangeEl = labelRangeEl();
    rangeEl.placeholder = '0x0800FFFF';
    const length = parseInt(rangeEl.value, 10);
    rangeEl.value = (!isNaN(start) && !isNaN(length) && length > 0)
        ? labelAddrHex(start + length - 1)
        : '';
}

function showLengthRange(start: number, editing: LabelState | undefined): void {
    const rangeEl = labelRangeEl();
    rangeEl.placeholder = '512';
    const end = parseInt(rangeEl.value.replace(/^0x/i, ''), 16);
    rangeEl.value = isValidLabelEnd(start, end)
        ? `${end - start + 1}`
        : (editing ? `${editing.length}` : '');
}

function isValidLabelEnd(start: number, end: number): boolean {
    return !isNaN(start) && !isNaN(end) && end >= start;
}

function parseLabelLength(mode: LabelRangeMode, startAddress: number): LabelLengthResult {
    const raw = labelRangeEl().value;
    if (mode === 'end') {
        return parseEndAddressLength(raw, startAddress);
    }

    return parseExplicitLength(raw);
}

function parseEndAddressLength(raw: string, startAddress: number): LabelLengthResult {
    const end = parseInt(raw.replace(/^0x/i, ''), 16);
    if (isNaN(end) || end < startAddress) { return { ok: false, error: 'Invalid end address.' }; }
    return { ok: true, length: end - startAddress + 1 };
}

function parseExplicitLength(raw: string): LabelLengthResult {
    const length = /^0x/i.test(raw) ? parseInt(raw, 16) : parseInt(raw, 10);
    if (isNaN(length) || length <= 0) { return { ok: false, error: 'Invalid length.' }; }
    return { ok: true, length };
}

function labelRangeWarning(startAddress: number, length: number, editId: string | undefined): string | null {
    const segEnd = startAddress + length - 1;
    if (isOutsideMappedData(startAddress, segEnd)) {
        return 'Range is outside mapped data. Click Save again to confirm.';
    }

    const overlap = S.labels.filter(l =>
        l.id !== editId &&
        startAddress <= l.startAddress + l.length - 1 &&
        segEnd >= l.startAddress
    );
    return overlap.length > 0
        ? `Overlaps with: ${overlap.map(l => `"${esc(l.name)}"`).join(', ')}. Click Save again.`
        : null;
}

function isOutsideMappedData(startAddress: number, endAddress: number): boolean {
    const segments = S.parseResult?.segments ?? [];
    return segments.length > 0 && !segments.some(segment =>
        startAddress <= segment.startAddress + segment.data.length - 1 && endAddress >= segment.startAddress
    );
}

function readLabelDraft(rangeMode: LabelRangeMode): LabelDraftResult {
    const name = readLabelName();
    if (!name) { return { ok: false, error: 'Name is required.' }; }

    const startAddress = parseInt(labelStartEl().value.replace(/^0x/i, ''), 16);
    if (isNaN(startAddress)) { return { ok: false, error: 'Invalid start address.' }; }

    const parsedLength = parseLabelLength(rangeMode, startAddress);
    if (!parsedLength.ok) { return { ok: false, error: parsedLength.error }; }

    return { ok: true, name, startAddress, length: parsedLength.length };
}

function readLabelName(): string {
    return labelNameEl().value.trim() || nextLabelName();
}

function applyLabel(editId: string | undefined, editing: LabelState | undefined, color: string, draft: Extract<LabelDraftResult, { ok: true }>): void {
    const label = {
        id: editId ?? `lbl_${Date.now()}`,
        name: draft.name,
        startAddress: draft.startAddress,
        length: draft.length,
        color,
        hidden: editing?.hidden,
    };
    S.labels = editId
        ? S.labels.map(l => l.id === editId ? label : l)
        : [...S.labels, label];

    postProviderMessage({ type: 'saveLabels', labels: S.labels });
    buildMemRows();
    rerender.labels();
    rerenderMemoryIfVisible();
}

function rerenderMemoryIfVisible(): void {
    if (S.currentView === 'memory') { rerender.memory(); }
}

function saveLabel(editId: string | undefined, editing: LabelState | undefined, color: string, rangeMode: LabelRangeMode, confirmed: boolean): boolean {
    clearLabelWarning();

    const draft = readLabelDraft(rangeMode);
    if (!draft.ok) { labelWarnEl().textContent = draft.error; return false; }

    const warning = confirmed ? null : labelRangeWarning(draft.startAddress, draft.length, editId);
    if (warning) {
        labelWarnEl().textContent = warning;
        return true;
    }

    applyLabel(editId, editing, color, draft);
    return false;
}

function renderLabelForm(editId?: string): void {
    const sec     = document.getElementById('s-labels')!;
    const editing = editId ? S.labels.find(l => l.id === editId) : undefined;

    // Ensure the labels section is expanded while editing
    sec.dataset.collapsed = 'false';
    sec.classList.remove('collapsed');

    let chosenColor = editing?.color ?? LABEL_COLORS[S.labels.length % LABEL_COLORS.length].v;
    const swatchHtml = labelSwatchesHtml(chosenColor);

    sec.innerHTML = labelFormHtml(editing, swatchHtml);

    let rangeMode: LabelRangeMode = 'len';
    let pendingWarning = false;

    wireLabelColorSwatches(sec, color => { chosenColor = color; });

    // Range mode toggle
    sec.querySelectorAll<HTMLElement>('.lf-mode').forEach(btn => {
        btn.addEventListener('click', () => {
            rangeMode = switchLabelRangeMode(sec, btn, rangeMode, editing);
            pendingWarning = false;
            clearLabelWarning();
        });
    });

    // Clear warning on input change
    ['lf-name', 'lf-start', 'lf-range'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', () => {
            pendingWarning = false;
            clearLabelWarning();
        });
    });

    // Cancel
    document.getElementById('lf-cancel')?.addEventListener('click', () => renderLabels());

    // Save
    document.getElementById('lf-save')?.addEventListener('click', () => {
        pendingWarning = saveLabel(editId, editing, chosenColor, rangeMode, pendingWarning);
    });
}

function labelFormHtml(editing: LabelState | undefined, swatchHtml: string): string {
    const mode = labelFormMode(editing);
    return `
        <div class="sb-hdr">${mode.title}</div>
        <div class="lbl-form">
            <div class="lf-field">
                <span class="lf-lbl">Name</span>
                <input id="lf-name" class="lf-input" type="text" placeholder="My Segment" value="${esc(editing?.name ?? '')}">
            </div>
            <div class="lf-field">
                <span class="lf-lbl">Start address</span>
                <input id="lf-start" class="lf-input" type="text" placeholder="0x08000000" value="${defaultLabelStart(editing)}">
            </div>
            <div class="lf-field">
                <span class="lf-lbl">Range</span>
                <div class="lf-range-row">
                    <div class="lf-mode-grp">
                        <button class="lf-mode active" data-mode="len">Length</button>
                        <button class="lf-mode" data-mode="end">End addr</button>
                    </div>
                    <input id="lf-range" class="lf-input" type="text" placeholder="512" value="${defaultLabelRange(editing)}">
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

function labelFormMode(editing: LabelState | undefined): { title: string; saveLabel: string } {
    return editing
        ? { title: 'Edit Label', saveLabel: 'Update' }
        : { title: 'New Label', saveLabel: 'Add' };
}

/**
 * Called whenever the hex-view selection changes.
 * If the label form (#lf-start) is currently open, updates its address
 * (and range) fields to reflect the newly selected byte(s).
 */
export function updateLabelFormSel(): void {
    if (S.selStart === null) { return; }
    const startEl = document.getElementById('lf-start') as HTMLInputElement | null;
    if (!startEl) { return; }
    const fh = (n: number) => `0x${n.toString(16).toUpperCase().padStart(8, '0')}`;
    startEl.value = fh(S.selStart);
    updateLabelRangeFromSelection(S.selStart);
}

function updateLabelRangeFromSelection(startAddress: number): void {
    const rangeEl = document.getElementById('lf-range') as HTMLInputElement | null;
    if (rangeEl && S.selEnd !== null && S.selEnd >= startAddress) {
        rangeEl.value = String(S.selEnd - startAddress + 1);
    }
}
