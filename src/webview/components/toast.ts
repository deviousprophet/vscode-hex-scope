/* ── Webview toast: transient point-of-interaction confirmation ──
   Generic: the message is a REQUIRED param (no default). Copy call sites pass
   "Copied ✓"; the component itself owns no copy vocabulary.
   Lifecycle: fade-in ~150ms, hold ~1s, fade-out ~250ms. Rapid calls replace
   the current toast (single live element, timer reset). prefers-reduced-motion
   → instant show/hide. role=status + aria-live=polite. */

import './toast.css';

const TOAST_IN_MS = 150;
const TOAST_HOLD_MS = 1000;
const TOAST_OUT_MS = 250;
const EDGE = 8;

export interface ToastOptions {
    x?: number;
    y?: number;
}

let toastEl: HTMLElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

/** Show a transient toast. Positioned near (x, y) when given, clamped to the
    webview viewport; falls back to top-center otherwise. */
export function showToast(message: string, opts: ToastOptions = {}): void {
    if (!toastEl || !toastEl.isConnected) { toastEl = createToast(); }
    toastEl.textContent = message;
    positionToast(toastEl, opts.x, opts.y);
    if (hideTimer !== null) { clearTimeout(hideTimer); }
    void toastEl.offsetHeight; // restart the fade-in transition
    toastEl.classList.add('sb-toast-visible');
    hideTimer = setTimeout(() => hideToast(), TOAST_IN_MS + TOAST_HOLD_MS);
}

function createToast(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'sb-toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.hidden = true;
    document.body.appendChild(el);
    return el;
}

function positionToast(el: HTMLElement, x?: number, y?: number): void {
    if (!hasUsableCoords(x, y)) {
        el.classList.add('sb-toast--top-center');
        el.classList.remove('sb-toast--near');
        el.hidden = false;
        return;
    }
    el.classList.remove('sb-toast--top-center');
    el.classList.add('sb-toast--near');
    el.hidden = false;
    // Measure after unhiding so clamps use real dimensions.
    const w = el.offsetWidth || 120;
    const h = el.offsetHeight || 24;
    el.style.left = `${clampWithin(EDGE, x!, window.innerWidth - w - EDGE)}px`;
    el.style.top = `${clampWithin(EDGE, y!, window.innerHeight - h - EDGE)}px`;
}

function hasUsableCoords(x?: number, y?: number): boolean {
    return typeof x === 'number' && typeof y === 'number' && isFinite(x) && isFinite(y);
}

function clampWithin(min: number, value: number, max: number): number {
    return Math.min(Math.max(min, value), Math.max(min, max));
}

function hideToast(): void {
    if (!toastEl) { return; }
    hideTimer = null;
    try {
        if (motionReduced()) {
            toastEl.hidden = true;
            toastEl.classList.remove('sb-toast-visible');
            return;
        }
        toastEl.classList.remove('sb-toast-visible');
        hideTimer = setTimeout(() => clearToastElement(), TOAST_OUT_MS);
    } catch { }
}

function clearToastElement(): void {
    if (toastEl) {
        try {
            toastEl.hidden = true;
            toastEl.classList.remove('sb-toast--near', 'sb-toast--top-center');
            toastEl.style.left = '';
            toastEl.style.top = '';
        } catch { }
    }
    hideTimer = null;
}

function motionReduced(): boolean {
    return typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}