// ── HexScope Diff Webview Entry Point ─────────────────────────────
// Two-panel hex diff. Host sends diffInit/diffUpdate/diffProgress/diffSwap/
// diffSearch; view sends diffReady/diffSwapRequest/diffSearchRequest.
// Large-file model: segments transfer once as binary WireParseResult +
// a light DiffMeta; per-window cells are computed on scroll.

import type { DiffMeta } from '../core/diff';
import type { SerializedParseResult, WireParseResult } from '../core/types';
import type { SegmentIndexEntry } from '../core/memory';
import { formatCopyCommand } from '../core/byte-tools/copyFormatters';
import type { ProviderToWebviewMessage, WebviewToProviderMessage } from '../webviewProtocol';
import { messageType } from '../webviewProtocol';
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
import { HexViewComponent, renderHexViewComponentHtml, type HexViewCallbacks, type HexViewRange } from './ui-components/hex-view/hexViewComponent';
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

let scrollTop = 0;
let containerHeight = 0;
let visualRows: DiffLightRow[] = [];
const ROW_HEIGHT = DIFF_ROW_HEIGHT;
const RENDER_BUFFER = 20;

const vscodeApi = vscode;

// ── DOM refs ──────────────────────────────────────────────────────
const app = document.getElementById('app')!;
const status = document.getElementById('status')!;

function post(msg: WebviewToProviderMessage): void {
    void vscodeApi.postMessage(msg);
}

/** Rehydrate the binary wire segments into byte-addressable segments. */
function hydrateParseResult(result: WireParseResult): SerializedParseResult {
    return {
        ...result,
        records: [],
        segments: result.segments.map(segment => ({
            startAddress: segment.startAddress,
            data: new Uint8Array(segment.data),
        })),
    };
}

function applySides(aWire: WireParseResult, bWire: WireParseResult): void {
    aResult = hydrateParseResult(aWire);
    bResult = hydrateParseResult(bWire);
    aIndex = buildSegmentIndex(aResult);
    bIndex = buildSegmentIndex(bResult);
}

// Fixed-height windowing: visible rows + buffer. Returns [start, end).
function visibleWindow(rowCount: number): [number, number] {
    if (rowCount === 0) { return [0, 0]; }
    const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - RENDER_BUFFER);
    const last = Math.min(rowCount, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + RENDER_BUFFER);
    return [first, last];
}

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

function renderScroll(): void {
    const scrollEl = document.getElementById('diff-scroll')!;
    containerHeight = Math.max(200, scrollEl.clientHeight);
    const rows = shownRows();
    if (viewMode === 'diff' && rows.length === 0) {
        scrollEl.innerHTML = '<div class="diff-no-diffs">No differences</div>';
        scrollEl.scrollTop = 0;
        return;
    }
    const totalHeight = rows.length * ROW_HEIGHT;
    const range = visibleWindow(rows.length);
    const matchSet = new Set(searchMatches);
    const searchRowIndex = searchRowIndexFor();
    // Materialize only the visible window's cells from the segment indexes.
    const windowRows: DiffVisualRow[] = [];
    for (let i = range[0]; i < range[1]; i++) {
        windowRows.push(diffCellWindow(aResult, aIndex, bResult, bIndex, rows[i].baseAddress));
    }
    const input = {
        rows: windowRows,
        rowOffset: range[0],
        searchRowIndex,
        matchSet,
        totalHeight,
    };
    scrollEl.innerHTML = `<div class="diff-grid">
        ${renderHexViewComponentHtml('a', { ...input, label: aLabel, error: aError })}
        <span class="diff-sep"></span>
        ${renderHexViewComponentHtml('b', { ...input, label: bLabel, error: bError })}
    </div>`;
    scrollEl.scrollTop = scrollTop;
    compA.reapply();
    compB.reapply();
    if (!scrollEl.dataset.vscrollInit) {
        scrollEl.dataset.vscrollInit = '1';
        scrollEl.addEventListener('scroll', () => {
            scrollTop = scrollEl.scrollTop;
            rerender();
        });
    }
}

function rerender(): void {
    if (!loaded) {
        if (error) { renderErrorCard(); }
        return;
    }

    app.innerHTML = `
        <div class="diff-toolbar">
            <div class="view-tabs">
                <button id="view-all" class="${viewMode === 'all' ? 'active' : ''}">All</button>
                <button id="view-diff" class="${viewMode === 'diff' ? 'active' : ''}">Diff</button>
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
    scrollTop = Math.max(0, idx * ROW_HEIGHT - containerHeight / 2);
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
    document.getElementById('view-all')!.addEventListener('click', () => { viewMode = 'all'; scrollTop = 0; rerender(); });
    document.getElementById('view-diff')!.addEventListener('click', () => { viewMode = 'diff'; scrollTop = 0; rerender(); });
    document.getElementById('prev-diff')!.addEventListener('click', () => gotoDiff(-1));
    document.getElementById('next-diff')!.addEventListener('click', () => gotoDiff(1));
    document.getElementById('swap')!.addEventListener('click', () => {
        swapped = !swapped;
        post({ type: 'diffSwapRequest' });
        document.body.classList.toggle('swapped', swapped);
    });
}

function updateStatus(): void {
    status.classList.remove('reloading');
    searchBar.setCount(searchMatches.length, searchFocusAddr >= 0 ? searchMatches.indexOf(searchFocusAddr) : 0);
    if (error) {
        status.textContent = `Error: ${error}`;
    } else if (!meta) {
        status.textContent = 'Loading…';
    } else {
        let text = `A=${aLabel} ⇄ B=${bLabel} · ${visualRows.length} rows`;
        if (selection) {
            text += ` · ${selection.side.toUpperCase()} 0x${selection.start.toString(16)}-0x${selection.end.toString(16)}`;
        }
        status.textContent = text;
    }
}

// ── Message handling ──────────────────────────────────────────────
type DiffHandler = (m: Extract<ProviderToWebviewMessage, { type: string }>) => void;

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

const diffHandlers: Record<string, DiffHandler> = {
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
        if (!firstJumpDone && msg.matches.length > 0) {
            firstJumpDone = true;
            searchFocusAddr = msg.matches[0];
            focusRow(searchFocusAddr);
        }
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

window.addEventListener('message', (event: MessageEvent<ProviderToWebviewMessage>) => {
    const handler = diffHandlers[messageType(event.data) ?? ''];
    if (handler) { handler(event.data as Extract<ProviderToWebviewMessage, { type: string }>); }
});

// ── Component wiring (two hexview components + cross-panel highlights) ─
function copySide(side: 'a' | 'b', range: HexViewRange): void {
    const result = side === 'a' ? aResult : bResult;
    const index = side === 'a' ? aIndex : bIndex;
    const noEdits = new Map<number, number>();
    const bytes: number[] = [];
    for (let addr = range.start; addr <= range.end; addr++) {
        const b = getByteAt(result, index, noEdits, addr);
        if (b !== undefined) { bytes.push(b); }
    }
    if (bytes.length === 0) { return; }
    void navigator.clipboard.writeText(formatCopyCommand('hex', bytes));
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
            to.setSelection(null);
            to.setMirrorRange(range);
            from.setMirrorRange(null);
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
        if ((e.target as HTMLElement).closest?.('#diff-scroll') && !(e.target as HTMLElement).closest?.('.data-cell')) {
            compA.setSelection(null);
            compB.setSelection(null);
            selection = null;
            compA.setMirrorRange(null);
            compB.setMirrorRange(null);
        }
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
