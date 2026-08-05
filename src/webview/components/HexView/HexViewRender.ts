// ── HexView pure render layer ───────────────────────────────────
// DOM-free markup builders for the hex grid (split out of HexView.ts).
// The HexView class consumes this render surface; memoryGrid imports it
// via HexView's re-export so existing importers keep working.

import { esc, fmtB } from '../../utils';

export const BYTES_PER_ROW = 16;

export interface HexViewCell {
    hex: string;
    char: string;
    /** Hex-cell classes (byte class + host-computed dirty/integrity). */
    cls: string;
    /** Char-cell classes (cp|cd + host-computed dirty/integrity/edit-placeholder). */
    charCls?: string;
    /** Byte value → data-val attribute (paintCell restore source). Undefined = empty cell. */
    val?: number;
}

export interface HexViewBanner {
    name: string;
    start: number;
    length: number;
    color: string;
}

export interface HexViewRow {
    address: number;
    kind: 'data' | 'gap';
    cells: HexViewCell[];
    gap?: { from: number; to: number; bytes: number };
    banners?: HexViewBanner[];
}

export interface HexViewRange {
    start: number;
    end: number;
}

export interface HexViewRenderInput {
    /** The visible slice (host-computed). */
    rows: readonly HexViewRow[];
    /** Top spacer (px) preserving slice alignment in the full-height container. */
    topSpacer: number;
    /** Bottom spacer (px). */
    bottomSpacer: number;
    /** True when content exceeds the max physical height (virtual-scroll compression). */
    compressed: boolean;
    /** Height (px) of the rows container when compressed. */
    containerHeight: number;
    /** Inner wrapper vertical offset (px) when compressed. */
    windowTop: number;
    /** Every address covered by any search match (visible only). */
    matchSet: ReadonlySet<number>;
    /** Host-owned selection; the component paints it. */
    selection: HexViewRange | null;
    /** Span of the active match (renders `.amatch`). */
    activeMatch: HexViewRange | null;
    /** Default true = hex + decoded-ASCII columns (single-view parity). */
    showAscii?: boolean;
}

// ── Pure render ───────────────────────────────────────────────────

const EMPTY_ROWS_HTML = `<div style="padding:30px 20px;color:var(--non-graphic);font-size:12px">No data records found.</div>`;

export function renderHexViewHeader(showAscii = true): string {
    const hiddenHtml = `<div class="cell-group"><span class="addr-cell">00000000</span></div>`;
    const hexHeaderHtml = Array.from({ length: BYTES_PER_ROW }, (_, i) =>
        `<span class="data-cell" data-col="${i}" style="cursor:default;color:var(--addr-active-fg)">${i.toString(16).toUpperCase().padStart(2, '0')}</span>`
    ).join('');
    return hiddenHtml
        + `<div class="cell-group">${hexHeaderHtml}</div>`
        + (showAscii ? `<div class="cell-group col-decoded"><span class="mem-hdr-decoded">Decoded text</span></div>` : '');
}

export function renderHexViewHtml(input: HexViewRenderInput): string {
    const showAscii = input.showAscii !== false;
    if (input.rows.length === 0) { return EMPTY_ROWS_HTML; }
    return buildRowParts(input, showAscii);
}

function buildRowParts(input: HexViewRenderInput, showAscii: boolean): string {
    const parts: string[] = [];
    if (input.compressed) {
        // Compressed: windowTop already positions the slice (physicalScrollTop + topSpacer - logicalScrollTop).
        // Emitting spacers too would double-offset and grow blank space above rows as you scroll down.
        parts.push(`<div style="position:absolute;top:${input.windowTop}px;left:0;width:max-content;min-width:100%">`);
        for (const row of input.rows) { appendHexViewRow(parts, row, input, showAscii); }
        parts.push('</div>');
        return parts.join('');
    }
    appendSpacer(parts, input.topSpacer);
    for (const row of input.rows) { appendHexViewRow(parts, row, input, showAscii); }
    appendSpacer(parts, input.bottomSpacer);
    return parts.join('');
}

function appendSpacer(parts: string[], height: number): void {
    if (height > 0) { parts.push(`<div style="height:${height}px"></div>`); }
}

function appendHexViewRow(parts: string[], row: HexViewRow, input: HexViewRenderInput, showAscii: boolean): void {
    if (row.kind === 'gap') {
        parts.push(renderGapRow(row));
        return;
    }
    for (const banner of row.banners ?? []) { parts.push(renderBanner(banner)); }
    parts.push(renderDataRow(row, input, showAscii));
}

function renderGapRow(row: HexViewRow): string {
    const gap = row.gap;
    if (!gap) { return ''; }
    return `<div class="gap-row">` +
        `<span class="gap-dots"></span>` +
        `<span class="gap-range">0x${addrHex(gap.from)}  0x${addrHex(gap.to)}</span>` +
        `<span class="gap-size">${fmtB(gap.bytes)} unmapped</span>` +
        `</div>`;
}

function renderBanner(banner: HexViewBanner): string {
    return `<div class="seg-banner" style="border-color:${banner.color};background:${banner.color}14;color:${banner.color}">` +
        `<span class="sb-name">${esc(banner.name)}</span>` +
        `<span class="sb-meta">0x${addrHex(banner.start)}  ${fmtB(banner.length)}</span>` +
        `</div>`;
}

function renderDataRow(row: HexViewRow, input: HexViewRenderInput, showAscii: boolean): string {
    const hexCells: string[] = [];
    const charCells: string[] = [];
    for (let col = 0; col < row.cells.length; col++) {
        const addr = row.address + col;
        hexCells.push(renderHexCell(row.cells[col], col, addr, input));
        if (showAscii) { charCells.push(renderCharCell(row.cells[col], col, addr, input)); }
    }
    return `<div class="data-row" data-row="${row.address}">` +
        `<div class="cell-group"><span class="addr-cell">${addrHex(row.address)}</span></div>` +
        `<div class="cell-group">${hexCells.join('')}</div>` +
        (showAscii ? `<div class="cell-group col-decoded">${charCells.join('')}</div>` : '') +
        `</div>`;
}

function renderHexCell(cell: HexViewCell, col: number, addr: number, input: HexViewRenderInput): string {
    if (cell.val === undefined) {
        return `<span class="data-cell be" data-col="${col}" aria-hidden="true">  </span>`;
    }
    return `<span class="data-cell ${compositedClasses(cell.cls, addr, input)}" data-col="${col}" data-addr="${addrHex(addr)}" data-val="${cell.val}">${cell.hex}</span>`;
}

function renderCharCell(cell: HexViewCell, col: number, addr: number, input: HexViewRenderInput): string {
    if (cell.val === undefined) {
        return `<span class="char-cell cd" data-col="${col}" aria-hidden="true"> </span>`;
    }
    return `<span class="char-cell ${compositedClasses(cell.charCls ?? 'cp', addr, input)}" data-col="${col}" data-addr="${addrHex(addr)}">${cell.char}</span>`;
}

function compositedClasses(base: string, addr: number, input: HexViewRenderInput): string {
    let cls = base;
    if (isMatchAddress(addr, input)) { cls += ' match'; }
    if (isActiveMatchAddress(addr, input)) { cls += ' amatch'; }
    if (inRange(input.selection, addr)) { cls += ' sel'; }
    return cls;
}

function isMatchAddress(addr: number, input: HexViewRenderInput): boolean {
    return input.matchSet.has(addr) || inRange(input.activeMatch, addr);
}

function isActiveMatchAddress(addr: number, input: HexViewRenderInput): boolean {
    return inRange(input.activeMatch, addr);
}

function inRange(range: HexViewRange | null, addr: number): boolean {
    return range !== null && addr >= range.start && addr <= range.end;
}

export function addrHex(address: number): string {
    return address.toString(16).toUpperCase().padStart(8, '0');
}
