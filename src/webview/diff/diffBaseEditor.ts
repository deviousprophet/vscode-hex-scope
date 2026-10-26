// ── Diff raw-binary base editor (comparison-only) ──────────────────
// The raw side head exposes `Edit base`; editing shows a fixed `0x` prefix,
// an eight-digit input, and Apply/Cancel. A valid Apply posts
// `setDiffBaseAddress` targeting the *displayed side's file path* to the host,
// which re-reads/re-parses only that side and reposts `diffBaseChanged`; Reset
// posts `resetDiffBaseAddress` for the same path. Path identity (not the pane
// key) keeps a swap safe. Nothing here persists: the override lives only in the
// open comparison panel.

import type { DiffSideKey, DiffWebviewToProvider } from '../../diffProtocol';
import { formatBinBaseAddress, parseBinBaseAddress } from '../../core/parser/binImage';
import type { SideHeadRenderOptions } from './diffModel';

export interface DiffBaseEditorHost {
    post: (message: DiffWebviewToProvider) => void;
    /** Live byte length of one side from the hydrated parse result. */
    byteLength: (side: DiffSideKey) => number;
    /** File path currently displayed in that pane (swap-safe request target). */
    path: (side: DiffSideKey) => string;
    /** Re-render both side heads after an editor open/close. */
    rerender: () => void;
}

interface EditorState {
    side: DiffSideKey;
    /** Digits in the input; the `0x` prefix is fixed chrome. */
    draft: string;
    /** Effective base shown before the edit (unchanged Apply closes without a post). */
    baseAddress: number;
    error: string | null;
}

const NO_HOST: DiffBaseEditorHost = {
    post: () => {},
    byteLength: () => 0,
    path: () => '',
    rerender: () => {},
};
/** Copied/typed prefix; fixed chrome, so it never consumes a digit slot. */
const LEADING_PREFIX = /^0[xX]/;

let host: DiffBaseEditorHost = NO_HOST;
let editing: EditorState | null = null;

/** Wire the host seam (provider post, live byte length, head re-render); tests inject spies. */
export function configureDiffBaseEditor(next: DiffBaseEditorHost): void {
    host = next;
}

/** Close the inline editor without re-rendering; the caller owns the head refresh (diffInit/swap). */
export function resetDiffBaseEditor(): void {
    editing = null;
}

/** Render options for one side head: override marker plus the open editor when it targets this side. */
export function diffBaseEditorOptions(side: DiffSideKey, baseOverride = false): SideHeadRenderOptions {
    const editor = editing && editing.side === side
        ? { draft: editing.draft, error: editing.error }
        : null;
    return { side, baseOverride, baseEditor: editor };
}

/** `Edit base`: prefill the effective base, reveal the editor, and focus/select the digits. */
export function beginDiffBaseEdit(side: DiffSideKey, baseAddress: number): void {
    editing = { side, draft: digits(baseAddress), baseAddress, error: null };
    host.rerender();
    focusEditor(side);
}

/** Cancel/Escape: drop the draft and return to the static controls. */
function cancelDiffBaseEdit(): void {
    if (!editing) { return; }
    editing = null;
    host.rerender();
}

/** Reset: drop the override and let the host re-resolve the stored per-file base. */
function resetDiffBase(side: DiffSideKey): void {
    editing = null;
    const path = host.path(side);
    if (path) { host.post({ type: 'resetDiffBaseAddress', path }); }
    host.rerender();
}

/** Enter applies, Escape cancels; any other key is left to the input. */
export function handleDiffBaseKeydown(event: KeyboardEvent): boolean {
    if (!editing) { return false; }
    if (event.key === 'Enter') {
        event.preventDefault();
        applyDiffBaseEdit();
        return true;
    }
    if (event.key === 'Escape') {
        event.preventDefault();
        cancelDiffBaseEdit();
        return true;
    }
    return false;
}

/** Typing: strip a typed `0x`/`0X` prefix and clear the inline error without re-rendering. */
export function updateDiffBaseDraft(text: string): void {
    if (!editing) { return; }
    const draft = text.replace(LEADING_PREFIX, '');
    editing.draft = draft;
    editing.error = null;
    const input = editorInput(editing.side);
    if (input && input.value !== draft) { input.value = draft; }
    renderErrorDom(editing.side, null);
}

/**
 * Paste: keep the whole pasted text visible so an over-long address reports an
 * inline error instead of being silently truncated into a different value.
 */
export function pasteDiffBaseText(text: string): void {
    if (!editing) { return; }
    editing.draft = text.replace(LEADING_PREFIX, '');
    editing.error = validateDraft(editing.draft, editing.side);
    const input = editorInput(editing.side);
    if (input) { input.value = editing.draft; }
    renderErrorDom(editing.side, editing.error);
}

type DiffBaseActionHandler = (side: DiffSideKey, baseAddress: number) => void;

/** Own markup actions only; the host never sends these strings. */
const BASE_ACTIONS: Record<string, DiffBaseActionHandler> = {
    edit: (side, baseAddress) => { beginDiffBaseEdit(side, baseAddress); },
    cancel: () => { cancelDiffBaseEdit(); },
    reset: side => { resetDiffBase(side); },
    apply: () => { applyDiffBaseEdit(); },
};

/** Delegated side-head button action; false for an unknown action. */
export function handleDiffBaseAction(action: string, side: DiffSideKey, baseAddress: number): boolean {
    const run = BASE_ACTIONS[action];
    if (!run) { return false; }
    run(side, baseAddress);
    return true;
}

/** Apply: validate inline against the live side length, then post a changed value. */
function applyDiffBaseEdit(): void {
    const state = editing;
    if (!state) { return; }
    const parsed = parseBinBaseAddress(state.draft, host.byteLength(state.side));
    if (!parsed.ok) {
        showDraftError(state, parsed.error);
        return;
    }
    editing = null;
    postChangedBase(state, parsed.value);
    host.rerender();
}

function showDraftError(state: EditorState, error: string): void {
    state.error = error;
    renderErrorDom(state.side, error);
}

/** Post only a changed, path-targetable value; the `0x` draft validation ran first. */
function postChangedBase(state: EditorState, value: number): void {
    if (value === state.baseAddress) { return; }
    const path = host.path(state.side);
    if (path) { host.post({ type: 'setDiffBaseAddress', path, value }); }
}

function validateDraft(draft: string, side: DiffSideKey): string | null {
    const parsed = parseBinBaseAddress(draft, host.byteLength(side));
    return parsed.ok ? null : parsed.error;
}

function digits(value: number): string {
    return formatBinBaseAddress(value).slice(2);
}

function editorInput(side: DiffSideKey): HTMLInputElement | null {
    return document.getElementById(`diff-base-input-${side}`) as HTMLInputElement | null;
}

function focusEditor(side: DiffSideKey): void {
    const input = editorInput(side);
    if (!input) { return; }
    input.focus();
    input.select();
}

function renderErrorDom(side: DiffSideKey, error: string | null): void {
    const input = editorInput(side);
    if (error === null) { input?.removeAttribute('aria-invalid'); } else { input?.setAttribute('aria-invalid', 'true'); }
    const errorEl = document.getElementById(`diff-base-error-${side}`);
    if (!errorEl) { return; }
    errorEl.textContent = error ?? '';
    errorEl.hidden = error === null;
}
