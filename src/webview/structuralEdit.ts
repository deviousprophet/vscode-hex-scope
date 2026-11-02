// ── Structural edit orchestration ───────────────────────────────────────────
// Applies length-changing edits to the webview's working document. The core
// math lives in `core/structural.ts`; this module owns the state transition:
// segment swap, edit-overlay remap, segment index/row rebuild, and the
// undoable transaction push.

import { insertBytes, replaceRange, applyRangePatch, invertRangePatch, segmentsEqual, type RangePatch, type StructuralSegment } from '../core/structural';
import { S, type EditTransaction } from './state';
import { buildMemRows, initFlatBytes } from './memory/memoryData';
import { currentSelectionRange, mappedSegments } from './memory/selection';

/** Apply an insert at `addr`; false when nothing changed or a raw image would split. */
export function applyStructuralInsert(addr: number, bytes: readonly number[]): boolean {
    if (!canInsert(addr, bytes)) { return false; }
    const next = insertBytes(S.parseResult!.segments, addr, bytes);
    return commitStructure({ start: addr, end: addr - 1, inserted: Uint8Array.from(bytes), removed: [] }, next);
}

function canInsert(addr: number, bytes: readonly number[]): boolean {
    if (bytes.length === 0 || !S.parseResult) { return false; }
    return isValidAddress(addr) && isValidAddress(addr + bytes.length - 1);
}

/** Replace the mapped bytes in `[start, end]` with `bytes`; false when nothing changed. */
export function applyStructuralReplace(start: number, end: number, bytes: readonly number[]): boolean {
    if (!S.parseResult || !isValidReplacement(start, end, bytes)) { return false; }
    const { segments, patch } = replaceRange(S.parseResult.segments, start, end, bytes);
    return commitStructure(patch, segments);
}

function isValidReplacement(start: number, end: number, bytes: readonly number[]): boolean {
    if (!isValidRange(start, end)) { return false; }
    return bytes.length === 0 || isValidAddress(start + bytes.length - 1);
}

function isValidRange(start: number, end: number): boolean {
    return isValidAddress(start) && isValidAddress(end) && start <= end;
}

/** Delete the mapped bytes in `[start, end]`; false when nothing changed. */
export function applyStructuralDelete(start: number, end: number): boolean {
    return applyStructuralReplace(start, end, []);
}

/** Undo a structural transaction: restore the segments and the byte overlay. */
export function undoStructuralTransaction(txn: Extract<EditTransaction, { kind: 'structure' }>): void {
    if (!S.parseResult) { return; }
    setSegments(invertRangePatch(S.parseResult.segments, txn.patch));
    S.edits = new Map(txn.editsBefore);
    syncStructuralDirty();
}

/** Redo a structural transaction. */
export function redoStructuralTransaction(txn: Extract<EditTransaction, { kind: 'structure' }>): void {
    if (!S.parseResult) { return; }
    setSegments(applyRangePatch(S.parseResult.segments, txn.patch));
    S.edits = new Map(txn.editsAfter);
    syncStructuralDirty();
}

/** Dirty means "segments differ from the last saved baseline". */
function syncStructuralDirty(): void {
    if (!S.parseResult) { return; }
    S.structuralDirty = !segmentsEqual(S.parseResult.segments, S.savedSegments);
}

/**
 * Current document with the pending byte overlay folded in. Structural saves
 * send this snapshot; the host never sees the overlay separately.
 */
export function effectiveSegments(): StructuralSegment[] {
    const segments = (S.parseResult?.segments ?? []).map(segment => ({
        startAddress: segment.startAddress,
        data: new Uint8Array(segment.data),
    }));
    for (const [addr, value] of S.edits) { patchByte(segments, addr, value); }
    return segments;
}

function commitStructure(patch: RangePatch, next: StructuralSegment[]): boolean {
    if (!S.parseResult || !canCommitStructure(patch, next)) { return false; }

    const editsBefore = Array.from(S.edits.entries());
    const editsAfter = remapEdits(S.edits, patch);
    setSegments(next);
    S.edits = editsAfter;
    S.undoStack.push({ kind: 'structure', patch, editsBefore, editsAfter: Array.from(editsAfter.entries()) });
    S.redoStack.length = 0;
    S.editMode = true;
    S.structuralDirty = true;
    return true;
}

function canCommitStructure(patch: RangePatch, next: StructuralSegment[]): boolean {
    if (isEmptyPatch(patch)) { return false; }
    return !splitsRawImage(next);
}

function isEmptyPatch(patch: RangePatch): boolean {
    return patch.removed.length === 0 && patch.inserted.length === 0;
}

function splitsRawImage(next: StructuralSegment[]): boolean {
    if (S.parseResult?.format !== 'bin') { return false; }
    if (next.length > 1) { return true; }
    return hasBinBaseDrift(next);
}

function hasBinBaseDrift(next: StructuralSegment[]): boolean {
    if (next.length === 0) { return false; }
    const base = S.parseResult?.baseAddress ?? next[0].startAddress;
    return next[0].startAddress !== base;
}

function setSegments(segments: StructuralSegment[]): void {
    if (!S.parseResult) { return; }
    S.parseResult.segments = segments;
    S.parseResult.totalDataBytes = segments.reduce((sum, segment) => sum + segment.data.length, 0);
    initFlatBytes();
    buildMemRows();
}

/** Shift pending byte edits with the structural change; removed bytes drop their edits. */
function remapEdits(edits: ReadonlyMap<number, number>, patch: RangePatch): Map<number, number> {
    const delta = patch.inserted.length - patch.removed.reduce((sum, run) => sum + run.data.length, 0);
    const out = new Map<number, number>();
    for (const [addr, value] of edits) {
        if (addr < patch.start) { out.set(addr, value); continue; }
        if (addr <= patch.end) { continue; }
        out.set(addr + delta, value);
    }
    return out;
}

function patchByte(segments: StructuralSegment[], addr: number, value: number): void {
    for (const segment of segments) {
        const offset = addr - segment.startAddress;
        if (offset >= 0 && offset < segment.data.length) {
            segment.data[offset] = value;
            return;
        }
    }
}

function isValidAddress(addr: number): boolean {
    return Number.isInteger(addr) && addr >= 0 && addr <= 0xFFFFFFFF;
}

/** First and last mapped address inside the current selection (null when empty). */
export function mappedSelectionBounds(): { start: number; end: number } | null {
    const range = currentSelectionRange();
    return range ? boundsForRange(range) : null;
}

function boundsForRange(range: { start: number; end: number }): { start: number; end: number } | null {
    const overlaps = mappedSegments()
        .map(segment => overlapOf(range, segment))
        .filter((overlap): overlap is { start: number; end: number } => overlap !== null);
    return overlaps.length > 0
        ? { start: overlaps[0].start, end: overlaps[overlaps.length - 1].end }
        : null;
}

function overlapOf(
    range: { start: number; end: number },
    segment: { startAddress: number; data: ArrayLike<number> },
): { start: number; end: number } | null {
    const from = Math.max(range.start, segment.startAddress);
    const to = Math.min(range.end, segment.startAddress + segment.data.length - 1);
    return from <= to ? { start: from, end: to } : null;
}
