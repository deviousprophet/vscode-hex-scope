// ── Structural segment edits ────────────────────────────────────────────────
// Length-changing edits for the addressed memory model. The editor's normal
// byte overlay can only replace bytes in place; insert/delete/replace moves
// every byte after the edit to a new address and changes the document length.
//
// A structural edit is expressed as a reversible RangePatch: the mapped bytes
// in an inclusive address range are removed and a byte block is inserted at the
// range start. The patch records only the removed runs and inserted bytes, so
// undo/redo never snapshots a whole firmware image.
//
// Segments stay sorted, non-overlapping, and merged when adjacent. Gaps are
// preserved as gaps: deleting a selection that spans an unmapped hole removes
// only mapped bytes and never materializes phantom 0x00 bytes.

import { bytesEqual } from './bytesEqual';

export interface StructuralSegment {
    startAddress: number;
    data: Uint8Array;
}

/** One contiguous mapped run removed by a structural edit. */
export interface RemovedRun {
    start: number;
    data: Uint8Array;
}

/** Reversible replacement of mapped bytes in `[start, end]` with `inserted` at `start`. */
export interface RangePatch {
    start: number;
    end: number;
    inserted: Uint8Array;
    removed: RemovedRun[];
}

type SegmentLike = { startAddress: number; data: ArrayLike<number> };

/** End address (inclusive) of a segment. */
function segmentEnd(segment: { startAddress: number; data: ArrayLike<number> }): number {
    return segment.startAddress + segment.data.length - 1;
}

/** Byte-for-byte segment equality (addresses + data). */
export function segmentsEqual(
    a: ReadonlyArray<SegmentLike>,
    b: ReadonlyArray<SegmentLike>,
): boolean {
    if (a.length !== b.length) { return false; }
    return a.every((segment, index) => sameSegment(segment, b[index]));
}

function sameSegment(a: SegmentLike, b: SegmentLike): boolean {
    return a.startAddress === b.startAddress && bytesEqual(a.data, b.data);
}

/** Copy, sort, drop empties, and merge adjacent segments. */
export function normalizeSegments(segments: ReadonlyArray<SegmentLike>): StructuralSegment[] {
    const sorted = segments
        .filter(segment => segment.data.length > 0)
        .map(segment => ({ startAddress: segment.startAddress, data: toBytes(segment.data) }))
        .sort((a, b) => a.startAddress - b.startAddress);
    const out: StructuralSegment[] = [];
    for (const segment of sorted) {
        const last = out[out.length - 1];
        if (last && last.startAddress + last.data.length === segment.startAddress) {
            out[out.length - 1] = { startAddress: last.startAddress, data: concatBytes(last.data, segment.data) };
        } else {
            out.push(segment);
        }
    }
    return out;
}

/**
 * Insert `bytes` at `addr`, shifting every mapped byte at or after `addr`
 * right by `bytes.length`. An unmapped address creates a new segment.
 */
export function insertBytes(
    segments: ReadonlyArray<SegmentLike>,
    addr: number,
    bytes: ArrayLike<number>,
): StructuralSegment[] {
    const normalized = normalizeSegments(segments);
    const inserted = toBytes(bytes);
    if (inserted.length === 0) { return normalized; }

    const ownerIndex = normalized.findIndex(segment => addr <= segmentEnd(segment));
    if (ownerIndex < 0) {
        return normalizeSegments([...normalized, { startAddress: addr, data: inserted }]);
    }

    const owner = normalized[ownerIndex];
    if (addr < owner.startAddress) {
        // The address sits in a gap before this segment: make room for it.
        return normalizeSegments([
            ...normalized.slice(0, ownerIndex),
            { startAddress: addr, data: inserted },
            ...shifted(normalized.slice(ownerIndex), inserted.length),
        ]);
    }

    const offset = addr - owner.startAddress;
    const grown: StructuralSegment = {
        startAddress: owner.startAddress,
        data: concatBytes(owner.data.slice(0, offset), inserted, owner.data.slice(offset)),
    };
    return normalizeSegments([
        ...normalized.slice(0, ownerIndex),
        grown,
        ...shifted(normalized.slice(ownerIndex + 1), inserted.length),
    ]);
}

/**
 * Remove every mapped byte in `[start, end]`; data after the range shifts
 * left by the number of removed bytes. Bytes before `start` never move.
 */
export function deleteRange(
    segments: ReadonlyArray<SegmentLike>,
    start: number,
    end: number,
): StructuralSegment[] {
    if (end < start) { return normalizeSegments(segments); }
    const out: StructuralSegment[] = [];
    let shift = 0;
    for (const segment of normalizeSegments(segments)) {
        shift = appendDeletedSegment(out, segment, start, end, shift);
    }
    return normalizeSegments(out);
}

/** Append one segment's kept bytes and return the updated left-shift. */
function appendDeletedSegment(
    out: StructuralSegment[],
    segment: StructuralSegment,
    start: number,
    end: number,
    shift: number,
): number {
    if (segmentEnd(segment) < start) {
        out.push({ startAddress: segment.startAddress, data: segment.data });
        return shift;
    }
    if (segment.startAddress > end) {
        out.push({ startAddress: segment.startAddress - shift, data: segment.data });
        return shift;
    }
    const kept = trimOverlap(segment, start, end, shift);
    if (kept) { out.push(kept); }
    return shift + removedInRange(segment, start, end);
}

/**
 * Replace the mapped bytes in `[start, end]` with `bytes` at `start`.
 * Returns the new segments plus the reversible patch.
 */
export function replaceRange(
    segments: ReadonlyArray<SegmentLike>,
    start: number,
    end: number,
    bytes: ArrayLike<number>,
): { segments: StructuralSegment[]; patch: RangePatch } {
    const normalized = normalizeSegments(segments);
    const inserted = toBytes(bytes);
    const removed = collectRemovedRuns(normalized, start, end);
    const deleted = deleteRange(normalized, start, end);
    return {
        segments: insertBytes(deleted, start, inserted),
        patch: { start, end, inserted, removed },
    };
}

/** Apply a patch forward (redo). */
export function applyRangePatch(
    segments: ReadonlyArray<SegmentLike>,
    patch: RangePatch,
): StructuralSegment[] {
    return insertBytes(deleteRange(segments, patch.start, patch.end), patch.start, patch.inserted);
}

/**
 * Apply a patch backward (undo): remove the inserted block, then re-insert
 * every removed run at its original address in ascending order.
 */
export function invertRangePatch(
    segments: ReadonlyArray<SegmentLike>,
    patch: RangePatch,
): StructuralSegment[] {
    let next = patch.inserted.length > 0
        ? deleteRange(segments, patch.start, patch.start + patch.inserted.length - 1)
        : normalizeSegments(segments);
    for (const run of patch.removed) {
        next = insertBytes(next, run.start, run.data);
    }
    return next;
}

/** Removed mapped runs in `[start, end]`, in address order. */
export function collectRemovedRuns(
    segments: ReadonlyArray<SegmentLike>,
    start: number,
    end: number,
): RemovedRun[] {
    const runs: RemovedRun[] = [];
    for (const segment of normalizeSegments(segments)) {
        const segStart = segment.startAddress;
        const segEnd = segmentEnd(segment);
        const from = Math.max(segStart, start);
        const to = Math.min(segEnd, end);
        if (from > to) { continue; }
        runs.push({
            start: from,
            data: segment.data.slice(from - segStart, to - segStart + 1),
        });
    }
    return runs;
}

/** Keep the parts of `segment` outside `[start, end]`, applying the left shift from earlier removals. */
function trimOverlap(
    segment: StructuralSegment,
    start: number,
    end: number,
    shift: number,
): StructuralSegment | null {
    const prefix = keptPrefix(segment, start);
    const suffix = keptSuffix(segment, end);
    if (prefix.length === 0 && suffix.length === 0) { return null; }
    return { startAddress: segment.startAddress - shift, data: concatBytes(prefix, suffix) };
}

function keptPrefix(segment: StructuralSegment, start: number): Uint8Array {
    const last = Math.min(segmentEnd(segment), start - 1);
    return last < segment.startAddress
        ? new Uint8Array(0)
        : segment.data.slice(0, last - segment.startAddress + 1);
}

function keptSuffix(segment: StructuralSegment, end: number): Uint8Array {
    const first = Math.max(segment.startAddress, end + 1);
    return first > segmentEnd(segment)
        ? new Uint8Array(0)
        : segment.data.slice(first - segment.startAddress);
}

function removedInRange(segment: StructuralSegment, start: number, end: number): number {
    const from = Math.max(segment.startAddress, start);
    const to = Math.min(segmentEnd(segment), end);
    return from > to ? 0 : to - from + 1;
}

function shifted(segments: ReadonlyArray<StructuralSegment>, delta: number): StructuralSegment[] {
    return segments.map(segment => ({ startAddress: segment.startAddress + delta, data: segment.data }));
}

function toBytes(data: ArrayLike<number>): Uint8Array {
    return data instanceof Uint8Array ? new Uint8Array(data) : Uint8Array.from(data);
}

function concatBytes(...parts: ArrayLike<number>[]): Uint8Array {
    const length = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
        out.set(part as ArrayLike<number>, offset);
        offset += part.length;
    }
    return out;
}
