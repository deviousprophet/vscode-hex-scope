import { S } from '../../state';
import { postProviderMessage } from '../../vscodeApi';
import { getByte } from '../../memory/memoryData';
import { esc, formatDecimal, formatHex } from '../../utils';
export function renderInspector(): void {
    const sec = document.getElementById('s-insp')!;
    sec.innerHTML =
        `<div class="sb-hdr">Inspector</div>
         <div class="sb-body">
           <div id="insp-addr" style="display:none"></div>
           <div id="insp-vals"><div class="sb-empty">Click a byte to inspect</div></div>
           <div id="insp-multi"></div>
         </div>`;

    applyCollapsibleSection(sec, false);
}

function applyCollapsibleSection(sec: HTMLElement, defaultCollapsed: boolean): void {
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
        addrEl.innerHTML = `<span class=\"insp-addr-value\">0x${esc(startHex)}</span>`;
        return;
    }

    const endHex = S.selEnd!.toString(16).toUpperCase().padStart(8, '0');
    addrEl.innerHTML =
        `<span class=\"insp-addr-value\">0x${esc(startHex)}</span>` +
        `<span class=\"insp-addr-sep\">–</span>` +
        `<span class=\"insp-addr-value\">0x${esc(endHex)}</span>` +
        `<span class=\"insp-addr-len\">${esc(String(len))} bytes</span>`;
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
            postProviderMessage({ type: 'copyText', text: el.dataset.copy!, label: el.dataset.label ?? 'value' });
        });
    });
}

export function updateInspector(): void {
    const state = readInspectorState();
    if (!state) { return; }

    renderInspectorAddress(state.addrEl, state.len);
    if (renderInspectorMissingData(state.valsEl, state.val)) { return; }
    renderInspectorSelection(state.valsEl, state.val, state.len);

    wireInspectorCopies(state.valsEl);
    renderMultiInline();
}

function readInspectorState(): { addrEl: HTMLElement; valsEl: HTMLElement; len: number; val: number | undefined } | null {
    const addrEl = document.getElementById('insp-addr');
    const valsEl = document.getElementById('insp-vals');
    if (!addrEl || !valsEl) { return null; }
    if (S.selStart === null) {
        renderInspectorNoSelection(addrEl, valsEl);
        return null;
    }
    return {
        addrEl,
        valsEl,
        len: inspectorSelectionLength(),
        val: getByte(S.selStart),
    };
}

function renderInspectorMissingData(valsEl: HTMLElement, val: number | undefined): val is undefined {
    if (val !== undefined) { return false; }
    renderInspectorNoData(valsEl);
    return true;
}

function renderInspectorSelection(valsEl: HTMLElement, val: number, len: number): void {
    if (len === 1) {
        valsEl.innerHTML = singleByteInspectorHtml(val);
        renderBits(val);
        return;
    }
    const selBytes = selectedBytes(len);
    valsEl.innerHTML = multiByteInspectorHtml(selBytes, len);
    renderBitsMulti(selBytes.slice(0, Math.min(len, 8)));
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
            `<div class="bitgrid-wrap">${bitIndexRowHtml()}${byteRowHtml(val, null)}</div>` +
            `<span class="bit-pc">${esc(String(pc))}/8 bits set</span></div>`;
    }

    applyCollapsibleSection(sec, true);

    wireBitColHover();
}

/** Multi-byte bit view — one 8-cell row per byte. */
function renderBitsMulti(bytes: number[]): void {
    const sec   = document.getElementById('s-bits')!;
    const rowsHtml = bytes.map((b, i) => byteRowHtml(b, `[${i}]`)).join('');
    const total = bytes.reduce((s, b) => s + popcount(b), 0);
    sec.innerHTML =
        `<div class="sb-hdr">Bit View ` +
        `<span class="sb-badge" style="font-weight:400;opacity:.6">${esc(String(bytes.length))} byte${bytes.length > 1 ? 's' : ''}</span></div>` +
        `<div class="sb-body">` +
        `<div class="bitgrid-wrap">${bitIndexRowHtml()}${rowsHtml}</div>` +
        `<span class="bit-pc">${esc(String(total))}/${esc(String(bytes.length * 8))} bits set</span></div>`;

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
            postProviderMessage({ type: 'copyText', text: span.dataset.copy!, label: 'decimal' });
        });
    });

    el.querySelectorAll<HTMLElement>('.mi-hex[data-copy]').forEach(span => {
        span.addEventListener('click', e => {
            e.stopPropagation();
            postProviderMessage({ type: 'copyText', text: span.dataset.copy!, label: 'hex' });
        });
    });
}

function renderMultiInline(): void {
    const el = document.getElementById('insp-multi');
    if (!el) { return; }
    if (!hasMultiInlineStart()) {
        el.innerHTML = ''; return;
    }

    const selLen = multiInlineSelectionLength();
    if (selLen < 2) { el.innerHTML = ''; return; }

    const width = multiWidth(selLen);
    const le = S.endian === 'le';
    const raw = selectedPaddedBytes(width, selLen);
    const groupHtml = multiValueGroupHtml(width, readMultiValues(raw, le));

    el.innerHTML =
        multiPadNoteHtml(selLen, width) +
        `<div class="mi-group">${groupHtml}</div>`;

    wireMultiInlineControls(el);
}

function hasMultiInlineStart(): boolean {
    return S.selStart !== null && getByte(S.selStart) !== undefined;
}

function multiInlineSelectionLength(): number {
    return (S.selStart !== null && S.selEnd !== null && S.selEnd >= S.selStart)
        ? S.selEnd - S.selStart + 1
        : 1;
}

// ── Parsed segments ───────────────────────────────────────────────
