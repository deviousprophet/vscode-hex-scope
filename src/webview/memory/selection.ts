import { S } from '../state';
import { getByte } from './memoryData';

export type SelectionRange = { start: number; end: number };

export function currentSelectionRange(): SelectionRange | null {
    if (S.selStart === null) { return null; }
    if (S.selEnd === null) { return null; }
    return { start: S.selStart, end: S.selEnd };
}

export function selectedBytes(): number[] {
    const range = currentSelectionRange();
    if (!range) { return []; }
    const out: number[] = [];
    for (let a = range.start; a <= range.end; a++) {
        const b = getByte(a);
        if (b !== undefined) { out.push(b); }
    }
    return out;
}

/** [start, end] for a mapped span, shift-extending from the current selection start. */
export function mappedSelectionRange(first: number, last: number, shift: boolean): [number, number] {
    if (shift && S.selStart !== null) {
        return [Math.min(S.selStart, first), Math.max(S.selStart, last)];
    }
    return [first, last];
}
