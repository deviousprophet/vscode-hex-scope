// ── HexScope Diff Webview Entry Point ─────────────────────────────
// Two-panel hex diff. Host sends diffInit/diffUpdate/diffProgress/diffSwap/
// diffSearch; view sends diffReady/diffSwapRequest/diffSearchRequest.
// Large-file model: segments transfer once as binary WireParseResult +
// a light DiffMeta; per-window cells are computed on scroll.

import type { DiffMeta } from '../core/diff';
import type { SerializedParseResult, WireParseResult } from '../core/types';
import { hydrateParseResult } from '../core/transfer';
import type { SegmentIndexEntry } from '../core/memory';
import { formatCopyCommand } from '../core/byte-tools/copyFormatters';
import type { ProviderToWebviewMessage, WebviewToProviderMessage } from '../webviewProtocol';
import { dispatchProviderMessage, type ProviderMessageHandlers } from './webviewMessageDispatcher';
import { vscode } from './vscodeApi';
import { esc } from './utils';
import { buildSegmentIndex, getByteAt } from '../core/memory';
import { diffCellWindow } from '../core/diff';
import {
    diffRunFocus,
    searchMatchFocus,
    DIFF_ROW_BYTES,
    DIFF_ROW_HEIGHT,
    groupVisualRows,
    visualRowIndexForAddress,
    type DiffLightRow,
    type DiffVisualRow,
} from './diff/diffViewModel';
import { renderDiffSummaryHtml, type DiffSummaryState } from './diff/diffRenderer';
import {
    calcCompressedWindowTop,
    calcRowOffset,
    calcScrollLayout,
    calcTotalHeight,
    calcVisibleRange,
    logicalToPhysicalScroll,
    physicalToLogicalScroll,
    type VirtualScrollState,
} from './render/virtualScroll';
import { HexViewComponent, renderHexViewComponentHtml, type HexViewCallbacks, type HexViewCell, type HexViewRange, type HexViewRow } from './ui-components/hex-view/hexViewComponent';
import { SearchBarComponent } from './ui-components/search-bar/searchBarComponent';

// ── State ─────────────────────────────────────────────────────────
let generation = 0;
let loaded = false;
let meta: DiffMeta | null = null;
let aResult: SerializedParseResult | null = null;
let bResult: SerializedParseResult | null = null;
let aIndex: SegmentIndexEntry[] = [];
let bIndex: SegmentIndexEntry[] = [];
let aLabel = '';
let bLabel = '';
let swapped = false;
let error: string | null = null;
let aError: string | null = null;
let bError: string | null = null;
let searchMatches: number[] = [];
let searchFocusAddr = -1;
let diffFocusAddr = -1;
let viewMode: 'all' | 'diff' = 'all';
let firstJumpDone = false;
let lastRequestedQuery = '';
// Selection mirror, kept for copy + status; the components own the real state.
let selection: { side: 'a' | 'b'; start: number; end: number } | null = null;

const compA = new HexViewComponent('a');
const compB = new HexViewComponent('b');

const searchBar = new SearchBarComponent({
    onSearch: (query, mode, endianness) => {
        lastRequestedQuery = query;
        firstJumpDone = false;
        searchBar.setBusy(true);
        post({ type: 'diffSearchRequest', generation, query, mode, endianness });
    },
    onPrev: () => gotoMatch(-1),
    onNext: () => gotoMatch(1),
    onClear: () => {
        searchMatches = [];
        searchFocusAddr = -1;
        firstJumpDone = false;
        // Supersede any in-flight search so stale partials cannot repopulate,
        // and drop the spinner: the clear request's own done reply is filtered
        // by the query check below, so busy must be cleared here.
        lastRequestedQuery = '';
        searchBar.setBusy(false);
        post({ type: 'diffSearchRequest', generation, query: '', mode: 'bytes', endianness: 'le' });
        rerender();
    },
});

let diffScrollState: VirtualScrollState | null = null;
let containerHeight = 0;
let visualRows: DiffLightRow[] = [];
const ROW_HEIGHT = DIFF_ROW_HEIGHT;

const vscodeApi = vscode;

// ── DOM refs ──────────────────────────────────────────────────────
const app = document.getElementById('app')!;
const status = document.getElementById('status')!;

function post(msg: WebviewToProviderMessage): void {
    void vscodeApi.postMessage(msg);
}

/** Rehydrate the binary wire segments into byte-addressable segments. */
function applySides(aWire: WireParseResult, bWire: WireParseResult): void {
    aResult = hydrateParseResult(aWire);
    bResult = hydrateParseResult(bWire);
    aIndex = buildSegmentIndex(aResult);
    bIndex = buildSegmentIndex(bResult);
}

// ── Buffered + compressed virtualization (mirrors memoryView + virtualScroll) ──

/** Rows currently shown: all, or only rows containing differences. */
function shownRows(): DiffLightRow[] {
    if (viewMode !== 'diff' || meta === null) { return visualRows; }
    return visualRows.filter(r => r.hasDiff);
}

function searchRowIndexFor(): number {
    return searchFocusAddr >= 0 ? visualRowIndexForAddress(shownRows(), searchFocusAddr) : -1;
}

function summaryState(): DiffSummaryState {
    return { meta, aError, bError };
}

function errorBannersHtml(): string {
    const parts: string[] = [];
    if (aError) { parts.push(`<div class="side-error">A: ${esc(aError)}</div>`); }
    if (bError) { parts.push(`<div class="side-error">B: ${esc(bError)}</div>`); }
    return parts.length ? `<div class="diff-errors">${parts.join('')}</div>` : '';
}

// ── Component row mapping (DiffVisualRow -> HexViewRow) ────────────────

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

function isEmptyDiffMode(rows: DiffLightRow[]): boolean {
    return viewMode === 'diff' && rows.length === 0;
}

function renderScroll(): void {
    const scrollEl = document.getElementById('diff-scroll')!;
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
            rerender();
        });
    }
}

function tabClass(mode: 'all' | 'diff'): string {
    return viewMode === mode ? 'active' : '';
}

function rerender(): void {
    if (!loaded) {
        if (error) { renderErrorCard(); }
        return;
    }

    app.innerHTML = `
        <div class="diff-toolbar">
            <div class="view-tabs">
                <button id="view-all" class="${tabClass('all')}">All</button>
                <button id="view-diff" class="${tabClass('diff')}">Diff</button>
            </div>
            <div class="tb-sep"></div>
            <button id="prev-diff" class="nav-btn" title="Previous difference">&#9650;</button>
            <button id="next-diff" class="nav-btn" title="Next difference">&#9660;</button>
            <button id="swap" class="nav-btn" title="Swap A/B">&#8646;</button>
            ${searchBar.toHtml()}
        </div>
        <div class="diff-summary">${renderDiffSummaryHtml(summaryState())}</div>
        ${errorBannersHtml()}
        <div id="diff-scroll"></div>
    `;

    renderScroll();
    wireToolbar();
    updateStatus();
}

/** Loading card replaced by an error card before any data arrives. */
function renderErrorCard(): void {
    app.innerHTML = `<div class="loading-shell" aria-live="polite">
        <div class="loading-card">
            <div class="loading-eyebrow">HexScope</div>
            <div class="loading-title">Could not open files</div>
            <div class="loading-text">${esc(error ?? 'Failed to open the selected files.')}</div>
        </div>
    </div>`;
    status.textContent = error ? `Error: ${error}` : '';
}

/** Live staged progress while the loading card is visible. */
function updateLoadingProgress(msg: Extract<ProviderToWebviewMessage, { type: 'diffProgress' }>): void {
    const pct = msg.total > 0 ? Math.min(100, Math.round((msg.completed / msg.total) * 100)) : 0;
    const text = document.getElementById('load-text');
    if (text) { text.textContent = `Loading files… ${pct}% (${msg.stage})`; }
    const fill = document.getElementById('load-fill') as HTMLElement | null;
    if (fill) { fill.style.width = `${Math.max(4, pct)}%`; }
}

/** Navigate so the visual row containing `addr` is centered in the viewport. */
function focusRow(addr: number): void {
    const idx = visualRowIndexForAddress(shownRows(), addr);
    if (idx < 0) { return; }
    if (diffScrollState) {
        diffScrollState.scrollTop = Math.max(0, idx * ROW_HEIGHT - diffScrollState.containerHeight / 2);
    }
    rerender();
}

/** Address to start navigating from when nothing is focused yet. */
function diffFocusBase(): number {
    return diffFocusAddr >= 0 ? diffFocusAddr : (meta?.runs[0]?.start ?? 0);
}

function gotoDiff(direction: 1 | -1): void {
    if (!meta) { return; }
    const f = diffRunFocus(meta, diffFocusBase(), direction);
    if (f) { diffFocusAddr = f.address; focusRow(f.address); }
}

function gotoMatch(direction: 1 | -1): void {
    if (!meta) { return; }
    const f = searchMatchFocus(meta, searchMatches, searchFocusAddr >= 0 ? searchFocusAddr : -1, direction);
    if (f) { searchFocusAddr = f.address; focusRow(f.address); }
}

function wireToolbar(): void {
    document.getElementById('view-all')!.addEventListener('click', () => { viewMode = 'all'; diffScrollState = null; rerender(); });
    document.getElementById('view-diff')!.addEventListener('click', () => { viewMode = 'diff'; diffScrollState = null; rerender(); });
    document.getElementById('prev-diff')!.addEventListener('click', () => gotoDiff(-1));
    document.getElementById('next-diff')!.addEventListener('click', () => gotoDiff(1));
    document.getElementById('swap')!.addEventListener('click', () => {
        swapped = !swapped;
        post({ type: 'diffSwapRequest' });
        document.body.classList.toggle('swapped', swapped);
    });
}

function currentMatchIndex(): number {
    return searchFocusAddr >= 0 ? searchMatches.indexOf(searchFocusAddr) : 0;
}

function selectionSuffix(): string {
    const sel = selection as { side: 'a' | 'b'; start: number; end: number };
    return ` · ${sel.side.toUpperCase()} 0x${sel.start.toString(16)}-0x${sel.end.toString(16)}`;
}

function statusText(): string {
    if (error) { return `Error: ${error}`; }
    if (!meta) { return 'Loading…'; }
    let text = `A=${aLabel} ⇄ B=${bLabel} · ${visualRows.length} rows`;
    if (selection) { text += selectionSuffix(); }
    return text;
}

function updateStatus(): void {
    status.classList.remove('reloading');
    searchBar.setCount(searchMatches.length, currentMatchIndex());
    status.textContent = statusText();
}

// ── Message handling ──────────────────────────────────────────────

/** True when `addr` is a present focus and still exists in the current diff. */
function focusExists(addr: number): boolean {
    return addr >= 0 && visualRowIndexForAddress(shownRows(), addr) >= 0;
}

/** Drop stale focus addresses that no longer exist in the new result. */
function dropInvalidFocus(): void {
    if (!focusExists(diffFocusAddr)) { diffFocusAddr = -1; }
    if (!focusExists(searchFocusAddr)) { searchFocusAddr = -1; }
}

function applyDiff(): void {
    if (error) { error = null; }
    dropInvalidFocus();
    rerender();
}

const diffHandlers: Partial<ProviderMessageHandlers> = {
    diffInit: m => {
        const msg = m as Extract<ProviderToWebviewMessage, { type: 'diffInit' }>;
        generation = msg.generation;
        applySides(msg.a, msg.b);
        meta = msg.meta;
        visualRows = groupVisualRows(msg.meta);
        aLabel = msg.aLabel;
        bLabel = msg.bLabel;
        aError = msg.aError;
        bError = msg.bError;
        searchMatches = [];
        searchFocusAddr = -1;
        diffFocusAddr = -1;
        firstJumpDone = false;
        error = null;
        loaded = true;
        rerender();
    },
    diffUpdate: m => {
        if (!loaded) { return; }
        const msg = m as Extract<ProviderToWebviewMessage, { type: 'diffUpdate' }>;
        generation = msg.generation;
        applySides(msg.a, msg.b);
        meta = msg.meta;
        visualRows = groupVisualRows(msg.meta);
        aError = msg.aError;
        bError = msg.bError;
        applyDiff();
    },
    diffProgress: m => {
        const msg = m as Extract<ProviderToWebviewMessage, { type: 'diffProgress' }>;
        if (!loaded) {
            updateLoadingProgress(msg);
        } else {
            status.classList.add('reloading');
            status.textContent = `Reloading… (${msg.stage})`;
        }
    },
    diffSwap: m => {
        const msg = m as Extract<ProviderToWebviewMessage, { type: 'diffSwap' }>;
        swapped = msg.swapped;
        document.body.classList.toggle('swapped', swapped);
    },
    diffSearch: m => {
        const msg = m as Extract<ProviderToWebviewMessage, { type: 'diffSearch' }>;
        if (msg.query !== lastRequestedQuery) { return; }
        searchMatches = msg.matches;
        applyFirstJump();
        if (msg.done) { searchBar.setBusy(false); }
        rerender();
    },
    loadError: m => {
        const msg = m as Extract<ProviderToWebviewMessage, { type: 'loadError' }>;
        error = msg.message;
        if (!loaded) {
            renderErrorCard();
        } else {
            rerender();
        }
    },
};

function applyFirstJump(): void {
    if (!firstJumpDone && searchMatches.length > 0) {
        firstJumpDone = true;
        searchFocusAddr = searchMatches[0];
        focusRow(searchFocusAddr);
    }
}

window.addEventListener('message', (event: MessageEvent<ProviderToWebviewMessage>) => {
    dispatchProviderMessage(event.data, diffHandlers);
});

// ── Component wiring (two hexview components + cross-panel highlights) ─
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

/** Selection range to paint in one panel (only the owning side paints `.sel`). */
function selectionFor(side: 'a' | 'b'): HexViewRange | null {
    return selection && selection.side === side ? { start: selection.start, end: selection.end } : null;
}

function clearAllSelection(): void {
    selection = null;
    compA.setMirrorRange(null);
    compB.setMirrorRange(null);
    rerender();
}

function wireComponents(): void {
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
            rerender();
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

// ── Bootstrap ─────────────────────────────────────────────────────
window.addEventListener('resize', () => rerender());

wireComponents();

// Alt+↓ / Alt+↑ jump to next/prev diff run.
document.addEventListener('keydown', e => {
    if (!e.altKey) { return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); gotoDiff(1); }
    if (e.key === 'ArrowUp') { e.preventDefault(); gotoDiff(-1); }
});

post({ type: 'diffReady' });
rerender();
searchBar.mount();
