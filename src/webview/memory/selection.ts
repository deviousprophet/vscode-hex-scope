import { S } from '../state';
import { getByte } from './memoryData';

export type SelectionRange = { start: number; end: number };

export function currentSelectionRange(): SelectionRange | null {
    if (S.selStart === null) { return null; }
    if (S.selEnd === null) { return null; }
    return { start: S.selStart, end: S.selEnd };
}

export function selectByteFromClick(e: MouseEvent, el: HTMLElement, applySelection: (start: number, end: number) => void): void {
    if (e.button !== 0) { return; }
    const addr = byteAddress(el);
    if (addr === null) { return; }

    const range = selectedRangeForClick(e, addr);
    applySelection(range.start, range.end);
}

export function selectByteForContextMenu(el: HTMLElement, applySelection: (start: number, end: number) => void): void {
    const addr = byteAddress(el);
    if (addr === null || isAddressInSelection(addr)) { return; }
    applySelection(addr, addr);
}

export function selectedBytes(): number[] {
    const range = currentSelectionRange();
    if (!range) { return []; }
    const out: number[] = [];
    for (let a = range.start; a <= range.end; a++) {
        out.push(getByte(a) ?? 0);
    }
    return out;
}

function selectedRangeForClick(e: MouseEvent, addr: number): SelectionRange {
    if (e.shiftKey && S.selStart !== null) {
        return addr < S.selStart
            ? { start: addr, end: S.selStart }
            : { start: S.selStart, end: addr };
    }
    return { start: addr, end: addr };
}

function isAddressInSelection(addr: number): boolean {
    return S.selStart !== null && S.selEnd !== null && addr >= S.selStart && addr <= S.selEnd;
}

function byteAddress(el: HTMLElement): number | null {
    const addr = parseInt(el.dataset.addr!, 16);
    return isNaN(addr) ? null : addr;
}
