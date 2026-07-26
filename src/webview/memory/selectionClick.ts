import { S } from '../state';
import type { SelectionRange } from './selection';

function byteAddress(el: HTMLElement): number | null {
    const addr = parseInt(el.dataset.addr!, 16);
    return isNaN(addr) ? null : addr;
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
