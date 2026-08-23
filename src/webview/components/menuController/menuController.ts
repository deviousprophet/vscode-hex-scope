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

import { formatAnalyzeCommand } from '../../../core/byteTools/analysis';
import { formatCopyCommand } from '../../../core/byteTools/copy';
import { formatAsciiByte, formatHexArrayByte, hexByte } from '../../../core/byteTools/hex';
import { fillCommand } from '../../contextCommands';
import { esc, positionMenu, wireMenuSubmenus } from '../../utils';

const MENU_SEP = `<div class="menu-sep" role="separator"></div>`;

/** Default focus target on open: first enabled command row (skips headers/separators/disabled). */
const DEFAULT_FOCUS_FIRST = '.menu-item[data-cmd]:not(.menu-disabled)';

/** Rows the keyboard navigates: shared `menu-item` rows plus any `role="menuitem"` (integrity buttons). */
const ITEM_SELECTOR = '.menu-item, [role="menuitem"]';

export interface MenuState {
    selectionActive: boolean;
    len: number;
    bytes: number[];
    editMode: boolean;
    endian: 'le' | 'be';
    /** Precomputed go-address target + mapped flag. null = not applicable (len !== 4). */
    goAddress: { address: number; valid: boolean } | null;
}

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

// ── Pure rendering (hex grid menu) ───────────────────────────────

export function renderMenuHtml(state: MenuState): string {
    const body = state.len === 1 ? buildSingleByteBody(state) : buildMultiByteBody(state);

    return `<div class="menu-header">${esc(`${state.len} byte${state.len === 1 ? '' : 's'} selected`)}</div>` +
        (state.editMode ? `<div class="menu-edit-badge">&#9998; Editing</div>` : '') +
        MENU_SEP +
        body;
}

function menuItem(cmd: string, label: string, hint = ''): string {
    return `<div class="menu-item" data-cmd="${cmd}" role="menuitem" tabindex="-1">` +
        `<span class="menu-label">${esc(label)}</span>` +
        (hint ? `<span class="menu-hint">${esc(hint)}</span>` : '') +
        `</div>`;
}

function menuSubmenu(label: string, id: string, body: string): string {
    return `<div class="menu-item menu-has-sub" data-sub="${id}" role="menuitem" tabindex="-1">` +
        `<span class="menu-label">${esc(label)}</span>` +
        `<div class="menu-submenu">${body}</div>` +
        `</div>`;
}

function menuPreview(text: string): string {
    return text.length > 20 ? `${text.slice(0, 18)}\u2026` : text;
}

function goAddressRow(state: MenuState): string {
    if (!state.goAddress) { return ''; }
    const { address, valid } = state.goAddress;
    const preview = `0x${address.toString(16).toUpperCase().padStart(8, '0')} ${state.endian.toUpperCase()}`;
    return `<div class="menu-item menu-go-row${valid ? '' : ' menu-disabled'}" data-cmd="go-address" role="menuitem" tabindex="-1"${valid ? '' : ' aria-disabled="true" title="Not mapped"'}>` +
        `<span class="menu-label">Go address</span>` +
        `<span class="menu-hint menu-go">${esc(preview)}</span>` +
        `</div>`;
}

function interactionRows(state: MenuState): string {
    return goAddressRow(state) +
        menuItem('select-all', 'Select all') +
        menuItem('select-segment', 'Select segment');
}

function buildFillMenu(len: number): string {
    const fillPresets: [number, string][] = [
        [0x00, 'Zero'],
        [0xFF, 'Erased flash'],
    ];
    const customRow =
        `<div class="menu-custom-row">` +
        `<span class="menu-label">Custom</span>` +
        `<div class="menu-custom-input-wrap">` +
        `<span class="menu-custom-prefix">0x</span>` +
        `<input class="menu-fill-input" type="text" maxlength="2" placeholder="FF" spellcheck="false">` +
        `<button class="menu-fill-apply" title="Apply">&#10003;</button>` +
        `</div></div>`;
    const hintFor = (v: number): string => `${v === 0 ? '(0x00)' : '(0xFF)'}${len > 1 ? ` \u00d7 ${len}` : ''}`;

    return fillPresets.map(([v, label]) => menuItem(`fill-${hexByte(v)}`, label, hintFor(v))).join('') +
        MENU_SEP +
        customRow;
}

/** Remaining copy formats: the direct top-level ones are omitted. */
function buildMultiCopyAsMenu(bytes: number[]): string {
    return menuItem('hex-raw', 'Hex (raw)', menuPreview(formatCopyCommand('hex-raw', bytes))) +
        menuItem('binary', 'Binary', menuPreview(formatCopyCommand('binary', bytes))) +
        menuItem('dec-array', 'Decimal Array', menuPreview(formatCopyCommand('dec-array', bytes))) +
        menuItem('hex-array', 'Hex Array', menuPreview(formatCopyCommand('hex-array', bytes))) +
        MENU_SEP +
        menuItem('base64', 'Base64', menuPreview(formatCopyCommand('base64', bytes)));
}

function buildSingleCopyAsMenu(value: number): string {
    const binValue = value.toString(2).padStart(8, '0');
    return menuItem('dec', 'Decimal', `${value}`) +
        menuItem('binary', 'Binary', `${binValue.slice(0, 4)} ${binValue.slice(4)}`);
}

function buildAnalyzeMenu(bytes: number[]): string {
    const sum = formatAnalyzeCommand('an-sum', bytes);
    const xor = formatAnalyzeCommand('an-xor', bytes);
    const crc8 = formatAnalyzeCommand('an-crc8', bytes);
    const crc16 = formatAnalyzeCommand('an-crc16', bytes);
    const crc32 = formatAnalyzeCommand('an-crc32', bytes);

    return menuItem('an-sum', 'Sum', sum.text.replace(' (', '  (')) +
        menuItem('an-xor', 'XOR', xor.text) +
        MENU_SEP +
        menuItem('an-crc8', 'CRC-8', crc8.text) +
        menuItem('an-crc16', 'CRC-16', crc16.text) +
        menuItem('an-crc32', 'CRC-32', crc32.text);
}

function buildMultiByteBody(state: MenuState): string {
    const { bytes, len, editMode } = state;
    return menuItem('copy-hex', 'Copy Hex', menuPreview(formatCopyCommand('hex', bytes))) +
        menuItem('copy-ascii', 'Copy ASCII', menuPreview(formatCopyCommand('ascii', bytes))) +
        menuItem('copy-c-array', 'Copy C Array', menuPreview(`{${bytes.map(formatHexArrayByte).join(', ')}}`)) +
        menuSubmenu('Copy as\u2026', 'copy', buildMultiCopyAsMenu(bytes)) +
        MENU_SEP +
        menuSubmenu('Analyze', 'analyze', buildAnalyzeMenu(bytes)) +
        MENU_SEP +
        interactionRows(state) +
        (editMode ? MENU_SEP + menuSubmenu('Patch / Fill', 'fill', buildFillMenu(len)) : '');
}

function buildSingleByteBody(state: MenuState): string {
    const value = state.bytes[0] ?? 0;
    const ascii = formatAsciiByte(value);
    const asciiRow = ascii !== '.'
        ? menuItem('copy-ascii', 'Copy ASCII', `'${ascii}'`)
        : '';
    return menuItem('copy-hex', 'Copy Hex', `0x${hexByte(value)}`) +
        asciiRow +
        menuSubmenu('Copy as\u2026', 'copy', buildSingleCopyAsMenu(value)) +
        MENU_SEP +
        interactionRows(state) +
        (state.editMode ? MENU_SEP + menuSubmenu('Patch / Fill', 'fill', buildFillMenu(1)) : '');
}

// ── Interaction controller ───────────────────────────────────────

function keepFillSubmenuOpen(fillInput: HTMLInputElement): void {
    const sub = fillInput.closest<HTMLElement>('.menu-submenu');
    if (sub) { sub.style.display = 'block'; }
}

function isValidCustomFill(raw: string, value: number): boolean {
    return raw !== '' && !isNaN(value) && value >= 0 && value <= 0xFF;
}

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
            this.wireInlineInputs(el);
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
        const sub = this.openSubmenuFromFocus();
        if (sub) { this.closeSubmenu(sub); return true; }
        this.closeCurrent();
        return true;
    }

    private handleMenuNavigationKey(e: KeyboardEvent): boolean {
        if (this.isFlankKey(e)) { return this.handleArrowFlank(e.key === 'ArrowRight'); }
        if (this.isHomeEndKey(e)) { return this.handleHomeEnd(e.key); }
        const dir = this.verticalArrowDir(e.key);
        if (dir === 0) { return false; }
        this.focusAdjacentRow(this.scopedNavigationRows(), dir);
        return true;
    }

    private isFlankKey(e: KeyboardEvent): boolean {
        return e.key === 'ArrowRight' || e.key === 'ArrowLeft';
    }

    private isHomeEndKey(e: KeyboardEvent): boolean {
        return e.key === 'Home' || e.key === 'End';
    }

    /** Shared Right/Left arrow handling: consumed only when the controller acts on the key. */
    private handleArrowFlank(right: boolean): boolean {
        return right ? this.handleArrowRight() : this.handleArrowLeft();
    }

    /** ArrowRight on a .menu-has-sub row opens its submenu and focuses the first enabled item. */
    private handleArrowRight(): boolean {
        const row = this.activeMenuRow();
        if (!row?.hasAttribute('data-sub')) { return false; }
        this.openSubmenuRow(row);
        return true;
    }

    /** ArrowLeft from inside an open submenu closes it and returns focus to the parent row. */
    private handleArrowLeft(): boolean {
        const sub = this.openSubmenuFromFocus();
        if (!sub) { return false; }
        sub.style.display = 'none';
        sub.closest<HTMLElement>('.menu-has-sub')?.focus();
        return true;
    }

    /** Home/End jump to the first/last enabled item in the active scope. */
    private handleHomeEnd(key: string): boolean {
        const rows = this.scopedNavigationRows();
        if (rows.length === 0) { return true; }
        rows[key === 'Home' ? 0 : rows.length - 1].focus();
        return true;
    }

    private verticalArrowDir(key: string): 1 | -1 | 0 {
        if (key === 'ArrowDown') { return 1; }
        if (key === 'ArrowUp') { return -1; }
        return 0;
    }

    /** ArrowUp/Down navigate strictly within the open submenu; otherwise only the parent menu's own rows. */
    private scopedNavigationRows(): HTMLElement[] {
        const menu = this.activeEl;
        if (!menu) { return []; }
        const sub = this.activeOpenSubmenu();
        if (sub) { return this.enabledRows(sub); }
        return Array.from(menu.querySelectorAll<HTMLElement>(`:scope > ${ITEM_SELECTOR}`))
            .filter(r => this.enabledRow(r));
    }

    private activeOpenSubmenu(): HTMLElement | null {
        const active = document.activeElement as HTMLElement | null;
        const sub = active?.closest?.('.menu-submenu') as HTMLElement | null;
        return sub && sub.style.display === 'block' ? sub : null;
    }

    /** Enter/Space: data-cmd rows emit; real buttons (no data-cmd) are left to native activation. */
    private handleMenuActivationKey(e: KeyboardEvent): boolean {
        if (!this.isActivationKey(e)) { return false; }
        // Keys typed into an inline input (custom fill) stay native: the input's
        // own handler applies the fill; the controller must not steal them.
        if (this.isInlineInputTarget(e)) { return false; }
        const row = this.activeMenuRow();
        if (!row) { return false; }
        return this.activateRow(row);
    }

    private isActivationKey(e: KeyboardEvent): boolean {
        return e.key === 'Enter' || e.key === ' ';
    }

    private isInlineInputTarget(e: KeyboardEvent): boolean {
        const target = e.target as HTMLElement | null;
        return !!target?.closest?.('input, textarea, select');
    }

    private activateRow(row: HTMLElement): boolean {
        if (row.classList.contains('menu-disabled')) { return true; }
        if (row.hasAttribute('data-sub')) { this.openSubmenuRow(row); return true; }
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

    // ── Submenu helpers ──────────────────────────────────────────

    /** Submenu currently open (either focused inside it or open behind the parent row). */
    private openSubmenuFromFocus(): HTMLElement | null {
        return this.focusedSubmenu() ?? this.firstOpenSubmenu();
    }

    private focusedSubmenu(): HTMLElement | null {
        const active = document.activeElement as HTMLElement | null;
        const sub = active?.closest?.('.menu-submenu') as HTMLElement | null;
        return sub && sub.style.display === 'block' ? sub : null;
    }

    private firstOpenSubmenu(): HTMLElement | null {
        for (const sub of document.querySelectorAll<HTMLElement>('.menu-submenu')) {
            if (sub.style.display === 'block') { return sub; }
        }
        return null;
    }

    private closeSubmenu(sub: HTMLElement): void {
        sub.style.display = 'none';
        sub.closest<HTMLElement>('.menu-has-sub')?.focus();
    }

    private openSubmenuRow(row: HTMLElement): void {
        const sub = row.querySelector<HTMLElement>(':scope > .menu-submenu');
        if (!sub) { return; }
        sub.style.display = 'block';
        sub.querySelector<HTMLElement>('.menu-item:not(.menu-disabled), [role="menuitem"]:not([disabled])')?.focus();
    }

    // ── Row navigation ───────────────────────────────────────────

    private activeMenuRow(): HTMLElement | null {
        const active = document.activeElement;
        return active && active.closest?.(ITEM_SELECTOR) ? active as HTMLElement : null;
    }

    private enabledRows(root: HTMLElement): HTMLElement[] {
        return Array.from(root.querySelectorAll<HTMLElement>(ITEM_SELECTOR))
            .filter(r => this.enabledRow(r));
    }

    private enabledRow(row: HTMLElement): boolean {
        return !row.classList.contains('menu-disabled')
            && !row.classList.contains('menu-custom-row')
            && (row as { disabled?: boolean }).disabled !== true
            && this.rowVisible(row);
    }

    /** A row is navigable only when not inside a collapsed (display:none) submenu. */
    private rowVisible(row: HTMLElement): boolean {
        const sub = row.closest<HTMLElement>('.menu-submenu');
        return !sub || sub.style.display === 'block';
    }

    private focusAdjacentRow(rows: HTMLElement[], dir: 1 | -1): void {
        if (rows.length === 0) { return; }
        const idx = this.currentRowIndex(rows, document.activeElement as HTMLElement | null, dir);
        rows[(idx + dir + rows.length) % rows.length].focus();
    }

    private currentRowIndex(rows: HTMLElement[], current: HTMLElement | null, dir: 1 | -1): number {
        const found = current ? this.findRowIndex(rows, current) : -1;
        return found === -1 ? this.wrapIndex(dir, rows.length) : found;
    }

    private findRowIndex(rows: HTMLElement[], current: HTMLElement): number {
        return rows.findIndex(r => r === current || r.contains(current));
    }

    private wrapIndex(dir: 1 | -1, length: number): number {
        return dir === 1 ? -1 : length;
    }

    // ── Custom fill inline input (hex menu) ──────────────────────

    private wireInlineInputs(el: HTMLElement): void {
        const fillInput = el.querySelector<HTMLInputElement>('.menu-fill-input');
        const fillApply = el.querySelector<HTMLButtonElement>('.menu-fill-apply');
        fillInput?.addEventListener('click', ev => ev.stopPropagation());
        fillInput?.addEventListener('mousedown', ev => ev.stopPropagation());
        fillInput?.addEventListener('focus', () => keepFillSubmenuOpen(fillInput));
        fillInput?.addEventListener('input', () => fillInput.classList.remove('menu-fill-invalid'));
        fillInput?.addEventListener('keydown', ev => this.handleFillKeydown(ev, fillInput));
        fillApply?.addEventListener('click', ev => { ev.stopPropagation(); this.applyCustomFill(fillInput); });
        fillApply?.addEventListener('mousedown', ev => ev.stopPropagation());
    }

    private handleFillKeydown(ev: KeyboardEvent, fillInput: HTMLInputElement): void {
        ev.stopPropagation();
        if (ev.key === 'Enter') { this.applyCustomFill(fillInput); }
        if (ev.key === 'Escape') { this.hide(); }
    }

    private applyCustomFill(fillInput: HTMLInputElement | null): void {
        if (!fillInput) { return; }
        const raw = fillInput.value.trim().replace(/^0x/i, '');
        const value = parseInt(raw, 16);
        if (!isValidCustomFill(raw, value)) {
            fillInput.classList.add('menu-fill-invalid');
            fillInput.focus();
            return;
        }
        fillInput.classList.remove('menu-fill-invalid');
        this.runMenuCommand(fillCommand(value));
    }

    // ── Misc helpers ─────────────────────────────────────────────

    private entryPoint(target: EventTarget | null): HTMLElement | null {
        const el = target as HTMLElement | null;
        return el && typeof el.closest === 'function' ? el : null;
    }
}

/** Module singleton: one controller owns all menus + one set of per-document listeners. */
export const menuController = new MenuController();