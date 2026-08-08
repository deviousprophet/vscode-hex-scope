// ── ExternalChange component ────────────────────────────────────
// Self-contained external-change banner unit: owns the three banner
// renderers (conflict/reload/error), their per-banner dismiss wiring,
// and styles (ExternalChange.css).
// The host owns reload/repair/view logic and lock-state transitions
// (src/webview/lock.ts); this module only renders banners into the
// host-provided `#app` and reports button actions via callbacks.
// This module never imports the `S` global and never posts provider
// messages.

import type { IncomingFile } from '../../appModel';
import { esc } from '../../utils';
import './externalChange.css';

/** Pure conflict-banner markup (byte-identical to pre-refactor). */
function renderConflictHtml(unsavedEditCount: number): string {
    return (
        `<span class="ecb-icon">&#9888;</span>` +
        `<span class="ecb-msg">File changed externally. You have <strong>${esc(String(unsavedEditCount))}</strong> unsaved edit${unsavedEditCount === 1 ? '' : 's'}. Changes must be reloaded.</span>` +
        `<button class="ecb-btn ecb-reload"  id="ecb-reload">Reload &amp; discard my edits</button>`
    );
}

/** Pure reload-banner markup (byte-identical to pre-refactor). */
function renderReloadHtml(): string {
    return (
        `<span class="erb-icon">&#128260;</span>` +
        `<span class="erb-msg">File changed externally. Reloading...</span>` +
        `<button class="erb-btn erb-reload"  id="erb-reload">Reload</button>`
    );
}

function formatCount(count: number, singular: string): string {
    return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

function formatExternalErrorText(checksumErrors: number, malformedLines: number): string {
    if (checksumErrors > 0 && malformedLines > 0) {
        return `${formatCount(checksumErrors, 'checksum error')} and ${formatCount(malformedLines, 'malformed line')}`;
    }

    return checksumErrors > 0
        ? formatCount(checksumErrors, 'checksum error')
        : formatCount(malformedLines, 'malformed line');
}

function createExternalErrorIcon(): HTMLSpanElement {
    const icon = document.createElement('span');
    icon.className = 'eeb-icon';
    icon.textContent = '\u274C';
    return icon;
}

function createExternalErrorMessage(checksumErrors: number, malformedLines: number): HTMLSpanElement {
    const msgSpan = document.createElement('span');
    msgSpan.className = 'eeb-msg';
    msgSpan.append('File changed externally and is now invalid: ');

    const strong = document.createElement('strong');
    strong.textContent = formatExternalErrorText(checksumErrors, malformedLines);
    msgSpan.append(strong);
    return msgSpan;
}

function createExternalErrorButton(id: string, className: string, text: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.id = id;
    button.className = className;
    button.textContent = text;
    return button;
}

function createExternalErrorAction(canQuickRepair: boolean): HTMLButtonElement {
    return canQuickRepair
        ? createExternalErrorButton('eeb-repair', 'eeb-btn eeb-repair', 'Quick Repair & reload')
        : createExternalErrorButton('eeb-view-text', 'eeb-btn eeb-view-text', 'View in text editor');
}

export class ExternalChange {
    /** Renders into host-provided #app; each show replaces its own kind first. */
    showConflict(incoming: IncomingFile, unsavedEditCount: number, onReload: (incoming: IncomingFile) => void): void {
        document.getElementById('ext-conflict-banner')?.remove();

        const banner = document.createElement('div');
        banner.id = 'ext-conflict-banner';
        banner.className = 'ext-conflict-banner';
        banner.innerHTML = renderConflictHtml(unsavedEditCount);

        document.getElementById('app')!.prepend(banner);

        document.getElementById('ecb-reload')!.addEventListener('click', () => {
            banner.remove();
            onReload(incoming);
        });
    }

    showReload(incoming: IncomingFile, onReload: (incoming: IncomingFile) => void): void {
        document.getElementById('ext-reload-banner')?.remove();

        const banner = document.createElement('div');
        banner.id = 'ext-reload-banner';
        banner.className = 'ext-reload-banner';
        banner.innerHTML = renderReloadHtml();

        document.getElementById('app')!.prepend(banner);

        document.getElementById('erb-reload')!.addEventListener('click', () => {
            banner.remove();
            onReload(incoming);
        });
    }

    showError(
        checksumErrors: number,
        malformedLines: number,
        canQuickRepair: boolean,
        onRepair: () => void,
        onViewText: () => void,
    ): void {
        document.getElementById('ext-error-banner')?.remove();

        const banner = document.createElement('div');
        banner.id = 'ext-error-banner';
        banner.className = 'ext-error-banner';

        banner.append(createExternalErrorIcon(), createExternalErrorMessage(checksumErrors, malformedLines));
        banner.append(createExternalErrorAction(canQuickRepair));
        document.getElementById('app')!.prepend(banner);
        // Parity: error actions are callback-only; the host reload flow removes
        // the banner (removeExternalChangeErrorBanner model update).
        document.getElementById('eeb-repair')?.addEventListener('click', onRepair);
        document.getElementById('eeb-view-text')?.addEventListener('click', onViewText);
    }

    /** Removes all three banner ids. */
    clearAll(): void {
        document.getElementById('ext-conflict-banner')?.remove();
        document.getElementById('ext-reload-banner')?.remove();
        document.getElementById('ext-error-banner')?.remove();
    }

    /** Removes only the error banner. */
    clearError(): void {
        document.getElementById('ext-error-banner')?.remove();
    }
}
