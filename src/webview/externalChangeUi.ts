import type { IncomingFile } from './appModel';

export function removeAllExternalChangeBanners(): void {
    document.getElementById('ext-conflict-banner')?.remove();
    document.getElementById('ext-reload-banner')?.remove();
    document.getElementById('ext-error-banner')?.remove();
}

export function showExternalChangeConflict(
    incoming: IncomingFile,
    unsavedEditCount: number,
    reloadDiscardingEdits: (incoming: IncomingFile) => void,
): void {
    document.getElementById('ext-conflict-banner')?.remove();

    const banner = document.createElement('div');
    banner.id = 'ext-conflict-banner';
    banner.className = 'ext-conflict-banner';
    banner.innerHTML =
        `<span class="ecb-icon">&#9888;</span>` +
        `<span class="ecb-msg">File changed externally. You have <strong>${unsavedEditCount}</strong> unsaved edit${unsavedEditCount === 1 ? '' : 's'}. Changes must be reloaded.</span>` +
        `<button class="ecb-btn ecb-reload"  id="ecb-reload">Reload &amp; discard my edits</button>`;

    document.getElementById('app')!.prepend(banner);

    document.getElementById('ecb-reload')!.addEventListener('click', () => {
        banner.remove();
        reloadDiscardingEdits(incoming);
    });
}

export function showExternalChangeReloadBanner(incoming: IncomingFile, reload: (incoming: IncomingFile) => void): void {
    document.getElementById('ext-reload-banner')?.remove();

    const banner = document.createElement('div');
    banner.id = 'ext-reload-banner';
    banner.className = 'ext-reload-banner';
    banner.innerHTML =
        `<span class="erb-icon">&#128260;</span>` +
        `<span class="erb-msg">File changed externally. Reloading...</span>` +
        `<button class="erb-btn erb-reload"  id="erb-reload">Reload</button>`;

    document.getElementById('app')!.prepend(banner);

    document.getElementById('erb-reload')!.addEventListener('click', () => {
        banner.remove();
        reload(incoming);
    });
}

export function updateExternalChangeLockState(locked: boolean): void {
    const app = document.getElementById('app');
    if (!app) { return; }

    if (locked) {
        app.classList.add('locked-due-to-external-change');
        disableAllInteractiveElements();
    } else {
        app.classList.remove('locked-due-to-external-change');
        enableAllInteractiveElements();
    }
}

function disableAllInteractiveElements(): void {
    forEachLockableRoot(root => {
        const elements = root.querySelectorAll('button, input, [role="button"]');
        elements.forEach(el => {
            const elem = el as HTMLElement;
            elem.setAttribute('data-was-enabled', 'true');
            if (elem instanceof HTMLButtonElement || elem instanceof HTMLInputElement) {
                elem.disabled = true;
            }
        });
    });
}

function enableAllInteractiveElements(): void {
    forEachLockableRoot(root => {
        const elements = root.querySelectorAll('[data-was-enabled="true"]');
        elements.forEach(el => {
            const elem = el as HTMLElement;
            elem.removeAttribute('data-was-enabled');
            if (elem instanceof HTMLButtonElement || elem instanceof HTMLInputElement) {
                elem.disabled = false;
            }
        });
    });
}

function forEachLockableRoot(callback: (root: HTMLElement) => void): void {
    for (const id of ['main-area', 'toolbar']) {
        const root = document.getElementById(id);
        if (root) { callback(root); }
    }
}

export function showExternalChangeError(
    checksumErrors: number,
    malformedLines: number,
    canQuickRepair: boolean,
    repairAndReload: () => void,
    viewInNormalEditor: () => void,
): void {
    document.getElementById('ext-error-banner')?.remove();

    const banner = document.createElement('div');
    banner.id = 'ext-error-banner';
    banner.className = 'ext-error-banner';

    banner.append(createExternalErrorIcon(), createExternalErrorMessage(checksumErrors, malformedLines));
    banner.append(createExternalErrorAction(canQuickRepair));
    document.getElementById('app')!.prepend(banner);
    wireExternalErrorActions(repairAndReload, viewInNormalEditor);
}

function formatExternalErrorText(checksumErrors: number, malformedLines: number): string {
    if (checksumErrors > 0 && malformedLines > 0) {
        return `${formatCount(checksumErrors, 'checksum error')} and ${formatCount(malformedLines, 'malformed line')}`;
    }

    return checksumErrors > 0
        ? formatCount(checksumErrors, 'checksum error')
        : formatCount(malformedLines, 'malformed line');
}

function formatCount(count: number, singular: string): string {
    return `${count} ${singular}${count === 1 ? '' : 's'}`;
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

function createExternalErrorAction(canQuickRepair: boolean): HTMLButtonElement {
    return canQuickRepair
        ? createExternalErrorButton('eeb-repair', 'eeb-btn eeb-repair', 'Quick Repair & reload')
        : createExternalErrorButton('eeb-view-text', 'eeb-btn eeb-view-text', 'View in text editor');
}

function createExternalErrorButton(id: string, className: string, text: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.id = id;
    button.className = className;
    button.textContent = text;
    return button;
}

function wireExternalErrorActions(repairAndReload: () => void, viewInNormalEditor: () => void): void {
    document.getElementById('eeb-repair')?.addEventListener('click', repairAndReload);
    document.getElementById('eeb-view-text')?.addEventListener('click', viewInNormalEditor);
}
