// ── ContextMenu component ────────────────────────────────────────
// Self-contained right-click menu: owns menu markup (pure
// renderContextMenuHtml), positioning, dismiss (click-outside/Escape),
// hover-submenus, and the transient inline input (custom fill). The
// host owns all command execution and the new action logic (go-address,
// select-all, select-segment) — this module never imports the `S`
// global and never posts provider messages; it reports commands via
// callbacks.
//
// Markup reuses the existing `.ctx-*` classes so the moved
// context-menu.css rules apply unchanged.

import './contextMenu.css';

import { formatAnalyzeCommand } from '../../../core/byteTools/analysis';
import { formatCopyCommand } from '../../../core/byteTools/copy';
import { formatAsciiByte, formatHexArrayByte, hexByte } from '../../../core/byteTools/hex';
import { fillCommand } from '../../contextCommands';
import { esc, positionContextMenu, wireHoverSubmenus } from '../../utils';

const CTX_SEP = `<div class="ctx-sep" role="separator"></div>`;

export interface ContextMenuState {
    selectionActive: boolean;
    len: number;
    bytes: number[];
    editMode: boolean;
    endian: 'le' | 'be';
    /** Precomputed go-address target + mapped flag. null = not applicable (len !== 4). */
    goAddress: { address: number; valid: boolean } | null;
}

export interface ContextMenuCallbacks {
    onCommand?: (cmd: string) => void;
}

// ── Pure rendering ────────────────────────────────────────────────

export function renderContextMenuHtml(state: ContextMenuState): string {
    const body = state.len === 1 ? buildSingleByteBody(state) : buildMultiByteBody(state);

    return `<div class="ctx-hdr">${esc(`${state.len} byte${state.len === 1 ? '' : 's'} selected`)}</div>` +
        (state.editMode ? `<div class="ctx-edit-badge">&#9998; Editing</div>` : '') +
        CTX_SEP +
        body;
}

function ctxItem(cmd: string, label: string, hint = ''): string {
    return `<div class="ctx-row" data-cmd="${cmd}" role="menuitem" tabindex="-1">` +
        `<span class="ctx-label">${esc(label)}</span>` +
        (hint ? `<span class="ctx-hint">${esc(hint)}</span>` : '') +
        `</div>`;
}

function ctxSubmenu(label: string, id: string, body: string): string {
    return `<div class="ctx-row ctx-has-sub" data-sub="${id}" role="menuitem" tabindex="-1">` +
        `<span class="ctx-label">${esc(label)}</span>` +
        `<div class="ctx-submenu">${body}</div>` +
        `</div>`;
}

function ctxPreview(text: string): string {
    return text.length > 20 ? `${text.slice(0, 18)}\u2026` : text;
}

function goAddressRow(state: ContextMenuState): string {
    if (!state.goAddress) { return ''; }
    const { address, valid } = state.goAddress;
    const preview = `0x${address.toString(16).toUpperCase().padStart(8, '0')} ${state.endian.toUpperCase()}`;
    return `<div class="ctx-row ctx-go-row${valid ? '' : ' ctx-disabled'}" data-cmd="go-address" role="menuitem" tabindex="-1"${valid ? '' : ' aria-disabled="true" title="Not mapped"'}>` +
        `<span class="ctx-label">Go address</span>` +
        `<span class="ctx-hint ctx-go">${esc(preview)}</span>` +
        `</div>`;
}

function interactionRows(state: ContextMenuState): string {
    return goAddressRow(state) +
        ctxItem('select-all', 'Select all') +
        ctxItem('select-segment', 'Select segment');
}

function buildFillMenu(len: number): string {
    const fillPresets: [number, string][] = [
        [0x00, 'Zero'],
        [0xFF, 'Erased flash'],
    ];
    const customRow =
        `<div class="ctx-custom-row">` +
        `<span class="ctx-label">Custom</span>` +
        `<div class="ctx-custom-input-wrap">` +
        `<span class="ctx-custom-prefix">0x</span>` +
        `<input class="ctx-fill-input" type="text" maxlength="2" placeholder="FF" spellcheck="false">` +
        `<button class="ctx-fill-apply" title="Apply">&#10003;</button>` +
        `</div></div>`;
    const hintFor = (v: number): string => `${v === 0 ? '(0x00)' : '(0xFF)'}${len > 1 ? ` \u00d7 ${len}` : ''}`;

    return fillPresets.map(([v, label]) => ctxItem(`fill-${hexByte(v)}`, label, hintFor(v))).join('') +
        CTX_SEP +
        customRow;
}

/** Remaining copy formats: the direct top-level ones are omitted. */
function buildMultiCopyAsMenu(bytes: number[]): string {
    return ctxItem('hex-raw', 'Hex (raw)', ctxPreview(formatCopyCommand('hex-raw', bytes))) +
        ctxItem('binary', 'Binary', ctxPreview(formatCopyCommand('binary', bytes))) +
        ctxItem('dec-array', 'Decimal Array', ctxPreview(formatCopyCommand('dec-array', bytes))) +
        ctxItem('hex-array', 'Hex Array', ctxPreview(formatCopyCommand('hex-array', bytes))) +
        CTX_SEP +
        ctxItem('base64', 'Base64', ctxPreview(formatCopyCommand('base64', bytes)));
}

function buildSingleCopyAsMenu(value: number): string {
    const binValue = value.toString(2).padStart(8, '0');
    return ctxItem('dec', 'Decimal', `${value}`) +
        ctxItem('binary', 'Binary', `${binValue.slice(0, 4)} ${binValue.slice(4)}`);
}

function buildAnalyzeMenu(bytes: number[]): string {
    const sum = formatAnalyzeCommand('an-sum', bytes);
    const xor = formatAnalyzeCommand('an-xor', bytes);
    const crc8 = formatAnalyzeCommand('an-crc8', bytes);
    const crc16 = formatAnalyzeCommand('an-crc16', bytes);
    const crc32 = formatAnalyzeCommand('an-crc32', bytes);

    return ctxItem('an-sum', 'Sum', sum.text.replace(' (', '  (')) +
        ctxItem('an-xor', 'XOR', xor.text) +
        CTX_SEP +
        ctxItem('an-crc8', 'CRC-8', crc8.text) +
        ctxItem('an-crc16', 'CRC-16', crc16.text) +
        ctxItem('an-crc32', 'CRC-32', crc32.text);
}

function buildMultiByteBody(state: ContextMenuState): string {
    const { bytes, len, editMode } = state;
    return ctxItem('copy-hex', 'Copy Hex', ctxPreview(formatCopyCommand('hex', bytes))) +
        ctxItem('copy-ascii', 'Copy ASCII', ctxPreview(formatCopyCommand('ascii', bytes))) +
        ctxItem('copy-c-array', 'Copy C Array', ctxPreview(`{${bytes.map(formatHexArrayByte).join(', ')}}`)) +
        ctxSubmenu('Copy as\u2026', 'copy', buildMultiCopyAsMenu(bytes)) +
        CTX_SEP +
        ctxSubmenu('Analyze', 'analyze', buildAnalyzeMenu(bytes)) +
        CTX_SEP +
        interactionRows(state) +
        (editMode ? CTX_SEP + ctxSubmenu('Patch / Fill', 'fill', buildFillMenu(len)) : '');
}

function buildSingleByteBody(state: ContextMenuState): string {
    const value = state.bytes[0] ?? 0;
    const ascii = formatAsciiByte(value);
    const asciiRow = ascii !== '.'
        ? ctxItem('copy-ascii', 'Copy ASCII', `'${ascii}'`)
        : '';
    return ctxItem('copy-hex', 'Copy Hex', `0x${hexByte(value)}`) +
        asciiRow +
        ctxSubmenu('Copy as\u2026', 'copy', buildSingleCopyAsMenu(value)) +
        CTX_SEP +
        interactionRows(state) +
        (state.editMode ? CTX_SEP + ctxSubmenu('Patch / Fill', 'fill', buildFillMenu(1)) : '');
}

// ── Interaction controller ────────────────────────────────────────

function keepFillSubmenuOpen(fillInput: HTMLInputElement): void {
    const sub = fillInput.closest<HTMLElement>('.ctx-submenu');
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

export class ContextMenu {
    private cb: ContextMenuCallbacks;
    private mounted = false;
    /** Element focused before the menu opened; restored on hide (so keyboard control returns to its trigger). */
    private restoreFocusEl: HTMLElement | null = null;

    /** Last input modality; mouse-opens hide the keyboard-selection highlight until first keypress. */
    private inputMode: 'mouse' | 'keyboard' = 'mouse';

    constructor(cb: ContextMenuCallbacks = {}) {
        this.cb = cb;
    }

    /** Document-delegated click-outside dismiss + Escape dismiss + input-modality tracking. Idempotent. */
    mount(): void {
        if (this.mounted) { return; }
        this.mounted = true;
        document.addEventListener('click', this.onDocClick);
        document.addEventListener('keydown', this.onDocKeydown);
        document.addEventListener('focusout', this.onDocFocusOut);
        window.addEventListener('blur', this.onWindowBlur);
        document.addEventListener('pointerdown', this.onPointerDown, { capture: true });
        document.addEventListener('keydown', this.onKeyboardAttract, { capture: true });
    }

    show(x: number, y: number, state: ContextMenuState): void {
        const el = document.getElementById('ctx-menu');
        if (!state.selectionActive || !el) { return; }
        this.restoreFocusEl = focusableActiveElement();
        el.innerHTML = renderContextMenuHtml(state);
        this.wireInlineInputs(el);
        wireHoverSubmenus(el, true);
        positionContextMenu(el, x, y);
        el.classList.toggle('ctx-kb', this.inputMode === 'keyboard');
        // Keyboard operability: move focus onto the first enabled menu item.
        el.querySelector<HTMLElement>('.ctx-row[data-cmd]:not(.ctx-disabled)')?.focus();
    }

    hide(): void {
        const el = document.getElementById('ctx-menu');
        if (el) { el.style.display = 'none'; }
        // Return keyboard control to the trigger when it is still around.
        this.restoreTriggerFocus();
    }

    private restoreTriggerFocus(): void {
        const restore = this.restoreFocusEl;
        this.restoreFocusEl = null;
        if (!restore || !restore.isConnected || restore === document.activeElement) { return; }
        restore.focus();
    }

    private onDocClick = (e: Event): void => {
        const target = this.ctxMenuEntryPoint(e.target);
        const menu = document.getElementById('ctx-menu');
        if (target === null || !menu) { return; }
        if (this.outsideMenu(target, menu)) { this.hide(); return; }
        this.runRowCommand(target, menu);
    };

    /** Focus moved out of the open menu (Tab, focusable click) or nowhere → close. Moves inside preserve it. */
    private onDocFocusOut = (e: FocusEvent): void => {
        const menu = this.openMenu();
        if (!menu) { return; }
        const next = e.relatedTarget as Node | null;
        if (next === null || !menu.contains(next)) { this.hide(); }
    };

    /** Webview lost window focus entirely (VS Code chrome, another editor, alt-tab) → close. */
    private onWindowBlur = (): void => {
        this.hide();
    };

    /** Mouse interaction: hide the keyboard-selection highlight until the user actually uses keys. */
    private onPointerDown = (): void => {
        this.inputMode = 'mouse';
        this.applyKbHighlight(false);
    };

    /** Any keypress (incl. the context-menu key that opens the menu) → keyboard mode: highlight on. */
    private onKeyboardAttract = (): void => {
        this.inputMode = 'keyboard';
        this.applyKbHighlight(true);
    };

    private applyKbHighlight(on: boolean): void {
        document.getElementById('ctx-menu')?.classList.toggle('ctx-kb', on);
    }

    private ctxMenuEntryPoint(target: EventTarget | null): HTMLElement | null {
        const el = target as HTMLElement | null;
        return el && typeof el.closest === 'function' ? el : null;
    }

    private outsideMenu(target: HTMLElement, menu: HTMLElement): boolean {
        return !menu.contains(target);
    }

    private runRowCommand(target: HTMLElement, menu: HTMLElement): void {
        const row = target.closest<HTMLElement>('.ctx-row[data-cmd]');
        if (row && !row.classList.contains('ctx-disabled')) {
            this.cb.onCommand?.(row.dataset.cmd!);
            this.hide();
        }
    }

    private onDocKeydown = (e: KeyboardEvent): void => {
        const menu = this.openMenu();
        if (!menu) { return; }
        if (this.handleMenuEscape(e)) { return; }
        if (this.handleMenuNavigationKey(e, menu)) { return; }
        this.handleMenuActivationKey(e, menu);
    };

    private openMenu(): HTMLElement | null {
        const menu = document.getElementById('ctx-menu');
        return menu && menu.style.display !== 'none' ? menu : null;
    }

    private handleMenuEscape(e: KeyboardEvent): boolean {
        if (e.key !== 'Escape') { return false; }
        e.preventDefault();
        const sub = this.openSubmenuFromFocus();
        if (sub) {
            // Two-step: Escape closes the open submenu first, then the whole menu.
            this.closeSubmenu(sub);
            return true;
        }
        this.hide();
        return true;
    }

    private handleMenuNavigationKey(e: KeyboardEvent, menu: HTMLElement): boolean {
        if (e.key === 'ArrowRight') {
            const handled = this.handleArrowRight();
            if (handled) { e.preventDefault(); }
            return handled;
        }
        if (e.key === 'ArrowLeft') {
            const handled = this.handleArrowLeft();
            if (handled) { e.preventDefault(); }
            return handled;
        }
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') { return false; }
        e.preventDefault();
        this.focusAdjacentRow(this.scopedNavigationRows(menu), e.key === 'ArrowDown' ? 1 : -1);
        return true;
    }

    /** ArrowRight on a .ctx-has-sub row opens its submenu and focuses the first enabled item. */
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
        sub.closest<HTMLElement>('.ctx-has-sub')?.focus();
        return true;
    }

    /** Submenu currently open (either focused inside it or open behind the parent row). */
    private openSubmenuFromFocus(): HTMLElement | null {
        const active = document.activeElement as HTMLElement | null;
        const focused = active?.closest?.('.ctx-submenu') as HTMLElement | null;
        if (focused && focused.style.display === 'block') { return focused; }
        for (const sub of document.querySelectorAll<HTMLElement>('.ctx-submenu')) {
            if (sub.style.display === 'block') { return sub; }
        }
        return null;
    }

    private closeSubmenu(sub: HTMLElement): void {
        sub.style.display = 'none';
        sub.closest<HTMLElement>('.ctx-has-sub')?.focus();
    }

    private handleMenuActivationKey(e: KeyboardEvent, menu: HTMLElement): void {
        if (!this.isActivationKey(e.key)) { return; }
        const row = this.activeMenuRow();
        if (!row) { return; }
        e.preventDefault();
        if (row.hasAttribute('data-sub')) { this.openSubmenuRow(row); return; }
        this.runRowCommand(row, menu);
    }

    private openSubmenuRow(row: HTMLElement): void {
        const sub = row.querySelector<HTMLElement>(':scope > .ctx-submenu');
        if (!sub) { return; }
        sub.style.display = 'block';
        sub.querySelector<HTMLElement>('.ctx-row:not(.ctx-disabled)')?.focus();
    }

    private activeMenuRow(): HTMLElement | null {
        const active = document.activeElement;
        return active && active.closest?.('.ctx-row') ? active as HTMLElement : null;
    }

    private isActivationKey(key: string): boolean {
        return key === 'Enter' || key === ' ';
    }

    private focusAdjacentRow(rows: HTMLElement[], dir: 1 | -1): void {
        if (rows.length === 0) { return; }
        const idx = this.currentRowIndex(rows, document.activeElement as HTMLElement | null, dir);
        rows[(idx + dir + rows.length) % rows.length].focus();
    }

    /** ArrowUp/Down navigate strictly within the open submenu; otherwise only the parent menu's own rows. */
    private scopedNavigationRows(menu: HTMLElement): HTMLElement[] {
        const active = document.activeElement as HTMLElement | null;
        const sub = active?.closest?.('.ctx-submenu') as HTMLElement | null;
        if (sub && sub.style.display === 'block') {
            return this.enabledRows(sub);
        }
        return Array.from(menu.querySelectorAll<HTMLElement>(':scope > .ctx-row'))
            .filter(r => this.enabledRow(r));
    }

    private enabledRows(root: HTMLElement): HTMLElement[] {
        return Array.from(root.querySelectorAll<HTMLElement>('.ctx-row'))
            .filter(r => this.enabledRow(r));
    }

    private enabledRow(row: HTMLElement): boolean {
        return !row.classList.contains('ctx-disabled')
            && !row.classList.contains('ctx-custom-row')
            && this.rowVisible(row);
    }

    /** A row is navigable only when not inside a collapsed (display:none) submenu. */
    private rowVisible(row: HTMLElement): boolean {
        const sub = row.closest<HTMLElement>('.ctx-submenu');
        return !sub || sub.style.display === 'block';
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

    private wireInlineInputs(el: HTMLElement): void {
        const fillInput = el.querySelector<HTMLInputElement>('.ctx-fill-input');
        const fillApply = el.querySelector<HTMLButtonElement>('.ctx-fill-apply');
        fillInput?.addEventListener('click', ev => ev.stopPropagation());
        fillInput?.addEventListener('mousedown', ev => ev.stopPropagation());
        fillInput?.addEventListener('focus', () => keepFillSubmenuOpen(fillInput));
        fillInput?.addEventListener('input', () => fillInput.classList.remove('ctx-fill-invalid'));
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
        const raw = fillInput?.value.trim().replace(/^0x/i, '') ?? '';
        const value = parseInt(raw, 16);
        if (!isValidCustomFill(raw, value)) {
            fillInput?.classList.add('ctx-fill-invalid');
            fillInput?.focus();
            return;
        }
        fillInput?.classList.remove('ctx-fill-invalid');
        this.cb.onCommand?.(fillCommand(value));
        this.hide();
    }
}
