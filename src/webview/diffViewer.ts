// ── HexScope Diff webview entry point ────────────────────────────
// Isolated from the single-file app shell: grid + summary + navigation only.

import './diff/diff.css';
import type { DiffWebviewToProvider } from '../diffProtocol';
import { postProviderMessage } from './vscodeApi';
import { hydrateDiffSide } from './diff/diffModel';
import { mountDiffGrid, setDiffData, showDiffError } from './diff/diffGrid';
import { setDiffSummary } from './diff/diffSummary';
import { dispatchDiffMessage, type DiffErrorMessage, type DiffInitMessage } from './diff/diffMessages';

const READY: DiffWebviewToProvider = { type: 'ready' };

function renderDiffShellHtml(): string {
    return `<div class="diff-summary" id="diff-summary"></div>` +
        `<div class="diff-body" id="diff-body">` +
        `<div class="diff-side">` +
        `<div class="diff-side-head" id="diff-head-a"></div>` +
        `<div class="diff-grid-root" id="diff-a">` +
        `<div class="mem-header" id="diff-header-a"></div>` +
        `<div class="mem-scroll"><div class="mem-rows" id="diff-rows-a"></div></div>` +
        `</div></div>` +
        `<div class="diff-side diff-hide-addr">` +
        `<div class="diff-side-head" id="diff-head-b"></div>` +
        `<div class="diff-grid-root" id="diff-b">` +
        `<div class="mem-header" id="diff-header-b"></div>` +
        `<div class="mem-scroll"><div class="mem-rows" id="diff-rows-b"></div></div>` +
        `</div></div></div>` +
        `<div class="diff-error" id="diff-error" hidden></div>`;
}

const app = document.getElementById('app');
if (app) { app.innerHTML = renderDiffShellHtml(); }

mountDiffGrid();
postProviderMessage(READY);

window.addEventListener('message', event => { applyDiffMessage(event.data); });

function applyDiffMessage(message: unknown): void {
    dispatchDiffMessage(message, {
        diffInit: applyDiffInit,
        diffError: applyDiffError,
    });
}

function applyDiffInit(message: DiffInitMessage): void {
    const a = hydrateDiffSide(message.a);
    const b = hydrateDiffSide(message.b);
    setSideHead('diff-head-a', a.name, a.format);
    setSideHead('diff-head-b', b.name, b.format);
    setDiffData(a, b, message.diff);
    setDiffSummary(message.diff);
}

function applyDiffError(message: DiffErrorMessage): void {
    showDiffError(message.message);
}

function setSideHead(id: string, name: string, format: string): void {
    const el = document.getElementById(id);
    if (!el) { return; }
    el.textContent = `${name} · ${format.toUpperCase()}`;
}
