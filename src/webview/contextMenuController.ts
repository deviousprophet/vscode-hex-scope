import { fillCommand } from './contextCommands';
import { renderContextMenuHtml } from './contextMenu';
import { positionContextMenu, wireHoverSubmenus } from './utils';

export type ContextMenuState = {
    selectionActive: () => boolean;
    selectionLength: () => number;
    selectionBytes: () => number[];
    editMode: () => boolean;
};

export function setupContextMenu(): void {
    document.addEventListener('click', hideContextMenu);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { hideContextMenu(); } });
}

export function showContextMenu(
    x: number,
    y: number,
    state: ContextMenuState,
    runCommand: (cmd: string) => void,
): void {
    if (!state.selectionActive()) { return; }

    const el = document.getElementById('ctx-menu')!;
    const len = state.selectionLength();
    const bytes = state.selectionBytes();

    el.innerHTML = renderContextMenuHtml(bytes, len, state.editMode());
    wireContextCommands(el, runCommand);
    wireCustomFill(el, runCommand);
    wireHoverSubmenus(el, true);
    positionContextMenu(el, x, y);
}

function wireContextCommands(el: HTMLElement, runCommand: (cmd: string) => void): void {
    el.querySelectorAll<HTMLElement>('.ctx-row[data-cmd]').forEach(row =>
        row.addEventListener('click', ev => {
            ev.stopPropagation();
            runCommand(row.dataset.cmd!);
            hideContextMenu();
        })
    );
}

function wireCustomFill(el: HTMLElement, runCommand: (cmd: string) => void): void {
    const fillInput = el.querySelector<HTMLInputElement>('.ctx-fill-input');
    const fillApply = el.querySelector<HTMLButtonElement>('.ctx-fill-apply');

    fillInput?.addEventListener('click', ev => ev.stopPropagation());
    fillInput?.addEventListener('mousedown', ev => ev.stopPropagation());
    fillInput?.addEventListener('focus', () => keepFillSubmenuOpen(fillInput));
    fillInput?.addEventListener('keydown', ev => handleFillInputKeydown(ev, fillInput, runCommand));
    fillInput?.addEventListener('input', () => fillInput.classList.remove('ctx-fill-invalid'));
    fillApply?.addEventListener('click', ev => { ev.stopPropagation(); applyCustomFill(fillInput, runCommand); });
    fillApply?.addEventListener('mousedown', ev => ev.stopPropagation());
}

function keepFillSubmenuOpen(fillInput: HTMLInputElement): void {
    const sub = fillInput.closest<HTMLElement>('.ctx-submenu');
    if (sub) { sub.style.display = 'block'; }
}

function handleFillInputKeydown(ev: KeyboardEvent, fillInput: HTMLInputElement, runCommand: (cmd: string) => void): void {
    ev.stopPropagation();
    if (ev.key === 'Enter') { applyCustomFill(fillInput, runCommand); }
    if (ev.key === 'Escape') { hideContextMenu(); }
}

function applyCustomFill(fillInput: HTMLInputElement | null, runCommand: (cmd: string) => void): void {
    const raw = fillInput?.value.trim().replace(/^0x/i, '') ?? '';
    const value = parseInt(raw, 16);
    if (!isValidCustomFill(raw, value)) {
        fillInput?.classList.add('ctx-fill-invalid');
        fillInput?.focus();
        return;
    }
    fillInput?.classList.remove('ctx-fill-invalid');
    runCommand(fillCommand(value));
    hideContextMenu();
}

function isValidCustomFill(raw: string, value: number): boolean {
    return raw !== '' && !isNaN(value) && value >= 0 && value <= 0xFF;
}

function hideContextMenu(): void {
    const el = document.getElementById('ctx-menu');
    if (el) { el.style.display = 'none'; }
}
