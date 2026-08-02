import * as assert from 'assert';
import { buildDiffMeta, diffCellWindow, DIFF_BPR } from '../../core/diff';
import type { CompactParseResult } from '../../core/parser/compact';
import type { SerializedParseResult } from '../../core/types';
import { buildSegmentIndex } from '../../core/memory';

function result(segments: Array<{ startAddress: number; data: Uint8Array }>): CompactParseResult {
    return {
        records: { pageCount: 0, get: () => undefined } as never,
        segments,
        totalDataBytes: segments.reduce((n, s) => n + s.data.length, 0),
        checksumErrors: 0,
        malformedLines: 0,
    };
}

function seg(startAddress: number, bytes: number[]): { startAddress: number; data: Uint8Array } {
    return { startAddress, data: Uint8Array.from(bytes) };
}

function serialized(segments: Array<{ startAddress: number; data: Uint8Array }>): SerializedParseResult {
    return {
        records: [],
        segments,
        totalDataBytes: segments.reduce((n, s) => n + s.data.length, 0),
        checksumErrors: 0,
        malformedLines: 0,
        format: 'ihex',
    };
}

function metaOf(segmentsA: Array<{ startAddress: number; data: Uint8Array }> | null, segmentsB: Array<{ startAddress: number; data: Uint8Array }> | null) {
    return buildDiffMeta(segmentsA ? result(segmentsA) : null, segmentsB ? result(segmentsB) : null);
}

suite('core diff meta pass', () => {
    test('identical files -> all unchanged, identical=true, no runs', () => {
        const d = metaOf([seg(0x1000, [1, 2, 3, 4])], [seg(0x1000, [1, 2, 3, 4])]);
        assert.strictEqual(d.identical, true);
        assert.strictEqual(d.summary.unchanged, 4);
        assert.strictEqual(d.summary.changed, 0);
        assert.strictEqual(d.summary.added, 0);
        assert.strictEqual(d.summary.removed, 0);
        assert.deepStrictEqual(d.runs, []);
        assert.strictEqual(d.totalRows, 1); // one aligned row of 16
        assert.strictEqual(d.hasDiff[0], 0);
    });

    test('one byte differs -> changed, single run at that address, row flagged', () => {
        const d = metaOf([seg(0x1000, [1, 2, 3, 4])], [seg(0x1000, [1, 9, 3, 4])]);
        assert.strictEqual(d.identical, false);
        assert.strictEqual(d.summary.changed, 1);
        assert.deepStrictEqual(d.runs, [{ start: 0x1001, end: 0x1001 }]);
        assert.strictEqual(d.hasDiff[0], 1);
    });

    test('B has extra range -> added status', () => {
        const d = metaOf([seg(0x1000, [1, 2, 3, 4])], [seg(0x1000, [1, 2, 3, 4]), seg(0x1010, [5, 6])]);
        assert.strictEqual(d.summary.added, 2);
        assert.strictEqual(d.hasDiff[1], 1);
    });

    test('A has extra range -> removed status', () => {
        const d = metaOf([seg(0x1000, [1, 2, 3, 4]), seg(0x1010, [5, 6])], [seg(0x1000, [1, 2, 3, 4])]);
        assert.strictEqual(d.summary.removed, 2);
        assert.strictEqual(d.hasDiff[1], 1);
    });

    test('differing address spaces align by address', () => {
        const d = metaOf([seg(0x2000, [1, 2, 3, 4])], [seg(0x2100, [1, 2, 3, 4])]);
        assert.deepStrictEqual(Array.from(d.rowStarts), [0x2000, 0x2100]);
        assert.strictEqual(d.summary.removed, 4);
        assert.strictEqual(d.summary.added, 4);
        assert.strictEqual(d.summary.unchanged, 0);
    });

    test('mid-row segment start gets leading aligned row', () => {
        const d = metaOf([seg(0x1002, [9, 9, 9])], [seg(0x1002, [9, 9, 9])]);
        assert.strictEqual(d.rowStarts[0], 0x1000);
    });

    test('gap between distant segments -> no rows in gap, no misalignment', () => {
        const d = metaOf([seg(0x1000, [1]), seg(0x1100, [2])], [seg(0x1000, [1]), seg(0x1100, [2])]);
        assert.strictEqual(d.identical, true);
        assert.deepStrictEqual(Array.from(d.rowStarts), [0x1000, 0x1100]);
    });

    test('run merges across row boundary', () => {
        const d = metaOf(
            [seg(0x1000, Array.from({ length: 20 }, (_, i) => i))],
            [seg(0x1000, Array.from({ length: 20 }, (_, i) => i + 1))],
        );
        assert.deepStrictEqual(d.runs, [{ start: 0x1000, end: 0x1013 }]);
        assert.strictEqual(d.summary.changed, 20);
    });

    test('empty inputs -> empty result, identical', () => {
        const d = metaOf(null, null);
        assert.strictEqual(d.totalRows, 0);
        assert.strictEqual(d.identical, true);
        assert.deepStrictEqual(d.runs, []);
    });

    test('one side empty -> all bytes added', () => {
        const d = metaOf(null, [seg(0x1000, [1, 2, 3, 4])]);
        assert.strictEqual(d.summary.added, 4);
        assert.strictEqual(d.summary.removed, 0);
    });

    test('address 0 is valid, never treated as absent', () => {
        const d = metaOf([seg(0x0, [1, 2, 3, 4])], [seg(0x0, [1, 2, 3, 4])]);
        assert.strictEqual(d.summary.unchanged, 4);
        assert.strictEqual(d.rowStarts[0], 0);
    });

    test('bytes per row constant is 16', () => {
        assert.strictEqual(DIFF_BPR, 16);
    });
});

suite('core diff windowed reader', () => {
    test('window at a row returns 16 distinct per-address cells + statuses', () => {
        const a = serialized([seg(0x1000, [1, 2, 3, 4])]);
        const b = serialized([seg(0x1000, [1, 9, 3, 4])]);
        const aIndex = buildSegmentIndex(a);
        const bIndex = buildSegmentIndex(b);
        const w = diffCellWindow(a, aIndex, b, bIndex, 0x1000);
        assert.strictEqual(w.baseAddress, 0x1000);
        assert.deepStrictEqual(w.a.slice(0, 4).map(c => c?.byte), [1, 2, 3, 4]);
        assert.strictEqual(w.a[4], null, 'addresses past the file end are empty cells');
        assert.strictEqual(w.statuses[1], 'changed');
        assert.strictEqual(w.statuses[0], 'unchanged');
        assert.strictEqual(w.statuses[5], 'empty');
    });

    test('added/removed cells surface in the window', () => {
        const a = serialized([seg(0x1000, [5, 6])]);
        const b = serialized([seg(0x1010, [7])]);
        const aIndex = buildSegmentIndex(a);
        const bIndex = buildSegmentIndex(b);
        const removed = diffCellWindow(a, aIndex, b, bIndex, 0x1000);
        assert.strictEqual(removed.statuses[0], 'removed');
        assert.strictEqual(removed.a[0]?.byte, 5);
        assert.strictEqual(removed.b[0], null);
        const added = diffCellWindow(a, aIndex, b, bIndex, 0x1010);
        assert.strictEqual(added.statuses[0], 'added');
        assert.strictEqual(added.a[0], null);
        assert.strictEqual(added.b[0]?.byte, 7);
    });

    test('cross-format-like pair (different segment layouts) aligns by address', () => {
        const a = serialized([seg(0x2000, [1, 2])]);
        const b = serialized([seg(0x2100, [1, 2])]);
        const aIndex = buildSegmentIndex(a);
        const bIndex = buildSegmentIndex(b);
        const wA = diffCellWindow(a, aIndex, b, bIndex, 0x2000);
        assert.strictEqual(wA.statuses[0], 'removed');
        const wB = diffCellWindow(a, aIndex, b, bIndex, 0x2100);
        assert.strictEqual(wB.statuses[0], 'added');
    });
});
