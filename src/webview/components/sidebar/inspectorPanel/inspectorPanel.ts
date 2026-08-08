// ── InspectorPanel component ──────────────────────────────────────
// Self-contained sidebar Inspector panel: owns the four section shells
// (Inspector / Bit View / Multi-Byte interpreter / Segments / Labels),
// their markup, collapse state, bit hover, label-form UI state, and
// interaction. Data is pushed via setters; byte reads go through the
// injected `readByte` accessor; actions report via callbacks. This
// module never imports the `S` global and never posts provider messages.
// Pure markup lives in inspectorRender.ts; the label-form state machine
// in inspectorLabelForm.ts (operating on this panel as its host).

import { esc, wireActionBtns } from '../../../utils';
import type { SegmentLabel, SerializedSegment } from '../../../../core/types';
import { labelsBadgeHtml } from './inspectorLabels';
import {
    bitIndexRowHtml,
    bitRowsHtml,
    bitTotalCount,
    byteRowHtml,
    inspectorSelectionLength,
    labelItemsHtml,
    multiByteInspectorHtml,
    multiPadNoteHtml,
    multiValueGroupHtml,
    multiWidth,
    popcount,
    readMultiValues,
    segmentBadgeHtml,
    segmentItemsHtml,
    singleByteInspectorHtml,
} from './inspectorRender';
import {
    renderLabelForm,
    updateLabelFormSel,
    type InspectorLabelFormHost,
} from './inspectorLabelForm';
import './inspectorPanel.css';

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

export class InspectorPanel implements InspectorLabelFormHost {
    readonly cb: InspectorCallbacks;
    selection: { start: number | null; end: number | null } = { start: null, end: null };
    private endian: 'le' | 'be' = 'le';
    segments: SerializedSegment[] = [];
    labels: SegmentLabel[] = [];
    root: HTMLElement | null = null;

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
        updateLabelFormSel(this);
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
            len: inspectorSelectionLength(this.selection),
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
        const selLen = inspectorSelectionLength(this.selection);
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

    renderLabels(): void {
        const sec = this.root?.querySelector<HTMLElement>('#s-labels') ?? null;
        if (!sec) { return; }
        const badgeHtml = labelsBadgeHtml(this.labels.length);
        const itemsHtml = labelItemsHtml(this.labels);
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
            el => renderLabelForm(this, el.dataset.id),
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
        sec.querySelector<HTMLElement>('#btn-add-lbl')?.addEventListener('click', () => renderLabelForm(this));
    }
}

// ── Multi-byte copy wiring (DOM listener; kept with the class) ──

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
