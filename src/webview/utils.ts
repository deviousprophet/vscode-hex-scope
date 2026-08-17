// ── Pure utility functions ────────────────────────────────────

export function esc(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function fmtB(b: number): string {
    if (b < 1024)        { return `${b} B`; }
    if (b < 1_048_576)   { return `${(b / 1024).toFixed(1)} KB`; }
    return `${(b / 1_048_576).toFixed(1)} MB`;
}

export function positionContextMenu(el: HTMLElement, x: number, y: number): void {
    el.style.display = 'block';
    const mw = el.offsetWidth || 220;
    const mh = el.offsetHeight || 120;
    el.style.left = `${Math.min(x, window.innerWidth - mw - 8)}px`;
    el.style.top = `${Math.min(y, window.innerHeight - mh - 8)}px`;
}

export function wireHoverSubmenus(menuEl: HTMLElement, keepOpenWhenFocused = false): void {
    let closeTimer: ReturnType<typeof setTimeout> | null = null;
    let activeSub: HTMLElement | null = null;

    const clearCloseTimer = () => {
        if (!closeTimer) { return; }
        clearTimeout(closeTimer);
        closeTimer = null;
    };

    const hidePreviousSub = (sub: HTMLElement) => {
        if (!activeSub || activeSub === sub) { return; }
        activeSub.style.display = 'none';
    };

    const shouldOpenLeft = (sub: HTMLElement, row: HTMLElement): boolean => {
        const rr = row.getBoundingClientRect();
        const sw = sub.offsetWidth || 220;
        return rr.right + sw > window.innerWidth - 8;
    };

    const openSub = (sub: HTMLElement, row: HTMLElement) => {
        clearCloseTimer();
        hidePreviousSub(sub);
        activeSub = sub;
        sub.style.display = 'block';
        if (shouldOpenLeft(sub, row)) {
            sub.style.left = 'auto'; sub.style.right = '100%';
        } else {
            sub.style.left = '100%'; sub.style.right = 'auto';
        }
    };

    const scheduledClose = (sub: HTMLElement) => {
        closeTimer = setTimeout(() => {
            if (keepOpenWhenFocused && sub.contains(document.activeElement)) { return; }
            sub.style.display = 'none';
            if (activeSub === sub) { activeSub = null; }
        }, 100);
    };

    menuEl.querySelectorAll<HTMLElement>('.ctx-has-sub').forEach(row => {
        const sub = row.querySelector<HTMLElement>('.ctx-submenu');
        if (!sub) { return; }
        row.addEventListener('mouseenter', () => openSub(sub, row));
        row.addEventListener('mouseleave', e => {
            if (!sub.contains(e.relatedTarget as Node)) { scheduledClose(sub); }
        });
        sub.addEventListener('mouseenter', clearCloseTimer);
        sub.addEventListener('mouseleave', e => {
            if (!row.contains(e.relatedTarget as Node)) { scheduledClose(sub); }
        });
    });
}

/** Index of the first element >= value in a sorted array (binary search). */
export function lowerBound(sorted: readonly number[], value: number): number {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sorted[mid] < value) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    return lo;
}

/** CSS class for a hex byte cell based on its value. */
function isPrintableByte(v: number): boolean {
    return v >= 0x20 && v < 0x7F;
}

export function byteClass(v: number): string {
    if (v === 0)              { return 'bz'; }  // zero  → dim
    if (isPrintableByte(v))   { return 'bp'; }  // print → warm
    if (v >= 0x80)            { return 'bh'; }  // high  → cool
    return 'bn';                                 // control → default
}

/**
 * Returns HTML for a paired edit + delete action button group.
 * Both buttons use the shared `.act-btn` class.
 *
 * @param editData   - data-* attributes for the edit button, e.g. `data-id="foo"`
 * @param deleteData - data-* attributes for the delete button
 */
export function actionBtnsHtml(editData: string, deleteData: string): string {
    return (
        `<button type="button" class="act-btn act-btn-edit" ${editData} title="Edit" aria-label="Edit">&#9998;</button>` +
        `<button type="button" class="act-btn act-btn-del"  ${deleteData} title="Delete" aria-label="Delete">&#128465;&#xFE0E;</button>`
    );
}

/**
 * Wires edit and delete buttons produced by actionBtnsHtml inside `container`.
 * Edit buttons are selected by `.act-btn-edit[data-key="${key}"]`,
 * delete buttons by `.act-btn-del[data-key="${key}"]`.
 * The delete button uses inlineConfirm before calling onDelete.
 */
export function wireActionBtns(
    container: HTMLElement,
    editSelector:   string,
    deleteSelector: string,
    onEdit:   (el: HTMLElement) => void,
    onDelete: (el: HTMLElement) => void,
): void {
    container.querySelectorAll<HTMLElement>(editSelector).forEach(el => {
        el.addEventListener('click', e => { e.stopPropagation(); onEdit(el); });
    });
    container.querySelectorAll<HTMLElement>(deleteSelector).forEach(el => {
        el.addEventListener('click', e => {
            e.stopPropagation();
            inlineConfirm(el, () => onDelete(el));
        });
    });
}

/**
 * Show a small "Delete?" popover anchored above `anchor`.
 * Clicking Yes calls `onConfirm`; clicking No or outside dismisses it.
 * Only one popover is live at a time. `message` overrides the default "Delete?".
 */
export function inlineConfirm(anchor: HTMLElement, onConfirm: () => void, message = 'Delete?'): void {
    // Remove any existing popover first
    dismissConfirmPopover();

    const pop = document.createElement('div');
    pop.id = 'del-confirm-pop';
    pop.className = 'del-confirm-pop';
    pop.innerHTML =
        `<span class="dcp-msg">${esc(message)}</span>` +
        '<button class="dcp-yes">Yes</button>' +
        '<button class="dcp-no">No</button>';

    document.body.appendChild(pop);

    // Position above the anchor
    const r = anchor.getBoundingClientRect();
    pop.style.position = 'fixed';
    // Initially offscreen so we can measure size, then reposition
    pop.style.visibility = 'hidden';
    pop.style.left = '0';
    pop.style.top  = '0';

    // After paint, measure and place
    requestAnimationFrame(() => {
        const pw = pop.offsetWidth;
        const ph = pop.offsetHeight;
        const gap = 6;
        let left = r.left + r.width / 2 - pw / 2;
        let top  = r.top - ph - gap;

        // Keep within viewport horizontally
        left = Math.max(4, Math.min(left, window.innerWidth - pw - 4));
        // If no room above, flip below
        if (top < 4) { top = r.bottom + gap; }

        pop.style.left = `${left}px`;
        pop.style.top  = `${top}px`;
        pop.style.visibility = '';
    });

    const cleanup = (confirmed: boolean) => {
        pop.remove();
        document.removeEventListener('mousedown', outsideHandler, true);
        document.removeEventListener('keydown',   keyHandler,     true);
        if (confirmed) { onConfirm(); }
    };

    pop.querySelector<HTMLElement>('.dcp-yes')!.addEventListener('click', e => {
        e.stopPropagation(); cleanup(true);
    });
    pop.querySelector<HTMLElement>('.dcp-no')!.addEventListener('click', e => {
        e.stopPropagation(); cleanup(false);
    });

    const outsideHandler = (e: MouseEvent) => {
        if (!pop.contains(e.target as Node)) { cleanup(false); }
    };
    const keyHandler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') { cleanup(false); }
    };

    // Delay adding outside-click so the originating click doesn't immediately close it
    setTimeout(() => {
        document.addEventListener('mousedown', outsideHandler, true);
        document.addEventListener('keydown',   keyHandler,     true);
    }, 0);
}

function dismissConfirmPopover(): void {
    document.getElementById('del-confirm-pop')?.remove();
}

// ── BigInt / hex formatting helpers (shared) ─────────────────────
/**
 * Format a numeric value as a decimal string. Preserves full precision for BigInt.
 */
export function formatDecimal(v: number | bigint): string {
    if (typeof v === 'bigint') { return v.toString(10); }
    if (Number.isFinite(v)) { return (v as number).toLocaleString('en'); }
    return String(v);
}

/**
 * Format a numeric value as a hex string prefixed with `0x`.
 * `pad` is the minimum number of hex digits (excluding `0x`).
 */
export function formatHex(v: number | bigint, pad: number): string {
    if (typeof v === 'bigint') {
        return `0x${(v as bigint).toString(16).toUpperCase().padStart(pad, '0')}`;
    }
    // Force unsigned 32-bit representation for numbers
    const u = (v as number) >>> 0;
    return `0x${u.toString(16).toUpperCase().padStart(pad, '0')}`;
}

/**
 * Convert a hex string like `0xDEADBEEF` into HTML with separate prefix/body
 * spans used by the UI to style the `0x` differently from the digits.
 */
export function formatHexHtml(hexStr: string): string {
    if (!hexStr) { return ''; }
    const prefix = esc(hexStr.slice(0, 2));
    const body = esc(hexStr.slice(2));
    return `<span class="si-hex-prefix">${prefix}</span><span class="si-hex-body">${body}</span>`;
}

/**
 * Flash a "copied" confirmation on a copy target: adds `.copied` for ~1s
 * (styled per target via CSS) and optionally swaps the element's text to
 * "Copied" until the flash ends. Pure DOM/CSS feedback — clipboard writes
 * are untouched and stay with the existing copy callbacks.
 */
export function flashCopied(el: HTMLElement, swapText = false): void {
    el.classList.add('copied');
    const prev = swapText ? el.textContent : null;
    if (swapText) { el.textContent = 'Copied'; }
    window.setTimeout(() => {
        el.classList.remove('copied');
        if (prev !== null) { el.textContent = prev; }
    }, 1000);
}

/** Direct wrappers around DataView BigInt reads (centralized for future fallbacks). */
export function getBigUint64(dv: DataView, offset: number, littleEndian: boolean): bigint {
    return dv.getBigUint64(offset, littleEndian);
}

export function getBigInt64(dv: DataView, offset: number, littleEndian: boolean): bigint {
    return dv.getBigInt64(offset, littleEndian);
}

/** Cast a signed BigInt to its unsigned 64-bit representation. */
export function asUint64(v: bigint): bigint {
    return BigInt.asUintN(64, v);
}
