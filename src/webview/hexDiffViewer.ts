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

function rerender(): void {
    const rows = result?.rows ?? [];
    const totalHeight = rows.length * ROW_HEIGHT;
    const [start, end] = visibleWindow(rows.length);
    const searchRowIndex = searchFocusAddr >= 0 && result ? rowIndexForAddress(result, searchFocusAddr) : -1;

    app.innerHTML = `
        <div class="diff-labels">
            <span class="label a">${esc(aLabel)}</span>
            <span class="label b">${esc(bLabel)}</span>
        </div>
        <div class="diff-summary">${renderDiffSummaryHtml({ result, scrollTop, containerHeight, focusRowIndex: 0, focusVersion: 0, searchMatches, searchRowIndex })}</div>
        <div id="diff-scroll" style="height:${esc(String(containerHeight))}px;overflow:auto">
            ${renderDiffRowsHtml({ result, scrollTop, containerHeight, focusRowIndex: 0, focusVersion: 0, searchMatches, searchRowIndex }, [start, end], totalHeight)}
        </div>
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

    const focusRow = (addr: number): void => {
        if (!result) { return; }
        const idx = rowIndexForAddress(result, addr);
        if (idx < 0) { return; }
        const rowTop = idx * ROW_HEIGHT;
        const target = Math.max(0, rowTop - containerHeight / 2);
        scrollTop = target;
        rerender();
    };

    document.getElementById('prev-diff')!.addEventListener('click', () => {
        const f = diffRunFocus(result!, diffFocusAddr >= 0 ? diffFocusAddr : (result?.runs[0]?.start ?? 0), -1);
        if (f) { diffFocusAddr = f.address; focusRow(f.address); }
    });
    document.getElementById('next-diff')!.addEventListener('click', () => {
        const f = diffRunFocus(result!, diffFocusAddr >= 0 ? diffFocusAddr : (result?.runs[0]?.start ?? 0), 1);
        if (f) { diffFocusAddr = f.address; focusRow(f.address); }
    });
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

    const gotoMatch = (dir: 1 | -1): void => {
        const f = searchMatchFocus(result!, searchMatches, searchFocusAddr >= 0 ? searchFocusAddr : -1, dir);
        if (f) { searchFocusAddr = f.address; focusRow(f.address); }
    };
    document.getElementById('prev-match')!.addEventListener('click', () => gotoMatch(-1));
    document.getElementById('next-match')!.addEventListener('click', () => gotoMatch(1));

    if (error) {
        status.textContent = `Error: ${error}`;
    } else if (!result) {
        status.textContent = 'Loading…';
    } else {
        status.textContent = `A=${esc(aLabel)} ⇄ B=${esc(bLabel)} · ${result.rows.length} rows · ${result.runs.length} diff regions`;
    }
}

// ── Message handling ──────────────────────────────────────────────
function applyDiff(result: DiffResult): void {
    if (error) { error = null; }
    // keep focus addresses if still valid; otherwise drop
    if (diffFocusAddr >= 0 && rowIndexForAddress(result, diffFocusAddr) < 0) { diffFocusAddr = -1; }
    if (searchFocusAddr >= 0 && rowIndexForAddress(result, searchFocusAddr) < 0) { searchFocusAddr = -1; }
    rerender();
}

window.addEventListener('message', (event: MessageEvent<ProviderToWebviewMessage>) => {
    const msg = event.data;
    const type = messageType(msg);
    if (type === 'diffInit') {
        const m = msg as Extract<ProviderToWebviewMessage, { type: 'diffInit' }>;
        generation = m.generation;
        result = m.result;
        aLabel = m.aLabel;
        bLabel = m.bLabel;
        searchMatches = [];
        searchFocusAddr = -1;
        diffFocusAddr = -1;
        error = null;
        rerender();
        return;
    }
    if (type === 'diffUpdate') {
        const m = msg as Extract<ProviderToWebviewMessage, { type: 'diffUpdate' }>;
        result = m.result;
        applyDiff(m.result);
        return;
    }
    if (type === 'diffSwap') {
        const m = msg as Extract<ProviderToWebviewMessage, { type: 'diffSwap' }>;
        swapped = m.swapped;
        document.body.classList.toggle('swapped', swapped);
        return;
    }
    if (type === 'diffSearch') {
        const m = msg as Extract<ProviderToWebviewMessage, { type: 'diffSearch' }>;
        searchMatches = m.matches;
        searchFocusAddr = searchMatches[0] ?? -1;
        rerender();
        return;
    }
    if (type === 'loadError') {
        const m = msg as Extract<ProviderToWebviewMessage, { type: 'loadError' }>;
        error = m.message;
        rerender();
    }
});

// ── Bootstrap ─────────────────────────────────────────────────────
containerHeight = Math.max(200, window.innerHeight - 90);
window.addEventListener('resize', () => {
    containerHeight = Math.max(200, window.innerHeight - 90);
    rerender();
});

post({ type: 'diffReady' });
rerender();
