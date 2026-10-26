// ── Raw-binary base-address field (profile bar) ───────────────────
// `.bin` only: a read-only address with explicit Edit / Save / Cancel
// actions after the profile picker. The host owns persistence; the field
// validates inline and reports a commit. It is the only editor for the value
// (the palette command just enters edit mode), so no prompt/dialog exists
// anywhere in the flow.

import './binBaseField.css';

import { S } from './state';
import { hasUnsavedEdits } from './appModel';
import {
    baseAddressChangeRefusal,
    baseAddressFieldState,
    type BaseAddressChangeState,
    type BaseAddressFieldState,
} from './baseAddressChange';
import { formatBinBaseAddress, parseBinBaseAddress } from '../core/parser/binImage';
import type { WebviewToProviderMessage } from '../webviewProtocol';

const HOST_ID = 'bin-base-field';
const INPUT_ID = 'bin-base-input';
const INPUT_WRAP_ID = 'bin-base-input-wrap';
const VALUE_ID = 'bin-base-value';
const EDIT_ID = 'bin-base-edit';
const SAVE_ID = 'bin-base-save';
const CANCEL_ID = 'bin-base-cancel';
const ERROR_ID = 'bin-base-error';
const ENABLED_TITLE = 'Hexadecimal address where byte 0 maps (0x00000000–0xFFFFFFFF)';
const EDIT_TITLE = 'Edit the raw binary base address';
const INPUT_ARIA_LABEL = 'Raw binary base address, hexadecimal digits (0x prefix is fixed)';
const DIGITS_PLACEHOLDER = '00000000';
/** Copied/typed prefix; it is fixed chrome, so it must never consume digit slots. */
const LEADING_PREFIX = /^0[xX]/;
const TOO_LONG_MESSAGE = 'Use up to eight hex digits (0x00000000–0xFFFFFFFF).';

/** Provider post seam; the host wires `postProviderMessage` once at startup. */
let postMessage: (message: WebviewToProviderMessage) => void = () => {};

/** Explicit view/edit mode: read-only value vs. fixed-prefix input + Save/Cancel. */
let editing = false;
/** Just-committed value shown until the host's fresh `init` replaces the parse result. */
let pendingBase: number | null = null;

/** Wire the provider post (hexViewer startup); tests inject a spy. */
export function configureBinBaseField(post: (message: WebviewToProviderMessage) => void): void {
    postMessage = post;
}

function fieldState(): BaseAddressChangeState {
    return {
        format: S.parseResult?.format,
        hasUnsavedEdits: hasUnsavedEdits(),
        lockedDueToExternalChange: S.lockedDueToExternalChange,
    };
}

function byId(id: string): HTMLElement | null {
    return document.getElementById(id);
}

function hostElement(): HTMLElement | null {
    return byId(HOST_ID);
}

function inputElement(): HTMLInputElement | null {
    return byId(INPUT_ID) as HTMLInputElement | null;
}

function inputWrapElement(): HTMLElement | null {
    return byId(INPUT_WRAP_ID);
}

function valueElement(): HTMLElement | null {
    return byId(VALUE_ID);
}

function editButtonElement(): HTMLButtonElement | null {
    return byId(EDIT_ID) as HTMLButtonElement | null;
}

function saveButtonElement(): HTMLButtonElement | null {
    return byId(SAVE_ID) as HTMLButtonElement | null;
}

function cancelButtonElement(): HTMLButtonElement | null {
    return byId(CANCEL_ID) as HTMLButtonElement | null;
}

function errorElement(): HTMLElement | null {
    return byId(ERROR_ID);
}

/** Effective base shown by the field (an empty image still reports its map origin). */
function committedBase(): number {
    return S.parseResult?.baseAddress ?? 0;
}

/** Base shown in view mode: the last commit until the host rehydrates. */
function displayedBase(): number {
    return pendingBase ?? committedBase();
}

function byteLength(): number {
    return S.parseResult?.totalDataBytes ?? 0;
}

/** Input text: the eight uppercase hex digits; the `0x` prefix is fixed chrome. */
function formatFieldDigits(value: number): string {
    return formatBinBaseAddress(value).slice(2);
}

/** Insert/refresh the field in the current profile bar; .bin only. */
function mountBinBaseField(): void {
    const bar = document.getElementById('profile-bar');
    if (!bar) { return; }
    // A fresh mount (init/full re-render) always starts in view mode.
    editing = false;
    pendingBase = null;
    if (!hostElement()) {
        bar.insertAdjacentHTML('beforeend', fieldHtml());
        wireEvents();
    }
    renderBinBaseField();
}

function fieldHtml(): string {
    return `<div id="${HOST_ID}" class="bin-base-field" hidden>
        <span class="tb-sep" aria-hidden="true"></span>
        <label class="profile-label base-field-label" for="${INPUT_ID}">Base Address</label>
        <span id="${VALUE_ID}" class="base-value"></span>
        <button id="${EDIT_ID}" class="sb-btn sb-btn-secondary base-btn" type="button">Edit</button>
        <div id="${INPUT_WRAP_ID}" class="base-input-wrap" hidden>
            <span class="base-addr-pfx" aria-hidden="true">0x</span>
            <input id="${INPUT_ID}" class="base-input" type="text" maxlength="8"
                placeholder="${DIGITS_PLACEHOLDER}" spellcheck="false" autocomplete="off"
                aria-label="${INPUT_ARIA_LABEL}">
        </div>
        <button id="${SAVE_ID}" class="sb-btn sb-btn-secondary base-btn" type="button" hidden>Save</button>
        <button id="${CANCEL_ID}" class="sb-btn sb-btn-secondary base-btn" type="button" hidden>Cancel</button>
        <span id="${ERROR_ID}" class="base-field-error" role="alert" hidden></span>
    </div>`;
}

/** Sync visibility, the view/edit mode, and the disabled/tooltip state. */
function renderBinBaseField(): void {
    const host = hostElement();
    if (!host) { return; }
    const state = baseAddressFieldState(fieldState());
    host.hidden = !state.visible;
    if (!state.visible) {
        editing = false;
        return;
    }
    exitEditWhenDisabled(state);
    clearAppliedPending();
    applyMode();
    applyFieldState(state);
}

/** A state that forbids editing while the field is open drops the draft. */
function exitEditWhenDisabled(state: BaseAddressFieldState): void {
    if (!editing || !state.disabled) { return; }
    editing = false;
    clearFieldError();
}

/** Drop the optimistic display once the host's fresh init carries the value. */
function clearAppliedPending(): void {
    if (pendingBase !== null && S.parseResult?.baseAddress === pendingBase) {
        pendingBase = null;
    }
}

/** View mode: value + Edit. Edit mode: fixed-prefix input + Save/Cancel. */
function applyMode(): void {
    setHidden(valueElement(), editing);
    setHidden(inputWrapElement(), !editing);
    setHidden(editButtonElement(), editing);
    setHidden(saveButtonElement(), !editing);
    setHidden(cancelButtonElement(), !editing);
    syncModeValue();
    if (!editing) { clearFieldError(); }
}

function setHidden(element: HTMLElement | null, hidden: boolean): void {
    if (element) { element.hidden = hidden; }
}

function syncModeValue(): void {
    const value = valueElement();
    if (value) { value.textContent = formatBinBaseAddress(displayedBase()); }
    if (!shouldPreserveInput()) { setInputValue(); }
}

/** Never clobber text the user is typing; every other path re-syncs. */
function shouldPreserveInput(): boolean {
    return editing && document.activeElement === inputElement();
}

function setInputValue(): void {
    const input = inputElement();
    if (input) { input.value = formatFieldDigits(displayedBase()); }
}

function applyFieldState(state: BaseAddressFieldState): void {
    applyButtonState(editButtonElement(), state);
    applyInputState(inputElement(), state);
}

function applyButtonState(button: HTMLButtonElement | null, state: BaseAddressFieldState): void {
    if (!button) { return; }
    button.disabled = state.disabled;
    button.title = state.tooltip ?? EDIT_TITLE;
}

function applyInputState(input: HTMLInputElement | null, state: BaseAddressFieldState): void {
    if (!input) { return; }
    input.disabled = state.disabled;
    input.title = state.tooltip ?? ENABLED_TITLE;
}

/**
 * Enter edit mode (Edit button / palette command). Returns refusal text when
 * the document may not change its base, else null after focusing + selecting
 * the digits.
 */
function beginEdit(): string | null {
    const refusal = baseAddressChangeRefusal(fieldState());
    if (refusal) { return refusal; }
    // Re-entering edit (palette while already editing) must not discard the draft.
    if (editing) { focusAndSelect(); return null; }
    renderBinBaseField();
    editing = true;
    clearFieldError();
    applyMode();
    setInputValue();
    focusAndSelect();
    return null;
}

function focusAndSelect(): void {
    const input = inputElement();
    if (!input) { return; }
    input.focus();
    input.select();
}

/** Cancel/Escape: drop the draft, restore the committed value, return to view. */
function cancelEdit(): void {
    if (!editing) { return; }
    editing = false;
    renderBinBaseField();
    editButtonElement()?.focus();
}

/** Save/Enter: commit valid changed input, or stay in edit mode with an error. */
function commitField(): void {
    if (!editing) { return; }
    const input = inputElement();
    if (!input) { return; }
    const parsed = parseBinBaseAddress(input.value, byteLength());
    if (!parsed.ok) {
        showFieldError(parsed.error);
        return;
    }
    finishCommit(parsed.value);
}

function finishCommit(value: number): void {
    clearFieldError();
    editing = false;
    const changed = value !== committedBase();
    pendingBase = changed ? value : null;
    if (changed) { postMessage({ type: 'setBinBaseAddress', value }); }
    renderBinBaseField();
    editButtonElement()?.focus();
}

function wireEvents(): void {
    const input = inputElement();
    if (!input) { return; }
    input.addEventListener('keydown', onFieldKeydown);
    input.addEventListener('input', onFieldInput);
    input.addEventListener('paste', onFieldPaste);
    editButtonElement()?.addEventListener('click', () => { beginEdit(); });
    saveButtonElement()?.addEventListener('click', commitField);
    cancelButtonElement()?.addEventListener('click', cancelEdit);
}

/** Strip a typed `0x`/`0X` prefix so it cannot eat two of the eight digit slots. */
function onFieldInput(): void {
    const input = inputElement();
    if (input && LEADING_PREFIX.test(input.value)) {
        input.value = input.value.replace(LEADING_PREFIX, '');
    }
    clearFieldError();
}

/**
 * Take over every paste so the input's `maxlength="8"` cannot silently cut a
 * pasted address into a different, valid one. The fixed prefix is stripped and
 * the rest stays visible for inline validation/commit.
 */
function onFieldPaste(event: ClipboardEvent): void {
    const text = (event.clipboardData?.getData('text') ?? '').trim();
    if (!text) { return; }
    event.preventDefault();
    const input = inputElement();
    if (!input) { return; }
    const digits = text.replace(LEADING_PREFIX, '');
    input.value = digits;
    validatePastedValue(digits);
}

function validatePastedValue(digits: string): void {
    if (digits.length > 8) {
        showFieldError(TOO_LONG_MESSAGE);
        return;
    }
    const parsed = parseBinBaseAddress(digits, byteLength());
    if (parsed.ok) { clearFieldError(); } else { showFieldError(parsed.error); }
}

function onFieldKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
        event.preventDefault();
        commitField();
        return;
    }
    if (event.key === 'Escape') {
        event.preventDefault();
        cancelEdit();
    }
}

function showFieldError(message: string): void {
    inputElement()?.setAttribute('aria-invalid', 'true');
    const error = errorElement();
    if (!error) { return; }
    error.textContent = message;
    error.hidden = false;
}

function clearFieldError(): void {
    inputElement()?.removeAttribute('aria-invalid');
    const error = errorElement();
    if (!error) { return; }
    error.textContent = '';
    error.hidden = true;
}

/** Module surface consumed by hexViewer.ts. */
export const binBaseField = {
    mount: mountBinBaseField,
    render: renderBinBaseField,
    beginEdit,
    /** Palette/`focusBinBaseAddress` entry (historical name). */
    focus: beginEdit,
};
