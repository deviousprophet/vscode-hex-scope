// ── HexView component ────────────────────────────────────────────
// Self-contained presentational hex grid: owns the grid markup
// (renderHexViewHeader / renderHexViewHtml), transient pointer
// interaction (hover, column hover, drag-selection reporting,
// click/context/copy reporting), and styles (HexView.css).
// The host owns all data and state: it builds the row model and the
// paint inputs, applies selection/matches/edits, and runs search,
// copy, and context-menu logic. This module never imports the `S`
// global, never computes domain state, and never uses global DOM ids
// (every query is scoped to the instance root — diff-compatible).

import { esc, fmtB, lowerBound } from '../../utils';
import './HexView.css';

const BYTES_PER_ROW = 16;

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

export interface HexViewCallbacks {
    onHover?: (addr: number) => void;
    onLeave?: () => void;
    onColumnHover?: (col: number) => void;
    onColumnLeave?: () => void;
    /** Drag-selection range report (component-transient). */
    onSelectionChange?: (range: HexViewRange) => void;
    onCellClick?: (addr: number, shift: boolean, column: 'hex' | 'char') => void;
    onCellContext?: (addr: number, x: number, y: number) => void;
    onCopy?: (range: HexViewRange) => void;
    /** Scroll → host recomputes the visible slice and feeds a new render input. */
    onVisibleWindowChange?: (scrollTop: number) => void;
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

function addrHex(address: number): string {
    return address.toString(16).toUpperCase().padStart(8, '0');
}

// ── Interaction controller ────────────────────────────────────────

function cellAddress(el: HTMLElement): number | null {
    const raw = el.dataset.addr;
    if (!raw) { return null; }
    const addr = parseInt(raw, 16);
    return Number.isNaN(addr) ? null : addr;
}

function selectedColumns(selStart: number, selEnd: number): Set<number> {
    const cols = new Set<number>();
    const startRow = Math.floor(selStart / BYTES_PER_ROW);
    const endRow = Math.floor(selEnd / BYTES_PER_ROW);
    const startCol = selStart % BYTES_PER_ROW;
    const endCol = selEnd % BYTES_PER_ROW;
    if (startRow === endRow) { return addColumnRange(cols, startCol, endCol); }
    if (endRow - startRow > 1) { return addColumnRange(cols, 0, BYTES_PER_ROW - 1); }
    addColumnRange(cols, startCol, BYTES_PER_ROW - 1);
    return addColumnRange(cols, 0, endCol);
}

function addColumnRange(cols: Set<number>, start: number, end: number): Set<number> {
    for (let c = start; c <= end; c++) { cols.add(c); }
    return cols;
}

interface CellAddressIndex {
    cellsByAddr: Map<number, HTMLElement[]>;
    visibleMin: number;
    visibleMax: number;
}

function buildCellAddressIndex(cells: NodeListOf<HTMLElement>): CellAddressIndex | null {
    const index: CellAddressIndex = {
        cellsByAddr: new Map<number, HTMLElement[]>(),
        visibleMin: Number.MAX_SAFE_INTEGER,
        visibleMax: Number.MIN_SAFE_INTEGER,
    };
    cells.forEach(el => addIndexedCell(index, el));
    if (index.cellsByAddr.size === 0) { return null; }
    return index;
}

function addIndexedCell(index: CellAddressIndex, el: HTMLElement): void {
    const addr = cellAddress(el);
    if (addr === null) { return; }
    addCellToMap(index.cellsByAddr, addr, el);
    index.visibleMin = Math.min(index.visibleMin, addr);
    index.visibleMax = Math.max(index.visibleMax, addr);
}

function addCellToMap(cellsByAddr: Map<number, HTMLElement[]>, addr: number, el: HTMLElement): void {
    const existing = cellsByAddr.get(addr);
    if (existing) {
        existing.push(el);
    } else {
        cellsByAddr.set(addr, [el]);
    }
}

function highlightVisibleMatches(
    index: CellAddressIndex,
    matchAddrs: readonly number[],
    activeIndex: number,
    length: number,
): void {
    const firstRelevant = lowerBound(matchAddrs, index.visibleMin - (length - 1));
    for (let mi = firstRelevant; mi < matchAddrs.length; mi++) {
        const matchBase = matchAddrs[mi];
        if (matchBase > index.visibleMax) { break; }
        if (matchBase + length - 1 < index.visibleMin) { continue; }
        highlightMatchRange(index.cellsByAddr, matchBase, length, mi === activeIndex);
    }
}

function highlightMatchRange(
    cellsByAddr: Map<number, HTMLElement[]>,
    matchBase: number,
    length: number,
    active: boolean,
): void {
    for (let i = 0; i < length; i++) {
        const cells = cellsByAddr.get(matchBase + i);
        if (!cells) { continue; }
        highlightMatchCells(cells, active);
    }
}

function highlightMatchCells(cells: HTMLElement[], active: boolean): void {
    for (const el of cells) {
        el.classList.add('match');
        if (active) { el.classList.add('amatch'); }
    }
}

export class HexView {
    private cb: HexViewCallbacks;
    private mounted = false;
    private dragAnchor: number | null = null;
    private lastDragRange: HexViewRange | null = null;
    private activeColumn: string | null = null;
    private hoveredCell: HTMLElement | null = null;
    private cachedRoot: HTMLElement | null = null;
    private cachedScrollEl: HTMLElement | null = null;

    constructor(private readonly rootSelector: string, cb: HexViewCallbacks = {}) {
        this.cb = cb;
    }

    setCallbacks(cb: HexViewCallbacks): void {
        this.cb = cb;
    }

    /** Document-delegated listeners filtered to the instance root. Idempotent. */
    mount(): void {
        if (this.mounted) { return; }
        this.mounted = true;
        document.addEventListener('scroll', this.handleScroll, true);
        document.addEventListener('mousedown', this.handleMouseDown);
        document.addEventListener('mousemove', this.handleMouseMove);
        document.addEventListener('mouseup', this.handleMouseUp);
        document.addEventListener('mouseover', this.handleMouseOver);
        document.addEventListener('mouseout', this.handleMouseOut);
        document.addEventListener('contextmenu', this.handleContextMenu);
        document.addEventListener('keydown', this.handleKeyDown);
    }

    /** Drive the scroll container to a physical scrollTop. */
    setScrollTop(top: number): void {
        const el = this.scrollEl();
        if (el) { el.scrollTop = top; }
    }

    getScrollTop(): number {
        return this.scrollEl()?.scrollTop ?? 0;
    }

    /** Scroll the rendered row of `addr` into view (host computes precise positions). */
    scrollTo(addr: number): void {
        const row = addr - (addr % BYTES_PER_ROW);
        const el = this.rootEl()?.querySelector<HTMLElement>(`.data-row[data-row="${row}"]`);
        if (!el) { return; }
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    /** Host-invoked incremental selection repaint. */
    paintSelection(range: HexViewRange | null): void {
        const root = this.rootEl();
        if (!root) { return; }
        root.querySelectorAll<HTMLElement>('.data-row.row-sel').forEach(el => el.classList.remove('row-sel'));
        root.querySelectorAll<HTMLElement>('#mem-header .data-cell.sel-col').forEach(el => el.classList.remove('sel-col'));
        const cells = root.querySelectorAll<HTMLElement>('[data-addr]');
        if (range === null) {
            cells.forEach(el => el.classList.remove('sel'));
            return;
        }
        const selectedCols = selectedColumns(range.start, range.end);
        cells.forEach(el => {
            const addr = cellAddress(el);
            if (addr === null) { return; }
            const isSelected = addr >= range.start && addr <= range.end;
            el.classList.toggle('sel', isSelected);
            if (isSelected) {
                el.closest<HTMLElement>('.data-row')?.classList.add('row-sel');
            }
        });
        root.querySelectorAll<HTMLElement>('#mem-header .data-cell[data-col]').forEach(el => {
            el.classList.toggle('sel-col', selectedCols.has(Number(el.dataset.col)));
        });
    }

    /** Host-invoked incremental match repaint (spans of `length` bytes). */
    paintMatch(matchAddrs: readonly number[], index: number, length: number): void {
        const root = this.rootEl();
        if (!root) { return; }
        paintMatchesInRoot(root, matchAddrs, index, length);
    }

    /** Nibble-edit preview; `null` restores the cell text from its own data-val. */
    paintCell(addr: number, previewText: string | null): void {
        const cell = this.cellElement(addr);
        if (!cell) { return; }
        if (previewText === null) {
            clearCellPreview(cell);
            return;
        }
        cell.classList.add('editing');
        cell.textContent = previewText;
    }

    // ── Element lookup (scoped, survives host full re-renders) ────

    private rootEl(): HTMLElement | null {
        if (this.cachedRoot?.isConnected) { return this.cachedRoot; }
        this.cachedRoot = document.querySelector<HTMLElement>(this.rootSelector);
        return this.cachedRoot;
    }

    private scrollEl(): HTMLElement | null {
        const root = this.rootEl();
        if (!root) { return null; }
        if (this.cachedScrollUsable(root)) { return this.cachedScrollEl; }
        this.cachedScrollEl = root.querySelector<HTMLElement>('#mem-scroll');
        return this.cachedScrollEl;
    }

    private cellElement(addr: number): HTMLElement | null {
        return this.rootEl()?.querySelector<HTMLElement>(`.data-cell[data-addr="${addrHex(addr)}"]`) ?? null;
    }

    // ── Event handlers ─────────────────────────────────────────────

    private readonly handleScroll = (e: Event): void => {
        const scrollEl = this.scrollEl();
        if (!scrollEl || e.target !== scrollEl) { return; }
        this.syncHeaderScroll(scrollEl);
        this.cb.onVisibleWindowChange?.(scrollEl.scrollTop);
    };

    private syncHeaderScroll(scrollEl: HTMLElement): void {
        const header = this.rootEl()?.querySelector<HTMLElement>('#mem-header');
        if (header) { header.scrollLeft = scrollEl.scrollLeft; }
    }

    private cachedScrollUsable(root: HTMLElement): boolean {
        return !!this.cachedScrollEl?.isConnected && root.contains(this.cachedScrollEl);
    }

    private inRoot(e: MouseEvent): boolean {
        const root = this.rootEl();
        return !!root && root.contains(e.target as Node);
    }

    private dataCellFrom(e: MouseEvent): HTMLElement | null {
        const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-addr]');
        if (!cell || cellAddress(cell) === null) { return null; }
        return cell;
    }

    private readonly handleMouseDown = (e: MouseEvent): void => {
        if (!this.isPrimaryCellDown(e)) { return; }
        const cell = this.dataCellFrom(e)!;
        const addr = cellAddress(cell)!;
        e.preventDefault();
        this.dragAnchor = addr;
        this.lastDragRange = null;
        this.cb.onCellClick?.(addr, e.shiftKey, columnFor(cell));
    };

    private isPrimaryCellDown(e: MouseEvent): boolean {
        return this.inRoot(e) && e.button === 0 && this.dataCellFrom(e) !== null;
    }

    private readonly handleMouseMove = (e: MouseEvent): void => {
        if (!this.activeDragFor(e)) {
            this.dragAnchor = null;
            return;
        }
        this.reportDragRange(this.dragRangeFromPoint(e));
    };

    private reportDragRange(range: HexViewRange | null): void {
        if (!range || this.isSameDragRange(range)) { return; }
        this.lastDragRange = range;
        this.cb.onSelectionChange?.(range);
    }

    private activeDragFor(e: MouseEvent): boolean {
        return this.dragAnchor !== null && (e.buttons & 1) === 1;
    }

    private dragRangeFromPoint(e: MouseEvent): HexViewRange | null {
        const addr = this.dragAddressFromPoint(e);
        if (addr === null || this.dragAnchor === null) { return null; }
        return { start: Math.min(this.dragAnchor, addr), end: Math.max(this.dragAnchor, addr) };
    }

    private isSameDragRange(range: HexViewRange): boolean {
        return !!this.lastDragRange
            && this.lastDragRange.start === range.start
            && this.lastDragRange.end === range.end;
    }

    private dragAddressFromPoint(e: MouseEvent): number | null {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (!el) { return null; }
        const cell = (el as HTMLElement).closest<HTMLElement>('[data-addr]');
        if (!cell) { return null; }
        if (!this.rootEl()?.contains(cell)) { return null; }
        return cellAddress(cell);
    }

    private readonly handleMouseUp = (): void => {
        this.dragAnchor = null;
    };

    private readonly handleMouseOver = (e: MouseEvent): void => {
        if (!this.inRoot(e)) { return; }
        const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-col]');
        if (!cell) {
            this.setCellHover(null);
            this.setColumn(null);
            return;
        }
        this.setCellHover(cell);
        this.setColumn(cell.dataset.col ?? null);
    };

    private readonly handleMouseOut = (e: MouseEvent): void => {
        const root = this.rootEl();
        if (!root || !root.contains(e.target as Node)) { return; }
        if (this.relatedTargetInColumn(e, root)) { return; }
        this.setCellHover(null);
        this.setColumn(null);
    };

    private relatedTargetInColumn(e: MouseEvent, root: HTMLElement): boolean {
        const related = e.relatedTarget as Node | null;
        if (!related || !root.contains(related)) { return false; }
        return (related as HTMLElement).closest?.('[data-col]') !== null;
    }

    private setCellHover(cell: HTMLElement | null): void {
        if (this.hoveredCell === cell) { return; }
        if (this.hoveredCell) { this.hoveredCell.classList.remove('cell-hover'); }
        this.hoveredCell = cell;
        this.paintHoveredCell(cell);
    }

    private paintHoveredCell(cell: HTMLElement | null): void {
        if (!cell) {
            this.cb.onLeave?.();
            return;
        }
        cell.classList.add('cell-hover');
        this.reportHover(cell);
    }

    private reportHover(cell: HTMLElement): void {
        const addr = cellAddress(cell);
        if (addr === null) {
            this.cb.onLeave?.();
            return;
        }
        this.cb.onHover?.(addr);
    }

    private setColumn(column: string | null): void {
        if (this.activeColumn === column) { return; }
        this.unpaintColumn();
        this.activeColumn = column;
        this.paintColumn();
    }

    private unpaintColumn(): void {
        if (this.activeColumn === null) { return; }
        this.rootEl()?.querySelectorAll<HTMLElement>(`[data-col="${this.activeColumn}"]`).forEach(el => el.classList.remove('col-hi'));
        this.cb.onColumnLeave?.();
    }

    private paintColumn(): void {
        if (this.activeColumn === null) { return; }
        this.rootEl()?.querySelectorAll<HTMLElement>(`[data-col="${this.activeColumn}"]`).forEach(el => el.classList.add('col-hi'));
        this.cb.onColumnHover?.(Number(this.activeColumn));
    }

    private readonly handleContextMenu = (e: MouseEvent): void => {
        if (!this.inRoot(e)) { return; }
        const cell = this.dataCellFrom(e);
        if (!cell) { return; }
        this.cb.onCellContext?.(cellAddress(cell)!, e.clientX, e.clientY);
        e.preventDefault();
    };

    private readonly handleKeyDown = (e: KeyboardEvent): void => {
        if (!this.copyDragShortcut(e)) { return; }
        e.preventDefault();
        e.stopPropagation();
        if (this.lastDragRange) { this.cb.onCopy?.(this.lastDragRange); }
    };

    private copyDragShortcut(e: KeyboardEvent): boolean {
        if (this.dragAnchor === null) { return false; }
        if (!isCopyShortcut(e)) { return false; }
        return !isEditableTarget(e.target as HTMLElement | null);
    }
}

function columnFor(cell: HTMLElement): 'hex' | 'char' {
    return cell.classList.contains('char-cell') ? 'char' : 'hex';
}

function isCopyShortcut(e: KeyboardEvent): boolean {
    return (e.ctrlKey || e.metaKey) && e.key === 'c';
}

function isEditableTarget(target: HTMLElement | null): boolean {
    return !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
}

function paintMatchesInRoot(
    root: HTMLElement,
    matchAddrs: readonly number[],
    index: number,
    length: number,
): void {
    const cells = root.querySelectorAll<HTMLElement>('.data-cell[data-addr], .char-cell[data-addr]');
    cells.forEach(el => el.classList.remove('match', 'amatch'));
    if (matchAddrs.length === 0 || length <= 0) { return; }
    const cellIndex = buildCellAddressIndex(cells);
    if (!cellIndex) { return; }
    highlightVisibleMatches(cellIndex, matchAddrs, index, length);
}

function clearCellPreview(cell: HTMLElement): void {
    cell.classList.remove('editing');
    const raw = cell.dataset.val;
    if (raw === undefined) { return; }
    const value = parseInt(raw, 10);
    if (!Number.isNaN(value)) {
        cell.textContent = value.toString(16).toUpperCase().padStart(2, '0');
    }
}
