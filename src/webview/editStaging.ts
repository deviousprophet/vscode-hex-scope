import type { SelectionRange } from './memory/selection';
import { S } from './state';
import { originalByteAt } from './editByteState';

export function stageIntegrityEditTransaction(edits: Array<[number, number]>): number {
    const previous: Array<[number, number]> = [];
    for (const [address, value] of edits) {
        const prior = stageIntegrityEdit(address, value);
        if (prior) { previous.push(prior); }
    }
    if (previous.length === 0) { return 0; }
    S.undoStack.push(previous);
    S.redoStack.length = 0;
    S.editMode = true;
    return previous.length;
}

export function stageIntegrityEdit(address: number, value: number): [number, number] | null {
    return stageScratchByte(address, value);
}

function stageScratchByte(address: number, value: number): [number, number] | null {
    const original = originalByteAt(address);
    if (original === undefined) { return null; }
    const current = S.edits.has(address) ? S.edits.get(address)! : original;
    if (current === value) { return null; }
    commitScratchValue(address, value, original);
    return [address, current];
}

function commitScratchValue(address: number, value: number, original: number): void {
    if (value === original) { S.edits.delete(address); }
    else { S.edits.set(address, value); }
}

export function fillSelectionTransaction(range: SelectionRange | null, fillVal: number): void {
    const prev = buildFillTransaction(range, fillVal);
    if (prev.length > 0) {
        S.undoStack.push(prev);
        S.redoStack.length = 0;
    }
}

function buildFillTransaction(range: SelectionRange | null, fillVal: number): Array<[number, number]> {
    if (!range) { return []; }
    const prev: Array<[number, number]> = [];
    for (let a = range.start; a <= range.end; a++) {
        const prior = stageFillByte(a, fillVal);
        if (prior) { prev.push(prior); }
    }
    return prev;
}

function stageFillByte(address: number, fillVal: number): [number, number] | null {
    return stageScratchByte(address, fillVal);
}