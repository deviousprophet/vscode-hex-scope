import type { DiffKind, DiffRun } from '../../core/diff';
import type { DiffSide } from '../../diffProtocol';
import { buildSegmentIndex, getByteAt, type SegmentIndexEntry } from '../../core/memory';
import type { SegmentLabel, SerializedParseResult } from '../../core/types';
import { BYTES_PER_ROW } from '../components/hexView/hexViewRender';
import { esc } from '../utils';

export interface DiffSideData {
    name: string;
    format: 'ihex' | 'srec';
    parseResult: SerializedParseResult;
    segmentIndex: SegmentIndexEntry[];
    labels: SegmentLabel[];
}

export interface DiffRow {
    address: number;
    kind: 'data' | 'gap';
    gap?: { from: number; to: number; bytes: number };
}

const NO_EDITS: ReadonlyMap<number, number> = new Map();

export function hydrateDiffSide(side: DiffSide): DiffSideData {
    const parseResult: SerializedParseResult = {
        records: [],
        recordCount: side.parseResult.recordCount,
        segments: side.parseResult.segments.map(segment => ({
            startAddress: segment.startAddress,
            data: new Uint8Array(segment.data),
        })),
        totalDataBytes: side.parseResult.totalDataBytes,
        checksumErrors: side.parseResult.checksumErrors,
        malformedLines: side.parseResult.malformedLines,
        startAddress: side.parseResult.startAddress,
        format: side.parseResult.format,
    };
    return {
        name: side.name,
        format: side.format,
        parseResult,
        segmentIndex: buildSegmentIndex(parseResult),
        labels: side.labels,
    };
}

export function getSideByte(side: DiffSideData, addr: number): number | undefined {
    return getByteAt(side.parseResult, side.segmentIndex, NO_EDITS, addr);
}

/** One row model shared by both grids: union of mapped 16-byte blocks, gaps only where neither side maps. */
export function buildDiffRows(a: DiffSideData, b: DiffSideData): DiffRow[] {
    const bases = new Set<number>();
    collectRowBases(a, bases);
    collectRowBases(b, bases);
    const ordered = [...bases].sort((x, y) => x - y);
    const rows: DiffRow[] = [];
    for (let i = 0; i < ordered.length; i++) {
        appendGapBefore(rows, ordered, i);
        rows.push({ address: ordered[i], kind: 'data' });
    }
    return rows;
}

function collectRowBases(side: DiffSideData, bases: Set<number>): void {
    for (const segment of side.parseResult.segments) {
        const startRow = rowBase(segment.startAddress);
        const endRow = rowBase(segment.startAddress + segment.data.length - 1);
        for (let row = startRow; row <= endRow; row += BYTES_PER_ROW) { bases.add(row); }
    }
}

function rowBase(addr: number): number {
    return addr - (addr % BYTES_PER_ROW);
}

function appendGapBefore(rows: DiffRow[], ordered: number[], index: number): void {
    if (index === 0) { return; }
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (current - previous > BYTES_PER_ROW) {
        rows.push({
            address: previous + BYTES_PER_ROW,
            kind: 'gap',
            gap: { from: previous + BYTES_PER_ROW, to: current - 1, bytes: current - previous - BYTES_PER_ROW },
        });
    }
}

export function diffKindAt(runs: readonly DiffRun[], addr: number): DiffKind | undefined {
    let lo = 0;
    let hi = runs.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const run = runs[mid];
        if (addr < run.start) { hi = mid - 1; }
        else if (addr > run.end) { lo = mid + 1; }
        else { return run.kind; }
    }
    return undefined;
}

const DIFF_CLASS: Record<DiffKind, string> = {
    changed: ' diff-chg',
    added: ' diff-add',
    removed: ' diff-del',
};

/** A run marks a cell only where that side owns it: changed everywhere, added on B, removed on A. */
export function diffClassForSide(side: 'a' | 'b', kind: DiffKind | undefined): string {
    if (!kind) { return ''; }
    return appliesTo(side, kind) ? DIFF_CLASS[kind] : '';
}

function appliesTo(side: 'a' | 'b', kind: DiffKind): boolean {
    if (kind === 'changed') { return true; }
    return side === (kind === 'removed' ? 'a' : 'b');
}

export function renderDiffErrorHtml(message: string): string {
    return `<div class="diff-error-card">` +
        `<div class="diff-error-title">Comparison failed</div>` +
        `<div class="diff-error-text">${esc(message)}</div>` +
        `</div>`;
}
