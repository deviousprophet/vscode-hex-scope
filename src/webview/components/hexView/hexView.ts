// ── HexView component ────────────────────────────────────────────
// Self-contained presentational hex grid: owns the transient pointer
// interaction (hover, column hover, drag-selection reporting,
// click/context/copy reporting) and styles (HexView.css). The grid
// markup is built by the pure render layer in hexViewRender.ts; DOM
// paint/match utilities live in hexViewPaint.ts.
// The host owns all data and state: it builds the row model and the
// paint inputs, applies selection/matches/edits, and runs search,
// copy, and context-menu logic. This module never imports the `S`
// global, never computes domain state, and never uses global DOM ids
// (every query is scoped to the instance root — diff-compatible).

import './hexView.css';
import { addrHex, BYTES_PER_ROW, type HexViewRange } from './hexViewRender';
import { cellAddress, clearCellPreview, columnFor, isCopyShortcut, isEditableTarget, paintMatchesInRoot, selectedColumns } from './hexViewPaint';

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

// ── Interaction controller ────────────────────────────────────────

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

    /** Host-invoked struct-field highlight: add `cls` to every cell (hex + char) at `addrs` (root-scoped). */
    paintStructHighlight(addrs: readonly number[], cls: string): void {
        const root = this.rootEl();
        if (!root) { return; }
        for (const addr of addrs) {
            root.querySelectorAll<HTMLElement>(`[data-addr="${addrHex(addr)}"]`).forEach(el => el.classList.add(cls));
        }
    }

    /** Host-invoked struct-field clear: remove `cls` from every cell in the grid root. */
    paintClearStructHighlight(cls: string): void {
        const root = this.rootEl();
        if (!root) { return; }
        root.querySelectorAll<HTMLElement>(`.${cls}`).forEach(el => el.classList.remove(cls));
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
