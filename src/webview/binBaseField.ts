// ── Raw-binary base-address field (profile bar) ───────────────────
// `.bin` only: an editable hex address after the profile picker. The host
// owns persistence; the field validates inline and reports a commit. It is
// the only editor for the value (the palette command and the Base stat just
// focus it), so no prompt/dialog exists anywhere in the flow.

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
const ERROR_ID = 'bin-base-error';
const ENABLED_TITLE = 'Hexadecimal address where byte 0 maps (0x00000000–0xFFFFFFFF)';

/** Provider post seam; the host wires `postProviderMessage` once at startup. */
let postMessage: (message: WebviewToProviderMessage) => void = () => {};

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

function hostElement(): HTMLElement | null {
    return document.getElementById(HOST_ID);
}

function inputElement(): HTMLInputElement | null {
    return document.getElementById(INPUT_ID) as HTMLInputElement | null;
}

function errorElement(): HTMLElement | null {
    return document.getElementById(ERROR_ID);
}

/** Effective base shown by the field (an empty image still reports its map origin). */
function committedBase(): number {
    return S.parseResult?.baseAddress ?? 0;
}

function byteLength(): number {
    return S.parseResult?.totalDataBytes ?? 0;
}

/** Insert/refresh the field in the current profile bar; .bin only. */
function mountBinBaseField(): void {
    const bar = document.getElementById('profile-bar');
    if (!bar) { return; }
    if (!hostElement()) {
        bar.insertAdjacentHTML('beforeend', fieldHtml());
        wireEvents();
    }
    renderBinBaseField();
}

function fieldHtml(): string {
    return `<div id="${HOST_ID}" class="bin-base-field" hidden>
        <span class="tb-sep" aria-hidden="true"></span>
        <label class="profile-label" for="${INPUT_ID}">Base</label>
        <input id="${INPUT_ID}" class="base-input" type="text" spellcheck="false" autocomplete="off"
            aria-label="Raw binary base address">
        <span id="${ERROR_ID}" class="base-field-error" role="alert" hidden></span>
    </div>`;
}

/** Sync visibility, the committed value, and the disabled/tooltip state. */
function renderBinBaseField(): void {
    const host = hostElement();
    if (!host) { return; }
    const state = baseAddressFieldState(fieldState());
    host.hidden = !state.visible;
    if (!state.visible) { return; }
    syncFieldInput(state);
}

function syncFieldInput(state: BaseAddressFieldState): void {
    const input = inputElement();
    if (!input) { return; }
    input.disabled = state.disabled;
    input.title = state.tooltip ?? ENABLED_TITLE;
    // Never clobber text the user is typing; every other path re-syncs.
    if (document.activeElement === input) { return; }
    input.value = formatBinBaseAddress(committedBase());
    clearFieldError();
}

/** Refusal text when the field cannot take focus, else null after focusing + selecting. */
function focusBinBaseField(): string | null {
    renderBinBaseField();
    const refusal = baseAddressChangeRefusal(fieldState());
    if (refusal) { return refusal; }
    const input = inputElement();
    if (!input) { return null; }
    input.focus();
    input.select();
    return null;
}

function wireEvents(): void {
    const input = inputElement();
    if (!input) { return; }
    input.addEventListener('keydown', onFieldKeydown);
    input.addEventListener('blur', onFieldBlur);
    input.addEventListener('input', clearFieldError);
}

function onFieldKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
        event.preventDefault();
        commitField();
        return;
    }
    if (event.key === 'Escape') {
        event.preventDefault();
        revertField();
        inputElement()?.blur();
    }
}

/** Blur commits a valid value; invalid or empty text reverts to the committed base. */
function onFieldBlur(): void {
    const input = inputElement();
    if (!input) { return; }
    if (input.disabled) { return; }
    blurCommitOrRevert(input.value.trim());
}

function blurCommitOrRevert(text: string): void {
    if (!text) { revertField(); return; }
    if (parseBinBaseAddress(text, byteLength()).ok) { commitField(); return; }
    revertField();
}

function commitField(): void {
    const input = inputElement();
    if (!input) { return; }
    if (input.disabled) { return; }
    const text = input.value.trim();
    if (!text) { revertField(); return; }
    applyCommittedText(input, text);
}

function applyCommittedText(input: HTMLInputElement, text: string): void {
    const parsed = parseBinBaseAddress(text, byteLength());
    if (!parsed.ok) {
        showFieldError(parsed.error);
        return;
    }
    clearFieldError();
    input.value = formatBinBaseAddress(parsed.value);
    if (parsed.value !== committedBase()) {
        postMessage({ type: 'setBinBaseAddress', value: parsed.value });
    }
}

function revertField(): void {
    const input = inputElement();
    if (!input) { return; }
    input.value = formatBinBaseAddress(committedBase());
    clearFieldError();
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
    focus: focusBinBaseField,
};
