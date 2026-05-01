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

/** CSS class for a hex byte cell based on its value. */
export function byteClass(v: number): string {
    if (v === 0)              { return 'bz'; }  // zero  → dim
    if (v >= 0x20 && v < 0x7F){ return 'bp'; }  // print → warm
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
        `<span class="act-btn act-btn-edit" ${editData} title="Edit">&#9998;</span>` +
        `<span class="act-btn act-btn-del"  ${deleteData} title="Delete">&#128465;&#xFE0E;</span>`
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
 * Only one popover is live at a time.
 */
export function inlineConfirm(anchor: HTMLElement, onConfirm: () => void): void {
    // Remove any existing popover first
    dismissConfirmPopover();

    const pop = document.createElement('div');
    pop.id = 'del-confirm-pop';
    pop.className = 'del-confirm-pop';
    pop.innerHTML =
        '<span class="dcp-msg">Delete?</span>' +
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
