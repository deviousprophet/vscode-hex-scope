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

export interface InspectorLabelFormHost {
    root: HTMLElement | null;
    selection: { start: number | null; end: number | null };
    segments: SerializedSegment[];
    labels: SegmentLabel[];
    cb: Pick<InspectorCallbacks, 'onLabelsChange'>;
    renderLabels(): void;
}

export function renderLabelForm(panel: InspectorLabelFormHost, editId?: string): void {
    const sec = panel.root?.querySelector<HTMLElement>('#s-labels') ?? null;
    if (!sec) { return; }
    const editing = panel.labels.find(l => l.id === editId);

    sec.dataset.collapsed = 'false';
    sec.classList.remove('collapsed');

    const chosenColor = defaultLabelColor(editing, LABEL_COLORS[panel.labels.length % LABEL_COLORS.length].v);
    sec.innerHTML = labelFormHtml(
        editing,
        labelSwatchesHtml(chosenColor),
        defaultLabelStart(panel.selection, editing),
        defaultLabelRange(panel.selection, editing),
    );

    const formState = { chosenColor, rangeMode: 'len' as LabelRangeMode, pendingWarning: false };
    wireLabelForm(panel, sec, editId, editing, formState);
}

export function updateLabelFormSel(panel: InspectorLabelFormHost): void {
    const { start } = panel.selection;
    if (start === null) { return; }
    const startEl = labelStartEl(panel);
    if (!startEl) { return; }
    startEl.value = labelAddrHex(start);
    fillLabelRangeValue(panel, start);
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
    panel.cb.onLabelsChange?.(panel.labels);
}

function saveLabel(panel: InspectorLabelFormHost, editId: string | undefined, editing: SegmentLabel | undefined, color: string, rangeMode: LabelRangeMode, confirmed: boolean): boolean {
    clearLabelWarning(panel);
    const draft = readLabelDraft(panel, rangeMode);
    if (!draft.ok) {
        showLabelError(panel, draft.error);
        return false;
    }
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
    state: { chosenColor: string; rangeMode: LabelRangeMode; pendingWarning: boolean },
): void {
    wireLabelColorSwatches(sec, color => { state.chosenColor = color; });

    sec.querySelectorAll<HTMLElement>('.compact-tabs button').forEach(btn => {
        btn.addEventListener('click', () => {
            state.rangeMode = switchLabelRangeMode(panel, sec, btn, state.rangeMode, editing);
            state.pendingWarning = false;
            clearLabelWarning(panel);
        });
    });

    const clearPending = (): void => {
        state.pendingWarning = false;
        clearLabelWarning(panel);
    };
    sec.querySelector<HTMLElement>('#lf-name')?.addEventListener('input', clearPending);
    sec.querySelector<HTMLElement>('#lf-start')?.addEventListener('input', clearPending);
    sec.querySelector<HTMLElement>('#lf-range')?.addEventListener('input', clearPending);

    sec.querySelector<HTMLElement>('#lf-cancel')?.addEventListener('click', () => panel.renderLabels());
    sec.querySelector<HTMLElement>('#lf-save')?.addEventListener('click', () => {
        state.pendingWarning = saveLabel(panel, editId, editing, state.chosenColor, state.rangeMode, state.pendingWarning);
    });
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

// ── Selection → live form sync ───────────────────────────────────

function fillLabelRangeValue(panel: InspectorLabelFormHost, start: number): void {
    const end = panel.selection.end;
    const rangeEl = labelRangeEl(panel);
    if (rangeEl && end !== null && end >= start) {
        rangeEl.value = String(end - start + 1);
    }
}
