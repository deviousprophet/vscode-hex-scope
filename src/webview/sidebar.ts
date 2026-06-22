// ── Sidebar panels ────────────────────────────────────────────────
// Inspector · Bit View · Multi-Byte interpreter · Parsed Segments · Segment Labels

import { S } from './state';
import { esc, fmtB, actionBtnsHtml, wireActionBtns, formatDecimal, formatHex } from './utils';
import { vscode } from './api';
import { rerender } from './render';
import { buildMemRows, getByte } from './data';
import type { SerializedSegment } from './types';

// ── Inspector ────────────────────────────────────────────────────

export function renderInspector(): void {
    const sec = document.getElementById('s-insp')!;
    sec.innerHTML =
        `<div class="sb-hdr">Inspector</div>
         <div class="sb-body">
           <div id="insp-addr" style="display:none"></div>
           <div id="insp-vals"><div class="sb-empty">Click a byte to inspect</div></div>
           <div id="insp-multi"></div>
         </div>`;

    // Collapsible: expanded by default
    if (sec.dataset.collapsed === undefined) { sec.dataset.collapsed = 'false'; }
    sec.classList.toggle('collapsed', sec.dataset.collapsed === 'true');

    // Header toggles collapse state
    const hdr = sec.querySelector<HTMLElement>('.sb-hdr');
    if (hdr) {
        hdr.addEventListener('click', () => {
            const now = sec.dataset.collapsed === 'true' ? 'false' : 'true';
            sec.dataset.collapsed = now;
            sec.classList.toggle('collapsed', now === 'true');
        });
    }
}

function inspectorSelectionLength(): number {
    if (S.selStart === null) { return 0; }
    return (S.selEnd !== null && S.selEnd >= S.selStart) ? S.selEnd - S.selStart + 1 : 1;
}

function renderInspectorNoSelection(addrEl: HTMLElement, valsEl: HTMLElement): void {
    addrEl.style.display = 'none';
    valsEl.innerHTML = '<div class="sb-empty">Click a byte to inspect</div>';
    renderBits();
    renderMultiInline();
}

function renderInspectorNoData(valsEl: HTMLElement): void {
    valsEl.innerHTML = '<div class="sb-empty">No data at this address</div>';
    renderBits();
    renderMultiInline();
}

function renderInspectorAddress(addrEl: HTMLElement, len: number): void {
    const startHex = S.selStart!.toString(16).toUpperCase().padStart(8, '0');
    addrEl.style.display = '';
    if (len === 1) {
        addrEl.innerHTML = `<span class=\"insp-addr-value\">0x${startHex}</span>`;
        return;
    }

    const endHex = S.selEnd!.toString(16).toUpperCase().padStart(8, '0');
    addrEl.innerHTML =
        `<span class=\"insp-addr-value\">0x${startHex}</span>` +
        `<span class=\"insp-addr-sep\">–</span>` +
        `<span class=\"insp-addr-value\">0x${endHex}</span>` +
        `<span class=\"insp-addr-len\">${len} bytes</span>`;
}

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

function selectedBytes(len: number): number[] {
    const bytes: number[] = [];
    for (let a = S.selStart!; a <= S.selEnd!; a++) {
        bytes.push(getByte(a) ?? 0);
    }
    return bytes.slice(0, len);
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

function wireInspectorCopies(valsEl: HTMLElement): void {
    valsEl.querySelectorAll<HTMLElement>('[data-copy]').forEach(el => {
        el.addEventListener('click', () => {
            vscode.postMessage({ type: 'copyText', text: el.dataset.copy!, label: el.dataset.label ?? 'value' });
        });
    });
}

export function updateInspector(): void {
    const addrEl = document.getElementById('insp-addr');
    const valsEl = document.getElementById('insp-vals');
    if (!addrEl || !valsEl) { return; }

    if (S.selStart === null) {
        renderInspectorNoSelection(addrEl, valsEl);
        return;
    }

    const len = inspectorSelectionLength();
    const val = getByte(S.selStart);
    renderInspectorAddress(addrEl, len);

    if (val === undefined) {
        renderInspectorNoData(valsEl);
        return;
    }

    if (len === 1) {
        valsEl.innerHTML = singleByteInspectorHtml(val);
        renderBits(val);
    } else {
        const selBytes = selectedBytes(len);
        valsEl.innerHTML = multiByteInspectorHtml(selBytes, len);
        renderBitsMulti(selBytes.slice(0, Math.min(len, 8)));
    }

    wireInspectorCopies(valsEl);
    renderMultiInline();
}

// ── Bit viewer ────────────────────────────────────────────────────

/** Single-byte bit view. */
export function renderBits(val?: number): void {
    const sec = document.getElementById('s-bits')!;
    if (val === undefined) {
        sec.innerHTML =
            `<div class="sb-hdr">Bit View</div>` +
            `<div class="sb-body"><div class="sb-empty">—</div></div>`;
    } else {
        const pc = popcount(val);
        sec.innerHTML =
            `<div class="sb-hdr">Bit View</div>` +
            `<div class="sb-body">` +
            `<div class="bitgrid-wrap">${bitIndexRow()}${byteRow(val, null)}</div>` +
            `<span class="bit-pc">${pc}/8 bits set</span></div>`;
    }

    // Persist collapsed state on the section element; default collapsed
    if (sec.dataset.collapsed === undefined) { sec.dataset.collapsed = 'true'; }
    sec.classList.toggle('collapsed', sec.dataset.collapsed === 'true');

    // Header toggles collapse state
    const hdr = sec.querySelector<HTMLElement>('.sb-hdr');
    if (hdr) {
        hdr.addEventListener('click', () => {
            const now = sec.dataset.collapsed === 'true' ? 'false' : 'true';
            sec.dataset.collapsed = now;
            sec.classList.toggle('collapsed', now === 'true');
        });
    }

    wireBitColHover();
}

/** Multi-byte bit view — one 8-cell row per byte. */
function renderBitsMulti(bytes: number[]): void {
    const sec   = document.getElementById('s-bits')!;
    const rows  = bytes.map((b, i) => byteRow(b, `[${i}]`)).join('');
    const total = bytes.reduce((s, b) => s + popcount(b), 0);
    sec.innerHTML =
        `<div class="sb-hdr">Bit View ` +
        `<span class="sb-badge" style="font-weight:400;opacity:.6">${bytes.length} byte${bytes.length > 1 ? 's' : ''}</span></div>` +
        `<div class="sb-body">` +
        `<div class="bitgrid-wrap">${bitIndexRow()}${rows}</div>` +
        `<span class="bit-pc">${total}/${bytes.length * 8} bits set</span></div>`;

    // Persist collapsed state on the section element; default collapsed
    if (sec.dataset.collapsed === undefined) { sec.dataset.collapsed = 'true'; }
    sec.classList.toggle('collapsed', sec.dataset.collapsed === 'true');

    // Header toggles collapse state
    const hdrm = sec.querySelector<HTMLElement>('.sb-hdr');
    if (hdrm) {
        hdrm.addEventListener('click', () => {
            const now = sec.dataset.collapsed === 'true' ? 'false' : 'true';
            sec.dataset.collapsed = now;
            sec.classList.toggle('collapsed', now === 'true');
        });
    }

    wireBitColHover();
}

function wireBitColHover(): void {
    const wrap = document.querySelector<HTMLElement>('#s-bits .bitgrid-wrap');
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

function popcount(v: number): number {
    let n = 0; let x = v >>> 0;
    while (x) { n += x & 1; x >>>= 1; }
    return n;
}

function bitIndexRow(): string {
    const cells = Array.from({ length: 8 }, (_, i) =>
        `<div class="bit-idx">${7 - i}</div>`
    ).join('');
    return `<div class="bit-row"><div></div>${cells}</div>`;
}

function byteRow(val: number, label: string | null): string {
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

// ── Multi-byte interpreter (inline, inside inspector) ─────────────

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

function selectedPaddedBytes(width: number, selLen: number): number[] {
    return Array.from({ length: width }, (_, i) => {
        const v = getByte(S.selStart! + i);
        return (i < selLen && v !== undefined) ? v : 0;
    });
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

function wireMultiInlineControls(el: HTMLElement): void {
    el.querySelectorAll<HTMLElement>('.mi-dec[data-copy]').forEach(span => {
        span.addEventListener('click', e => {
            e.stopPropagation();
            vscode.postMessage({ type: 'copyText', text: span.dataset.copy!, label: 'decimal' });
        });
    });

    el.querySelectorAll<HTMLElement>('.mi-hex[data-copy]').forEach(span => {
        span.addEventListener('click', e => {
            e.stopPropagation();
            vscode.postMessage({ type: 'copyText', text: span.dataset.copy!, label: 'hex' });
        });
    });
}

function renderMultiInline(): void {
    const el = document.getElementById('insp-multi');
    if (!el) { return; }
    if (S.selStart === null || getByte(S.selStart) === undefined) {
        el.innerHTML = ''; return;
    }

    const selLen = (S.selEnd !== null && S.selEnd >= S.selStart) ? S.selEnd - S.selStart + 1 : 1;
    if (selLen < 2) { el.innerHTML = ''; return; }

    const width = multiWidth(selLen);
    const le = S.endian === 'le';
    const raw = selectedPaddedBytes(width, selLen);
    const group = multiValueGroupHtml(width, readMultiValues(raw, le));

    el.innerHTML =
        multiPadNoteHtml(selLen, width) +
        `<div class="mi-group">${group}</div>`;

    wireMultiInlineControls(el);
}

// ── Parsed segments ───────────────────────────────────────────────

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
    const items = S.labels.length === 0
        ? '<div class="sb-empty">No labels defined</div>'
        : S.labels.map((l, i) => `
            <div class="label-item${l.hidden ? ' label-hidden' : ''}" data-id="${l.id}">
                <div class="label-sw" style="background:${l.hidden ? 'transparent' : l.color};border:1px solid ${l.color}"></div>
                <div class="label-inf">
                    <div class="label-nm">${esc(l.name)}</div>
                    <div class="label-rng">0x${l.startAddress.toString(16).toUpperCase().padStart(8, '0')} &middot; ${fmtB(l.length)}</div>
                </div>
                <span class="label-act label-vis" data-id="${l.id}" data-hidden="${l.hidden ? '1' : '0'}" title="${l.hidden ? 'Show' : 'Hide'}">${l.hidden ? '&#128065;&#xFE0E;' : '&#128065;'}</span>
                <span class="label-act label-up"  data-id="${l.id}" title="Move up"   ${i === 0 ? 'style="opacity:.3;pointer-events:none"' : ''}>&#8593;</span>
                <span class="label-act label-dn"  data-id="${l.id}" title="Move down" ${i === S.labels.length - 1 ? 'style="opacity:.3;pointer-events:none"' : ''}>&#8595;</span>
                ${actionBtnsHtml(`data-id="${l.id}"`, `data-id="${l.id}"`)}
            </div>`).join('');

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
            vscode.postMessage({ type: 'saveLabels', labels: S.labels });
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
            vscode.postMessage({ type: 'saveLabels', labels: S.labels });
            buildMemRows();
            rerender.labels();
            if (S.currentView === 'memory') { rerender.memory(); }
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
            vscode.postMessage({ type: 'saveLabels', labels: S.labels });
            buildMemRows();
            rerender.labels();
            if (S.currentView === 'memory') { rerender.memory(); }
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
            vscode.postMessage({ type: 'saveLabels', labels: S.labels });
            buildMemRows();
            rerender.labels();
            if (S.currentView === 'memory') { rerender.memory(); }
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

function labelBadgeHtml(): string {
    return S.labels.length > 0 ? `<span class="sb-badge">${S.labels.length}</span>` : '';
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
        const end = parseInt(raw.replace(/^0x/i, ''), 16);
        if (isNaN(end) || end < startAddress) { return { ok: false, error: 'Invalid end address.' }; }
        return { ok: true, length: end - startAddress + 1 };
    }

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

    vscode.postMessage({ type: 'saveLabels', labels: S.labels });
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

    sec.innerHTML = `
        <div class="sb-hdr">${editing ? 'Edit Label' : 'New Label'}</div>
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
                <button class="lf-btn lf-save" id="lf-save">${editing ? 'Update' : 'Add'}</button>
                <button class="lf-btn lf-cancel" id="lf-cancel">Cancel</button>
            </div>
        </div>`;

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
