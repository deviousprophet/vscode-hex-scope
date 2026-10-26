// ── HexScope Diff webview entry point ────────────────────────────
// Isolated from the single-file app shell: grid + summary + navigation only.

import './diff/diff.css';
import type { DiffWebviewToProvider } from '../diffProtocol';
import { disambiguatedLabels } from '../core/diffLabels';
import { postDiffProviderMessage } from './vscodeApi';
import { hydrateDiffSide, renderSideHeadHtml, type DiffSideData } from './diff/diffModel';
import { applyDiffProgress, copySelectionText, currentSides, mountDiffGrid, replaceSideData, setDiffData, setDiffGridHooks, showDiffError } from './diff/diffGrid';
import { refreshDiffSearchCount, resetDiffSearch } from './diff/diffSearch';
import { setDiffSummary } from './diff/diffSummary';
import { renderDiffViewBodyHtml } from './components/diffView/diffViewRender';
import { isCopyShortcut, isEditableTarget } from './components/hexView/hexViewPaint';
import { dispatchDiffMessage, type DiffBaseChangedMessage, type DiffErrorMessage, type DiffInitMessage } from './diff/diffMessages';
import { createDiffExternalChangeBanner } from './diff/diffExternalChange';
import {
    configureDiffBaseEditor,
    diffBaseEditorOptions,
    handleDiffBaseAction,
    handleDiffBaseKeydown,
    pasteDiffBaseText,
    resetDiffBaseEditor,
    updateDiffBaseDraft,
} from './diff/diffBaseEditor';

const READY: DiffWebviewToProvider = { type: 'ready' };
let sides: { a: DiffSideData; b: DiffSideData } | null = null;
const externalChange = createDiffExternalChangeBanner(postDiffProviderMessage);

function renderDiffShellHtml(): string {
    return `<div class="diff-root" id="diff-root" hidden>` +
        `<div class="diff-summary" id="diff-summary"></div>` +
        renderDiffViewBodyHtml() +
        `<div class="diff-error" id="diff-error" hidden></div>` +
        `</div>`;
}

const app = document.getElementById('app');
if (app) { app.insertAdjacentHTML('beforeend', renderDiffShellHtml()); }

configureDiffBaseEditor({
    post: message => postDiffProviderMessage(message),
    byteLength: side => sideData(side)?.parseResult.totalDataBytes ?? 0,
    path: side => sideData(side)?.path ?? '',
    rerender: () => renderSideHeads(),
});

setDiffGridHooks({
    onSidesSwapped: (a, b) => {
        resetDiffBaseEditor();
        sides = { a, b };
        renderSideHeads();
    },
});
mountDiffGrid();
mountSideHeadEvents();
postDiffProviderMessage(READY);

window.addEventListener('message', event => { applyDiffMessage(event.data); });
document.addEventListener('keydown', handleCopyShortcut);

/** Delegated controls survive the side-head innerHTML re-renders. */
function mountSideHeadEvents(): void {
    for (const id of ['diff-head-a', 'diff-head-b']) {
        const head = document.getElementById(id);
        if (!head) { continue; }
        head.addEventListener('click', onSideHeadClick);
        head.addEventListener('input', onSideHeadInput);
        head.addEventListener('keydown', onSideHeadKeydown);
        head.addEventListener('paste', onSideHeadPaste);
    }
}

function onSideHeadClick(event: MouseEvent): void {
    const button = baseActionButton(event.target);
    if (!button) { return; }
    const side = diffSideKey(button.dataset.side);
    if (!side) { return; }
    handleDiffBaseAction(button.dataset.diffBaseAction ?? '', side, baseAddressOf(side));
}

function baseActionButton(target: EventTarget | null): HTMLElement | null {
    return (target as HTMLElement | null)?.closest<HTMLElement>('[data-diff-base-action]') ?? null;
}

function diffSideKey(value: string | undefined): 'a' | 'b' | null {
    return value === 'a' || value === 'b' ? value : null;
}

function baseAddressOf(side: 'a' | 'b'): number {
    return sideData(side)?.baseAddress ?? 0;
}

function sideData(side: 'a' | 'b'): DiffSideData | null {
    if (!sides) { return null; }
    return side === 'a' ? sides.a : sides.b;
}

function onSideHeadInput(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    if (!isBaseEditorInput(input)) { return; }
    updateDiffBaseDraft(input.value);
}

/** The shared `.addr-input` inside a side head carries the editor side marker. */
function isBaseEditorInput(input: HTMLInputElement | null): input is HTMLInputElement {
    return !!input?.dataset.diffBaseInput;
}

function onSideHeadKeydown(event: KeyboardEvent): void {
    handleDiffBaseKeydown(event);
}

function onSideHeadPaste(event: ClipboardEvent): void {
    const input = event.target as HTMLInputElement | null;
    if (!isBaseEditorInput(input)) { return; }
    const text = (event.clipboardData?.getData('text') ?? '').trim();
    if (!text) { return; }
    event.preventDefault();
    pasteDiffBaseText(text);
}

function applyDiffMessage(message: unknown): void {
    dispatchDiffMessage(message, {
        diffInit: applyDiffInit,
        diffError: applyDiffError,
        diffProgress: applyDiffProgress,
        diffExternalChange: externalChange.applyChange,
        diffExternalChangeError: externalChange.applyError,
        diffBaseChanged: applyDiffBaseChanged,
    });
}

function applyDiffInit(message: DiffInitMessage): void {
    const a = hydrateDiffSide(message.a);
    const b = hydrateDiffSide(message.b);
    resetDiffBaseEditor();
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

/**
 * One side was rebuilt at a new comparison-only base. Replace it by file path
 * (the current pane order may be swapped), keep the other side and the view
 * mode, recompute the diff, and close any inline editor.
 */
function applyDiffBaseChanged(message: DiffBaseChangedMessage): void {
    const updated = hydrateDiffSide(message.side);
    const diff = replaceSideData(updated.path, updated);
    if (!diff) { return; }
    sides = currentSides();
    resetDiffBaseEditor();
    renderSideHeads();
    resetDiffSearch();
    setDiffSummary(diff);
}

function handleCopyShortcut(e: KeyboardEvent): void {
    if (!isCopyShortcut(e) || isEditableTarget(e.target as HTMLElement | null)) { return; }
    const payload = copySelectionText();
    if (!payload) { return; }
    e.preventDefault();
    postDiffProviderMessage({ type: 'copyText', text: payload.text, label: payload.label });
}

function renderSideHeads(): void {
    if (!sides) { return; }
    const [labelA, labelB] = disambiguatedLabels(sides.a, sides.b);
    setSideHead('diff-head-a', labelA, sides.a, 'a');
    setSideHead('diff-head-b', labelB, sides.b, 'b');
}

function setSideHead(id: string, label: string, side: DiffSideData, key: 'a' | 'b'): void {
    const el = document.getElementById(id);
    if (!el) { return; }
    el.innerHTML = renderSideHeadHtml(label, side.format, side.baseAddress, diffBaseEditorOptions(key, !!side.baseOverride));
    el.title = side.path;
}
