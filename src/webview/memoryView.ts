// ── Memory View ──────────────────────────────────────────────────
// Renders the hex-grid memory view: column header, data rows, gap rows,
// and segment label banners.  Byte-click listeners are injected via callbacks
// so this module has no upward dependencies on hexViewer.ts.

import { S, BPR } from './state';
import { esc, fmtB, byteClass } from './utils';

// ── Column header ────────────────────────────────────────────────

export function renderMemHeader(): void {
    const hidden = `<div class="cell-group"><span class="addr-cell">00000000</span></div>`;

    const hexHdr = Array.from({ length: BPR }, (_, i) =>
        `<span class="data-cell" data-col="${i}" style="cursor:default;color:var(--addr-active-fg)">${i.toString(16).toUpperCase().padStart(2, '0')}</span>`
    ).join('');

    const ascHdrStyle = `width:calc(var(--text-cell-width)*${BPR});display:inline-block;color:var(--addr-active-fg);font-size:11px;text-align:left`;

    document.getElementById('mem-header')!.innerHTML =
        `${hidden}` +
        `<div class="cell-group">${hexHdr}</div>` +
        `<div class="cell-group"><span style="${ascHdrStyle}">Decoded text</span></div>`;
}

// ── Memory body ──────────────────────────────────────────────────

export function renderMemBody(
    onHexDown: (e: MouseEvent, el: HTMLElement) => void,
    onHexCtx:  (e: MouseEvent, el: HTMLElement) => void,
): void {
    const container = document.getElementById('mem-rows')!;

    if (S.memRows.length === 0) {
        container.innerHTML = `<div style="padding:30px 20px;color:var(--non-graphic);font-size:12px">No data records found.</div>`;
        return;
    }

    const labelMap = buildLabelMap();
    const parts: string[] = [];

    for (const row of S.memRows) {
        if (row.type === 'gap') {
            const f = row.from.toString(16).toUpperCase().padStart(8, '0');
            const t = row.to.toString(16).toUpperCase().padStart(8, '0');
            parts.push(`<div class="gap-row">
                <span class="gap-dots">···</span>
                <span class="gap-range">0x${f} – 0x${t}</span>
                <span class="gap-size">${fmtB(row.bytes)} unmapped</span>
            </div>`);
        } else {
            for (const lbl of (labelMap.get(row.address) ?? [])) {
                parts.push(`<div class="seg-banner" style="border-color:${lbl.color};background:${lbl.color}14;color:${lbl.color}">
                    <span class="sb-name">${esc(lbl.name)}</span>
                    <span class="sb-meta">0x${lbl.startAddress.toString(16).toUpperCase().padStart(8, '0')} · ${fmtB(lbl.length)}</span>
                </div>`);
            }
            parts.push(renderRow(row.address));
        }
    }

    container.innerHTML = parts.join('');

    // Attach caller-provided interaction callbacks
    container.querySelectorAll<HTMLElement>('.data-cell[data-addr]').forEach(el => {
        el.addEventListener('mousedown', e => onHexDown(e as MouseEvent, el));
        el.addEventListener('contextmenu', e => { onHexCtx(e as MouseEvent, el); e.preventDefault(); });
    });
    container.querySelectorAll<HTMLElement>('.char-cell[data-addr]').forEach(el => {
        el.addEventListener('mousedown', e => onHexDown(e as MouseEvent, el));
        el.addEventListener('contextmenu', e => { onHexCtx(e as MouseEvent, el); e.preventDefault(); });
    });

    applyMatchHighlights();
    applySel();

    // Column hover — set up once per container lifetime
    if (!container.dataset.colHoverInit) {
        container.dataset.colHoverInit = '1';
        const hdr = document.getElementById('mem-header')!;
        let activeCol: string | null = null;
        const setCol = (col: string | null) => {
            if (col === activeCol) { return; }
            if (activeCol !== null) {
                container.querySelectorAll<HTMLElement>(`[data-col="${activeCol}"]`).forEach(el => el.classList.remove('col-hi'));
                hdr.querySelectorAll<HTMLElement>(`[data-col="${activeCol}"]`).forEach(el => el.classList.remove('col-hi'));
            }
            activeCol = col;
            if (col !== null) {
                container.querySelectorAll<HTMLElement>(`[data-col="${col}"]`).forEach(el => el.classList.add('col-hi'));
                hdr.querySelectorAll<HTMLElement>(`[data-col="${col}"]`).forEach(el => el.classList.add('col-hi'));
            }
        };
        container.addEventListener('mouseover', e => {
            const col = (e.target as HTMLElement).closest<HTMLElement>('[data-col]')?.dataset.col ?? null;
            setCol(col);
        });
        container.addEventListener('mouseleave', () => setCol(null));
    }
}

// ── Single data row ──────────────────────────────────────────────

function renderRow(base: number): string {
    const hexCells: string[] = [];
    const chrCells: string[] = [];

    for (let col = 0; col < BPR; col++) {
        const addr = base + col;
        const val  = S.flatBytes.get(addr);
        const ah   = addr.toString(16).toUpperCase().padStart(8, '0');

        if (val === undefined) {
            hexCells.push(`<span class="data-cell be" data-col="${col}" aria-hidden="true">  </span>`);
            chrCells.push(`<span class="char-cell cd" data-col="${col}" aria-hidden="true"> </span>`);
        } else {
            const hex   = val.toString(16).toUpperCase().padStart(2, '0');
            const dirty = S.edits.has(addr) ? ' dirty' : '';
            hexCells.push(`<span class="data-cell ${byteClass(val)}${dirty}" data-col="${col}" data-addr="${ah}" data-val="${val}">${hex}</span>`);
            const p = val >= 0x20 && val < 0x7F;
            chrCells.push(`<span class="char-cell ${p ? 'cp' : 'cd'}${dirty}" data-col="${col}" data-addr="${ah}">${p ? esc(String.fromCharCode(val)) : '·'}</span>`);
        }
    }

    return `<div class="data-row" data-row="${base}">
        <div class="cell-group"><span class="addr-cell">${base.toString(16).toUpperCase().padStart(8, '0')}</span></div>
        <div class="cell-group">${hexCells.join('')}</div>
        <div class="cell-group">${chrCells.join('')}</div>
    </div>`;
}

// ── Selection highlight ──────────────────────────────────────────

export function applySel(): void {
    document.querySelectorAll<HTMLElement>('[data-addr]').forEach(el => {
        const a = parseInt(el.dataset.addr!, 16);
        el.classList.toggle('sel',
            S.selStart !== null && S.selEnd !== null && a >= S.selStart && a <= S.selEnd
        );
    });
}

// ── Match highlight ──────────────────────────────────────────────

export function applyMatchHighlights(): void {
    document.querySelectorAll('.data-cell, .char-cell').forEach(el => el.classList.remove('match', 'amatch'));
    if (!S.matchAddrs.length) { return; }

    const nLen = getNeedleLen();
    if (!nLen) { return; }

    for (let mi = 0; mi < S.matchAddrs.length; mi++) {
        for (let i = 0; i < nLen; i++) {
            const ah = (S.matchAddrs[mi] + i).toString(16).toUpperCase().padStart(8, '0');
            const active = mi === S.matchIdx;
            for (const sel of [`.data-cell[data-addr="${ah}"]`, `.char-cell[data-addr="${ah}"]`]) {
                const el = document.querySelector<HTMLElement>(sel);
                if (!el) { continue; }
                el.classList.add('match');
                if (active) { el.classList.add('amatch'); }
            }
        }
    }
}

function getNeedleLen(): number | null {
    const q = (document.getElementById('search-input') as HTMLInputElement)?.value ?? '';
    if (!q.trim()) { return null; }
    if (S.searchMode === 'addr') { return 1; }
    if (S.searchMode === 'hex') {
        const tokens = q.replace(/\s/g, '').match(/.{1,2}/g) ?? [];
        const n = tokens.filter(t => !isNaN(parseInt(t, 16))).length;
        return n || null;
    }
    return new TextEncoder().encode(q).length || null;
}

// ── Scroll ───────────────────────────────────────────────────────

export function scrollTo(addr: number): void {
    const row = addr - (addr % BPR);
    const el  = document.querySelector<HTMLElement>(`.data-row[data-row="${row}"]`);
    if (el) { el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
}

// ── Label map ────────────────────────────────────────────────────

function buildLabelMap(): Map<number, typeof S.labels> {
    const m = new Map<number, typeof S.labels>();
    for (const lbl of S.labels) {
        if (lbl.hidden) { continue; }
        const ra = lbl.startAddress - (lbl.startAddress % BPR);
        m.set(ra, [...(m.get(ra) ?? []), lbl]);
    }
    return m;
}
