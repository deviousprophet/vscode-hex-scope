// ── Selection-edit session helpers ────────────────────────────────
// Session typing stages bytes into `S.edits` LIVE (so the grid shows
// typed values immediately, matching single-byte editing) while the
// undo snapshot accumulated in `undo` keeps one-undo-per-session.
// `undo` records the FIRST prior value seen per address (last-write
// semantics: a range-end re-edit must not overwrite the snapshot).

import { S } from './state';
import { restoreEditedBytes, stageIntegrityEdit } from './editTransactions';

/** Next mapped address strictly after `addr`, still `<= end`; null when none. */
export function advanceWithinRange(addr: number, end: number, isMapped: (a: number) => boolean): number | null {
    for (let a = addr + 1; a <= end; a++) {
        if (isMapped(a)) { return a; }
    }
    return null;
}

/**
 * Stage one typed session byte into `S.edits` immediately.
 * Returns true when the value actually changed; records the address's
 * first prior value in `undo` so exit can group the whole session as
 * one undo transaction.
 */
export function stageSessionByte(undo: Map<number, number>, addr: number, value: number): boolean {
    const prior = stageIntegrityEdit(addr, value);
    if (prior === null) { return false; }
    if (!undo.has(addr)) { undo.set(addr, prior[1]); }
    return true;
}

/** Commit exit: push the session's accumulated priors as ONE undo entry. */
export function flushSessionUndo(undo: Map<number, number>): void {
    if (undo.size === 0) { return; }
    S.undoStack.push(Array.from(undo.entries()));
    S.redoStack.length = 0;
    S.editMode = true;
}

/** Abort exit (Cancel/new document): revert every staged session byte. */
export function discardSessionUndo(undo: Map<number, number>): void {
    if (undo.size === 0) { return; }
    restoreEditedBytes(Array.from(undo.entries()));
}