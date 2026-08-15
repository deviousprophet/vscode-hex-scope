// ── Toolbar component ──────────────────────────────────────────
// Self-contained `#toolbar` UI unit: owns the toolbar chrome markup
// (renderToolbarHtml / toHtml), the transient view/edit/ascii/dirty
// state, button wiring, and styles (Toolbar.css).
// The host owns all domain state (S) + view/edit/save/cancel logic.
// This module never imports the `S` global, never posts provider
// messages, and never runs edit logic — it reports every click via
// callbacks and receives state via host-invoked setters.

import './toolbar.css';

export type ToolbarView = 'memory' | 'record';

export interface ToolbarCallbacks {
    onViewChange?: (v: ToolbarView) => void;
    onAsciiToggle?: () => void;
    onEditStart?: () => void;
    onSave?: () => void;
    onCancel?: () => void;
}

export interface ToolbarRenderState {
    view: ToolbarView;
    ascii: boolean;
    editMode: boolean;
    dirtyCount: number;
}

function activeClass(active: boolean): string {
    return active ? 'active' : '';
}

function tabClass(view: ToolbarView, tab: ToolbarView): string {
    return view === tab ? 'active' : '';
}

function hiddenAttr(show: boolean): string {
    return show ? '' : ' style="display:none"';
}

function groupDisplay(show: boolean): string {
    return show ? '' : 'none';
}

function disabledAttr(disabled: boolean): string {
    return disabled ? ' disabled' : '';
}

function dirtyEditText(count: number): string {
    return count > 0 ? `${count} unsaved byte${count === 1 ? '' : 's'}` : '';
}

function setDisplay(id: string, visible: boolean): void {
    const el = document.getElementById(id);
    if (el) { el.style.display = visible ? '' : 'none'; }
}

function setActive(id: string, active: boolean): void {
    document.getElementById(id)?.classList.toggle('active', active);
}

/** Pure markup builder. SearchBar's `toHtml()` is injected as a slot. */
export function renderToolbarHtml(searchBarHtml: string, s: ToolbarRenderState): string {
    const mem = s.view === 'memory';
    return `
        <div id="toolbar">
            <div class="view-tabs">
                <button id="btn-mem" class="${tabClass(s.view, 'memory')}">Memory</button>
                <button id="btn-rec" class="${tabClass(s.view, 'record')}">Records</button>
            </div>
            <div class="tb-sep"></div>
            <button id="btn-ascii-toggle" class="${activeClass(mem && s.ascii)} tb-ascii-btn" type="button" title="Show or hide the decoded ASCII column"${hiddenAttr(mem)}>ASCII</button>
            <button id="btn-edit-mode" class="tb-edit-btn" title="Enter edit mode"${hiddenAttr(mem && !s.editMode)}>&#11041; Edit</button>
            <div id="edit-mode-group" style="display:${groupDisplay(mem && s.editMode)}">
                <span class="tb-editing-pill" title="Underlined bytes are edited">&#9679; EDITING</span>
                <span id="edit-dirty-count">${dirtyEditText(s.dirtyCount)}</span>
                <span id="edit-status" role="status"></span>
                <button id="btn-save" class="tb-save-btn" title="Save edits to file"${disabledAttr(s.dirtyCount === 0)}>&#128190; Save</button>
                <button id="btn-cancel" class="tb-cancel-btn" title="Discard all edits">&#10005; Cancel</button>
            </div>
            <span id="load-progress" class="tb-load-progress" role="status" hidden></span>
            ${searchBarHtml}
        </div>`;
}

export class Toolbar {
    private cb: ToolbarCallbacks;
    private view: ToolbarView = 'memory';
    private editMode = false;
    private ascii = false;
    private dirtyCount = 0;
    private mounted = false;

    private static readonly CLICK_ACTIONS: ReadonlyArray<readonly [string, (t: Toolbar) => void]> = [
        ['#btn-mem', t => t.cb.onViewChange?.('memory')],
        ['#btn-rec', t => t.cb.onViewChange?.('record')],
        ['#btn-ascii-toggle', t => t.cb.onAsciiToggle?.()],
        ['#btn-edit-mode', t => t.cb.onEditStart?.()],
        ['#btn-save', t => t.cb.onSave?.()],
        ['#btn-cancel', t => t.cb.onCancel?.()],
    ];

    constructor(cb: ToolbarCallbacks = {}) {
        this.cb = cb;
    }

    setCallbacks(cb: ToolbarCallbacks): void {
        this.cb = cb;
    }

    /** Regenerate full toolbar markup (SearchBar slot injected). */
    toHtml(searchBarHtml: string): string {
        return renderToolbarHtml(searchBarHtml, {
            view: this.view,
            ascii: this.ascii,
            editMode: this.editMode,
            dirtyCount: this.dirtyCount,
        });
    }

    /** Document-delegated click listeners. Idempotent. */
    mount(): void {
        if (this.mounted) { return; }
        this.mounted = true;
        document.addEventListener('click', e => this.onDocumentClick(e));
    }

    /** Active view tab + memory-only gating (ascii button, edit entry/edit group). */
    setView(v: ToolbarView): void {
        this.view = v;
        setActive('btn-mem', v === 'memory');
        setActive('btn-rec', v === 'record');
        this.applyMemoryGating();
    }

    /** Edit button hidden / EDITING group shown within memory view. */
    setEditMode(on: boolean): void {
        this.editMode = on;
        this.applyMemoryGating();
    }

    /** ASCII toggle active state (active only within memory view). */
    setAscii(on: boolean): void {
        this.ascii = on;
        setActive('btn-ascii-toggle', this.view === 'memory' && on);
    }

    /** Dirty count text + Save disabled (count === 0). */
    setDirty(count: number): void {
        this.dirtyCount = count;
        const span = document.getElementById('edit-dirty-count');
        if (span) { span.textContent = dirtyEditText(count); }
        const save = document.getElementById('btn-save') as HTMLButtonElement | null;
        if (save) { save.disabled = count === 0; }
    }

    /** Transient edit-mode status message (e.g. a truncated paste); auto-clears. */
    setStatus(message: string): void {
        const el = document.getElementById('edit-status');
        if (!el) { return; }
        el.textContent = message;
        el.classList.add('visible');
        if (this.statusTimer) { clearTimeout(this.statusTimer); }
        this.statusTimer = setTimeout(() => {
            this.statusTimer = null;
            el.classList.remove('visible');
        }, 3000);
    }

    private statusTimer: ReturnType<typeof setTimeout> | null = null;

    private applyMemoryGating(): void {
        const mem = this.view === 'memory';
        setDisplay('btn-ascii-toggle', mem);
        setActive('btn-ascii-toggle', mem && this.ascii);
        setDisplay('btn-edit-mode', mem && !this.editMode);
        setDisplay('edit-mode-group', mem && this.editMode);
    }

    private onDocumentClick(e: Event): void {
        const target = e.target as HTMLElement | null;
        if (!target || typeof target.closest !== 'function') { return; }
        const action = Toolbar.CLICK_ACTIONS.find(([selector]) => target.closest(selector) !== null);
        if (action) { action[1](this); }
    }
}