// ── Inspector component ───────────────────────────────────────────
// Self-contained sidebar Inspector panel: owns the four section shells
// (Inspector / Bit View / Multi-Byte interpreter / Segments / Labels),
// their markup, collapse state, bit hover, label-form UI state, and
// interaction. Data is pushed via setters; byte reads go through the
// injected `readByte` accessor; actions report via callbacks. This
// module never imports the `S` global and never posts provider messages.

import { esc, fmtB, formatDecimal, formatHex, wireActionBtns } from '../../utils';
import type { SegmentLabel, SerializedSegment } from '../../../core/types';
import {
    defaultLabelColor,
    endAddressOrEmpty,
    isOutsideMappedData,
    isValidLabelEnd,
    labelFormHtml,
    labelItemHtml,
    labelsBadgeHtml,
    LABEL_COLORS,
    mergeLabel,
    parseEndAddressLength,
    parseExplicitLength,
    type LabelDraftResult,
    type LabelLengthResult,
    type LabelRangeMode,
} from './InspectorLabels';
import './Inspector.css';

export interface InspectorCallbacks {
    /** Host-owned byte read (memory adapter); data stays host-side. */
    readByte: (addr: number) => number | undefined;
    /** Segment/label row click → host jumps. */
    onJumpTo?: (address: number) => void;
    /** Any label mutation → host persists + invalidates. */
    onLabelsChange?: (labels: SegmentLabel[]) => void;
    /** Copy chip → host posts copyText. */
    onCopy?: (text: string, label: string) => void;
}

export class Inspector {
    private readonly cb: InspectorCallbacks;
    private selection: { start: number | null; end: number | null } = { start: null, end: null };
    private endian: 'le' | 'be' = 'le';
    private segments: SerializedSegment[] = [];
    private labels: SegmentLabel[] = [];
    private root: HTMLElement | null = null;

    constructor(cb: InspectorCallbacks) {
        this.cb = cb;
    }

    /** Renders the four section shells and wires doc-delegated listeners (idempotent). */
    mount(root: HTMLElement): void {
        this.root = root;
        root.innerHTML = `
            <div class="sb-section" id="s-insp"></div>
            <div class="sb-section" id="s-bits"></div>
            <div class="sb-section" id="s-segments"></div>
            <div class="sb-section" id="s-labels"></div>`;
        this.renderInspectorShell();
        this.renderBits();
        this.renderSegments();
        this.renderLabels();
        this.paintInspectorData();
    }

    /** Data path (was host updateInspector). */
    setSelection(start: number | null, end: number | null): void {
        this.selection = { start, end };
        this.paintInspectorData();
    }

    /** Hex-view selection → live-update an open label form (parity: old updateLabelFormSel). */
    syncLabelForm(): void {
        this.updateLabelFormSel();
    }

    setSegments(segments: SerializedSegment[]): void {
        this.segments = segments;
        this.renderSegments();
    }

    setLabels(labels: SegmentLabel[]): void {
        this.labels = labels;
        this.renderLabels();
    }

    setEndian(endian: 'le' | 'be'): void {
        if (this.endian === endian) { return; }
        this.endian = endian;
        this.paintInspectorData();
    }

    // ── Inspector (address/vals/multi-byte) ─────────────────────

    private renderInspectorShell(): void {
        const sec = this.root?.querySelector<HTMLElement>('#s-insp');
        if (!sec) { return; }
        sec.innerHTML =
            `<div class="sb-hdr">Inspector</div>
             <div class="sb-body">
               <div id="insp-addr" style="display:none"></div>
               <div id="insp-vals"><div class="sb-empty">Click a byte to inspect</div></div>
               <div id="insp-multi"></div>
             </div>`;
        this.applyCollapsibleSection(sec, false);
    }

    private applyCollapsibleSection(sec: HTMLElement, defaultCollapsed: boolean): void {
        if (sec.dataset.collapsed === undefined) { sec.dataset.collapsed = String(defaultCollapsed); }
        sec.classList.toggle('collapsed', sec.dataset.collapsed === 'true');

        const hdr = sec.querySelector<HTMLElement>('.sb-hdr');
        if (!hdr) { return; }
        hdr.addEventListener('click', () => {
            const now = sec.dataset.collapsed === 'true' ? 'false' : 'true';
            sec.dataset.collapsed = now;
            sec.classList.toggle('collapsed', now === 'true');
        });
    }

    private inspectorSelectionLength(): number {
        const { start, end } = this.selection;
        if (start === null) { return 0; }
        return (end !== null && end >= start) ? end - start + 1 : 1;
    }

    private renderInspectorNoSelection(addrEl: HTMLElement, valsEl: HTMLElement): void {
        addrEl.style.display = 'none';
        valsEl.innerHTML = '<div class="sb-empty">Click a byte to inspect</div>';
        this.renderBits();
        this.renderMultiInline();
    }

    private renderInspectorNoData(valsEl: HTMLElement): void {
        valsEl.innerHTML = '<div class="sb-empty">No data at this address</div>';
        this.renderBits();
        this.renderMultiInline();
    }

    private renderInspectorAddress(addrEl: HTMLElement, len: number): void {
        const { start, end } = this.selection;
        if (start === null) { return; }
        const startHex = start.toString(16).toUpperCase().padStart(8, '0');
        addrEl.style.display = '';
        if (len === 1) {
            addrEl.innerHTML = `<span class="insp-addr-value">0x${esc(startHex)}</span>`;
            return;
        }
        const endHex = (end ?? start).toString(16).toUpperCase().padStart(8, '0');
        addrEl.innerHTML =
            `<span class="insp-addr-value">0x${esc(startHex)}</span>` +
            `<span class="insp-addr-sep">–</span>` +
            `<span class="insp-addr-value">0x${esc(endHex)}</span>` +
            `<span class="insp-addr-len">${esc(String(len))} bytes</span>`;
    }

    private paintInspectorData(): void {
        const state = this.readInspectorState();
        if (!state) { return; }

        this.renderInspectorAddress(state.addrEl, state.len);
        if (state.val === undefined) {
            this.renderInspectorNoData(state.valsEl);
            return;
        }
        if (state.len === 1) {
            state.valsEl.innerHTML = singleByteInspectorHtml(state.val);
            this.renderBits(state.val);
        } else {
            const selBytes = this.selectedBytes(state.len);
            state.valsEl.innerHTML = multiByteInspectorHtml(selBytes, state.len);
            this.renderBitsMulti(selBytes.slice(0, Math.min(state.len, 8)));
        }
        this.wireInspectorCopies(state.valsEl);
        this.renderMultiInline();
    }

    private readInspectorState(): { addrEl: HTMLElement; valsEl: HTMLElement; len: number; val: number | undefined } | null {
        const el = this.inspectorElements();
        if (el === null) { return null; }
        if (this.selection.start === null) {
            this.renderInspectorNoSelection(el.addrEl, el.valsEl);
            return null;
        }
        return {
            addrEl: el.addrEl,
            valsEl: el.valsEl,
            len: this.inspectorSelectionLength(),
            val: this.cb.readByte(this.selection.start),
        };
    }

    private inspectorElements(): { addrEl: HTMLElement; valsEl: HTMLElement } | null {
        const root = this.root;
        if (!root) { return null; }
        const addrEl = root.querySelector<HTMLElement>('#insp-addr');
        const valsEl = root.querySelector<HTMLElement>('#insp-vals');
        if (!addrEl || !valsEl) { return null; }
        return { addrEl, valsEl };
    }

    private selectedBytes(len: number): number[] {
        const bytes: number[] = [];
        const { start, end } = this.selection;
        if (start === null || end === null) { return bytes; }
        for (let a = start; a <= end; a++) {
            bytes.push(this.readSelectedByte(a));
        }
        return bytes.slice(0, len);
    }

    private readSelectedByte(addr: number): number {
        return this.cb.readByte(addr) ?? 0;
    }

    private wireInspectorCopies(valsEl: HTMLElement): void {
        valsEl.querySelectorAll<HTMLElement>('[data-copy]').forEach(el => {
            el.addEventListener('click', () => {
                this.cb.onCopy?.(el.dataset.copy!, el.dataset.label ?? 'value');
            });
        });
    }

    // ── Bit view ─────────────────────────────────────────────────

    private renderBits(val?: number): void {
        const sec = this.root?.querySelector<HTMLElement>('#s-bits') ?? null;
        if (!sec) { return; }
        if (val === undefined) {
            sec.innerHTML =
                `<div class="sb-hdr">Bit View</div>` +
                `<div class="sb-body"><div class="sb-empty">—</div></div>`;
        } else {
            const pc = popcount(val);
            sec.innerHTML =
                `<div class="sb-hdr">Bit View</div>` +
                `<div class="sb-body">` +
                `<div class="bitgrid-wrap">${bitIndexRowHtml()}${byteRowHtml(val, null)}</div>` +
                `<span class="bit-pc">${esc(String(pc))}/8 bits set</span></div>`;
        }
        this.applyCollapsibleSection(sec, true);
        this.wireBitColHover();
    }

    private renderBitsMulti(bytes: number[]): void {
        const sec = this.root?.querySelector<HTMLElement>('#s-bits') ?? null;
        if (!sec) { return; }
        const rowsHtml = bitRowsHtml(bytes);
        const total = bitTotalCount(bytes);
        sec.innerHTML =
            `<div class="sb-hdr">Bit View ` +
            `<span class="sb-badge" style="font-weight:400;opacity:.6">${esc(String(bytes.length))} byte${bytes.length > 1 ? 's' : ''}</span></div>` +
            `<div class="sb-body">` +
            `<div class="bitgrid-wrap">${bitIndexRowHtml()}${rowsHtml}</div>` +
            `<span class="bit-pc">${esc(String(total))}/${esc(String(bytes.length * 8))} bits set</span></div>`;

        this.applyCollapsibleSection(sec, true);
        this.wireBitColHover();
    }

    private wireBitColHover(): void {
        const wrap = this.root?.querySelector<HTMLElement>('#s-bits .bitgrid-wrap');
        if (!wrap) { return; }
        let active: string | null = null;
        const setCol = (bit: string | null) => {
            if (bit === active) { return; }
            active = bit;
            wrap.querySelectorAll<HTMLElement>('.bit-v').forEach(c =>
                c.classList.toggle('bit-col-hi', c.dataset.bit === bit)
            );
        };
        wrap.addEventListener('mouseover', e => {
            setCol((e.target as HTMLElement).dataset.bit ?? null);
        });
        wrap.addEventListener('mouseleave', () => setCol(null));
    }

    // ── Multi-byte interpreter ───────────────────────────────────

    private renderMultiInline(): void {
        const el = this.multiInlineEl();
        if (el === null) { return; }
        if (!this.hasMultiInlineStart()) {
            el.innerHTML = ''; return;
        }
        const selLen = this.multiInlineSelectionLength();
        if (selLen < 2) { el.innerHTML = ''; return; }

        const width = multiWidth(selLen);
        const le = this.endian === 'le';
        const raw = this.selectedPaddedBytes(width, selLen);
        const groupHtml = multiValueGroupHtml(width, readMultiValues(raw, le));

        el.innerHTML =
            multiPadNoteHtml(selLen, width) +
            `<div class="mi-group">${groupHtml}</div>`;

        wireMultiInlineCopies(el, (text, label) => this.cb.onCopy?.(text, label));
    }

    private multiInlineEl(): HTMLElement | null {
        return this.root?.querySelector<HTMLElement>('#insp-multi') ?? null;
    }

    private hasMultiInlineStart(): boolean {
        return this.selection.start !== null && this.cb.readByte(this.selection.start) !== undefined;
    }

    private multiInlineSelectionLength(): number {
        const { start, end } = this.selection;
        return (start !== null && end !== null && end >= start)
            ? end - start + 1
            : 1;
    }

    private selectedPaddedBytes(width: number, selLen: number): number[] {
        const { start } = this.selection;
        return Array.from({ length: width }, (_, i) => {
            const v = start !== null ? this.cb.readByte(start + i) : undefined;
            return (i < selLen && v !== undefined) ? v : 0;
        });
    }

    // ── Segments ─────────────────────────────────────────────────

    private renderSegments(): void {
        const sec = this.root?.querySelector<HTMLElement>('#s-segments') ?? null;
        if (!sec) { return; }
        const segments = [...this.segments].sort((a, b) => a.startAddress - b.startAddress);
        sec.innerHTML = `
            <div class="sb-hdr">Segments ${segmentBadgeHtml(segments)}</div>
            <div class="sb-body">${segmentItemsHtml(segments)}</div>`;

        this.applyCollapsibleSection(sec, false);
        sec.querySelectorAll<HTMLElement>('.segment-item').forEach(item => {
            item.addEventListener('click', () => this.jumpToSegment(item));
            item.addEventListener('keydown', event => this.handleSegmentKeydown(event, item));
        });
    }

    private jumpToSegment(item: HTMLElement): void {
        const startAddress = Number(item.dataset.start);
        if (Number.isFinite(startAddress)) { this.cb.onJumpTo?.(startAddress); }
    }

    private handleSegmentKeydown(event: KeyboardEvent, item: HTMLElement): void {
        if (event.key !== 'Enter' && event.key !== ' ') { return; }
        event.preventDefault();
        this.jumpToSegment(item);
    }

    // ── Labels ───────────────────────────────────────────────────

    private renderLabels(): void {
        const sec = this.root?.querySelector<HTMLElement>('#s-labels') ?? null;
        if (!sec) { return; }
        const badgeHtml = labelsBadgeHtml(this.labels.length);
        const itemsHtml = this.labelItemsHtml();
        sec.innerHTML = `
            <div class="sb-hdr">Labels ${badgeHtml}</div>
            <div class="sb-body">${itemsHtml}
            <button class="lf-add-btn" id="btn-add-lbl">+ Add Segment Label</button>
            </div>`;

        this.applyCollapsibleSection(sec, true);
        this.wireLabelActions(sec);
        this.wireLabelVisibility(sec);
        this.wireLabelMoveUp(sec);
        this.wireLabelMoveDown(sec);
        this.wireLabelJump(sec);
        this.wireLabelAdd(sec);
    }

    private wireLabelActions(sec: HTMLElement): void {
        wireActionBtns(
            sec,
            '.act-btn-edit',
            '.act-btn-del',
            el => this.renderLabelForm(el.dataset.id),
            el => {
                this.labels = this.labels.filter(l => l.id !== el.dataset.id);
                this.cb.onLabelsChange?.(this.labels);
            },
        );
    }

    private wireLabelVisibility(sec: HTMLElement): void {
        sec.querySelectorAll<HTMLElement>('.label-vis').forEach(el => {
            el.addEventListener('click', () => {
                const id = el.dataset.id!;
                const hidden = el.dataset.hidden !== '1';
                this.labels = this.labels.map(l => l.id === id ? { ...l, hidden } : l);
                this.cb.onLabelsChange?.(this.labels);
            });
        });
    }

    private wireLabelMoveUp(sec: HTMLElement): void {
        sec.querySelectorAll<HTMLElement>('.label-up').forEach(el => {
            el.addEventListener('click', () => {
                const idx = this.labels.findIndex(l => l.id === el.dataset.id);
                if (idx <= 0) { return; }
                const next = [...this.labels];
                [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                this.labels = next;
                this.cb.onLabelsChange?.(this.labels);
            });
        });
    }

    private wireLabelMoveDown(sec: HTMLElement): void {
        sec.querySelectorAll<HTMLElement>('.label-dn').forEach(el => {
            el.addEventListener('click', () => {
                const idx = this.labels.findIndex(l => l.id === el.dataset.id);
                if (idx < 0 || idx >= this.labels.length - 1) { return; }
                const next = [...this.labels];
                [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                this.labels = next;
                this.cb.onLabelsChange?.(this.labels);
            });
        });
    }

    private wireLabelJump(sec: HTMLElement): void {
        sec.querySelectorAll<HTMLElement>('.label-item').forEach(item => {
            item.style.cursor = 'pointer';
            item.addEventListener('click', e => {
                if ((e.target as HTMLElement).closest('.label-act')) { return; }
                const id = item.dataset.id!;
                const lbl = this.labels.find(l => l.id === id);
                if (lbl) { this.cb.onJumpTo?.(lbl.startAddress); }
            });
        });
    }

    private wireLabelAdd(sec: HTMLElement): void {
        sec.querySelector<HTMLElement>('#btn-add-lbl')?.addEventListener('click', () => this.renderLabelForm());
    }

    private labelItemsHtml(): string {
        return this.labels.length === 0
            ? '<div class="sb-empty">No labels defined</div>'
            : this.labels.map((label, index) => labelItemHtml(label, index, this.labels.length)).join('');
    }

    private labelAddrHex(n: number): string {
        return `0x${n.toString(16).toUpperCase().padStart(8, '0')}`;
    }

    private nextLabelName(): string {
        const taken = new Set(this.labels.map(l => l.name));
        let candidate = 'Label_0';
        let n = 1;
        while (taken.has(candidate)) { candidate = `Label_${n++}`; }
        return candidate;
    }

    private defaultLabelStart(editing: SegmentLabel | undefined): string {
        if (editing) { return this.labelAddrHex(editing.startAddress); }
        return this.selection.start !== null ? this.labelAddrHex(this.selection.start) : '';
    }

    private defaultLabelRange(editing: SegmentLabel | undefined): string {
        if (editing) { return `${editing.length}`; }
        const { start, end } = this.selection;
        return start !== null && end !== null ? `${end - start + 1}` : '';
    }

    private labelSwatchesHtml(chosenColor: string): string {
        return LABEL_COLORS.map(c =>
            `<span class="lf-swatch${c.v === chosenColor ? ' selected' : ''}" data-color="${c.v}" style="background:${c.v}" title="${c.name}"></span>`
        ).join('');
    }

    private wireLabelColorSwatches(sec: HTMLElement, onColor: (color: string) => void): void {
        sec.querySelectorAll<HTMLElement>('.lf-swatch').forEach(sw => {
            sw.addEventListener('click', () => {
                sec.querySelectorAll('.lf-swatch').forEach(s => s.classList.remove('selected'));
                sw.classList.add('selected');
                onColor(sw.dataset.color!);
            });
        });
    }

    private labelNameEl(): HTMLInputElement | null {
        return this.root?.querySelector<HTMLInputElement>('#lf-name') ?? null;
    }

    private labelStartEl(): HTMLInputElement | null {
        return this.root?.querySelector<HTMLInputElement>('#lf-start') ?? null;
    }

    private labelRangeEl(): HTMLInputElement | null {
        return this.root?.querySelector<HTMLInputElement>('#lf-range') ?? null;
    }

    private labelWarnEl(): HTMLElement | null {
        return this.root?.querySelector<HTMLElement>('#lf-warn') ?? null;
    }

    private clearLabelWarning(): void {
        const el = this.labelWarnEl();
        if (el) { el.textContent = ''; }
    }

    private switchLabelRangeMode(
        sec: HTMLElement,
        btn: HTMLElement,
        currentMode: LabelRangeMode,
        editing: SegmentLabel | undefined,
    ): LabelRangeMode {
        if (btn.classList.contains('active')) { return currentMode; }
        sec.querySelectorAll('.lf-mode').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const nextMode = btn.dataset.mode as LabelRangeMode;
        const startEl = this.labelStartEl();
        const start = startEl ? parseInt(startEl.value.replace(/^0x/i, ''), 16) : NaN;
        this.updateLabelRangeValue(currentMode, nextMode, start, editing);
        return nextMode;
    }

    private updateLabelRangeValue(
        currentMode: LabelRangeMode,
        nextMode: LabelRangeMode,
        start: number,
        editing: SegmentLabel | undefined,
    ): void {
        if (currentMode === 'len' && nextMode === 'end') {
            this.showEndAddressRange(start);
            return;
        }
        this.showLengthRange(start, editing);
    }

    private showEndAddressRange(start: number): void {
        const rangeEl = this.labelRangeEl();
        if (!rangeEl) { return; }
        rangeEl.placeholder = '0x0800FFFF';
        const length = parseInt(rangeEl.value, 10);
        rangeEl.value = endAddressOrEmpty(start, length);
    }

    private showLengthRange(start: number, editing: SegmentLabel | undefined): void {
        const rangeEl = this.labelRangeEl();
        if (!rangeEl) { return; }
        rangeEl.placeholder = '512';
        const end = parseInt(rangeEl.value.replace(/^0x/i, ''), 16);
        rangeEl.value = isValidLabelEnd(start, end)
            ? `${end - start + 1}`
            : (editing ? `${editing.length}` : '');
    }

    private parseLabelLength(mode: LabelRangeMode, startAddress: number): LabelLengthResult {
        const raw = this.labelRangeEl()?.value ?? '';
        if (mode === 'end') {
            return parseEndAddressLength(raw, startAddress);
        }
        return parseExplicitLength(raw);
    }

    private labelRangeWarning(startAddress: number, length: number, editId: string | undefined): string | null {
        const segEnd = startAddress + length - 1;
        if (isOutsideMappedData(this.segments, startAddress, segEnd)) {
            return 'Range is outside mapped data. Click Save again to confirm.';
        }
        const overlap = this.labels.filter(l =>
            l.id !== editId &&
            startAddress <= l.startAddress + l.length - 1 &&
            segEnd >= l.startAddress
        );
        return overlap.length > 0
            ? `Overlaps with: ${overlap.map(l => `"${esc(l.name)}"`).join(', ')}. Click Save again.`
            : null;
    }

    private readLabelDraft(rangeMode: LabelRangeMode): LabelDraftResult {
        const name = this.readLabelName();
        if (!name) { return { ok: false, error: 'Name is required.' }; }
        const startAddress = this.labelStartAddress();
        if (isNaN(startAddress)) { return { ok: false, error: 'Invalid start address.' }; }
        const parsedLength = this.parseLabelLength(rangeMode, startAddress);
        if (!parsedLength.ok) { return { ok: false, error: parsedLength.error }; }
        return { ok: true, name, startAddress, length: parsedLength.length };
    }

    private labelStartAddress(): number {
        const startEl = this.labelStartEl();
        return startEl ? parseInt(startEl.value.replace(/^0x/i, ''), 16) : NaN;
    }

    private readLabelName(): string {
        return this.labelNameEl()?.value.trim() || this.nextLabelName();
    }

    private applyLabel(editId: string | undefined, editing: SegmentLabel | undefined, color: string, draft: Extract<LabelDraftResult, { ok: true }>): void {
        const label: SegmentLabel = {
            id: editId ?? `lbl_${Date.now()}`,
            name: draft.name,
            startAddress: draft.startAddress,
            length: draft.length,
            color,
            hidden: editing ? editing.hidden : undefined,
        };
        this.labels = mergeLabel(this.labels, editId, label);
        this.cb.onLabelsChange?.(this.labels);
    }

    private saveLabel(editId: string | undefined, editing: SegmentLabel | undefined, color: string, rangeMode: LabelRangeMode, confirmed: boolean): boolean {
        this.clearLabelWarning();
        const draft = this.readLabelDraft(rangeMode);
        if (!draft.ok) {
            this.showLabelError(draft.error);
            return false;
        }
        const warning = confirmed ? null : this.labelRangeWarning(draft.startAddress, draft.length, editId);
        if (warning) {
            this.showLabelError(warning);
            return true;
        }
        this.applyLabel(editId, editing, color, draft);
        return false;
    }

    private showLabelError(message: string): void {
        const warn = this.labelWarnEl();
        if (warn) { warn.textContent = message; }
    }

    private renderLabelForm(editId?: string): void {
        const sec = this.root?.querySelector<HTMLElement>('#s-labels') ?? null;
        if (!sec) { return; }
        const editing = this.labels.find(l => l.id === editId);

        sec.dataset.collapsed = 'false';
        sec.classList.remove('collapsed');

        const chosenColor = defaultLabelColor(editing, LABEL_COLORS[this.labels.length % LABEL_COLORS.length].v);
        sec.innerHTML = labelFormHtml(
            editing,
            this.labelSwatchesHtml(chosenColor),
            this.defaultLabelStart(editing),
            this.defaultLabelRange(editing),
        );

        const formState = { chosenColor, rangeMode: 'len' as LabelRangeMode, pendingWarning: false };
        this.wireLabelForm(sec, editId, editing, formState);
    }

    private wireLabelForm(
        sec: HTMLElement,
        editId: string | undefined,
        editing: SegmentLabel | undefined,
        state: { chosenColor: string; rangeMode: LabelRangeMode; pendingWarning: boolean },
    ): void {
        this.wireLabelColorSwatches(sec, color => { state.chosenColor = color; });

        sec.querySelectorAll<HTMLElement>('.lf-mode').forEach(btn => {
            btn.addEventListener('click', () => {
                state.rangeMode = this.switchLabelRangeMode(sec, btn, state.rangeMode, editing);
                state.pendingWarning = false;
                this.clearLabelWarning();
            });
        });

        const clearPending = (): void => {
            state.pendingWarning = false;
            this.clearLabelWarning();
        };
        sec.querySelector<HTMLElement>('#lf-name')?.addEventListener('input', clearPending);
        sec.querySelector<HTMLElement>('#lf-start')?.addEventListener('input', clearPending);
        sec.querySelector<HTMLElement>('#lf-range')?.addEventListener('input', clearPending);

        sec.querySelector<HTMLElement>('#lf-cancel')?.addEventListener('click', () => this.renderLabels());
        sec.querySelector<HTMLElement>('#lf-save')?.addEventListener('click', () => {
            state.pendingWarning = this.saveLabel(editId, editing, state.chosenColor, state.rangeMode, state.pendingWarning);
        });
    }

    private updateLabelFormSel(): void {
        const { start } = this.selection;
        if (start === null) { return; }
        const startEl = this.labelStartEl();
        if (!startEl) { return; }
        startEl.value = this.labelAddrHex(start);
        this.fillLabelRangeValue(start);
    }

    private fillLabelRangeValue(start: number): void {
        const end = this.selection.end;
        const rangeEl = this.labelRangeEl();
        if (rangeEl && end !== null && end >= start) {
            rangeEl.value = String(end - start + 1);
        }
    }
}

// ── Pure helpers (module-scope) ─────────────────────────────────

function singleByteInspectorHtml(val: number): string {
    const hexStr  = `0x${val.toString(16).toUpperCase().padStart(2, '0')}`;
    const binRaw  = val.toString(2).padStart(8, '0');
    const binDisp = `${binRaw.slice(0, 4)} ${binRaw.slice(4)}`;
    const asciiChip = val >= 0x20 && val < 0x7F
        ? `<span class="insp-ascii-chip">'${esc(String.fromCharCode(val))}'</span>`
        : '';
    return (
        `<div class="insp-byte-row">` +
        `<span class="insp-hex-chip" data-copy="${esc(hexStr)}" data-label="hex" title="Click to copy">${hexStr}</span>` +
        `<span class="insp-dec-chip" data-copy="${esc(String(val))}" data-label="decimal" title="Click to copy">${val}</span>` +
        `${asciiChip}` +
        `</div>` +
        `<div class="insp-bin-row" data-copy="${esc(binRaw)}" data-label="binary" title="Click to copy">${binDisp}</div>`
    );
}

function multiByteInspectorHtml(selBytes: number[], len: number): string {
    const dumpBytes = selBytes.slice(0, 8);
    const dumpStr   = dumpBytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
    const copyStr   = len > 8 ? `${dumpStr} …` : dumpStr;
    return (
        `<div class="insp-raw-dump" data-copy="${esc(copyStr)}" data-label="bytes" title="Click to copy">` +
        `${dumpStr}${len > 8 ? ' <span class="insp-dump-ellipsis">…</span>' : ''}` +
        `</div>`
    );
}

function popcount(v: number): number {
    let n = 0; let x = v >>> 0;
    while (x) { n += x & 1; x >>>= 1; }
    return n;
}

function bitIndexRowHtml(): string {
    const cells = Array.from({ length: 8 }, (_, i) =>
        `<div class="bit-idx">${7 - i}</div>`
    ).join('');
    return `<div class="bit-row"><div></div>${cells}</div>`;
}

function byteRowHtml(val: number, label: string | null): string {
    const hexStr = val.toString(16).toUpperCase().padStart(2, '0');
    const cells = Array.from({ length: 8 }, (_, i) => {
        const bit = 7 - i;
        const on  = (val >> bit) & 1;
        return `<div class="bit-v${on ? ' on' : ''}" data-bit="${bit}" title="bit ${bit} = ${on}"></div>`;
    }).join('');
    const lbl = label !== null
        ? `<div class="bit-lbl"><span class="bit-lbl-idx">${esc(label)}</span><span class="bit-hex">0x${hexStr}</span></div>`
        : `<div class="bit-lbl"><span class="bit-hex">0x${hexStr}</span></div>`;
    return `<div class="bit-row">${lbl}${cells}</div>`;
}

function bitRowsHtml(bytes: number[]): string {
    return bytes.map((b, i) => byteRowHtml(b, `[${i}]`)).join('');
}

function bitTotalCount(bytes: number[]): number {
    return bytes.reduce((s, b) => s + popcount(b), 0);
}

type MultiValues = {
    u16: number;
    i16: number;
    u32: number;
    i32: number;
    f32: number;
    u64: bigint;
    i64: bigint;
    f64: number;
};

function multiWidth(selLen: number): number {
    return selLen <= 2 ? 2 : selLen <= 4 ? 4 : 8;
}

function readMultiValues(raw: number[], le: boolean): MultiValues {
    const bytesLE = le ? [...raw] : [...raw].reverse();
    const buf8 = new ArrayBuffer(8);
    const dv8 = new DataView(buf8);
    for (let i = 0; i < 8; i++) { dv8.setUint8(i, bytesLE[i] ?? 0); }
    return {
        u16: dv8.getUint16(0, true),
        i16: dv8.getInt16(0, true),
        u32: dv8.getUint32(0, true),
        i32: dv8.getInt32(0, true),
        f32: dv8.getFloat32(0, true),
        u64: dv8.getBigUint64(0, true),
        i64: dv8.getBigInt64(0, true),
        f64: dv8.getFloat64(0, true),
    };
}

function fmtFloat(v: number, sig: number): string {
    if (isNaN(v))     { return 'NaN'; }
    if (!isFinite(v)) { return `${v > 0 ? '+' : ''}${v}`; }
    return v.toExponential(sig - 1);
}

function multiCard(type: string, primary: string, copy: string): string {
    return `<div class="mi-card">` +
        `<span class="mi-type">${type}</span>` +
        `<div class="mi-vals"><span class="mi-dec" data-copy="${esc(copy)}" title="Click to copy">${primary}</span></div>` +
        `</div>`;
}

function multiUnsignedCard(type: string, uVal: number | bigint, hexW: number): string {
    const dec = formatDecimal(uVal);
    const hex = formatHex(uVal, hexW);
    return `<div class="mi-card mi-ucard">` +
        `<span class="mi-type">${type}</span>` +
        `<div class="mi-vals">` +
        `<span class="mi-dec" data-copy="${esc(String(uVal))}" title="Click to copy decimal">${dec}</span>` +
        `<span class="mi-hex" data-copy="${esc(hex)}" title="Click to copy hex">${hex}</span>` +
        `</div>` +
        `</div>`;
}

function multiValueGroupHtml(width: number, values: MultiValues): string {
    if (width === 2) {
        return (
            multiUnsignedCard('uint16', values.u16, 4) +
            multiCard('int16', formatDecimal(values.i16), String(values.i16))
        );
    }
    if (width === 4) {
        return (
            multiUnsignedCard('uint32', values.u32, 8) +
            multiCard('int32', formatDecimal(values.i32), String(values.i32)) +
            multiCard('float32', fmtFloat(values.f32, 7), fmtFloat(values.f32, 7))
        );
    }
    return (
        multiUnsignedCard('uint64', values.u64, 16) +
        multiCard('int64', formatDecimal(values.i64), String(values.i64)) +
        multiCard('float64', fmtFloat(values.f64, 10), fmtFloat(values.f64, 10))
    );
}

function multiPadNoteHtml(selLen: number, width: number): string {
    return selLen < width
        ? `<div class="mi-pad-row"><span class="mi-pad-note">zero-padded to ${width * 8}-bit</span></div>`
        : '';
}

function wireMultiInlineCopies(el: HTMLElement, cb: (text: string, label: string) => void): void {
    el.querySelectorAll<HTMLElement>('.mi-dec[data-copy]').forEach(span => {
        span.addEventListener('click', e => {
            e.stopPropagation();
            cb(span.dataset.copy!, 'decimal');
        });
    });
    el.querySelectorAll<HTMLElement>('.mi-hex[data-copy]').forEach(span => {
        span.addEventListener('click', e => {
            e.stopPropagation();
            cb(span.dataset.copy!, 'hex');
        });
    });
}

function segmentAddress(address: number): string {
    return `0x${address.toString(16).toUpperCase().padStart(8, '0')}`;
}

function segmentBadgeHtml(segments: SerializedSegment[]): string {
    return segments.length > 0 ? `<span class="sb-badge">${segments.length}</span>` : '';
}

function segmentItemsHtml(segments: SerializedSegment[]): string {
    if (segments.length === 0) { return '<div class="sb-empty">No segments</div>'; }
    return segments.map((s, i) => segmentItemHtml(s, i)).join('');
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

