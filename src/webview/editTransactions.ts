import { S } from './state';
import { currentEditedByte, restoreEditedByte } from './editByteState';

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
    const inverse: Array<[number, number]> = [];
    for (const [addr, newVal] of txn) {
        inverse.push([addr, currentEditedByte(addr)]);
        restoreEditedByte(addr, newVal);
    }
    S.undoStack.push(inverse);
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