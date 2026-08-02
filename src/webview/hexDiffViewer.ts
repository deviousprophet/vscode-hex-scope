// ── HexScope Diff Webview Composition Root ─────────────────────────
// Owns the toolbar, message dispatch, summary/status, and the search bar.
// Grid rendering + interaction live in diff/diffView.ts (mirrors how the
// single view splits memory/memoryView.ts from hexViewer.ts).
// Host sends diffInit/diffUpdate/diffProgress/diffSwap/diffSearch; view sends
// diffReady/diffSwapRequest/diffSearchRequest.

import type { DiffMeta } from '../core/diff';
import type { SerializedParseResult, WireParseResult } from '../core/types';
import type { ProviderToWebviewMessage, WebviewToProviderMessage } from '../webviewProtocol';
import { dispatchProviderMessage, type ProviderMessageHandlers } from './webviewMessageDispatcher';
import { vscode } from './vscodeApi';
import { esc } from './utils';
import { groupVisualRows, type DiffLightRow } from './diff/diffViewModel';
import { renderDiffSummaryHtml, type DiffSummaryState } from './diff/diffRenderer';
import {
    applyFirstJump,
    currentMatchIndex,
    dropInvalidFocus,
    getViewMode,
    gotoDiff,
    gotoMatch,
    hasSelection,
    initDiffData,
    matchCount,
    renderDiffBody,
    resetSearch,
    selectionSuffix,
    setDiffState,
    setSearch,
    setViewMode,
    wireDiffComponents,
} from './diff/diffView';
import { SearchBarComponent } from './ui-components/search-bar/searchBarComponent';

// ── State (view-level; grid state lives in diffView) ───────────────
let generation = 0;
let loaded = false;
let error: string | null = null;
let meta: DiffMeta | null = null;
let aLabel = '';
let bLabel = '';
let aError: string | null = null;
let bError: string | null = null;
let lastRequestedQuery = '';

const searchBar = new SearchBarComponent({
    onSearch: (query, mode, endianness) => {
        lastRequestedQuery = query;
        searchBar.setBusy(true);
        post({ type: 'diffSearchRequest', generation, query, mode, endianness });
    },
    onPrev: () => gotoMatch(-1),
    onNext: () => gotoMatch(1),
    onClear: () => {
        resetSearch();
        // Supersede any in-flight search so stale partials cannot repopulate,
        // and drop the spinner: the clear request's own done reply is filtered
        // by the query check below, so busy must be cleared here.
        lastRequestedQuery = '';
        searchBar.setBusy(false);
        post({ type: 'diffSearchRequest', generation, query: '', mode: 'bytes', endianness: 'le' });
        rerender();
    },
});

const vscodeApi = vscode;

// ── DOM refs ───────────────────────────────────────────────────────
const app = document.getElementById('app')!;
const status = document.getElementById('status')!;

function post(msg: WebviewToProviderMessage): void {
    void vscodeApi.postMessage(msg);
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

function tabClass(mode: 'all' | 'diff'): string {
    return getViewMode() === mode ? 'active' : '';
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

    renderDiffBody();
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

function statusText(): string {
    if (error) { return `Error: ${error}`; }
    if (!meta) { return 'Loading…'; }
    let text = `A=${aLabel} ⇄ B=${bLabel}`;
    if (hasSelection()) { text += selectionSuffix(); }
    return text;
}

function updateStatus(): void {
    status.classList.remove('reloading');
    searchBar.setCount(matchCount(), currentMatchIndex());
    status.textContent = statusText();
}

function wireToolbar(): void {
    const applyMode = (mode: 'all' | 'diff') => () => {
        setViewMode(mode);
        rerender();
    };
    document.getElementById('view-all')!.addEventListener('click', applyMode('all'));
    document.getElementById('view-diff')!.addEventListener('click', applyMode('diff'));
    document.getElementById('prev-diff')!.addEventListener('click', () => gotoDiff(-1));
    document.getElementById('next-diff')!.addEventListener('click', () => gotoDiff(1));
    document.getElementById('swap')!.addEventListener('click', () => {
        post({ type: 'diffSwapRequest' });
    });
}

// ── Message handling ──────────────────────────────────────────────

function applySides(aWire: WireParseResult, bWire: WireParseResult): void {
    initDiffData(aWire, bWire);
}

function setFromInit(msg: Extract<ProviderToWebviewMessage, { type: 'diffInit' }>): void {
    meta = msg.meta;
    aLabel = msg.aLabel;
    bLabel = msg.bLabel;
    aError = msg.aError;
    bError = msg.bError;
    setDiffState({
        meta: msg.meta,
        aLabel: msg.aLabel,
        bLabel: msg.bLabel,
        aError: msg.aError,
        bError: msg.bError,
        visualRows: groupVisualRows(msg.meta),
        resetScroll: true,
    });
    resetSearch();
    error = null;
    loaded = true;
}

function setFromUpdate(msg: Extract<ProviderToWebviewMessage, { type: 'diffUpdate' }>): void {
    meta = msg.meta;
    aError = msg.aError;
    bError = msg.bError;
    setDiffState({
        meta: msg.meta,
        aLabel,
        bLabel,
        aError: msg.aError,
        bError: msg.bError,
        visualRows: groupVisualRows(msg.meta),
        resetScroll: false,
    });
    dropInvalidFocus();
}

const diffHandlers: Partial<ProviderMessageHandlers> = {
    diffInit: m => {
        const msg = m as Extract<ProviderToWebviewMessage, { type: 'diffInit' }>;
        generation = msg.generation;
        applySides(msg.a, msg.b);
        setFromInit(msg);
        rerender();
    },
    diffUpdate: m => {
        if (!loaded) { return; }
        const msg = m as Extract<ProviderToWebviewMessage, { type: 'diffUpdate' }>;
        generation = msg.generation;
        applySides(msg.a, msg.b);
        setFromUpdate(msg);
        rerender();
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
        document.body.classList.toggle('swapped', msg.swapped);
    },
    diffSearch: m => {
        const msg = m as Extract<ProviderToWebviewMessage, { type: 'diffSearch' }>;
        if (msg.query !== lastRequestedQuery) { return; }
        setSearch(msg.matches, -1);
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

window.addEventListener('message', (event: MessageEvent<ProviderToWebviewMessage>) => {
    dispatchProviderMessage(event.data, diffHandlers);
});

// ── Bootstrap ─────────────────────────────────────────────────────
window.addEventListener('resize', () => rerender());

wireDiffComponents();

// Alt+↓ / Alt+↑ jump to next/prev diff run.
document.addEventListener('keydown', e => {
    if (!e.altKey) { return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); gotoDiff(1); }
    if (e.key === 'ArrowUp') { e.preventDefault(); gotoDiff(-1); }
});

post({ type: 'diffReady' });
rerender();
searchBar.mount();
