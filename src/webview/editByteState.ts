import { S } from './state';

/** Original (un-edited) byte value at `addr`, else undefined when unmapped. */
export function originalByteAt(addr: number): number | undefined {
    if (!S.parseResult) { return undefined; }
    for (const seg of S.parseResult.segments) {
        const off = addr - seg.startAddress;
        if (isSegmentOffset(off, seg.data.length)) { return seg.data[off]; }
    }
    return undefined;
}

/** Current in-effect byte value at `addr` (edited value or the accepted original). */
export function currentEditedByte(addr: number): number {
    const orig = originalByteAt(addr);
    return S.edits.has(addr) ? S.edits.get(addr)! : (orig ?? 0);
}

export function restoreEditedByte(addr: number, prevVal: number): void {
    const orig = originalByteAt(addr);
    if (orig !== undefined && prevVal === orig) {
        S.edits.delete(addr);
        return;
    }
    S.edits.set(addr, prevVal);
}

/** Mass-revert staged edits to snapshot values (selection-session discard). */
export function restoreEditedBytes(prev: Array<[number, number]>): void {
    for (const [addr, prevVal] of prev) { restoreEditedByte(addr, prevVal); }
}

function isSegmentOffset(offset: number, length: number): boolean {
    return offset >= 0 && offset < length;
}