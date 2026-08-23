// ── MenuController component ────────────────────────────────────
// Headless shared menu controller: owns the single #menu container,
// positioning, dismissal (click-outside/focusout/window-blur/Escape),
// hover-submenus, input modality, and full keyboard navigation for
// every popover menu in the webview (hex grid, struct field menu,
// integrity ⋮ menu). The controller never renders content: callers
// supply innerHTML per show (hex/struct) or attach a pre-authored
// static popover (integrity). The host owns all command execution —
// this module never imports the `S` global and never posts provider
// messages; it reports commands via per-show `emit` callbacks.
//
// The `menu-*` class lexicon is the single shared vocabulary; the
// integrity profile menu uses its own `integrity-profile-menu-*`
// classes and is wired by id elsewhere (not renamed).
//
// One active menu: opening a menu closes any other (registry
// semantics). A module-level singleton owns one set of per-document
// listeners; re-mounts never stack handlers.

import './menu.css';

import { positionMenu, wireMenuSubmenus } from '../../utils';
import { wireFillInputs } from './menuFill';
import * as nav from './menuNav';

/** Default focus target on open: first enabled command row (skips headers/separators/disabled). */
const DEFAULT_FOCUS_FIRST = '.menu-item[data-cmd]:not(.menu-disabled)';

interface MenuShowOpts {
    /** Caller-rendered HTML for dynamic menus (hex, struct). Omit for static popovers. */
    innerHTML?: string;
    /** Pre-open activeElement snapshot, restored on close (skipped on window blur). */
    restore?: 'snapshot';
    /** aria-expanded anchor for button-popovers. */
    anchor?: HTMLElement;
    /** Focus selector for the first item on open, e.g. '.menu-item:not(.menu-disabled)'. */
    focusFirst?: string;
    /** Called with the command when a [data-cmd] item is activated (click or Enter/Space). */
    emit?: (cmd: string) => void;
    /** Called every time this menu closes (any reason). */
    onClose?: () => void;
}

interface MenuEntry {
    emit?: (cmd: string) => void;
    onClose?: () => void;
    anchor?: HTMLElement;
/** Static popover: visibility is the `hidden` attribute (its CSS anchors it), no JS positioning. */
    attached: boolean;
} 

// ── Interaction controller ───────────────────────────────────────

/** Element that can take focus right now, or null (duck-typed; no bare `HTMLElement/Element` global in jsdom). */
function focusableActiveElement(): HTMLElement | null {
    const act = document.activeElement;
    return (act && typeof (act as { focus?: () => void }).focus === 'function') ? act as HTMLElement : null;
}

function firstDefined<T>(a: T | undefined, b: T | undefined): T | undefined {
    return a ?? b;
}

/** Merge per-show/attach opts over the prior registry entry (last non-undefined wins). */
function mergeEntry(prior: MenuEntry | undefined, opts: MenuShowOpts, attached: boolean): MenuEntry {
    return {
        emit: firstDefined(opts.emit, prior?.emit),
        onClose: firstDefined(opts.onClose, prior?.onClose),
        anchor: firstDefined(opts.anchor, prior?.anchor),
        attached,
    };
}

class MenuController {
    /** The one dynamic-menu container (#menu), created lazily on first show and reused. */
    private container: HTMLElement | null = null;
    /** Registered menus: the #menu container's per-show opts + attached static popovers. */
    private readonly registry = new Map<HTMLElement, MenuEntry>();
    /** The single open menu right now, or null. */
    private activeEl: HTMLElement | null = null;
    /** Element focused before the menu opened; restored on close (skipped on window blur). */
    private restoreEl: HTMLElement | null = null;
    /** Last input modality; mouse-opens hide the keyboard-selection highlight until first keypress. */
    private inputMode: 'mouse' | 'keyboard' = 'mouse';
    /** Per-document listener sets; re-mounts never stack (WeakSet dedup). */
    private readonly clickDocs = new WeakSet<Document>();
    private readonly focusDocs = new WeakSet<Document>();
    private readonly blurDocs = new WeakSet<Document>();
    private readonly keyDocs = new WeakSet<Document>();
    private readonly pointerDocs = new WeakSet<Document>();

    /** Attach a pre-authored static popover (integrity ⋮ menu). Registers only; show() displays it. */
    attach(el: HTMLElement, opts: Pick<MenuShowOpts, 'emit' | 'onClose'> = {}): void {
        this.registry.set(el, mergeEntry(this.registry.get(el), opts, true));
    }

    /** Unregister a static popover; closes it if it is the active menu. */
    detach(el: HTMLElement): void {
        this.registry.delete(el);
        if (this.activeEl === el) { this.closeCurrent({ restore: false }); }
    }

    /** Open a menu: the internal #menu container by default, or an attached el. */
    show(x: number, y: number, opts: MenuShowOpts & { el?: HTMLElement } = {}): void {
        const el = opts.el ?? this.ensureContainer();
        if (!el) { return; }
        // One active menu: opening one closes any other (without focus restore —
        // this show() captures the fresh snapshot below).
        this.closeActiveIfDifferent(el);
        this.registry.set(el, mergeEntry(this.registry.get(el), opts, !!opts.el));
if (opts.innerHTML !== undefined) {
            const innerHtml = opts.innerHTML;
            el.innerHTML = innerHtml;
            wireFillInputs(el, cmd => this.runMenuCommand(cmd), () => this.hide());
        }
        wireMenuSubmenus(el, true);
        this.revealMenu(el, opts, x, y);
        // Snapshot the pre-open focus BEFORE moving focus into the menu.
        this.restoreEl = focusableActiveElement();
        this.activeEl = el;
        this.finalizeShow(el, opts);
    }

    private closeActiveIfDifferent(el: HTMLElement): void {
        if (!this.activeEl || this.activeEl === el) { return; }
        this.closeCurrent({ restore: false });
    }

    private revealMenu(el: HTMLElement, opts: MenuShowOpts & { el?: HTMLElement }, x: number, y: number): void {
        if (opts.el) { el.hidden = false; } else { positionMenu(el, x, y); }
        el.classList.toggle('menu-kb', this.inputMode === 'keyboard');
    }

    private finalizeShow(el: HTMLElement, opts: MenuShowOpts): void {
        opts.anchor?.setAttribute('aria-expanded', 'true');
        this.ensureDocListeners(el.ownerDocument ?? document);
        el.querySelector<HTMLElement>(opts.focusFirst ?? DEFAULT_FOCUS_FIRST)?.focus();
    }

    /** Close the active menu (any reason) and restore focus to the pre-open snapshot. */
    hide(): void {
        this.closeCurrent();
    }

    /** Close a specific attached/active menu; no-op when it is not the active one. */
    close(el: HTMLElement): void {
        if (this.activeEl !== el) { return; }
        this.closeCurrent();
    }

    /** The active menu element, or null. */
    openMenu(): HTMLElement | null {
        return this.activeEl;
    }

    /** The emit callback registered for a menu element, if any. */
    emitFor(el: HTMLElement): ((cmd: string) => void) | undefined {
        return this.registry.get(el)?.emit;
    }

    // ── Closing ──────────────────────────────────────────────────

    private closeCurrent(opts: { restore?: boolean } = {}): void {
        const restore = opts.restore ?? true;
        const el = this.activeEl;
        const entry = this.activeEntry();
        // Close BEFORE restoring focus: the restore itself moves focus and must
        // not re-trigger focusout dismissal (WIP ordering bug fix).
        this.activeEl = null;
        if (el) { this.closeElement(el, entry); }
        if (restore) { this.restoreSnapshotFocus(); } else { this.restoreEl = null; }
        this.notifyClosed(entry);
    }

    private activeEntry(): MenuEntry | undefined {
        return this.activeEl ? this.registry.get(this.activeEl) : undefined;
    }

    private closeElement(el: HTMLElement, entry: MenuEntry | undefined): void {
        if (entry?.attached) { el.hidden = true; } else { el.style.display = 'none'; this.closeSubmenus(el); }
        entry?.anchor?.setAttribute('aria-expanded', 'false');
    }

    private notifyClosed(entry: MenuEntry | undefined): void {
        entry?.onClose?.();
    }

    private restoreSnapshotFocus(): void {
        const restore = this.restoreEl;
        this.restoreEl = null;
        if (!restore || !restore.isConnected || restore === document.activeElement) { return; }
        restore.focus();
    }

    private closeSubmenus(root: HTMLElement): void {
        root.querySelectorAll<HTMLElement>('.menu-submenu').forEach(sub => { sub.style.display = 'none'; });
    }

    // ── Per-document listeners (once per document) ───────────────

    private ensureDocListeners(doc: Document): void {
        this.addDocListener(this.clickDocs, doc, 'click', this.onDocClick);
        this.addDocListener(this.focusDocs, doc, 'focusout', this.onDocFocusOut as unknown as (e: Event) => void);
        this.addDocListener(this.pointerDocs, doc, 'pointerdown', this.onCapturedPointerDown, true);
        this.addDocListener(this.keyDocs, doc, 'keydown', this.onCapturedKeydown, true);
        this.ensureWindowBlur(doc);
    }

    private addDocListener(docs: WeakSet<Document>, doc: Document, type: string, fn: (e: Event) => void, capture = false): void {
        if (!docs.has(doc)) { docs.add(doc); doc.addEventListener(type, fn as EventListener, { capture }); }
    }

    private ensureWindowBlur(doc: Document): void {
        const win = doc.defaultView;
        if (win && !this.blurDocs.has(doc)) { this.blurDocs.add(doc); win.addEventListener('blur', this.onWindowBlur); }
    }

    private ensureContainer(): HTMLElement | null {
        if (this.container && this.container.isConnected) { return this.container; }
        const el = document.createElement('div');
        el.id = 'menu';
        el.className = 'menu';
        el.setAttribute('role', 'menu');
        el.style.display = 'none';
        document.body.appendChild(el);
        this.container = el;
        return el;
    }

    // ── Dismissal ────────────────────────────────────────────────

    /** Document-delegated click: outside → close; inside command row → emit + close. */
    private onDocClick = (e: Event): void => {
        const menu = this.activeEl;
        if (!menu) { return; }
        if (this.expunged(menu)) { return; }
        if (!this.clickInside(menu, e.target)) { this.closeCurrent(); }
    };

    private clickInside(menu: HTMLElement, t: EventTarget | null): boolean {
        const target = this.entryPoint(t);
        if (!target) { return false; }
        if (!menu.contains(target)) { return false; }
        this.activateClickedRow(menu, target);
        return true;
    }

    private expunged(menu: HTMLElement): boolean {
        if (!menu.isConnected) { this.registry.delete(menu); this.closeCurrent({ restore: false }); return true; }
        return false;
    }

    private activateClickedRow(menu: HTMLElement, target: HTMLElement): void {
        const row = target.closest<HTMLElement>('.menu-item[data-cmd]');
        if (!row || row.classList.contains('menu-disabled')) { return; }
        this.registry.get(menu)?.emit?.(row.dataset.cmd!);
        this.closeCurrent();
    }

    /** Focus moved out of the open menu (Tab, focusable click) or nowhere → close. Moves inside preserve it. */
    private onDocFocusOut = (e: FocusEvent): void => {
        const menu = this.activeEl;
        if (!menu) { return; }
        const next = e.relatedTarget as Node | null;
        if (next === null || !menu.contains(next)) { this.closeCurrent(); }
    };

    /** Webview lost window focus entirely (VS Code chrome, another editor, alt-tab) → close, no restore. */
    private onWindowBlur = (): void => {
        this.closeCurrent({ restore: false });
    };

    // ── Input modality ───────────────────────────────────────────

    /** Mouse interaction: hide the keyboard-selection highlight until the user actually uses keys. */
    private onCapturedPointerDown = (): void => {
        this.inputMode = 'mouse';
        this.applyKbHighlight(false);
    };

    private applyKbHighlight(on: boolean): void {
        this.activeEl?.classList.toggle('menu-kb', on);
    }

    // ── Keyboard model (capture-phase interception) ──────────────

    /** Capture-phase: nav/Escape keys are consumed (preventDefault + stopPropagation) so
     *  host grid/undo/edit/save handlers never see them while a menu is open. */
    private onCapturedKeydown = (e: Event): void => {
        this.inputMode = 'keyboard';
        this.applyKbHighlight(true);
        if (this.expungedOrNone()) { return; }
        const ke = e as KeyboardEvent;
        if (this.handleMenuKeydown(ke)) { ke.preventDefault(); ke.stopPropagation(); }
    };

    private expungedOrNone(): boolean {
        const menu = this.activeEl;
        if (!menu) { return true; }
        if (!menu.isConnected) { this.registry.delete(menu); this.closeCurrent({ restore: false }); return true; }
        return false;
    }

    private handleMenuKeydown(e: KeyboardEvent): boolean {
        if (this.handleMenuEscape(e)) { return true; }
        if (this.handleMenuNavigationKey(e)) { return true; }
        return this.handleMenuActivationKey(e);
    }

    private handleMenuEscape(e: KeyboardEvent): boolean {
        if (e.key !== 'Escape') { return false; }
        // Two-step: Escape closes the open submenu first, then the whole menu.
        const sub = nav.openSubmenuFromFocus();
        if (sub) { nav.closeSubmenu(sub); return true; }
        this.closeCurrent();
        return true;
    }

    private handleMenuNavigationKey(e: KeyboardEvent): boolean {
        if (nav.isFlankKey(e)) { return this.handleArrowFlank(e.key === 'ArrowRight'); }
        if (nav.isHomeEndKey(e)) { return this.handleHomeEnd(e.key); }
        const dir = nav.verticalArrowDir(e.key);
        if (dir === 0) { return false; }
        nav.focusAdjacentRow(nav.scopedNavigationRows(this.activeEl), dir);
        return true;
    }

    /** Shared Right/Left arrow handling: consumed only when the controller acts on the key. */
    private handleArrowFlank(right: boolean): boolean {
        return right ? this.handleArrowRight() : this.handleArrowLeft();
    }

    /** ArrowRight on a .menu-has-sub row opens its submenu and focuses the first enabled item. */
    private handleArrowRight(): boolean {
        const row = nav.activeMenuRow();
        if (!row?.hasAttribute('data-sub')) { return false; }
        nav.openSubmenuRow(row);
        return true;
    }

    /** ArrowLeft from inside an open submenu closes it and returns focus to the parent row. */
    private handleArrowLeft(): boolean {
        const sub = nav.openSubmenuFromFocus();
        if (!sub) { return false; }
        nav.closeSubmenu(sub);
        return true;
    }

    /** Home/End jump to the first/last enabled item in the active scope. */
    private handleHomeEnd(key: string): boolean {
        const rows = nav.scopedNavigationRows(this.activeEl);
        if (rows.length === 0) { return true; }
        rows[key === 'Home' ? 0 : rows.length - 1].focus();
        return true;
    }

    /** Enter/Space: data-cmd rows emit; real buttons (no data-cmd) are left to native activation. */
    private handleMenuActivationKey(e: KeyboardEvent): boolean {
        if (!nav.isActivationKey(e)) { return false; }
        // Keys typed into an inline input (custom fill) stay native: the input's
        // own handler applies the fill; the controller must not steal them.
        if (nav.isInlineInputTarget(e)) { return false; }
        const row = nav.activeMenuRow();
        if (!row) { return false; }
        return this.activateRow(row);
    }

    private activateRow(row: HTMLElement): boolean {
        if (row.classList.contains('menu-disabled')) { return true; }
        if (row.hasAttribute('data-sub')) { nav.openSubmenuRow(row); return true; }
        if (!row.dataset.cmd) { return false; }
        this.runRowCommand(row);
        return true;
    }

    private runRowCommand(row: HTMLElement): void {
        this.runMenuCommand(row.dataset.cmd!);
    }

    private runMenuCommand(cmd: string): void {
        const menu = this.activeEl;
        if (!menu) { return; }
        this.registry.get(menu)?.emit?.(cmd);
        this.closeCurrent();
    }

    // ── Custom fill inline input (hex menu) ──────────────────────

    // ── Misc helpers ─────────────────────────────────────────────

    private entryPoint(target: EventTarget | null): HTMLElement | null {
        const el = target as HTMLElement | null;
        return el && typeof el.closest === 'function' ? el : null;
    }
}

/** Module singleton: one controller owns all menus + one set of per-document listeners. */
export const menuController = new MenuController();