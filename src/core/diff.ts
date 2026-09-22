import type { MemorySegment } from './parser/types';

export type DiffKind = 'changed' | 'added' | 'removed';

export interface DiffRun {
    start: number;
    end: number;
    kind: DiffKind;
    count: number;
}

export interface DiffSummary {
    changed: number;
    added: number;
    removed: number;
}

export interface DiffModel {
    summary: DiffSummary;
    runs: DiffRun[];
}

/**
 * One side's read position: the current segment plus the address inside it.
 * `addr` is the next resolved address to classify, not the segment start.
 */
interface Cursor {
    segs: readonly MemorySegment[];
    index: number;
    addr: number;
}

function sortedSegments(segments: readonly MemorySegment[]): MemorySegment[] {
    return segments
        .filter(seg => seg.data.length > 0)
        .slice()
        .sort((a, b) => a.startAddress - b.startAddress);
}

function makeCursor(segments: readonly MemorySegment[]): Cursor {
    const segs = sortedSegments(segments);
    return { segs, index: 0, addr: segs.length > 0 ? segs[0].startAddress : 0 };
}

function segmentEnd(seg: MemorySegment): number {
    return seg.startAddress + seg.data.length - 1;
}

function currentSeg(cursor: Cursor): MemorySegment | null {
    if (cursor.index >= cursor.segs.length) { return null; }
    return cursor.segs[cursor.index];
}

function cursorEnd(cursor: Cursor): number | null {
    const seg = currentSeg(cursor);
    return seg ? segmentEnd(seg) : null;
}

function cursorDone(cursor: Cursor): boolean {
    return cursor.index >= cursor.segs.length;
}

/** True when `cursor` resolves before `other` (or `other` is exhausted). */
function leads(cursor: Cursor, other: Cursor): boolean {
    const end = cursorEnd(cursor);
    if (end === null) { return false; }
    const otherEnd = cursorEnd(other);
    return otherEnd === null || cursor.addr < other.addr;
}

/** Move a cursor to `to`, stepping into the next segment when `to` left the current one. */
function advance(cursor: Cursor, to: number): void {
    const end = cursorEnd(cursor);
    if (end === null || to > end) {
        cursor.index += 1;
        const next = currentSeg(cursor);
        cursor.addr = next ? next.startAddress : 0;
        return;
    }
    cursor.addr = to;
}

function canMerge(prev: DiffRun | null, kind: DiffKind, start: number): prev is DiffRun {
    return !!prev && prev.kind === kind && prev.end + 1 === start;
}

class RunBuilder {
    public readonly runs: DiffRun[] = [];
    private prev: DiffRun | null = null;

    public push(start: number, end: number, kind: DiffKind): void {
        if (start > end) { return; }
        const prev = this.prev;
        if (canMerge(prev, kind, start)) {
            prev.end = end;
            prev.count += end - start + 1;
            return;
        }
        const run: DiffRun = { start, end, kind, count: end - start + 1 };
        this.runs.push(run);
        this.prev = run;
    }

    public summary(): DiffSummary {
        const summary: DiffSummary = { changed: 0, added: 0, removed: 0 };
        for (const run of this.runs) { summary[run.kind] += run.count; }
        return summary;
    }
}

function pushChanged(builder: RunBuilder, a: Cursor, b: Cursor, start: number, end: number): void {
    const aSeg = a.segs[a.index];
    const bSeg = b.segs[b.index];
    for (let addr = start; addr <= end; addr++) {
        if (aSeg.data[addr - aSeg.startAddress] !== bSeg.data[addr - bSeg.startAddress]) {
            builder.push(addr, addr, 'changed');
        }
    }
}

/** Emit `[cursor.addr, stop]` as a one-sided run, stopping before the other side's next address. */
function emitOnly(builder: RunBuilder, cursor: Cursor, other: Cursor, kind: DiffKind): void {
    const end = cursorEnd(cursor);
    if (end === null) { return; }
    const otherEnd = cursorEnd(other);
    const stop = otherEnd === null ? end : Math.min(end, other.addr - 1);
    builder.push(cursor.addr, stop, kind);
    advance(cursor, stop + 1);
}

function emitChanged(builder: RunBuilder, left: Cursor, right: Cursor): void {
    const leftEnd = cursorEnd(left);
    const rightEnd = cursorEnd(right);
    if (leftEnd === null || rightEnd === null) { return; }
    const stop = Math.min(leftEnd, rightEnd);
    pushChanged(builder, left, right, left.addr, stop);
    advance(left, stop + 1);
    advance(right, stop + 1);
}

function step(builder: RunBuilder, left: Cursor, right: Cursor): void {
    if (leads(left, right)) { emitOnly(builder, left, right, 'removed'); return; }
    if (leads(right, left)) { emitOnly(builder, right, left, 'added'); return; }
    emitChanged(builder, left, right);
}

/**
 * Address-keyed byte diff over two segment sets. Sweeps the union of
 * resolved addresses: mapped on both sides → compare, only A → removed,
 * only B → added. Contiguous same-kind addresses merge into one run;
 * addresses mapped in neither file never appear.
 */
export function computeByteDiff(
    a: readonly MemorySegment[],
    b: readonly MemorySegment[],
): DiffModel {
    const builder = new RunBuilder();
    const left = makeCursor(a);
    const right = makeCursor(b);

    while (!cursorDone(left) || !cursorDone(right)) {
        step(builder, left, right);
    }

    return { summary: builder.summary(), runs: builder.runs };
}
