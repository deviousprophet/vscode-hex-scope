import { S, type EditTransaction } from './state';
import { currentEditedByte, restoreEditedByte } from './editByteState';
import { redoStructuralTransaction, undoStructuralTransaction } from './structuralEdit';

export function undoLastEditTransaction(): boolean {
    const txn = popUndoTransaction();
    if (!txn) { return false; }
    if (txn.kind === 'structure') {
        undoStructuralTransaction(txn);
        S.redoStack.push(txn);
        return true;
    }
    S.redoStack.push(undoByteTransaction(txn));
    return true;
}

export function redoLastEditTransaction(): boolean {
    const txn = popRedoTransaction();
    if (!txn) { return false; }
    if (txn.kind === 'structure') {
        redoStructuralTransaction(txn);
        S.undoStack.push(txn);
        return true;
    }
    S.undoStack.push(redoByteTransaction(txn));
    return true;
}

function undoByteTransaction(txn: Extract<EditTransaction, { kind: 'bytes' }>): EditTransaction {
    const redo: Array<[number, number]> = [];
    for (const [addr, prevVal] of txn.patches) {
        redo.push([addr, currentEditedByte(addr)]);
        restoreEditedByte(addr, prevVal);
    }
    return { kind: 'bytes', patches: redo };
}

function redoByteTransaction(txn: Extract<EditTransaction, { kind: 'bytes' }>): EditTransaction {
    const inverse: Array<[number, number]> = [];
    for (const [addr, newVal] of txn.patches) {
        inverse.push([addr, currentEditedByte(addr)]);
        restoreEditedByte(addr, newVal);
    }
    return { kind: 'bytes', patches: inverse };
}

function popUndoTransaction(): EditTransaction | null {
    if (!S.editMode) { return null; }
    if (S.undoStack.length === 0) { return null; }
    return S.undoStack.pop()!;
}

function popRedoTransaction(): EditTransaction | null {
    if (!S.editMode) { return null; }
    if (S.redoStack.length === 0) { return null; }
    return S.redoStack.pop()!;
}
