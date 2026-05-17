//  Memory View 
// Renders the hex-grid memory view: column header, data rows, gap rows,
// and segment label banners. Uses virtual scrolling to efficiently handle
// large files by rendering only visible rows + a buffer.

import { S, BPR } from './state';
import { getByte } from './data';
import { esc, fmtB, byteClass } from './utils';
import { calcVisibleRange, calcTotalHeight, calcRowOffset, type VirtualScrollState } from './virtualScroll';

//  Virtual scroll state 
let vscrollState: VirtualScrollState | null = null;
let vscrollRenderedRange: [number, number] = [0, 0];

const VIRTUAL_SCROLL_CONFIG = {
    rowHeight: 20,   // CSS: var(--cell-size)  20px
    gapHeight: 30,   // CSS: var(--cell-size) * 1.5  30px
    bufferSize: 10,  // render 10 rows above/below viewport
};

//  Column header 

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

//  Virtual scroll rendering 

function renderVisibleRows(): void {
    if (!vscrollState) { return; }

    const [startIdx, endIdx] = calcVisibleRange(vscrollState);

    // No change in rendered range? Skip
    if (startIdx === vscrollRenderedRange[0] && endIdx === vscrollRenderedRange[1]) { return; }
    vscrollRenderedRange = [startIdx, endIdx];

    const container = document.getElementById('mem-rows')!;
    const scrollContainer = document.getElementById('mem-scroll')!;
    const labelMap = buildLabelMap();

    // Calculate offset for top spacer
    const topOffset = calcRowOffset(startIdx, vscrollState);

    const parts: string[] = [];

    // Top spacer (invisible, maintains scroll height ratio)
    if (topOffset > 0) {
        parts.push(`<div style="height:${topOffset}px"></div>`);
    }

    // Render only visible rows
    for (let i = startIdx; i < endIdx && i < S.memRows.length; i++) {
        const row = S.memRows[i];
        if (row.type === 'gap') {
            const f = row.from.toString(16).toUpperCase().padStart(8, '0');
            const t = row.to.toString(16).toUpperCase().padStart(8, '0');
            parts.push(`<div class="gap-row">
                <span class="gap-dots"></span>
                <span class="gap-range">0x${f}  0x${t}</span>
                <span class="gap-size">${fmtB(row.bytes)} unmapped</span>
            </div>`);
        } else {
            for (const lbl of (labelMap.get(row.address) ?? [])) {
                parts.push(`<div class="seg-banner" style="border-color:${lbl.color};background:${lbl.color}14;color:${lbl.color}">
                    <span class="sb-name">${esc(lbl.name)}</span>
                    <span class="sb-meta">0x${lbl.startAddress.toString(16).toUpperCase().padStart(8, '0')}  ${fmtB(lbl.length)}</span>
                </div>`);
            }
            parts.push(renderRow(row.address));
        }
    }

    // Bottom spacer
    const totalHeight = calcTotalHeight(vscrollState);
    const bottomOffset = totalHeight - calcRowOffset(endIdx, vscrollState);
    if (bottomOffset > 0) {
        parts.push(`<div style="height:${bottomOffset}px"></div>`);
    }

    container.innerHTML = parts.join('');

    // Re-attach interaction callbacks
    const onHexDown = (scrollContainer as any)._hexDownCallback;
    const onHexCtx = (scrollContainer as any)._hexCtxCallback;

    if (onHexDown || onHexCtx) {
        container.querySelectorAll<HTMLElement>('.data-cell[data-addr]').forEach(el => {
            if (onHexDown) {
                el.addEventListener('mousedown', e => onHexDown(e as MouseEvent, el));
            }
            if (onHexCtx) {
                el.addEventListener('contextmenu', e => { onHexCtx(e as MouseEvent, el); e.preventDefault(); });
            }
        });
        container.querySelectorAll<HTMLElement>('.char-cell[data-addr]').forEach(el => {
            if (onHexDown) {
                el.addEventListener('mousedown', e => onHexDown(e as MouseEvent, el));
            }
            if (onHexCtx) {
                el.addEventListener('contextmenu', e => { onHexCtx(e as MouseEvent, el); e.preventDefault(); });
            }
        });
    }

    // Apply search and selection highlights
    applyMatchHighlights();
    applySel();
}

//  Memory body 

export function renderMemBody(
    onHexDown: (e: MouseEvent, el: HTMLElement) => void,
    onHexCtx:  (e: MouseEvent, el: HTMLElement) => void,
): void {
    console.time('[MEMORY] renderMemBody');
    const container = document.getElementById('mem-rows')!;

    if (S.memRows.length === 0) {
        container.innerHTML = `<div style="padding:30px 20px;color:var(--non-graphic);font-size:12px">No data records found.</div>`;
        console.timeEnd('[MEMORY] renderMemBody');
        return;
    }

    console.log(`[MEMORY] Rendering ${S.memRows.length} rows`);

    // Initialize virtual scroll state
    const scrollContainer = document.getElementById('mem-scroll')!;

    vscrollState = {
        containerHeight: scrollContainer.clientHeight,
        rowHeight: VIRTUAL_SCROLL_CONFIG.rowHeight,
        gapHeight: VIRTUAL_SCROLL_CONFIG.gapHeight,
        scrollTop: scrollContainer.scrollTop,
        bufferSize: VIRTUAL_SCROLL_CONFIG.bufferSize,
        visibleRowIndices: [0, 0],
    };
    vscrollRenderedRange = [-1, -1];

    // Store callbacks for scroll listener
    (scrollContainer as any)._hexDownCallback = onHexDown;
    (scrollContainer as any)._hexCtxCallback = onHexCtx;

    // Initial render of visible rows
    console.time('[MEMORY] renderVisibleRows');
    renderVisibleRows();
    console.timeEnd('[MEMORY] renderVisibleRows');
    console.timeEnd('[MEMORY] renderMemBody');

    // Column hover  set up once per container lifetime
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

    // Set up scroll listener for virtual scrolling (only once)
    if (!scrollContainer.dataset.vscrollInit) {
        scrollContainer.dataset.vscrollInit = '1';
        scrollContainer.addEventListener('scroll', () => {
            if (!vscrollState) { return; }
            vscrollState.scrollTop = scrollContainer.scrollTop;
            renderVisibleRows();
        });
    }
}

//  Single data row 

function renderRow(base: number): string {
    const hexCells: string[] = [];
    const chrCells: string[] = [];

    for (let col = 0; col < BPR; col++) {
        const addr = base + col;
        const val  = getByte(addr);
        const ah   = addr.toString(16).toUpperCase().padStart(8, '0');

        if (val === undefined) {
            hexCells.push(`<span class="data-cell be" data-col="${col}" aria-hidden="true">  </span>`);
            chrCells.push(`<span class="char-cell cd" data-col="${col}" aria-hidden="true"> </span>`);
        } else {
            const hex   = val.toString(16).toUpperCase().padStart(2, '0');
            const dirty = S.edits.has(addr) ? ' dirty' : '';
            hexCells.push(`<span class="data-cell ${byteClass(val)}${dirty}" data-col="${col}" data-addr="${ah}" data-val="${val}">${hex}</span>`);
            const p = val >= 0x20 && val < 0x7F;
            chrCells.push(`<span class="char-cell ${p ? 'cp' : 'cd'}${dirty}" data-col="${col}" data-addr="${ah}">${p ? esc(String.fromCharCode(val)) : ''}</span>`);
        }
    }

    return `<div class="data-row" data-row="${base}">
        <div class="cell-group"><span class="addr-cell">${base.toString(16).toUpperCase().padStart(8, '0')}</span></div>
        <div class="cell-group">${hexCells.join('')}</div>
        <div class="cell-group">${chrCells.join('')}</div>
    </div>`;
}

//  Selection highlight 

export function applySel(): void {
    document.querySelectorAll<HTMLElement>('[data-addr]').forEach(el => {
        const a = parseInt(el.dataset.addr!, 16);
        el.classList.toggle('sel',
            S.selStart !== null && S.selEnd !== null && a >= S.selStart && a <= S.selEnd
        );
    });
}

//  Match highlight 

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

//  Scroll 

export function scrollTo(addr: number): void {
    const row = addr - (addr % BPR);
    const scrollContainer = document.getElementById('mem-scroll');
    if (!scrollContainer) { return; }

    if (!vscrollState) {
        const el = document.querySelector<HTMLElement>(`.data-row[data-row="${row}"]`);
        if (el) { el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
        return;
    }

    const rowIndex = findRowIndex(row);
    if (rowIndex < 0) { return; }

    const targetTop = Math.max(0, calcRowOffset(rowIndex, vscrollState) - vscrollState.rowHeight * 2);
    vscrollState.scrollTop = targetTop;
    scrollContainer.scrollTop = targetTop;
    renderVisibleRows();

    const el = document.querySelector<HTMLElement>(`.data-row[data-row="${row}"]`);
    if (el) { el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
}

function findRowIndex(rowBase: number): number {
    for (let i = 0; i < S.memRows.length; i++) {
        const row = S.memRows[i];
        if (row.type === 'data' && row.address === rowBase) {
            return i;
        }
    }
    return -1;
}

//  Label map 

function buildLabelMap(): Map<number, typeof S.labels> {
    const m = new Map<number, typeof S.labels>();
    for (const lbl of S.labels) {
        if (lbl.hidden) { continue; }
        const ra = lbl.startAddress - (lbl.startAddress % BPR);
        m.set(ra, [...(m.get(ra) ?? []), lbl]);
    }
    return m;
}
