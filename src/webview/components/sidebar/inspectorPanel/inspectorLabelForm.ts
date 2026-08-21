// ── Inspector label form — state machine + validation ─────────────
// The inline add/edit label form inside the Labels section: range-mode
// switching, draft validation, warning gating, save/cancel wiring
// (split out of InspectorPanel.ts). Operates on an InspectorLabelFormHost
// (the panel exposing root/selection/segments/labels + onLabelsChange);
// DOM reads/writes happen here, model/domain state stays host-owned.

import { esc } from '../../../utils';
import type { SegmentLabel, SerializedSegment } from '../../../../core/types';
import {
    defaultLabelColor,
    endAddressOrEmpty,
    isOutsideMappedData,
    isValidLabelEnd,
    labelChipText,
    labelFormHtml,
    LABEL_COLORS,
    mergeLabel,
    parseEndAddressLength,
    parseExplicitLength,
    type LabelDraftResult,
    type LabelLengthResult,
    type LabelRangeMode,
} from './inspectorLabels';
import {
    defaultLabelRange,
    defaultLabelStart,
    labelAddrHex,
    labelSwatchesHtml,
    nextLabelName,
} from './inspectorRender';
import type { InspectorCallbacks } from './inspectorPanel';
import type { SidebarSections } from '../sidebar';

export interface InspectorLabelFormHost {
    root: HTMLElement | null;
    sections: SidebarSections | null;
    selection: { start: number | null; end: number | null };
    segments: SerializedSegment[];
    labels: SegmentLabel[];
    /** Pinned-segment name overrides keyed by start address (decimal string). */
    segmentNames: Record<string, string>;
    /** Live form state; present only while the inline form is open. */
    labelFormState?: LabelFormState;
    cb: Pick<InspectorCallbacks, 'onLabelsChange' | 'onLabelDraftChange'>;
    renderLabels(): void;
}

export interface LabelFormState {
    chosenColor: string;
    rangeMode: LabelRangeMode;
    pendingWarning: boolean;
    /** Last-focused field → receives hex-view click/drag auto-fill. */
    lastFocused: 'start' | 'range' | null;
}

export function renderLabelForm(panel: InspectorLabelFormHost, editId?: string): void {
    const body = panel.sections?.body('labels');
    if (!body) { return; }
    const editing = panel.labels.find(l => l.id === editId);

    panel.sections!.setCollapsed('labels', false);

    const chosenColor = defaultLabelColor(editing, LABEL_COLORS[panel.labels.length % LABEL_COLORS.length].v);
    const rangeMode: LabelRangeMode = 'end';
    const defaultStart = formDefaultStart(panel, editing);
    const defaultRange = formDefaultRange(panel, editing, rangeMode);
    const chipText = labelChipText(rangeMode, parseInt(defaultStart.replace(/^0x/i, ''), 16), defaultRange);
    body.innerHTML = labelFormHtml(
        editing,
        labelSwatchesHtml(chosenColor),
        defaultStart,
        defaultRange,
        rangeMode,
        chipText,
    );

    const formState: LabelFormState = { chosenColor, rangeMode, pendingWarning: false, lastFocused: null };
    panel.labelFormState = formState;
    wireLabelForm(panel, body, editId, editing, formState);
    labelNameEl(panel)?.focus();
}

function formDefaultStart(panel: InspectorLabelFormHost, editing: SegmentLabel | undefined): string {
    return defaultLabelStart(panel.selection, editing);
}

function formDefaultRange(panel: InspectorLabelFormHost, editing: SegmentLabel | undefined, mode: LabelRangeMode): string {
    return defaultLabelRange(panel.selection, editing, mode);
}

/**
 * Hex-view selection change → live-update the open form. Auto-fill fires
 * ONLY here (never on keystrokes): the last-focused field receives the fill.
 * - Range focused → switch to End addr mode and fill the selection end.
 * - Otherwise → fill Start, then Range per current mode (length or end).
 */
export function updateLabelFormSel(panel: InspectorLabelFormHost): void {
    const targets = openFormTargets(panel);
    if (!targets) { return; }
    if (targets.state.lastFocused === 'range') {
        fillRangeFromSelection(panel, targets.state, targets.rangeEl);
    } else {
        fillStartAndRange(panel, targets.state, targets.startEl, targets.rangeEl);
    }
    syncDraftPreview(panel, targets.state);
}

/** Refresh the auto-calc chip + report the draft range to the host grid. */
function syncDraftPreview(panel: InspectorLabelFormHost, state: LabelFormState): void {
    const chip = panel.root?.querySelector<HTMLElement>('#lf-chip');
    if (chip) {
        const start = labelStartAddress(panel);
        const raw = labelRangeEl(panel)?.value ?? '';
        const text = labelChipText(state.rangeMode, start, raw);
        chip.textContent = text;
        if (text) { chip.title = text; } else { chip.removeAttribute('title'); }
    }
    const start = labelStartAddress(panel);
    const parsed = parseLabelLength(panel, state.rangeMode, start);
    panel.cb.onLabelDraftChange?.(isNaN(start) || !parsed.ok
        ? null
        : { start, end: start + parsed.length - 1, color: state.chosenColor });
}

/** Open form with both field elements present — else null. */
function openFormTargets(panel: InspectorLabelFormHost): { state: LabelFormState; startEl: HTMLInputElement; rangeEl: HTMLInputElement } | null {
    const state = panel.labelFormState;
    const startEl = labelStartEl(panel);
    const rangeEl = labelRangeEl(panel);
    const blocked = [
        !state,
        panel.selection.start === null,
        !startEl,
        !rangeEl,
    ];
    if (blocked.some(Boolean)) { return null; }
    return { state: state!, startEl: startEl!, rangeEl: rangeEl! };
}

/** Range focused → auto-switch to End addr mode and fill the selection end. */
function fillRangeFromSelection(panel: InspectorLabelFormHost, state: LabelFormState, rangeEl: HTMLInputElement): void {
    activateRangeTab(panel, 'end');
    state.rangeMode = 'end';
    const { start, end } = panel.selection;
    rangeEl.placeholder = '0x0800FFFF';
    rangeEl.value = labelAddrHex(Math.max(end ?? start ?? 0, start ?? 0));
}

/** Start focused (or nothing focused) → Start fills, Range follows its mode. */
function fillStartAndRange(panel: InspectorLabelFormHost, state: LabelFormState, startEl: HTMLInputElement, rangeEl: HTMLInputElement): void {
    const { start } = panel.selection;
    if (start === null) { return; }
    startEl.value = labelAddrHex(start);
    fillRangeForMode(panel, state, start);
}

function fillRangeForMode(panel: InspectorLabelFormHost, state: LabelFormState, start: number): void {
    const rangeEl = labelRangeEl(panel);
    if (!rangeEl) { return; }
    const selEnd = selectionEnd(start, panel.selection.end);
    rangeEl.value = state.rangeMode === 'end'
        ? endOrEmpty(selEnd)
        : lengthOrEmpty(selEnd, start);
}

function endOrEmpty(end: number | null): string {
    return end !== null ? labelAddrHex(end) : '';
}

function lengthOrEmpty(end: number | null, start: number): string {
    return end !== null ? String(end - start + 1) : '';
}

function selectionEnd(start: number, end: number | null): number | null {
    return end !== null && end >= start ? end : null;
}

/** Flips the compact-tabs active state without rewriting the range value. */
function activateRangeTab(panel: InspectorLabelFormHost, mode: LabelRangeMode): void {
    panel.sections?.body('labels')?.querySelectorAll<HTMLElement>('.compact-tabs button').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === mode);
    });
}

// ── Form element accessors ───────────────────────────────────────

function labelNameEl(panel: InspectorLabelFormHost): HTMLInputElement | null {
    return panel.root?.querySelector<HTMLInputElement>('#lf-name') ?? null;
}

function labelStartEl(panel: InspectorLabelFormHost): HTMLInputElement | null {
    return panel.root?.querySelector<HTMLInputElement>('#lf-start') ?? null;
}

function labelRangeEl(panel: InspectorLabelFormHost): HTMLInputElement | null {
    return panel.root?.querySelector<HTMLInputElement>('#lf-range') ?? null;
}

function labelWarnEl(panel: InspectorLabelFormHost): HTMLElement | null {
    return panel.root?.querySelector<HTMLElement>('#lf-warn') ?? null;
}

function clearLabelWarning(panel: InspectorLabelFormHost): void {
    const el = labelWarnEl(panel);
    if (el) { el.textContent = ''; }
}

// ── Range-mode switching ─────────────────────────────────────────

function switchLabelRangeMode(
    panel: InspectorLabelFormHost,
    sec: HTMLElement,
    btn: HTMLElement,
    currentMode: LabelRangeMode,
    editing: SegmentLabel | undefined,
): LabelRangeMode {
    if (btn.classList.contains('active')) { return currentMode; }
    sec.querySelectorAll<HTMLElement>('.compact-tabs button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const nextMode = btn.dataset.mode as LabelRangeMode;
    const startEl = labelStartEl(panel);
    const start = startEl ? parseInt(startEl.value.replace(/^0x/i, ''), 16) : NaN;
    updateLabelRangeValue(panel, currentMode, nextMode, start, editing);
    return nextMode;
}

function updateLabelRangeValue(
    panel: InspectorLabelFormHost,
    currentMode: LabelRangeMode,
    nextMode: LabelRangeMode,
    start: number,
    editing: SegmentLabel | undefined,
): void {
    if (currentMode === 'len' && nextMode === 'end') {
        showEndAddressRange(panel, start);
        return;
    }
    showLengthRange(panel, start, editing);
}

function showEndAddressRange(panel: InspectorLabelFormHost, start: number): void {
    const rangeEl = labelRangeEl(panel);
    if (!rangeEl) { return; }
    rangeEl.placeholder = '0x0800FFFF';
    const length = parseInt(rangeEl.value, 10);
    rangeEl.value = endAddressOrEmpty(start, length);
}

function showLengthRange(panel: InspectorLabelFormHost, start: number, editing: SegmentLabel | undefined): void {
    const rangeEl = labelRangeEl(panel);
    if (!rangeEl) { return; }
    rangeEl.placeholder = '512';
    const end = parseInt(rangeEl.value.replace(/^0x/i, ''), 16);
    rangeEl.value = isValidLabelEnd(start, end)
        ? `${end - start + 1}`
        : (editing ? `${editing.length}` : '');
}

// ── Draft validation ─────────────────────────────────────────────

function parseLabelLength(panel: InspectorLabelFormHost, mode: LabelRangeMode, startAddress: number): LabelLengthResult {
    const raw = labelRangeEl(panel)?.value ?? '';
    if (mode === 'end') {
        return parseEndAddressLength(raw, startAddress);
    }
    return parseExplicitLength(raw);
}

function labelRangeWarning(panel: InspectorLabelFormHost, startAddress: number, length: number, editId: string | undefined): string | null {
    const segEnd = startAddress + length - 1;
    if (isOutsideMappedData(panel.segments, startAddress, segEnd)) {
        return 'Range is outside mapped data. Click Save again to confirm.';
    }
    const overlap = panel.labels.filter(l =>
        l.id !== editId &&
        startAddress <= l.startAddress + l.length - 1 &&
        segEnd >= l.startAddress
    );
    return overlap.length > 0
        ? `Overlaps with: ${overlap.map(l => `"${esc(l.name)}"`).join(', ')}. Click Save again.`
        : null;
}

function readLabelDraft(panel: InspectorLabelFormHost, rangeMode: LabelRangeMode): LabelDraftResult {
    const name = readLabelName(panel);
    if (!name) { return { ok: false, error: 'Name is required.' }; }
    const startAddress = labelStartAddress(panel);
    if (isNaN(startAddress)) { return { ok: false, error: 'Invalid start address.' }; }
    const parsedLength = parseLabelLength(panel, rangeMode, startAddress);
    if (!parsedLength.ok) { return { ok: false, error: parsedLength.error }; }
    return { ok: true, name, startAddress, length: parsedLength.length };
}

function labelStartAddress(panel: InspectorLabelFormHost): number {
    const startEl = labelStartEl(panel);
    return startEl ? parseInt(startEl.value.replace(/^0x/i, ''), 16) : NaN;
}

function readLabelName(panel: InspectorLabelFormHost): string {
    return labelNameEl(panel)?.value.trim() || nextLabelName(panel.labels);
}

// ── Save / apply ─────────────────────────────────────────────────

function applyLabel(panel: InspectorLabelFormHost, editId: string | undefined, editing: SegmentLabel | undefined, color: string, draft: Extract<LabelDraftResult, { ok: true }>): void {
    const label: SegmentLabel = {
        id: editId ?? `lbl_${Date.now()}`,
        name: draft.name,
        startAddress: draft.startAddress,
        length: draft.length,
        color,
        hidden: editing ? editing.hidden : undefined,
    };
    panel.labels = mergeLabel(panel.labels, editId, label);
    panel.cb.onLabelsChange?.(panel.labels, panel.segmentNames);
}

function saveLabel(panel: InspectorLabelFormHost, editId: string | undefined, editing: SegmentLabel | undefined, color: string, rangeMode: LabelRangeMode, confirmed: boolean): boolean {
    clearLabelWarning(panel);
    const draft = readLabelDraft(panel, rangeMode);
    if (!draft.ok) {
        showLabelError(panel, draft.error);
        return false;
    }
    return confirmAndApplyLabel(panel, editId, editing, color, draft, confirmed);
}

/** Warning gate: first Save shows the warning and keeps the form open. */
function confirmAndApplyLabel(
    panel: InspectorLabelFormHost,
    editId: string | undefined,
    editing: SegmentLabel | undefined,
    color: string,
    draft: Extract<LabelDraftResult, { ok: true }>,
    confirmed: boolean,
): boolean {
    const warning = confirmed ? null : labelRangeWarning(panel, draft.startAddress, draft.length, editId);
    if (warning) {
        showLabelError(panel, warning);
        return true;
    }
    applyLabel(panel, editId, editing, color, draft);
    return false;
}

function showLabelError(panel: InspectorLabelFormHost, message: string): void {
    const warn = labelWarnEl(panel);
    if (warn) { warn.textContent = message; }
}

// ── Form wiring ──────────────────────────────────────────────────

function wireLabelForm(
    panel: InspectorLabelFormHost,
    sec: HTMLElement,
    editId: string | undefined,
    editing: SegmentLabel | undefined,
    state: LabelFormState,
): void {
    wireLabelColorSwatches(sec, color => {
        state.chosenColor = color;
        syncDraftPreview(panel, state);
    });

    sec.querySelectorAll<HTMLElement>('.compact-tabs button').forEach(btn => {
        btn.addEventListener('click', () => {
            state.rangeMode = switchLabelRangeMode(panel, sec, btn, state.rangeMode, editing);
            state.pendingWarning = false;
            clearLabelWarning(panel);
            syncDraftPreview(panel, state);
        });
    });
    // Focus tracking drives hex-click auto-fill (survives blur — clicking
    // the hex view moves focus, but the last-focused field stays the target).
    sec.querySelector<HTMLElement>('#lf-start')?.addEventListener('focus', () => { state.lastFocused = 'start'; });
    sec.querySelector<HTMLElement>('#lf-range')?.addEventListener('focus', () => { state.lastFocused = 'range'; });

    const clearPending = (): void => {
        state.pendingWarning = false;
        clearLabelWarning(panel);
        syncDraftPreview(panel, state);
    };
    sec.querySelector<HTMLElement>('#lf-name')?.addEventListener('input', clearPending);
    sec.querySelector<HTMLElement>('#lf-start')?.addEventListener('input', clearPending);
    sec.querySelector<HTMLElement>('#lf-range')?.addEventListener('input', clearPending);

    sec.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            e.stopPropagation();
            panel.renderLabels();
            return;
        }
        if (e.key === 'Enter' && (e.target as HTMLElement | null)?.tagName === 'INPUT') {
            e.preventDefault();
            sec.querySelector<HTMLButtonElement>('#lf-save')?.click();
        }
    });

    sec.querySelector<HTMLElement>('#lf-cancel')?.addEventListener('click', () => panel.renderLabels());
    sec.querySelector<HTMLElement>('#lf-save')?.addEventListener('click', () => {
        state.pendingWarning = saveLabel(panel, editId, editing, state.chosenColor, state.rangeMode, state.pendingWarning);
    });
}

function wireLabelColorSwatches(sec: HTMLElement, onColor: (color: string) => void): void {
    sec.querySelectorAll<HTMLElement>('.lf-swatch').forEach(sw => {
        sw.addEventListener('click', () => {
            sec.querySelectorAll('.lf-swatch').forEach(s => {
                s.classList.remove('selected');
                s.setAttribute('aria-pressed', 'false');
            });
            sw.classList.add('selected');
            sw.setAttribute('aria-pressed', 'true');
            onColor(sw.dataset.color!);
        });
    });
}

// ── Selection → live form sync ───────────────────────────────────
// (updateLabelFormSel above; auto-fill fires only on selection changes,
// never on keystrokes — manual typing is only ever replaced by a new
// hex-view selection, per the fill rules.)
