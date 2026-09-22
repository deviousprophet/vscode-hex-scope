// ── HexScope Diff webview entry point ────────────────────────────
// Isolated from the single-file app shell: grid + summary + navigation only.

import './diff/diff.css';
import type { DiffWebviewToProvider } from '../diffProtocol';
import { disambiguatedLabels } from '../core/diffLabels';
import { postProviderMessage } from './vscodeApi';
import { hydrateDiffSide, renderSideHeadHtml, type DiffSideData } from './diff/diffModel';
import { applyDiffProgress, copySelectionText, mountDiffGrid, setDiffData, setDiffGridHooks, showDiffError } from './diff/diffGrid';
import { refreshDiffSearchCount, resetDiffSearch } from './diff/diffSearch';
import { setDiffSummary } from './diff/diffSummary';
import { isCopyShortcut, isEditableTarget } from './components/hexView/hexViewPaint';
import { dispatchDiffMessage, type DiffErrorMessage, type DiffInitMessage } from './diff/diffMessages';
import { createDiffExternalChangeBanner } from './diff/diffExternalChange';

const READY: DiffWebviewToProvider = { type: 'ready' };
let sides: { a: DiffSideData; b: DiffSideData } | null = null;
const externalChange = createDiffExternalChangeBanner(postProviderMessage);

function renderDiffShellHtml(): string {
    return `<div class="diff-root" id="diff-root" hidden>` +
        `<div class="diff-summary" id="diff-summary"></div>` +
        `<div class="diff-body" id="diff-body">` +
        `<div class="diff-side">` +
        `<div class="diff-side-head" id="diff-head-a"></div>` +
        `<div class="diff-grid-root" id="diff-a">` +
        `<div class="mem-header" id="diff-header-a"></div>` +
        `<div class="mem-scroll"><div class="mem-rows" id="diff-rows-a"></div></div>` +
        `</div></div>` +
        `<div class="diff-split" id="diff-split"></div>` +
        `<div class="diff-side">` +
        `<div class="diff-side-head" id="diff-head-b"></div>` +
        `<div class="diff-grid-root" id="diff-b">` +
        `<div class="mem-header" id="diff-header-b"></div>` +
        `<div class="mem-scroll"><div class="mem-rows" id="diff-rows-b"></div></div>` +
        `</div></div></div>` +
        `<div class="diff-error" id="diff-error" hidden></div>` +
        `</div>`;
}

const app = document.getElementById('app');
if (app) { app.insertAdjacentHTML('beforeend', renderDiffShellHtml()); }

setDiffGridHooks({
    onSidesSwapped: (a, b) => {
        sides = { a, b };
        renderSideHeads();
    },
});
mountDiffGrid();
postProviderMessage(READY);

window.addEventListener('message', event => { applyDiffMessage(event.data); });
document.addEventListener('keydown', handleCopyShortcut);

function applyDiffMessage(message: unknown): void {
    dispatchDiffMessage(message, {
        diffInit: applyDiffInit,
        diffError: applyDiffError,
        diffProgress: applyDiffProgress,
        diffExternalChange: externalChange.applyChange,
        diffExternalChangeError: externalChange.applyError,
    });
}

function applyDiffInit(message: DiffInitMessage): void {
    const a = hydrateDiffSide(message.a);
    const b = hydrateDiffSide(message.b);
    sides = { a, b };
    renderSideHeads();
    resetDiffSearch();
    setDiffData(a, b, message.diff);
    setDiffSummary(message.diff);
    refreshDiffSearchCount();
}

function applyDiffError(message: DiffErrorMessage): void {
    showDiffError(message.message);
}

function handleCopyShortcut(e: KeyboardEvent): void {
    if (!isCopyShortcut(e) || isEditableTarget(e.target as HTMLElement | null)) { return; }
    const payload = copySelectionText();
    if (!payload) { return; }
    e.preventDefault();
    postProviderMessage({ type: 'copyText', text: payload.text, label: payload.label });
}

function renderSideHeads(): void {
    if (!sides) { return; }
    const [labelA, labelB] = disambiguatedLabels(sides.a, sides.b);
    setSideHead('diff-head-a', labelA, sides.a);
    setSideHead('diff-head-b', labelB, sides.b);
}

function setSideHead(id: string, label: string, side: DiffSideData): void {
    const el = document.getElementById(id);
    if (!el) { return; }
    el.innerHTML = renderSideHeadHtml(label, side.format);
    el.title = side.path;
}
