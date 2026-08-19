// ── InspectorPanel component ──────────────────────────────────────
// Self-contained sidebar Inspector panel: owns the section shells
// (Inspector with internal Bit View block / merged Labels), their
// markup, collapse state, bit hover, label-form UI state, and
// interaction. Collapsed sections remain in the panel stack. Data is pushed via setters; byte reads go
// through the injected `readByte` accessor; actions report via
// callbacks. This module never imports the `S` global and never posts
// provider messages. Pure markup lives in inspectorRender.ts; the
// label-form state machine in inspectorLabelForm.ts (operating on this
// panel as its host).

import { esc, flashCopied, wireActionBtns } from '../../../utils';
import type { SegmentLabel, SerializedSegment } from '../../../../core/types';
import { SidebarSections } from '../sidebar';
import {
    bitIndexRowHtml,
    bitRowsHtml,
    bitTotalCount,
    byteRowHtml,
    gapPaddingNoteHtml,
    inspectorSelectionLength,
    labelItemsHtml,
    multiByteInspectorHtml,
    multiContextHtml,
    multiValueGroupHtml,
    multiWidth,
    popcount,
    readMultiValues,
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
    /** Sticky per-mount: user collapse of the internal Bits block. */
    private bitsCollapsed = false;
    segments: SerializedSegment[] = [];
    labels: SegmentLabel[] = [];
    root: HTMLElement | null = null;
    sections: SidebarSections | null = null;

    constructor(cb: InspectorCallbacks) {
        this.cb = cb;
    }

    /** Renders the section shells and wires doc-delegated listeners (idempotent). */
    mount(root: HTMLElement): void {
        this.root = root;
        root.innerHTML = '';
        // Remount resets sticky bit-block collapse (no persistence).
        this.bitsCollapsed = false;
        this.sections = new SidebarSections(root, 's', [
            { id: 'insp', label: 'Inspector' },
            { id: 'labels', label: 'Labels', defaultCollapsed: true },
        ]);
        this.renderInspectorShell();
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
        this.renderLabels();
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
        const body = this.sections?.body('insp');
        if (!body) { return; }
        body.innerHTML =
            `<div id="insp-addr" style="display:none"></div>` +
            `<div id="insp-vals"><div class="sb-empty">Click a byte to inspect</div></div>` +
            `<div id="insp-multi"></div>` +
            `<div id="insp-bits"></div>`;
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
        this.paintInspectorValue(state.valsEl, state.len, state.val);
        this.wireInspectorCopies(state.valsEl);
        this.renderMultiInline();
    }

    private paintInspectorValue(valsEl: HTMLElement, len: number, val: number): void {
        if (len === 1) {
            valsEl.innerHTML = singleByteInspectorHtml(val);
            this.renderBits(val);
            return;
        }
        const selBytes = this.selectedBytes(len);
        const skipped = this.countUnmappedInSelection();
        valsEl.innerHTML = multiByteInspectorHtml(selBytes, len)
            + (skipped > 0 ? gapPaddingNoteHtml(skipped) : '');
        this.renderBitsMulti(selBytes.slice(0, Math.min(len, 8)));
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

    /** Unmapped addresses inside the current selection (decode pads them with 0x00). */
    private countUnmappedInSelection(): number {
        const { start, end } = this.selection;
        if (start === null || end === null) { return 0; }
        return countUnmapped(start, end, this.cb.readByte);
    }

    private wireInspectorCopies(valsEl: HTMLElement): void {
        valsEl.querySelectorAll<HTMLElement>('[data-copy]').forEach(el => {
            el.addEventListener('click', () => {
                this.cb.onCopy?.(el.dataset.copy!, el.dataset.label ?? 'value');
                flashCopied(el, true);
            });
        });
    }

    // ── Bit view (internal block inside the Inspector section) ───

    private renderBits(val?: number): void {
        const block = this.bitsBlock();
        if (!block) { return; }
        const inner = val === undefined
            ? '<div class="sb-empty">—</div>'
            : `<div class="bitgrid-wrap">${bitIndexRowHtml()}${byteRowHtml(val, null)}</div>` +
              `<span class="bit-pc">${esc(String(popcount(val)))}/8 bits set</span>`;
        this.renderBitsBlock(block, inner, null);
    }

    private renderBitsMulti(bytes: number[]): void {
        const block = this.bitsBlock();
        if (!block) { return; }
        const inner =
            `<div class="bitgrid-wrap">${bitIndexRowHtml()}${bitRowsHtml(bytes)}</div>` +
            `<span class="bit-pc">${esc(String(bitTotalCount(bytes)))}/${esc(String(bytes.length * 8))} bits set</span>`;
        this.renderBitsBlock(block, inner, `${bytes.length} byte${bytes.length > 1 ? 's' : ''}`);
    }

    /**
     * Renders the internal "Bits" disclosure inside #insp-bits (pattern:
     * scriptsPanel output-block collapse). Expansion is content-driven:
     * every paint starts expanded unless the user collapsed it this mount.
     */
    private renderBitsBlock(block: HTMLElement, innerHtml: string, badge: string | null): void {
        const collapsed = this.bitsCollapsed;
        block.innerHTML =
            `<button type="button" class="sb-inner-toggle" data-collapse aria-expanded="${collapsed ? 'false' : 'true'}">` +
            `<span class="sb-inner-toggle-icon" aria-hidden="true">&#9658;</span>` +
            `<span class="sb-inner-label">Bits</span>` +
            (badge ? `<span class="sb-badge">${esc(badge)}</span>` : '') +
            `</button>` +
            `<div class="sb-inner-body">${innerHtml}</div>`;
        block.classList.toggle('collapsed', collapsed);
        block.querySelector<HTMLElement>('[data-collapse]')?.addEventListener('click', () => {
            this.bitsCollapsed = !this.bitsCollapsed;
            block.classList.toggle('collapsed', this.bitsCollapsed);
            block.querySelector<HTMLElement>('[data-collapse]')?.setAttribute('aria-expanded', String(!this.bitsCollapsed));
        });
        this.wireBitColHover();
    }

    private bitsBlock(): HTMLElement | null {
        return this.root?.querySelector<HTMLElement>('#insp-bits') ?? null;
    }

    private wireBitColHover(): void {
        const wrap = this.root?.querySelector<HTMLElement>('#insp-bits .bitgrid-wrap');
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
            multiContextHtml(this.endian, width, selLen) +
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

    // ── Labels (merged segment rows + user labels) ─────────────────

    renderLabels(): void {
        const body = this.sections?.body('labels');
        if (!body) { return; }
        const itemsHtml = labelItemsHtml(this.labels, this.segments);
        body.innerHTML = `${itemsHtml}
            <button class="sb-btn sb-btn-add" id="btn-add-lbl">+ Add Segment Label</button>`;

        const total = this.labels.length + this.segments.length;
        this.sections!.setBadge('labels', total > 0 ? String(total) : null);
        this.wireLabelActions(body);
        this.wireLabelVisibility(body);
        this.wireLabelJump(body);
        this.wireLabelJumpPermanent(body);
        this.wireLabelAdd(body);
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

    private wireLabelJump(sec: HTMLElement): void {
        sec.querySelectorAll<HTMLElement>('.label-item').forEach(item => {
            if (item.classList.contains('label-perma')) { return; }
            item.style.cursor = 'pointer';
            item.addEventListener('click', e => {
                if ((e.target as HTMLElement).closest('.label-act')) { return; }
                const id = item.dataset.id!;
                const lbl = this.labels.find(l => l.id === id);
                if (lbl) { this.cb.onJumpTo?.(lbl.startAddress); }
            });
        });
    }

    /** Permanent segment rows: click / Enter / Space jump to the segment start. */
    private wireLabelJumpPermanent(sec: HTMLElement): void {
        sec.querySelectorAll<HTMLElement>('.label-perma').forEach(item => {
            item.addEventListener('click', () => {
                const start = Number(item.dataset.start);
                this.jumpToSegment(start);
            });
            item.addEventListener('keydown', event => {
                if (event.key !== 'Enter' && event.key !== ' ') { return; }
                event.preventDefault();
                this.jumpToSegment(Number(item.dataset.start));
            });
        });
    }

    private jumpToSegment(start: number): void {
        if (Number.isFinite(start)) { this.cb.onJumpTo?.(start); }
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
            flashCopied(span, true);
        });
    });
    el.querySelectorAll<HTMLElement>('.mi-hex[data-copy]').forEach(span => {
        span.addEventListener('click', e => {
            e.stopPropagation();
            cb(span.dataset.copy!, 'hex');
            flashCopied(span, true);
        });
    });
}


/** Bytes in [start,end] with no mapped value. */
function countUnmapped(start: number, end: number, readByte: (a: number) => number | undefined): number {
    let n = 0;
    for (let a = start; a <= end; a++) {
        if (readByte(a) === undefined) { n++; }
    }
    return n;
}
