// ── MenuNav: stateless DOM keyboard-navigation helpers ───────────
// Pure DOM helpers for MenuController's keyboard model: row scoping,
// enabled-item filtering, submenu open/close, and focus movement.
// Stateless — no controller fields, no event wiring; everything is
// derived from the passed menu element / the active element. Kept in
// its own module so the interaction core stays lean and unit-testable
// without a controller instance.

const ITEM_SELECTOR = '.menu-item, [role="menuitem"]';

const SUBMENU_SELECTOR = '.menu-submenu';
const FOCUS_FIRST_IN_SUB = '.menu-item:not(.menu-disabled), [role="menuitem"]:not([disabled])';
const INPUT_SELECTOR = 'input, textarea, select';

// ── Key classifiers ──────────────────────────────────────────────

export function isFlankKey(e: KeyboardEvent): boolean {
    return e.key === 'ArrowRight' || e.key === 'ArrowLeft';
}

export function isHomeEndKey(e: KeyboardEvent): boolean {
    return e.key === 'Home' || e.key === 'End';
}

export function isActivationKey(e: KeyboardEvent): boolean {
    return e.key === 'Enter' || e.key === ' ';
}

export function isInlineInputTarget(e: KeyboardEvent): boolean {
    const target = e.target as HTMLElement | null;
    return !!target?.closest?.(INPUT_SELECTOR);
}

export function verticalArrowDir(key: string): 1 | -1 | 0 {
    if (key === 'ArrowDown') { return 1; }
    if (key === 'ArrowUp') { return -1; }
    return 0;
}

// ── Row scoping ──────────────────────────────────────────────────

/** ArrowUp/Down navigate strictly within the open submenu; otherwise only the parent menu's own rows. */
export function scopedNavigationRows(menu: HTMLElement | null): HTMLElement[] {
    if (!menu) { return []; }
    const sub = activeOpenSubmenu();
    if (sub) { return enabledRows(sub); }
    return Array.from(menu.querySelectorAll<HTMLElement>(`:scope > ${ITEM_SELECTOR}`))
        .filter(r => enabledRow(r));
}

export function activeMenuRow(): HTMLElement | null {
    const active = document.activeElement;
    return active && active.closest?.(ITEM_SELECTOR) ? active as HTMLElement : null;
}

function enabledRows(root: HTMLElement): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(ITEM_SELECTOR))
        .filter(r => enabledRow(r));
}

function enabledRow(row: HTMLElement): boolean {
    return !row.classList.contains('menu-disabled')
        && !row.classList.contains('menu-custom-row')
        && (row as { disabled?: boolean }).disabled !== true
        && rowVisible(row);
}

/** A row is navigable only when not inside a collapsed (display:none) submenu. */
function rowVisible(row: HTMLElement): boolean {
    const sub = row.closest<HTMLElement>(SUBMENU_SELECTOR);
    return !sub || sub.style.display === 'block';
}

// ── Submenus ─────────────────────────────────────────────────────

/** Submenu currently open (either focused inside it or open behind the parent row). */
export function openSubmenuFromFocus(): HTMLElement | null {
    return focusedSubmenu() ?? firstOpenSubmenu();
}

function focusedSubmenu(): HTMLElement | null {
    const active = document.activeElement as HTMLElement | null;
    const sub = active?.closest?.(SUBMENU_SELECTOR) as HTMLElement | null;
    return sub && sub.style.display === 'block' ? sub : null;
}

function firstOpenSubmenu(): HTMLElement | null {
    for (const sub of document.querySelectorAll<HTMLElement>(SUBMENU_SELECTOR)) {
        if (sub.style.display === 'block') { return sub; }
    }
    return null;
}

function activeOpenSubmenu(): HTMLElement | null {
    const active = document.activeElement as HTMLElement | null;
    const sub = active?.closest?.(SUBMENU_SELECTOR) as HTMLElement | null;
    return sub && sub.style.display === 'block' ? sub : null;
}

export function closeSubmenu(sub: HTMLElement): void {
    sub.style.display = 'none';
    sub.closest<HTMLElement>('.menu-has-sub')?.focus();
}

export function openSubmenuRow(row: HTMLElement): void {
    const sub = row.querySelector<HTMLElement>(`:scope > ${SUBMENU_SELECTOR}`);
    if (!sub) { return; }
    sub.style.display = 'block';
    sub.querySelector<HTMLElement>(FOCUS_FIRST_IN_SUB)?.focus();
}

// ── Focus movement ───────────────────────────────────────────────

export function focusAdjacentRow(rows: HTMLElement[], dir: 1 | -1): void {
    if (rows.length === 0) { return; }
    const idx = currentRowIndex(rows, document.activeElement as HTMLElement | null, dir);
    rows[(idx + dir + rows.length) % rows.length].focus();
}

function currentRowIndex(rows: HTMLElement[], current: HTMLElement | null, dir: 1 | -1): number {
    const found = current ? findRowIndex(rows, current) : -1;
    return found === -1 ? wrapIndex(dir, rows.length) : found;
}

function findRowIndex(rows: HTMLElement[], current: HTMLElement): number {
    return rows.findIndex(r => r === current || r.contains(current));
}

function wrapIndex(dir: 1 | -1, length: number): number {
    return dir === 1 ? -1 : length;
}