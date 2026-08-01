// ── HexScope Diff Webview Entry Point ─────────────────────────────
// Two-panel hex diff. Host sends diffInit/diffUpdate/diffSwap/diffSearch;
// view sends diffReady/diffSwapRequest/diffSearchRequest.

import type { DiffResult } from '../core/diff';
import type { ProviderToWebviewMessage, WebviewToProviderMessage } from '../webviewProtocol';
import { messageType } from '../webviewProtocol';
import { vscode } from './vscodeApi';
import { esc, formatAddress, rowIndexForAddress, diffRunFocus, searchMatchFocus } from './diff/diffViewModel';
import { renderDiffSummaryHtml, renderDiffRowsHtml } from './diff/diffRenderer';

// ── State ─────────────────────────────────────────────────────────
let generation = 0;
let result: DiffResult | null = null;
let aLabel = '';
let bLabel = '';
let swapped = false;
let error: string | null = null;
let searchQuery = '';
let searchMatches: number[] = [];
let searchFocusAddr = -1;
let diffFocusAddr = -1;

let scrollTop = 0;
let containerHeight = 0;
const ROW_HEIGHT = 22;
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

function searchRowIndexFor(): number {
    return searchFocusAddr >= 0 && result ? rowIndexForAddress(result, searchFocusAddr) : -1;
}

function diffScrollHtml(rows: DiffResult['rows'], totalHeight: number): string {
    const [start, end] = visibleWindow(rows.length);
    return `<div id="diff-scroll" style="height:${esc(String(containerHeight))}px;overflow:auto">
            ${renderDiffRowsHtml({ result, searchRowIndex: searchRowIndexFor() }, [start, end], totalHeight, scrollTop)}
        </div>`;
}

function rerender(): void {
    const rows = result?.rows ?? [];
    const totalHeight = rows.length * ROW_HEIGHT;

    app.innerHTML = `
        <div class="diff-labels">
            <span class="label a">${esc(aLabel)}</span>
            <span class="label b">${esc(bLabel)}</span>
        </div>
        <div class="diff-summary">${renderDiffSummaryHtml({ result, searchRowIndex: searchRowIndexFor() })}</div>
        ${diffScrollHtml(rows, totalHeight)}
        <div class="diff-toolbar">
            <button id="prev-diff">▲ Prev</button>
            <button id="next-diff">Next ▼</button>
            <input id="diff-search" type="text" placeholder="Search hex bytes (e.g. DE AD BE EF)" value="${esc(searchQuery)}">
            <button id="prev-match">▲ Match</button>
            <button id="next-match">Match ▼</button>
            <button id="swap">⇄ Swap</button>
        </div>
    `;

    const scrollEl = document.getElementById('diff-scroll')!;
    scrollEl.scrollTop = scrollTop;
    scrollEl.addEventListener('scroll', () => {
        scrollTop = scrollEl.scrollTop;
        rerender();
    });

    wireToolbar();
    updateStatus();
}

/** Navigate so the row containing `addr` is centered in the viewport. */
function focusRow(addr: number): void {
    const idx = rowIndexForAddress(result!, addr);
    if (!result || idx < 0) { return; }
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

function wireToolbar(): void {
    document.getElementById('prev-diff')!.addEventListener('click', () => gotoDiff(-1));
    document.getElementById('next-diff')!.addEventListener('click', () => gotoDiff(1));
    document.getElementById('swap')!.addEventListener('click', () => {
        swapped = !swapped;
        post({ type: 'diffSwapRequest' });
        document.body.classList.toggle('swapped', swapped);
    });

    const searchInput = document.getElementById('diff-search') as HTMLInputElement;
    const doSearch = (query: string): void => {
        searchQuery = query;
        post({ type: 'diffSearchRequest', generation, query });
    };
    searchInput.addEventListener('change', () => doSearch(searchInput.value));
    searchInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') { doSearch(searchInput.value); }
    });

    document.getElementById('prev-match')!.addEventListener('click', () => gotoMatch(-1));
    document.getElementById('next-match')!.addEventListener('click', () => gotoMatch(1));
}

function updateStatus(): void {
    if (error) {
        status.textContent = `Error: ${error}`;
    } else if (!result) {
        status.textContent = 'Loading…';
    } else {
        status.textContent = `A=${esc(aLabel)} ⇄ B=${esc(bLabel)} · ${result.rows.length} rows · ${result.runs.length} diff regions`;
    }
}

// ── Message handling ──────────────────────────────────────────────
type DiffHandler = (m: Extract<ProviderToWebviewMessage, { type: string }>) => void;

/** True when `addr` is a real, present focus and still exists in `result`. */
function focusExists(addr: number, result: DiffResult): boolean {
    return addr >= 0 && rowIndexForAddress(result, addr) >= 0;
}

/** Drop stale focus addresses that no longer exist in the new result. */
function dropInvalidFocus(result: DiffResult): void {
    if (!focusExists(diffFocusAddr, result)) { diffFocusAddr = -1; }
    if (!focusExists(searchFocusAddr, result)) { searchFocusAddr = -1; }
}

function applyDiff(result: DiffResult): void {
    if (error) { error = null; }
    dropInvalidFocus(result);
    rerender();
}

const diffHandlers: Record<string, DiffHandler> = {
    diffInit: m => {
        const msg = m as Extract<ProviderToWebviewMessage, { type: 'diffInit' }>;
        generation = msg.generation;
        result = msg.result;
        aLabel = msg.aLabel;
        bLabel = msg.bLabel;
        searchMatches = [];
        searchFocusAddr = -1;
        diffFocusAddr = -1;
        error = null;
        rerender();
    },
    diffUpdate: m => {
        const msg = m as Extract<ProviderToWebviewMessage, { type: 'diffUpdate' }>;
        result = msg.result;
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

// ── Bootstrap ─────────────────────────────────────────────────────
containerHeight = Math.max(200, window.innerHeight - 90);
window.addEventListener('resize', () => {
    containerHeight = Math.max(200, window.innerHeight - 90);
    rerender();
});

post({ type: 'diffReady' });
rerender();
