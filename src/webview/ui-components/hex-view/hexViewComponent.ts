// Reusable hex-grid component: optional filename label + 00..0F header +
// (address gutter + hex cells) + optional decoded-text column. Host-agnostic
// row model (HexViewRow): the host feeds the slice it wants rendered plus
// selection/match data; the component owns markup + CSS + transient
// interaction (hover / column hover / drag-selection reporting / copy intent).
// Used by the diff view (showChar:false, hex-only) and the single memory view.

import { esc, fmtB } from '../../utils';

export interface HexViewRange { start: number; end: number }

export interface HexViewCallbacks {
    onHover?: (addr: number) => void;
    onLeave?: () => void;
    onSelectionChange?: (range: HexViewRange | null) => void;
    onColumnHover?: (col: number) => void;
    onColumnLeave?: () => void;
    /** Ctrl/Cmd+C with this component's selection active; the host decides bytes + format. */
    onCopy?: (range: HexViewRange) => void;
}

/** One rendered byte cell: hex glyph + decoded-text glyph + host-computed classes. */
export interface HexViewCell {
    hex: string;
    char: string;
    cls: string;
}

/** Label banner rendered above a data row (single-view segment labels). */
export interface HexViewBanner {
    name: string;
    start: number;
    length: number;
    color: string;
}

/** Host-agnostic visual row: a data row (BPR cells) or an explicit gap row. */
export interface HexViewRow {
    address: number;
    kind: 'data' | 'gap';
    /** Data rows only: one cell per byte of the row. */
    cells: HexViewCell[];
    /** Gap rows only. */
    gap?: { from: number; to: number; bytes: number };
    banners?: HexViewBanner[];
}

export interface HexViewRenderInput {
    label: string;
    rows: readonly HexViewRow[];
    /** Index of `rows[0]` within the full row list (absolute positioning). */
    rowOffset: number;
    searchRowIndex: number;
    matchSet: ReadonlySet<number>;
    error: string | null;
    totalHeight: number;
    /** Selection to paint, from host state (single source of truth). */
    selection?: HexViewRange | null;
    /** Render the decoded-text (ASCII) column header + char cells. Diff passes false. */
    showChar?: boolean;
    /**
     * Vertical offset applied to every row position (px). Hosts use this for
     * compressed-mode virtualization: `windowTop = calcCompressedWindowTop(firstIdx) - rowOffset*ROW_HEIGHT`
     * anchors the buffered slice to its scaled phantom position. Omitted/0 = plain
     * absolute indexing (non-compressed). The host owns the phantom + anchor.
     */
    windowTop?: number;
    /**
     * Height (px) of each rendered row, parallel to `rows`. When provided, rows
     * are positioned at cumulative heights instead of the uniform ROW_HEIGHT
     * (single view: gap rows and label banners have variable heights). The
     * host's virtual-scroll getRowHeight must match these exactly.
     */
    rowHeights?: readonly number[];
}

/** Row width in bytes (BPR contract; single source is the core BPR constant). */
const ROW_BYTES = 16;
/** Fixed data-row height in px; must match `.diff-row` height in the component css. */
const ROW_HEIGHT = 22;

function formatAddress(address: number): string {
    return address.toString(16).toUpperCase().padStart(8, '0');
}

function cellSelected(addr: number, sel: HexViewRange | null | undefined): boolean {
    return !!sel && addr >= sel.start && addr <= sel.end;
}

function rowSelected(row: HexViewRow, sel: HexViewRange | null | undefined): boolean {
    return !!sel && row.kind === 'data'
        && row.address + ROW_BYTES > sel.start && row.address <= sel.end;
}

/** Header columns spanned by a selection (single-view parity). */
function selectedColumns(sel: HexViewRange | null | undefined): Set<number> {
    const cols = new Set<number>();
    if (!sel) { return cols; }
    const addRange = (a: number, b: number) => { for (let c = a; c <= b; c++) { cols.add(c); } };
    const startRow = Math.floor(sel.start / ROW_BYTES);
    const endRow = Math.floor(sel.end / ROW_BYTES);
    if (startRow === endRow) { addRange(sel.start % ROW_BYTES, sel.end % ROW_BYTES); return cols; }
    if (endRow - startRow > 1) { addRange(0, ROW_BYTES - 1); return cols; }
    addRange(sel.start % ROW_BYTES, ROW_BYTES - 1);
    addRange(0, sel.end % ROW_BYTES);
    return cols;
}

/** Empty (`be`) cells hold no byte: they never carry match or selection. */
function isMatchedCell(cls: string, isMatch: boolean): boolean {
    return isMatch && !cls.includes('be');
}

/** `data-val` is the decimal byte value (single-view host reads it); empty cells omit it. */
function dataValAttr(hex: string): string {
    return /^[0-9a-fA-F]{2}$/.test(hex) ? ` data-val="${parseInt(hex, 16)}"` : '';
}

function cellHtml(cls: string, hex: string, addr: number, col: number, isMatch: boolean, isSel: boolean, side: 'a' | 'b'): string {
    const empty = cls.includes('be');
    const match = isMatchedCell(cls, isMatch) ? ' match' : '';
    const sel = isSel && !empty ? ' sel' : '';
    const addrAttr = empty ? '' : ` data-addr="${esc(formatAddress(addr))}"`;
    return `<span class="data-cell ${cls}${match}${sel}"${addrAttr} data-side="${side}" data-col="${col}"${dataValAttr(hex)}>${hex}</span>`;
}

function charCellHtml(cls: string, char: string, addr: number, col: number, isMatch: boolean, isSel: boolean): string {
    const empty = cls.includes('be');
    const match = isMatchedCell(cls, isMatch) ? ' match' : '';
    const sel = isSel && !empty ? ' sel' : '';
    const addrAttr = empty ? '' : ` data-addr="${esc(formatAddress(addr))}"`;
    return `<span class="char-cell ${cls}${match}${sel}"${addrAttr} data-col="${col}">${esc(char)}</span>`;
}

function rowModifiers(isSearchRow: boolean, error: string | null): string {
    return `${isSearchRow ? ' search-row' : ''}${error ? ' panel-error' : ''}`;
}

function cellsForRow(
    row: HexViewRow,
    side: 'a' | 'b',
    matchSet: ReadonlySet<number>,
    sel: HexViewRange | null | undefined,
    showChar: boolean,
): { hex: string; char: string } {
    let hex = '';
    let char = '';
    for (let j = 0; j < row.cells.length; j++) {
        const c = row.cells[j];
        const addr = row.address + j;
        const isMatch = matchSet.has(addr);
        const isSel = cellSelected(addr, sel);
        hex += cellHtml(c.cls, c.hex, addr, j, isMatch, isSel, side);
        if (showChar) {
            char += charCellHtml(c.cls, c.char, addr, j, isMatch, isSel);
        }
    }
    return { hex, char };
}

function gapRowHtml(row: HexViewRow, top: number): string {
    const gap = row.gap ?? { from: row.address, to: row.address, bytes: 0 };
    const f = gap.from.toString(16).toUpperCase().padStart(8, '0');
    const t = gap.to.toString(16).toUpperCase().padStart(8, '0');
    return `<div class="gap-row" style="top:${top}px">
        <span class="gap-dots"></span>
        <span class="gap-range">0x${f}  0x${t}</span>
        <span class="gap-size">${fmtB(gap.bytes)} unmapped</span>
    </div>`;
}

function bannerHtml(b: HexViewBanner): string {
    const start = b.start.toString(16).toUpperCase().padStart(8, '0');
    return `<div class="seg-banner" style="border-color:${b.color};background:${b.color}14;color:${b.color}">
        <span class="sb-name">${esc(b.name)}</span>
        <span class="sb-meta">0x${start}  ${fmtB(b.length)}</span>
    </div>`;
}

function rowTop(windowTop: number, index: number, rowOffset: number, rowHeights: readonly number[] | undefined): number {
    if (!rowHeights) { return windowTop + (index + rowOffset) * ROW_HEIGHT; }
    let offset = 0;
    for (let k = 0; k < index; k++) { offset += rowHeights[k]; }
    return windowTop + offset;
}

function rowHtml(
    row: HexViewRow,
    side: 'a' | 'b',
    index: number,
    rowOffset: number,
    isSearchRow: boolean,
    matchSet: ReadonlySet<number>,
    error: string | null,
    sel: HexViewRange | null | undefined,
    showChar: boolean,
    windowTop: number,
    rowHeights: readonly number[] | undefined,
): string {
    const top = rowTop(windowTop, index, rowOffset, rowHeights);
    if (row.kind === 'gap') { return gapRowHtml(row, top); }
    const addr = esc(formatAddress(row.address));
    const banners = (row.banners ?? []).map(bannerHtml).join('');
    const cells = cellsForRow(row, side, matchSet, sel, showChar);
    const isRowSel = rowSelected(row, sel);
    const rowClass = `diff-row${isRowSel ? ' row-sel' : ''}`;
    const inner = `<span class="addr">${addr}</span>
        <div class="side${rowModifiers(isSearchRow, error)}">${cells.hex}</div>
        ${showChar ? `<div class="side side-char">${cells.char}</div>` : ''}`;
    if (banners) {
        // Labels render above their data row as one positioned unit (single view).
        return `<div class="row-anchor" style="top:${top}px">${banners}<div class="${rowClass}" data-addr="${addr}">${inner}
    </div></div>`;
    }
    return `<div class="${rowClass}" data-addr="${addr}" style="top:${top}px">${inner}
</div>`;
}

function headerHtml(showChar: boolean, sel: HexViewRange | null | undefined): string {
    const selCols = selectedColumns(sel);
    const cells: string[] = [];
    for (let i = 0; i < ROW_BYTES; i++) {
        cells.push(`<span class="hcell${selCols.has(i) ? ' sel-col' : ''}" data-col="${i}">${esc(i.toString(16).toUpperCase().padStart(2, '0'))}</span>`);
    }
    const char = showChar ? `<div class="side side-char"><span class="hcell hcell-decoded">Decoded text</span></div>` : '';
    return `<span class="addr"></span><div class="side">${cells.join('')}</div>${char}`;
}

/** Pure HTML for one component (testable without DOM). */
export function renderHexViewComponentHtml(side: 'a' | 'b', input: HexViewRenderInput): string {
    const showChar = input.showChar === true;
    const windowTop = input.windowTop ?? 0;
    const rows: string[] = [];
    for (let i = 0; i < input.rows.length; i++) {
        rows.push(rowHtml(
            input.rows[i],
            side,
            i,
            input.rowOffset,
            i + input.rowOffset === input.searchRowIndex,
            input.matchSet,
            input.error,
            input.selection,
            showChar,
            windowTop,
            input.rowHeights,
        ));
    }
    return `<div class="diff-component ${side}">
        ${input.label ? `<div class="panel-label">${esc(input.label)}</div>` : ''}
        <div class="diff-header">${headerHtml(showChar, input.selection)}</div>
        <div class="diff-body" style="height:${input.totalHeight}px">${rows.join('')}</div>
    </div>`;
}

// ── DOM helpers (module-private; keep decision points tiny) ────────────

function addrOf(el: HTMLElement): number {
    return parseInt(el.dataset.addr ?? '', 16);
}

function colOf(el: HTMLElement): number {
    return parseInt(el.dataset.col ?? '', 10);
}

function cellAt(t: EventTarget | null, scope: string): { addr: number } | null {
    const el = (t as HTMLElement).closest?.(`${scope} .data-cell[data-addr]`) as HTMLElement | null;
    if (!el) { return null; }
    return addrCell(el);
}

function addrCell(el: HTMLElement): { addr: number } | null {
    const addr = parseInt(el.dataset.addr ?? '', 16);
    return Number.isFinite(addr) ? { addr } : null;
}

function isEmptyCell(t: EventTarget | null, scope: string): boolean {
    const el = (t as HTMLElement).closest?.(`${scope} .data-cell`) as HTMLElement | null;
    return el?.classList.contains('be') === true;
}

function isCopyShortcut(k: KeyboardEvent): boolean {
    return (k.ctrlKey || k.metaKey) && k.key.toLowerCase() === 'c';
}

function isEditableTarget(k: KeyboardEvent): boolean {
    return (k.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable="true"]') !== null;
}

function headerCellAt(t: EventTarget | null, scope: string): HTMLElement | null {
    return (t as HTMLElement).closest?.(`${scope} .diff-header .hcell`) as HTMLElement | null;
}

function columnIndexOf(h: HTMLElement): number {
    return Array.prototype.indexOf.call(h.parentElement?.children ?? [], h);
}

function insideComponent(el: HTMLElement | null, scope: string): boolean {
    return el !== null && el.closest(scope) !== null;
}

function rowOverlaps(base: number, start: number, end: number): boolean {
    return Number.isFinite(base) && base + ROW_BYTES > start && base <= end;
}

function rowContains(base: number, addr: number): boolean {
    return Number.isFinite(base) && addr >= base && addr < base + ROW_BYTES;
}

function clearColumnHighlight(scope: string): void {
    document.querySelectorAll(`${scope} .data-cell.col-hi`).forEach(el => el.classList.remove('col-hi'));
    document.querySelectorAll(`${scope} .char-cell.col-hi`).forEach(el => el.classList.remove('col-hi'));
    document.querySelectorAll(`${scope} .diff-header .hcell.col-hi`).forEach(el => el.classList.remove('col-hi'));
}

function isColumnCell(el: HTMLElement, column: number): boolean {
    return (addrOf(el) & 0xF) === column && addrOf(el) >= 0;
}

function paintColumnCells(scope: string, column: number): void {
    for (const el of document.querySelectorAll<HTMLElement>(`${scope} .data-cell[data-addr], ${scope} .char-cell[data-addr]`)) {
        if (isColumnCell(el, column)) { el.classList.add('col-hi'); }
    }
}

function paintColumnHeaders(scope: string, column: number): void {
    for (const el of document.querySelectorAll<HTMLElement>(`${scope} .diff-header .hcell[data-col]`)) {
        if (colOf(el) === column) { el.classList.add('col-hi'); }
    }
}

function paintMirrorRow(scope: string, addr: number): void {
    for (const el of document.querySelectorAll<HTMLElement>(`${scope} .diff-row[data-addr]`)) {
        if (rowContains(addrOf(el), addr)) { el.classList.add('row-hi'); }
    }
}

function paintMirrorRange(scope: string, range: HexViewRange): void {
    for (const el of document.querySelectorAll<HTMLElement>(`${scope} .data-cell[data-addr]`)) {
        if (addrOf(el) >= range.start && addrOf(el) <= range.end) { el.classList.add('sel-mirror'); }
    }
}

/** Interaction controller: owns transient hover/column/mirror, reports selection. */
export class HexViewComponent {
    // Transient drag range, reported via onSelectionChange; the HOST owns the
    // selection state and repaints it through the render input (Q7).
    private _dragRange: HexViewRange | null = null;
    private _hoverAddr = -1;
    private _mirrorAddr = -1;
    private _mirrorRange: HexViewRange | null = null;
    private _column = -1;
    private _dragging = false;
    private _mounted = false;
    private cb: HexViewCallbacks;

    constructor(private readonly side: 'a' | 'b', cb: HexViewCallbacks = {}) {
        this.cb = cb;
    }

    /** Replace the interaction callbacks (e.g. after wiring cross-panel hosts). */
    setCallbacks(cb: HexViewCallbacks): void {
        this.cb = cb;
    }

    private get rootSel(): string {
        return `.diff-component.${this.side}`;
    }

    mount(): void {
        if (this._mounted) { return; }
        this._mounted = true;

        document.addEventListener('mousedown', e => {
            const c = cellAt(e.target, this.rootSel);
            if (!c || isEmptyCell(e.target, this.rootSel)) { return; }
            // Empty (be) cells carry no data: they cannot start a selection.
            this.startSelection(c.addr);
        });
        document.addEventListener('mouseover', e => this.onMouseOver(e as MouseEvent));
        document.addEventListener('mouseout', e => {
            if (this.shouldLeave(e as MouseEvent)) { this.clearHoverAndColumn(); }
        });
        document.addEventListener('mouseup', () => { this._dragging = false; });
        document.addEventListener('keydown', e => this.handleCopyKey(e as KeyboardEvent));
    }

    // ponytail: destroy() removed (unused; sole user of _listeners registry) — re-add with a listener registry when a host must detach document listeners.
    // ponytail: getSelection() removed (unused) — selection lives in host state; re-add if a host must read this component's drag range.

    /** Paint the hovered-by-the-other-side byte in this component (cell + row + column). */
    setMirrorAddr(addr: number): void {
        this._mirrorAddr = addr;
        this.applyMirror();
        this.applyMirrorRow(addr);
    }
    /** Paint the selected-by-the-other-side range in this component. */
    setMirrorRange(range: HexViewRange | null): void { this._mirrorRange = range; this.applyMirrorRange(); }
    /** Paint a byte column in this component (from either header's hover). */
    setColumn(col: number): void { this.applyColumn(col); }

    /** Re-apply transient paints after the DOM is rebuilt. */
    reapply(): void {
        this.applyHover();
        this.applyMirror();
        this.applyMirrorRow(this._mirrorAddr);
        this.applyMirrorRange();
        this.applyColumn();
    }

    private startSelection(addr: number): void {
        this._dragging = true;
        this._dragRange = { start: addr, end: addr };
        this.cb.onSelectionChange?.(this._dragRange);
    }

    private onMouseOver(e: MouseEvent): void {
        const c = cellAt(e.target, this.rootSel);
        if (this._dragging) { this.extendDrag(c); return; }
        if (c) { this.paintByteHover(c.addr); return; }
        this.paintHeaderHover(e.target);
    }

    private extendDrag(c: { addr: number } | null): void {
        if (!c || !this._dragRange) { return; }
        this._dragRange = {
            start: Math.min(this._dragRange.start, c.addr),
            end: Math.max(this._dragRange.end, c.addr),
        };
        this.cb.onSelectionChange?.(this._dragRange);
    }

    private paintByteHover(addr: number): void {
        // byte hover + its column (single-view parity: byte hover highlights the column)
        this._hoverAddr = addr;
        this.applyHover();
        this.cb.onHover?.(addr);
        this.applyColumn(addr & 0xF);
        this.cb.onColumnHover?.(addr & 0xF);
    }

    private paintHeaderHover(target: EventTarget | null): void {
        const h = headerCellAt(target, this.rootSel);
        if (!h) { return; }
        const col = columnIndexOf(h);
        this.applyColumn(col);
        this.cb.onColumnHover?.(col);
    }

    private shouldLeave(e: MouseEvent): boolean {
        const t = e.target as HTMLElement;
        const related = e.relatedTarget as HTMLElement | null;
        // Leaving the whole component clears hover + column (mouseleave emulation).
        return t.closest(this.rootSel) !== null && !insideComponent(related, this.rootSel);
    }

    private clearHoverAndColumn(): void {
        this._hoverAddr = -1;
        this.applyHover();
        this.cb.onLeave?.();
        this.applyColumn(-1);
        this.cb.onColumnLeave?.();
    }

    private handleCopyKey(k: KeyboardEvent): boolean {
        if (!isCopyShortcut(k)) { return false; }
        if (isEditableTarget(k)) { return false; }
        if (!this._dragRange) { return false; }
        k.preventDefault();
        this.emitCopy(this._dragRange);
        return true;
    }

    private emitCopy(range: HexViewRange): void {
        this.cb.onCopy?.(range);
    }

    /** Highlight the row containing `addr` (mirrors the other side's row hover). */
    private applyMirrorRow(addr: number): void {
        document.querySelectorAll(`${this.rootSel} .diff-row.row-hi`).forEach(el => el.classList.remove('row-hi'));
        if (addr < 0) { return; }
        paintMirrorRow(this.rootSel, addr);
    }

    /** Highlight the hovered byte on its own side too (matches the mirror). */
    private applyHover(): void {
        const scope = this.rootSel;
        document.querySelectorAll(`${scope} .data-cell.cell-hover`).forEach(el => el.classList.remove('cell-hover'));
        if (this._hoverAddr < 0) { return; }
        const el = document.querySelector(`${scope} .data-cell[data-addr="${esc(formatAddress(this._hoverAddr))}"]`);
        el?.classList.add('cell-hover');
    }

    private applyMirror(): void {
        const scope = this.rootSel;
        document.querySelectorAll(`${scope} .data-cell.cell-mirror`).forEach(el => el.classList.remove('cell-mirror'));
        if (this._mirrorAddr < 0) { return; }
        const el = document.querySelector(`${scope} .data-cell[data-addr="${esc(formatAddress(this._mirrorAddr))}"]`);
        el?.classList.add('cell-mirror');
    }

    private applyMirrorRange(): void {
        document.querySelectorAll(`${this.rootSel} .data-cell.sel-mirror`).forEach(el => el.classList.remove('sel-mirror'));
        if (!this._mirrorRange) { return; }
        paintMirrorRange(this.rootSel, this._mirrorRange);
    }

    private applyColumn(col?: number): void {
        this._column = col ?? this._column;
        clearColumnHighlight(this.rootSel);
        if (this._column < 0) { return; }
        paintColumnCells(this.rootSel, this._column);
        paintColumnHeaders(this.rootSel, this._column);
    }
}
