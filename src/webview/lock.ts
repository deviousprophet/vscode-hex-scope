// ── Host lock-state util ─────────────────────────────────────────
// App-wide external-change lock: disables/enables interactive
// elements in the lockable roots (#main-area, #toolbar) and toggles
// the `locked-due-to-external-change` class on `#app`.
// Host (`hexViewer.ts`) owns the lock-state transitions and calls
// `updateExternalChangeLockState` on invalidation.

function disableAllInteractiveElements(): void {
    forEachLockableRoot(root => {
        const elements = root.querySelectorAll('button, input, [role="button"]');
        elements.forEach(el => {
            const elem = el as HTMLElement;
            // Snapshot the element's own prior enabled state so unlock can restore it exactly
            // (buttons already disabled for state reasons must stay disabled).
            const wasEnabled = elem instanceof HTMLButtonElement || elem instanceof HTMLInputElement
                ? String(!elem.disabled)
                : 'true';
            elem.setAttribute('data-was-enabled', wasEnabled);
            if (elem instanceof HTMLButtonElement || elem instanceof HTMLInputElement) {
                elem.disabled = true;
            }
        });
    });
}

function enableAllInteractiveElements(): void {
    forEachLockableRoot(root => {
        const elements = root.querySelectorAll('[data-was-enabled]');
        elements.forEach(el => {
            const elem = el as HTMLElement;
            const wasEnabled = elem.getAttribute('data-was-enabled');
            elem.removeAttribute('data-was-enabled');
            if (elem instanceof HTMLButtonElement || elem instanceof HTMLInputElement) {
                elem.disabled = wasEnabled !== 'true';
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
