// Diff grid render + interaction host. Mirrors memory/memoryView.ts: owns the
// grid state and renders the buffered/compressed slice through the shared
// HexViewComponent; the composition root (hexDiffViewer.ts) owns the toolbar,
// messages, and search bar. Host -> virtualScroll (slice + position) -> component.

import type { DiffMeta } from '../../core/diff';
import type { SerializedParseResult, WireParseResult } from '../../core/types';
import { hydrateParseResult } from '../../core/transfer';
import type { SegmentIndexEntry } from '../../core/memory';
import { formatCopyCommand } from '../../core/byte-tools/copyFormatters';
import { buildSegmentIndex, getByteAt } from '../../core/memory';
import { diffCellWindow } from '../../core/diff';
import {
    diffRunFocus,
    searchMatchFocus,
    DIFF_ROW_BYTES,
    DIFF_ROW_HEIGHT,
    visualRowIndexForAddress,
    type DiffLightRow,
    type DiffVisualRow,
} from './diffViewModel';
import {
    calcCompressedWindowTop,
    calcRowOffset,
    calcScrollLayout,
    calcTotalHeight,
    calcVisibleRange,
    logicalToPhysicalScroll,
    physicalToLogicalScroll,
    type VirtualScrollState,
} from '../render/virtualScroll';
import { HexViewComponent, renderHexViewComponentHtml, type HexViewCallbacks, type HexViewCell, type HexViewRange, type HexViewRow } from '../ui-components/hex-view/hexViewComponent';

// ── Grid state ─────────────────────────────────────────────────────
let meta: DiffMeta | null = null;
let aResult: SerializedParseResult | null = null;
let bResult: SerializedParseResult | null = null;
let aIndex: SegmentIndexEntry[] = [];
let bIndex: SegmentIndexEntry[] = [];
let aLabel = '';
let bLabel = '';
let aError: string | null = null;
let bError: string | null = null;
let viewMode: 'all' | 'diff' = 'all';
let visualRows: DiffLightRow[] = [];
let diffScrollState: VirtualScrollState | null = null;
let containerHeight = 0;
let selection: { side: 'a' | 'b'; start: number; end: number } | null = null;
let searchMatches: number[] = [];
let searchFocusAddr = -1;
let diffFocusAddr = -1;
let firstJumpDone = false;

const ROW_HEIGHT = DIFF_ROW_HEIGHT;
const compA = new HexViewComponent('a');
const compB = new HexViewComponent('b');

// ── Data setters (called by the composition root on messages) ──────

export function initDiffData(aWire: WireParseResult, bWire: WireParseResult): void {
    aResult = hydrateParseResult(aWire);
    bResult = hydrateParseResult(bWire);
    aIndex = buildSegmentIndex(aResult);
    bIndex = buildSegmentIndex(bResult);
}

export function setDiffState(input: {
    meta: DiffMeta | null;
    aLabel: string;
    bLabel: string;
    aError: string | null;
    bError: string | null;
    visualRows: DiffLightRow[];
    resetScroll: boolean;
}): void {
    meta = input.meta;
    aLabel = input.aLabel;
    bLabel = input.bLabel;
    aError = input.aError;
    bError = input.bError;
    visualRows = input.visualRows;
    if (input.resetScroll) { diffScrollState = null; }
}

export function setSearch(matches: number[], focusAddr: number): void {
    searchMatches = matches;
    searchFocusAddr = focusAddr;
    firstJumpDone = focusAddr >= 0;
}

export function resetSearch(): void {
    searchMatches = [];
    searchFocusAddr = -1;
    firstJumpDone = false;
}

export function currentMatchIndex(): number {
    return searchFocusAddr >= 0 ? searchMatches.indexOf(searchFocusAddr) : 0;
}

export function matchCount(): number {
    return searchMatches.length;
}

export function setViewMode(mode: 'all' | 'diff'): void {
    viewMode = mode;
    diffScrollState = null;
}

export function getViewMode(): 'all' | 'diff' {
    return viewMode;
}

export function selectionSuffix(): string {
    const sel = selection as { side: 'a' | 'b'; start: number; end: number };
    return ` · ${sel.side.toUpperCase()} 0x${sel.start.toString(16)}-0x${sel.end.toString(16)}`;
}

export function hasSelection(): boolean {
    return selection !== null;
}

// ── Row mapping (DiffVisualRow -> HexViewRow) ────────────────────────

/** Status -> byte-cell class (diff collapse: all differences -> bd). */
const STATUS_CLASS: Record<string, string> = {
    unchanged: 'bn',
    empty: 'be',
    changed: 'bd',
    added: 'bd',
    removed: 'bd',
};

/** Map one diff window to the component's host-agnostic row for one side. */
function toHexViewRow(vr: DiffVisualRow, side: 'a' | 'b'): HexViewRow {
    const cells: HexViewCell[] = [];
    for (let j = 0; j < DIFF_ROW_BYTES; j++) {
        const cell = vr[side][j];
        cells.push({
            hex: cell && cell.present ? cell.byte.toString(16).toUpperCase().padStart(2, '0') : '··',
            char: '',
            cls: STATUS_CLASS[vr.statuses[j]] ?? vr.statuses[j],
        });
    }
    return { address: vr.baseAddress, kind: 'data', cells };
}

/** Rows currently shown: all, or only rows containing differences. */
function shownRows(): DiffLightRow[] {
    if (viewMode !== 'diff' || meta === null) { return visualRows; }
    return visualRows.filter(r => r.hasDiff);
}

function isEmptyDiffMode(rows: DiffLightRow[]): boolean {
    return viewMode === 'diff' && rows.length === 0;
}

function searchRowIndexFor(): number {
    return searchFocusAddr >= 0 ? visualRowIndexForAddress(shownRows(), searchFocusAddr) : -1;
}

/** Selection range to paint in one panel (only the owning side paints `.sel`). */
function selectionFor(side: 'a' | 'b'): HexViewRange | null {
    return selection && selection.side === side ? { start: selection.start, end: selection.end } : null;
}

// ── Render (buffered + compressed via virtualScroll) ───────────────

export function renderDiffBody(): void {
    const scrollEl = document.getElementById('diff-scroll');
    if (!scrollEl) { return; }
    containerHeight = Math.max(200, scrollEl.clientHeight);
    const rows = shownRows();
    if (isEmptyDiffMode(rows)) {
        scrollEl.innerHTML = '<div class="diff-no-diffs">No differences</div>';
        scrollEl.scrollTop = 0;
        diffScrollState = null;
        return;
    }
    // Logical scroll position is preserved across rerenders (physical->logical
    // old state, logical->physical new state); clamped to the scrollable range.
    diffScrollState = {
        containerHeight,
        scrollTop: Math.min(
            diffScrollState ? diffScrollState.scrollTop : 0,
            Math.max(0, rows.length * ROW_HEIGHT - containerHeight),
        ),
        bufferSize: 10,
        visibleRowIndices: [0, 0],
        rowCount: rows.length,
        heightVersion: 'diff',
        getRowHeight: () => ROW_HEIGHT,
    };
    const layout = calcScrollLayout(diffScrollState);
    const [startIdx, endIdx] = calcVisibleRange(diffScrollState);
    const matchSet = new Set(searchMatches);
    const searchRowIndex = searchRowIndexFor();
    // Materialize only the visible window's cells from the segment indexes.
    const windowRows: DiffVisualRow[] = [];
    for (let i = startIdx; i < endIdx; i++) {
        windowRows.push(diffCellWindow(aResult, aIndex, bResult, bIndex, rows[i].baseAddress));
    }
    // Compressed anchor: place the slice at its scaled phantom position, offset
    // so the component's absolute row indexing lines up (never physicalHeight/totalHeight).
    const windowTop = layout.isCompressed
        ? calcCompressedWindowTop(startIdx, diffScrollState, layout) - calcRowOffset(startIdx, diffScrollState)
        : 0;
    const base = {
        rowOffset: startIdx,
        searchRowIndex,
        matchSet,
        totalHeight: layout.physicalHeight,
        showChar: false,
        windowTop,
    };
    scrollEl.innerHTML = `<div class="diff-grid">
        ${renderHexViewComponentHtml('a', { ...base, label: aLabel, error: aError, rows: windowRows.map(vr => toHexViewRow(vr, 'a')), selection: selectionFor('a') })}
        <span class="diff-sep"></span>
        ${renderHexViewComponentHtml('b', { ...base, label: bLabel, error: bError, rows: windowRows.map(vr => toHexViewRow(vr, 'b')), selection: selectionFor('b') })}
    </div>`;
    scrollEl.scrollTop = logicalToPhysicalScroll(diffScrollState.scrollTop, diffScrollState);
    compA.reapply();
    compB.reapply();
    if (!scrollEl.dataset.vscrollInit) {
        scrollEl.dataset.vscrollInit = '1';
        scrollEl.addEventListener('scroll', () => {
            if (diffScrollState) { diffScrollState.scrollTop = physicalToLogicalScroll(scrollEl.scrollTop, diffScrollState); }
            renderDiffBody();
        });
    }
}

// ── Navigation ─────────────────────────────────────────────────────

/** Navigate so the visual row containing `addr` is centered in the viewport. */
function focusRow(addr: number): void {
    const idx = visualRowIndexForAddress(shownRows(), addr);
    if (idx < 0) { return; }
    if (diffScrollState) {
        diffScrollState.scrollTop = Math.max(0, idx * ROW_HEIGHT - diffScrollState.containerHeight / 2);
    }
    renderDiffBody();
}

/** Address to start navigating from when nothing is focused yet. */
function diffFocusBase(): number {
    return diffFocusAddr >= 0 ? diffFocusAddr : (meta?.runs[0]?.start ?? 0);
}

export function gotoDiff(direction: 1 | -1): void {
    if (!meta) { return; }
    const f = diffRunFocus(meta, diffFocusBase(), direction);
    if (f) { diffFocusAddr = f.address; focusRow(f.address); }
}

export function gotoMatch(direction: 1 | -1): void {
    if (!meta) { return; }
    const f = searchMatchFocus(meta, searchMatches, searchFocusAddr >= 0 ? searchFocusAddr : -1, direction);
    if (f) { searchFocusAddr = f.address; focusRow(f.address); }
}

export function applyFirstJump(): void {
    if (!firstJumpDone && searchMatches.length > 0) {
        firstJumpDone = true;
        searchFocusAddr = searchMatches[0];
        focusRow(searchFocusAddr);
    }
}

/** True when `addr` is a present focus and still exists in the current diff. */
function focusExists(addr: number): boolean {
    return addr >= 0 && visualRowIndexForAddress(shownRows(), addr) >= 0;
}

/** Drop stale focus addresses that no longer exist in the new result. */
export function dropInvalidFocus(): void {
    if (!focusExists(diffFocusAddr)) { diffFocusAddr = -1; }
    if (!focusExists(searchFocusAddr)) { searchFocusAddr = -1; }
}

// ── Interaction (cross-panel hover/selection mirror + copy) ────────

function sideBytes(result: SerializedParseResult | null, index: SegmentIndexEntry[], range: HexViewRange): number[] {
    const noEdits = new Map<number, number>();
    const bytes: number[] = [];
    for (let addr = range.start; addr <= range.end; addr++) {
        const b = getByteAt(result, index, noEdits, addr);
        if (b !== undefined) { bytes.push(b); }
    }
    return bytes;
}

function copySide(side: 'a' | 'b', range: HexViewRange): void {
    const result = side === 'a' ? aResult : bResult;
    const index = side === 'a' ? aIndex : bIndex;
    const bytes = sideBytes(result, index, range);
    if (bytes.length === 0) { return; }
    void navigator.clipboard.writeText(formatCopyCommand('hex', bytes));
}

function isBlankScrollClick(target: EventTarget | null): boolean {
    const t = target as HTMLElement;
    return t.closest?.('#diff-scroll') !== null && t.closest?.('.data-cell') === null;
}

function clearAllSelection(): void {
    selection = null;
    compA.setMirrorRange(null);
    compB.setMirrorRange(null);
    renderDiffBody();
}

export function wireDiffComponents(): void {
    // Cross-panel hover mirror: hovered byte lights up in the other component.
    const mirrorCallbacks = (from: HexViewComponent, to: HexViewComponent): HexViewCallbacks => ({
        onHover: addr => to.setMirrorAddr(addr),
        onLeave: () => to.setMirrorAddr(-1),
        onSelectionChange: (range: HexViewRange | null) => {
            selection = range ? { side: from === compA ? 'a' : 'b', start: range.start, end: range.end } : null;
            // Single-active selection: the other component clears its own,
            // and this side drops its own mirror (it now holds the selection).
            // The owning side's `.sel` paint comes from the render input.
            to.setMirrorRange(range);
            from.setMirrorRange(null);
            renderDiffBody();
        },
        onColumnHover: col => to.setColumn(col),
        onColumnLeave: () => to.setColumn(-1),
        onCopy: range => copySide(from === compA ? 'a' : 'b', range),
    });
    compA.setCallbacks(mirrorCallbacks(compA, compB));
    compB.setCallbacks(mirrorCallbacks(compB, compA));

    compA.mount();
    compB.mount();

    // Clicking empty scroll space clears the selection (toolbar/rail clicks leave it).
    document.addEventListener('mousedown', e => {
        if (isBlankScrollClick(e.target)) { clearAllSelection(); }
    });
}
