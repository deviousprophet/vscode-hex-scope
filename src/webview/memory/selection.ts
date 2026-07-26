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
        out.push(getByte(a) ?? 0);
    }
    return out;
}
