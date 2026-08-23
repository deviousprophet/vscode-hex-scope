// ── MenuFill: hex-menu custom-fill inline input wiring ───────────
// Owns the "Patch / Fill → Custom" transient input: stop-propagation,
// invalid-state toggling, submenu-keepalive on focus, Enter/ Escape
// key handling. Pure wires around a callback pair so MenuController
// stays lean and the input behaviour is standalone-testable.
// Commands are never executed here — `onApply` is the controller's emit.

import { fillCommand } from '../../contextCommands';

export function wireFillInputs(
    el: HTMLElement,
    onApply: (cmd: string) => void,
    onEscape: () => void,
): void {
    const fillInput = el.querySelector<HTMLInputElement>('.menu-fill-input');
    const fillApply = el.querySelector<HTMLButtonElement>('.menu-fill-apply');
    if (fillInput) {
        fillInput.addEventListener('click', ev => ev.stopPropagation());
        fillInput.addEventListener('mousedown', ev => ev.stopPropagation());
        fillInput.addEventListener('focus', () => keepFillSubmenuOpen(fillInput));
        fillInput.addEventListener('input', () => fillInput.classList.remove('menu-fill-invalid'));
        fillInput.addEventListener('keydown', ev => handleFillKeydown(ev, fillInput, onApply, onEscape));
    }
    if (fillApply) {
        fillApply.addEventListener('click', ev => { ev.stopPropagation(); applyCustomFill(fillInput, onApply); });
        fillApply.addEventListener('mousedown', ev => ev.stopPropagation());
    }
}

function handleFillKeydown(ev: KeyboardEvent, fillInput: HTMLInputElement | null, onApply: (cmd: string) => void, onEscape: () => void): void {
    ev.stopPropagation();
    if (ev.key === 'Enter') { applyCustomFill(fillInput, onApply); }
    if (ev.key === 'Escape') { onEscape(); }
}

function applyCustomFill(fillInput: HTMLInputElement | null, onApply: (cmd: string) => void): void {
    if (!fillInput) { return; }
    const raw = fillInput.value.trim().replace(/^0x/i, '');
    const value = parseInt(raw, 16);
    if (!isValidCustomFill(raw, value)) {
        fillInput.classList.add('menu-fill-invalid');
        fillInput.focus();
        return;
    }
    fillInput.classList.remove('menu-fill-invalid');
    onApply(fillCommand(value));
}

function keepFillSubmenuOpen(fillInput: HTMLInputElement): void {
    const sub = fillInput.closest<HTMLElement>('.menu-submenu');
    if (sub) { sub.style.display = 'block'; }
}

function isValidCustomFill(raw: string, value: number): boolean {
    return raw !== '' && !isNaN(value) && value >= 0 && value <= 0xFF;
}