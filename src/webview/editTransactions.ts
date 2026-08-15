import type { SelectionRange } from './memory/selection';
import { S } from './state';

export function stageIntegrityEditTransaction(edits: Array<[number, number]>): boolean {
    const previous: Array<[number, number]> = [];
    for (const [address, value] of edits) {
        const prior = stageIntegrityEdit(address, value);
        if (prior) { previous.push(prior); }
    }
    if (previous.length === 0) { return false; }
    S.undoStack.push(previous);
    S.redoStack.length = 0;
    S.editMode = true;
    return true;
}

export function stageIntegrityEdit(address: number, value: number): [number, number] | null {
    const original = getOriginalByte(address);
    if (original === undefined) { return null; }
    const current = currentIntegrityByte(address, original);
    if (current === value) { return null; }
    if (value === original) { S.edits.delete(address); }
    else { S.edits.set(address, value); }
    return [address, current];
}

function currentIntegrityByte(address: number, original: number): number {
    return S.edits.has(address) ? S.edits.get(address)! : original;
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
    const original = getOriginalByte(address);
    if (original === undefined) { return null; }
    const current = currentIntegrityByte(address, original);
    if (current === fillVal) { return null; }
    if (fillVal === original) { S.edits.delete(address); }
    else { S.edits.set(address, fillVal); }
    return [address, current];
}

export function undoLastEditTransaction(): boolean {
    const txn = popUndoTransaction();
    if (!txn) { return false; }
    const redo: Array<[number, number]> = [];
    for (const [addr, prevVal] of txn) {
        redo.push([addr, currentEditedByte(addr)]);
        restoreEditedByte(addr, prevVal);
    }
    S.redoStack.push(redo);
    return true;
}

export function redoLastEditTransaction(): boolean {
    const txn = popRedoTransaction();
    if (!txn) { return false; }
    for (const [addr, newVal] of txn) {
        restoreEditedByte(addr, newVal);
    }
    return true;
}

function popUndoTransaction(): Array<[number, number]> | null {
    if (!S.editMode) { return null; }
    if (S.undoStack.length === 0) { return null; }
    return S.undoStack.pop()!;
}

function popRedoTransaction(): Array<[number, number]> | null {
    if (!S.editMode) { return null; }
    if (S.redoStack.length === 0) { return null; }
    return S.redoStack.pop()!;
}

/** Current in-effect byte value at `addr` (edited value or the original). */
function currentEditedByte(addr: number): number {
    const orig = getOriginalByte(addr);
    return S.edits.has(addr) ? S.edits.get(addr)! : (orig ?? 0);
}

function restoreEditedByte(addr: number, prevVal: number): void {
    const orig = getOriginalByte(addr);
    if (orig !== undefined && prevVal === orig) {
        S.edits.delete(addr);
        return;
    }
    S.edits.set(addr, prevVal);
}

function getOriginalByte(addr: number): number | undefined {
    if (!S.parseResult) { return undefined; }
    for (const seg of S.parseResult.segments) {
        const off = addr - seg.startAddress;
        if (isSegmentOffset(off, seg.data.length)) { return seg.data[off]; }
    }
    return undefined;
}

function isSegmentOffset(offset: number, length: number): boolean {
    return offset >= 0 && offset < length;
}
