// ── HexScope Diff Webview Entry Point ─────────────────────────────
// Two-panel hex diff. Host sends diffInit/diffUpdate/diffSwap/diffSearch;
// view sends diffReady/diffSwapRequest/diffSearchRequest.

import type { DiffResult } from '../core/diff';
import type { SearchEndianness, SearchMode, SegmentLabel } from '../core/types';
import type { CopyCommand } from '../core/byte-tools/copyCommand';
import { formatCopyCommand } from '../core/byte-tools/copyFormatters';
import type { ProviderToWebviewMessage, WebviewToProviderMessage } from '../webviewProtocol';
import { messageType } from '../webviewProtocol';
import { vscode } from './vscodeApi';
import { esc } from './utils';
import {
    formatAddress,
    diffRunFocus,
    searchMatchFocus,
    DIFF_ROW_BYTES,
    DIFF_ROW_HEIGHT,
    groupVisualRows,
    visualRowIndexForAddress,
    type DiffVisualRow,
} from './diff/diffViewModel';
import { renderDiffSummaryHtml, renderDiffComponentHtml, type DiffRenderState, type DiffSelection } from './diff/diffRenderer';

// ── State ─────────────────────────────────────────────────────────
let generation = 0;
let result: DiffResult | null = null;
let aLabel = '';
let bLabel = '';
let swapped = false;
let error: string | null = null;
let aError: string | null = null;
let bError: string | null = null;
let searchQuery = '';
let searchMode: SearchMode = 'bytes';
let searchEndianness: SearchEndianness = 'le';
let searchMatches: number[] = [];
let searchFocusAddr = -1;
let diffFocusAddr = -1;
let viewMode: 'all' | 'diff' = 'all';
let aLabels: SegmentLabel[] = [];
let bLabels: SegmentLabel[] = [];
let selection: DiffSelection | null = null;
let dragging = false;
let hoverAddr = -1;
let hoverSide: 'a' | 'b' | null = null;
let hoverCol = -1;

let scrollTop = 0;
let containerHeight = 0;
let visualRows: DiffVisualRow[] = [];
const ROW_HEIGHT = DIFF_ROW_HEIGHT;
const RENDER_BUFFER = 20;

const vscodeApi = vscode;

// ── DOM refs ──────────────────────────────────────────────────────
const app = document.getElementById('app')!;
const status = document.getElementById('status')!;

function post(msg: WebviewToProviderMessage): void {
    void vscodeApi.postMessage(msg);
}

// Fixed-height windowing: visible rows + buffer. Returns [start, end).
function visibleWindow(rowCount: number): [number, number] {
    if (rowCount === 0) { return [0, 0]; }
    const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - RENDER_BUFFER);
    const last = Math.min(rowCount, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + RENDER_BUFFER);
    return [first, last];
}

/** Rows currently shown: all, or only rows containing differences. */
function shownRows(): DiffVisualRow[] {
    if (viewMode !== 'diff' || result === null) { return visualRows; }
    return visualRows.filter(vr => vr.statuses.some(s => s !== 'unchanged' && s !== 'empty'));
}

function searchRowIndexFor(): number {
    return searchFocusAddr >= 0 ? visualRowIndexForAddress(shownRows(), searchFocusAddr) : -1;
}

function renderState(): DiffRenderState {
    return {
        result,
        visualRows: shownRows(),
        searchRowIndex: searchRowIndexFor(),
        matchSet: new Set(searchMatches),
        aError,
        bError,
        selection,
    };
}

function errorBannersHtml(): string {
    const parts: string[] = [];
    if (aError) { parts.push(`<div class="side-error">A: ${esc(aError)}</div>`); }
    if (bError) { parts.push(`<div class="side-error">B: ${esc(bError)}</div>`); }
    return parts.length ? `<div class="diff-errors">${parts.join('')}</div>` : '';
}

function railItemHtml(side: 'A' | 'B', label: SegmentLabel): string {
    const range = `0x${label.startAddress.toString(16).toUpperCase()} · ${label.length} B`;
    return `<div class="rail-item" style="border-left-color:${esc(label.color)}">
        <span class="rail-tag ${side === 'A' ? 'a' : 'b'}">${side}</span>
        <span class="rail-name">${esc(label.name)}</span>
        <span class="rail-range">${esc(range)}</span>
    </div>`;
}

function labelRailHtml(): string {
    const items = [
        ...aLabels.map(l => railItemHtml('A', l)),
        ...bLabels.map(l => railItemHtml('B', l)),
    ];
    if (items.length === 0) { return ''; }
    return `<div class="diff-rail">${items.join('')}</div>`;
}

function searchPlaceholder(): string {
    const placeholders: Record<SearchMode, string> = {
        bytes: 'Bytes (e.g. DE AD BE EF)',
        value: 'Value (e.g. 0x12345678 or 305419896)',
        ascii: 'ASCII text',
        addr: 'Addr (e.g. 1A0)',
    };
    return placeholders[searchMode];
}

function endianButtonsHtml(): string {
    const btn = (end: SearchEndianness, label: string) =>
        `<button id="search-btn-${end}" class="${searchEndianness === end ? 'active' : ''}" type="button">${label}</button>`;
    return `<div id="search-endian-toggle" class="compact-tabs search-endian-toggle" style="display:${searchMode === 'value' ? 'inline-flex' : 'none'}">
        ${btn('auto', 'Auto')}${btn('le', 'LE')}${btn('be', 'BE')}
    </div>`;
}

function searchBoxHtml(): string {
    const modeOpts = (['bytes', 'value', 'ascii', 'addr'] as const).map(m =>
        `<option value="${m}"${searchMode === m ? ' selected' : ''}>${m}</option>`
    ).join('');
    return `<div id="search-box">
        ${endianButtonsHtml()}
        <select id="search-mode">${modeOpts}</select>
        <div class="search-addr-wrap">
            <span id="search-addr-prefix" class="search-addr-prefix" style="display:none">0x</span>
            <input id="search-input" type="text" placeholder="${esc(searchPlaceholder())}" autocomplete="off" spellcheck="false"
                maxlength="${searchMode === 'addr' ? 8 : 100}" class="${searchMode === 'addr' ? 'search-addr-mode' : ''}" value="${esc(searchQuery)}">
        </div>
        <button class="nav-btn" id="btn-search" title="Run search" aria-label="Run search">&#128269;</button>
        <button class="nav-btn" id="btn-prev" title="Previous match">&#9650;</button>
        <button class="nav-btn" id="btn-next" title="Next match">&#9660;</button>
        <button class="nav-btn" id="btn-clear-search" title="Clear">&#10005;</button>
        <span id="match-count"></span>
    </div>`;
}

function renderScroll(): void {
    const scrollEl = document.getElementById('diff-scroll')!;
    containerHeight = Math.max(200, scrollEl.clientHeight);
    const rows = shownRows();
    if (viewMode === 'diff' && result !== null && rows.length === 0) {
        scrollEl.innerHTML = '<div class="diff-no-diffs">No differences at the shown addresses</div>';
        scrollEl.scrollTop = 0;
        scrollEl.addEventListener('scroll', () => rerender());
        return;
    }
    const state = renderState();
    const totalHeight = rows.length * ROW_HEIGHT;
    const range = visibleWindow(rows.length);
    scrollEl.innerHTML = `<div class="diff-grid">
        ${renderDiffComponentHtml(state, 'a', aLabel, range, totalHeight)}
        <span class="diff-sep"></span>
        ${renderDiffComponentHtml(state, 'b', bLabel, range, totalHeight)}
    </div>`;
    scrollEl.scrollTop = scrollTop;
    reapplyTransientHighlights();
    scrollEl.addEventListener('scroll', () => {
        scrollTop = scrollEl.scrollTop;
        rerender();
    });
}

function rerender(): void {
    visualRows = groupVisualRows(result?.rows ?? []);

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
            ${searchBoxHtml()}
        </div>
        <div class="diff-summary">${renderDiffSummaryHtml(renderState())}</div>
        ${labelRailHtml()}
        ${errorBannersHtml()}
        <div id="diff-scroll"></div>
    `;

    renderScroll();
    wireToolbar();
    updateStatus();
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
    return diffFocusAddr >= 0 ? diffFocusAddr : (result?.runs[0]?.start ?? 0);
}

function gotoDiff(direction: 1 | -1): void {
    if (!result) { return; }
    const f = diffRunFocus(result, diffFocusBase(), direction);
    if (f) { diffFocusAddr = f.address; focusRow(f.address); }
}

function gotoMatch(direction: 1 | -1): void {
    if (!result) { return; }
    const f = searchMatchFocus(result, searchMatches, searchFocusAddr >= 0 ? searchFocusAddr : -1, direction);
    if (f) { searchFocusAddr = f.address; focusRow(f.address); }
}

function applySearchModeUi(inputEl: HTMLInputElement): void {
    const endianToggle = document.getElementById('search-endian-toggle') as HTMLElement | null;
    if (endianToggle) { endianToggle.style.display = searchMode === 'value' ? 'inline-flex' : 'none'; }
    inputEl.placeholder = searchPlaceholder();
    inputEl.maxLength = searchMode === 'addr' ? 8 : 100;
    if (searchMode !== 'addr') { inputEl.classList.remove('search-addr-mode'); }
    updateAddrOverlay(inputEl);
}

function updateAddrOverlay(inputEl: HTMLInputElement): void {
    const prefix = document.getElementById('search-addr-prefix') as HTMLElement | null;
    const show = searchMode === 'addr' && inputEl.value.length > 0;
    if (prefix) { prefix.style.display = show ? '' : 'none'; }
    inputEl.classList.toggle('search-addr-mode', show);
}

function applyEndianUi(): void {
    const toggle = (id: string, on: boolean): void => {
        document.getElementById(id)?.classList.toggle('active', on);
    };
    toggle('search-btn-auto', searchEndianness === 'auto');
    toggle('search-btn-le', searchEndianness === 'le');
    toggle('search-btn-be', searchEndianness === 'be');
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

    const searchInput = document.getElementById('search-input') as HTMLInputElement;
    const doSearch = (query: string): void => {
        searchQuery = query;
        post({ type: 'diffSearchRequest', generation, query, mode: searchMode, endianness: searchEndianness });
    };

    searchInput.addEventListener('input', () => {
        if (searchMode !== 'addr') { return; }
        searchInput.value = searchInput.value.replace(/[^0-9a-fA-F]/g, '');
        updateAddrOverlay(searchInput);
    });
    searchInput.addEventListener('keydown', e => {
        if (e.key !== 'Enter') { return; }
        e.preventDefault();
        doSearch(searchInput.value);
        if (e.shiftKey) { gotoMatch(-1); }
    });

    document.getElementById('search-mode')!.addEventListener('change', (e: Event) => {
        searchMode = (e.target as HTMLSelectElement).value as SearchMode;
        applySearchModeUi(searchInput);
        doSearch(searchInput.value);
    });
    const endianButtons: Array<[SearchEndianness, string]> = [['auto', 'search-btn-auto'], ['le', 'search-btn-le'], ['be', 'search-btn-be']];
    for (const [end, id] of endianButtons) {
        document.getElementById(id)!.addEventListener('click', () => {
            searchEndianness = end;
            applyEndianUi();
            doSearch(searchInput.value);
        });
    }
    document.getElementById('btn-search')!.addEventListener('click', () => doSearch(searchInput.value));
    document.getElementById('btn-prev')!.addEventListener('click', () => gotoMatch(-1));
    document.getElementById('btn-next')!.addEventListener('click', () => gotoMatch(1));
    document.getElementById('btn-clear-search')!.addEventListener('click', () => {
        searchInput.value = '';
        searchQuery = '';
        searchMatches = [];
        searchFocusAddr = -1;
        updateAddrOverlay(searchInput);
        rerender();
    });

    applySearchModeUi(searchInput);
    applyEndianUi();
}

function copySelection(format?: CopyCommand): void {
    const bytes = selectionBytes();
    if (bytes.length === 0) { return; }
    void navigator.clipboard.writeText(formatCopyCommand(format ?? 'hex', bytes));
}

function updateMatchCount(): void {
    const el = document.getElementById('match-count');
    if (!el) { return; }
    if (searchQuery.length > 0 && searchMatches.length === 0) { el.textContent = '0 / 0'; return; }
    if (searchMatches.length === 0) { el.textContent = ''; return; }
    const idx = searchFocusAddr >= 0 ? searchMatches.indexOf(searchFocusAddr) : 0;
    el.textContent = `${idx + 1} / ${searchMatches.length}`;
}

function updateStatus(): void {
    updateMatchCount();
    if (error) {
        status.textContent = `Error: ${error}`;
    } else if (!result) {
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

function applyDiff(result: DiffResult): void {
    if (error) { error = null; }
    dropInvalidFocus();
    rerender();
}

const diffHandlers: Record<string, DiffHandler> = {
    diffInit: m => {
        const msg = m as Extract<ProviderToWebviewMessage, { type: 'diffInit' }>;
        generation = msg.generation;
        result = msg.result;
        aLabel = msg.aLabel;
        bLabel = msg.bLabel;
        aError = msg.aError;
        bError = msg.bError;
        aLabels = msg.aLabels;
        bLabels = msg.bLabels;
        searchMatches = [];
        searchFocusAddr = -1;
        diffFocusAddr = -1;
        error = null;
        rerender();
    },
    diffUpdate: m => {
        const msg = m as Extract<ProviderToWebviewMessage, { type: 'diffUpdate' }>;
        result = msg.result;
        aError = msg.aError;
        bError = msg.bError;
        applyDiff(msg.result);
    },
    diffSwap: m => {
        const msg = m as Extract<ProviderToWebviewMessage, { type: 'diffSwap' }>;
        swapped = msg.swapped;
        document.body.classList.toggle('swapped', swapped);
    },
    diffSearch: m => {
        const msg = m as Extract<ProviderToWebviewMessage, { type: 'diffSearch' }>;
        searchMatches = msg.matches;
        searchFocusAddr = searchMatches[0] ?? -1;
        rerender();
    },
    loadError: m => {
        const msg = m as Extract<ProviderToWebviewMessage, { type: 'loadError' }>;
        error = msg.message;
        rerender();
    },
};

window.addEventListener('message', (event: MessageEvent<ProviderToWebviewMessage>) => {
    const handler = diffHandlers[messageType(event.data) ?? ''];
    if (handler) { handler(event.data as Extract<ProviderToWebviewMessage, { type: string }>); }
});

// ── Selection + hover (per-panel, DOM-class updates, no re-render) ─
function cellFromEvent(target: EventTarget | null): { side: 'a' | 'b'; addr: number } | null {
    const el = (target as HTMLElement).closest?.('[data-addr][data-side]') as HTMLElement | null;
    if (!el) { return null; }
    const side = el.dataset.side as 'a' | 'b';
    const addr = parseInt(el.dataset.addr ?? '', 16);
    if (!Number.isFinite(addr)) { return null; }
    return { side, addr };
}

const addrSel = (addr: number, side?: 'a' | 'b'): string =>
    `.data-cell[data-addr="${esc(formatAddress(addr))}"]${side ? `[data-side="${side}"]` : ''}`;

/** Apply `.sel` to the selected side's range and `.sel-mirror` to the other side. */
function applySelectionDom(): void {
    document.querySelectorAll('.data-cell.sel, .data-cell.sel-mirror').forEach(el => el.classList.remove('sel', 'sel-mirror'));
    if (!selection) { return; }
    const other = selection.side === 'a' ? 'b' : 'a';
    for (const el of document.querySelectorAll<HTMLElement>(`.data-cell[data-side="${selection.side}"]`)) {
        const a = parseInt(el.dataset.addr ?? '', 16);
        if (a >= selection.start && a <= selection.end) { el.classList.add('sel'); }
    }
    for (const el of document.querySelectorAll<HTMLElement>(`.data-cell[data-side="${other}"]`)) {
        const a = parseInt(el.dataset.addr ?? '', 16);
        if (a >= selection.start && a <= selection.end) { el.classList.add('sel-mirror'); }
    }
}

/** Highlight the same address in the opposite component (cross-panel hover). */
function applyHoverMirror(): void {
    document.querySelectorAll('.data-cell.cell-mirror').forEach(el => el.classList.remove('cell-mirror'));
    if (hoverAddr < 0 || !hoverSide) { return; }
    const mirror = document.querySelector(addrSel(hoverAddr, hoverSide === 'a' ? 'b' : 'a'));
    mirror?.classList.add('cell-mirror');
}

/** Highlight the byte column across both components when hovering a header offset. */
function applyColHover(): void {
    document.querySelectorAll('.data-cell.col-hi').forEach(el => el.classList.remove('col-hi'));
    if (hoverCol < 0) { return; }
    for (const el of document.querySelectorAll<HTMLElement>('.data-cell[data-addr]')) {
        const a = parseInt(el.dataset.addr ?? '', 16);
        if (a >= 0 && (a & 0xF) === hoverCol) { el.classList.add('col-hi'); }
    }
}

function wireSelection(): void {
    document.addEventListener('mousedown', e => {
        const cell = cellFromEvent(e.target);
        if (cell) {
            dragging = true;
            selection = { side: cell.side, start: cell.addr, end: cell.addr };
            applySelectionDom();
            return;
        }
        // Clicking empty scroll space clears the selection; toolbar/rail clicks leave it.
        if ((e.target as HTMLElement).closest?.('#diff-scroll')) {
            selection = null;
            applySelectionDom();
        }
    });
    document.addEventListener('mouseover', e => {
        if (dragging && selection) {
            const cell = cellFromEvent(e.target);
            if (cell && cell.side === selection.side) {
                selection = {
                    side: cell.side,
                    start: Math.min(selection.start, cell.addr),
                    end: Math.max(selection.end, cell.addr),
                };
                applySelectionDom();
            }
            return;
        }
        const cell = cellFromEvent(e.target);
        if (cell) {
            hoverAddr = cell.addr;
            hoverSide = cell.side;
            applyHoverMirror();
        }
    });
    document.addEventListener('mouseout', e => {
        if (cellFromEvent(e.target)) {
            hoverAddr = -1;
            hoverSide = null;
            applyHoverMirror();
        }
    });
    document.addEventListener('mouseup', () => { dragging = false; });

    // Header column hover: highlight that offset column across both components.
    document.addEventListener('mouseover', e => {
        const hcell = (e.target as HTMLElement).closest?.('.diff-header .hcell') as HTMLElement | null;
        if (!hcell) { return; }
        const idx = Array.prototype.indexOf.call(hcell.parentElement?.children ?? [], hcell);
        if (idx >= 0) { hoverCol = idx; applyColHover(); }
    });
    document.addEventListener('mouseout', e => {
        if ((e.target as HTMLElement).closest?.('.diff-header .hcell')) {
            hoverCol = -1;
            applyColHover();
        }
    });
}

/** Re-apply transient hover/selection classes after the DOM is rebuilt. */
function reapplyTransientHighlights(): void {
    applySelectionDom();
    applyHoverMirror();
    applyColHover();
}

/** Bytes of the selected side over the selection range, in address order. */
function selectionBytes(): number[] {
    if (!selection) { return []; }
    const bytes: number[] = [];
    for (const vr of visualRows) {
        for (let i = 0; i < DIFF_ROW_BYTES; i++) {
            const addr = vr.baseAddress + i;
            if (addr < selection.start || addr > selection.end) { continue; }
            const cell = selection.side === 'a' ? vr.a[i] : vr.b[i];
            if (cell?.present) { bytes.push(cell.byte); }
        }
    }
    return bytes;
}

// ── Bootstrap ─────────────────────────────────────────────────────
window.addEventListener('resize', () => rerender());

wireSelection();

// Alt+↓ / Alt+↑ jump to next/prev diff run.
document.addEventListener('keydown', e => {
    if (!e.altKey) { return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); gotoDiff(1); }
    if (e.key === 'ArrowUp') { e.preventDefault(); gotoDiff(-1); }
});

// Ctrl+C copies the selected side's bytes in the chosen copy format.
document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        copySelection();
    }
});

// Ctrl+F focuses the search box (mirrors the single-file view).
document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        const inp = document.getElementById('search-input') as HTMLInputElement | null;
        if (inp) { inp.focus(); inp.select(); }
    }
});

post({ type: 'diffReady' });
rerender();
