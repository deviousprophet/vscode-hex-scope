import { computeByteDiff, type DiffModel } from '../core/diff';
import type { MemorySegment } from '../core/parser/types';
import type { WireParseResult } from '../core/types';
import type { DiffSide } from '../diffProtocol';

export type DiffSideKey = 'a' | 'b';

export interface ParsedDiffSide {
    format: DiffSide['format'];
    wire: WireParseResult;
}

export interface DiffReloadState {
    a: DiffSide;
    b: DiffSide;
    diff: DiffModel;
}

export interface DiffSideRef {
    name: string;
    path: string;
}

export interface SideDefects {
    checksumErrors: number;
    malformedLines: number;
    canQuickRepair: boolean;
}

/** A pending reload is dropped when the panel is gone, a newer reload for that side started, or no state is loaded. */
export function reloadIsStale(
    disposed: boolean,
    gen: number,
    latestGen: number,
    current: DiffReloadState | null,
): boolean {
    return disposed || gen !== latestGen || current === null;
}

/** Parse defects that make a side unusable for comparison; `null` when the side is clean. */
export function sideDefects(wire: WireParseResult): SideDefects | null {
    if (wire.checksumErrors === 0 && wire.malformedLines === 0) { return null; }
    return {
        checksumErrors: wire.checksumErrors,
        malformedLines: wire.malformedLines,
        canQuickRepair: wire.malformedLines === 0,
    };
}

/** Build the executable side + diff from both freshly parsed sides. */
export function buildDiffState(
    refA: DiffSideRef,
    a: ParsedDiffSide,
    refB: DiffSideRef,
    b: ParsedDiffSide,
): DiffReloadState {
    return withDiff({ a: toSide(refA, a), b: toSide(refB, b) });
}

/** Replace only the reloaded side, then recompute the diff so counts/colors follow the new bytes. */
export function reloadState(
    state: DiffReloadState,
    side: DiffSideKey,
    ref: DiffSideRef,
    parsed: ParsedDiffSide,
): DiffReloadState {
    return side === 'a'
        ? withDiff({ a: toSide(ref, parsed), b: state.b })
        : withDiff({ a: state.a, b: toSide(ref, parsed) });
}

function withDiff(sides: { a: DiffSide; b: DiffSide }): DiffReloadState {
    return { ...sides, diff: computeByteDiff(sideSegments(sides.a), sideSegments(sides.b)) };
}

function toSide(ref: DiffSideRef, parsed: ParsedDiffSide): DiffSide {
    return { name: ref.name, path: ref.path, format: parsed.format, parseResult: parsed.wire, labels: [] };
}

function sideSegments(side: DiffSide): MemorySegment[] {
    return side.parseResult.segments.map(segment => ({
        startAddress: segment.startAddress,
        data: new Uint8Array(segment.data),
    }));
}
