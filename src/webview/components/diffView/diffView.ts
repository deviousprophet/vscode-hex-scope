// ── DiffView component ───────────────────────────────────────────
// Self-contained two-pane diff grid surface: owns the two HexView
// instances, the diff grid markup (diffViewRender.ts), pane-qualified
// interaction callbacks (hover/selection/click/row-drag re-exposed at
// diff level), mirrored-selection paint, header injection, per-pane
// scroll control, and grid-surface styles (diffView.css).
// The host (diff/diffGrid.ts) owns all data and state: the row model,
// view mode, selection range/source pane, sync flag, per-pane
// virtual-scroll state, the render loop, and the rows-wrapper DOM.
// This module never imports the host, never reads data state, and
// never computes a slice — it only drives/reads the two grids.

import './diffView.css';
import { HexView, type HexViewCallbacks } from '../hexView/hexView';
import { renderHexViewHeader, type HexViewRange } from '../hexView/hexViewRender';

export type DiffPane = 'a' | 'b';

export interface DiffViewCallbacks {
    onVisibleWindowChange?: (pane: DiffPane, top: number, left: number) => void;
    onCellClick?: (pane: DiffPane, addr: number, shift: boolean, column: 'hex' | 'char') => void;
    onSelectionChange?: (pane: DiffPane, range: HexViewRange) => void;
    onAddressRowClick?: (pane: DiffPane, rowBase: number, shift: boolean) => void;
    onAddressRowDrag?: (pane: DiffPane, rows: HexViewRange) => void;
}

export class DiffView {
    private cb: DiffViewCallbacks;
    private viewA: HexView | null = null;
    private viewB: HexView | null = null;

    constructor(cb: DiffViewCallbacks = {}) {
        this.cb = cb;
    }

    setCallbacks(cb: DiffViewCallbacks): void {
        this.cb = cb;
    }

    /** Create + mount both HexViews on `#diff-a` / `#diff-b`. Idempotent. */
    mount(): void {
        if (!this.viewA) {
            this.viewA = new HexView('#diff-a', this.callbacksFor('a'));
            this.viewA.mount();
        }
        if (!this.viewB) {
            this.viewB = new HexView('#diff-b', this.callbacksFor('b'));
            this.viewB.mount();
        }
    }

    /** Drop the HexView instances (test seam; a later mount re-creates them). */
    reset(): void {
        this.viewA = null;
        this.viewB = null;
    }

    /** Repaint the host-owned selection on both panes (read-only mirror). */
    paintSelection(range: HexViewRange | null): void {
        this.viewA?.paintSelection(range);
        this.viewB?.paintSelection(range);
    }

    /** Incremental match repaint on both panes (no row rebuild) — streamed search batches. */
    paintMatch(matchAddrs: readonly number[], index: number, length: number): void {
        this.viewA?.paintMatch(matchAddrs, index, length);
        this.viewB?.paintMatch(matchAddrs, index, length);
    }

    /** Fill both pane headers from the hex-only header render (no decoded column). */
    injectHeaders(): void {
        const headerHtml = renderHexViewHeader(false);
        for (const pane of ['a', 'b'] as DiffPane[]) {
            const header = this.headerEl(pane);
            if (header) { header.innerHTML = headerHtml; }
        }
    }

    setScrollTop(pane: DiffPane, top: number): void {
        this.paneView(pane)?.setScrollTop(top);
    }

    setScrollLeft(pane: DiffPane, left: number): void {
        this.paneView(pane)?.setScrollLeft(left);
    }

    getScrollTop(pane: DiffPane): number {
        return this.paneView(pane)?.getScrollTop() ?? 0;
    }

    private paneView(pane: DiffPane): HexView | null {
        return pane === 'a' ? this.viewA : this.viewB;
    }

    private headerEl(pane: DiffPane): HTMLElement | null {
        const rootId = pane === 'a' ? 'diff-a' : 'diff-b';
        return document.getElementById(rootId)?.querySelector<HTMLElement>('.mem-header') ?? null;
    }

    private callbacksFor(pane: DiffPane): HexViewCallbacks {
        return {
            onVisibleWindowChange: (top, left) => this.cb.onVisibleWindowChange?.(pane, top, left),
            onCellClick: (addr, shift, column) => this.cb.onCellClick?.(pane, addr, shift, column),
            onSelectionChange: range => this.cb.onSelectionChange?.(pane, range),
            onAddressRowClick: (rowBase, shift) => this.cb.onAddressRowClick?.(pane, rowBase, shift),
            onAddressRowDrag: rows => this.cb.onAddressRowDrag?.(pane, rows),
        };
    }
}
