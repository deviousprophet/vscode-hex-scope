import * as assert from 'assert';
import { computeDiff, DIFF_BPR } from '../../core/diff';
import type { CompactParseResult } from '../../core/parser/compact';

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

suite('core diff', () => {
    test('identical files -> all unchanged, identical=true, no runs', () => {
        const a = result([seg(0x1000, [1, 2, 3, 4])]);
        const b = result([seg(0x1000, [1, 2, 3, 4])]);
        const d = computeDiff(a, b);
        assert.strictEqual(d.identical, true);
        assert.strictEqual(d.summary.unchanged, 4);
        assert.strictEqual(d.summary.changed, 0);
        assert.strictEqual(d.summary.added, 0);
        assert.strictEqual(d.summary.removed, 0);
        assert.deepStrictEqual(d.runs, []);
        assert.strictEqual(d.rows.length, 16); // one aligned row of 16
    });

    test('one byte differs -> changed, single run at that address', () => {
        const a = result([seg(0x1000, [1, 2, 3, 4])]);
        const b = result([seg(0x1000, [1, 9, 3, 4])]);
        const d = computeDiff(a, b);
        assert.strictEqual(d.identical, false);
        assert.strictEqual(d.summary.changed, 1);
        assert.deepStrictEqual(d.runs, [{ start: 0x1001, end: 0x1001 }]);
        const row = d.rows.find(r => r.address === 0x1001)!;
        assert.strictEqual(row.status, 'changed');
        assert.strictEqual(row.a!.byte, 2);
        assert.strictEqual(row.b!.byte, 9);
    });

    test('B has extra range -> added status', () => {
        const a = result([seg(0x1000, [1, 2, 3, 4])]);
        const b = result([seg(0x1000, [1, 2, 3, 4]), seg(0x1010, [5, 6])]);
        const d = computeDiff(a, b);
        assert.strictEqual(d.summary.added, 2);
        const addedRow = d.rows.find(r => r.address === 0x1010)!;
        assert.strictEqual(addedRow.status, 'added');
        assert.strictEqual(addedRow.a, null);
        assert.strictEqual(addedRow.b!.byte, 5);
    });

    test('A has extra range -> removed status', () => {
        const a = result([seg(0x1000, [1, 2, 3, 4]), seg(0x1010, [5, 6])]);
        const b = result([seg(0x1000, [1, 2, 3, 4])]);
        const d = computeDiff(a, b);
        assert.strictEqual(d.summary.removed, 2);
        const removedRow = d.rows.find(r => r.address === 0x1010)!;
        assert.strictEqual(removedRow.status, 'removed');
        assert.strictEqual(removedRow.a!.byte, 5);
        assert.strictEqual(removedRow.b, null);
    });

    test('differing address spaces align by address (AC6)', () => {
        const a = result([seg(0x2000, [1, 2, 3, 4])]);
        const b = result([seg(0x2100, [1, 2, 3, 4])]);
        const d = computeDiff(a, b);
        // rows cover 0x2000-0x200F and 0x2100-0x210F (two aligned rows)
        assert.deepStrictEqual(d.rows.map(r => r.address), [
            ...Array.from({ length: 16 }, (_, i) => 0x2000 + i),
            ...Array.from({ length: 16 }, (_, i) => 0x2100 + i),
        ]);
        assert.strictEqual(d.summary.removed, 4); // A's bytes gone from B
        assert.strictEqual(d.summary.added, 4);   // B's bytes new vs A
        assert.strictEqual(d.summary.unchanged, 0);
    });

    test('mid-row segment start gets leading aligned row (AC2b)', () => {
        const a = result([seg(0x1002, [9, 9, 9])]);
        const b = result([seg(0x1002, [9, 9, 9])]);
        const d = computeDiff(a, b);
        assert.strictEqual(d.rows[0].address, 0x1000);
        assert.strictEqual(d.rows[0].status, 'empty');
    });

    test('gap between distant segments -> no rows in gap, no misalignment', () => {
        const a = result([seg(0x1000, [1]), seg(0x1100, [2])]);
        const b = result([seg(0x1000, [1]), seg(0x1100, [2])]);
        const d = computeDiff(a, b);
        assert.strictEqual(d.identical, true);
        // Only each segment's own span is covered; the gap 0x1010-0x10FF has no rows.
        assert.deepStrictEqual(d.rows.map(r => r.address), [
            ...Array.from({ length: 16 }, (_, i) => 0x1000 + i),
            ...Array.from({ length: 16 }, (_, i) => 0x1100 + i),
        ]);
        assert.ok(!d.rows.some(r => r.address === 0x1050));
    });

    test('run merges across row boundary (D16)', () => {
        const a = result([seg(0x1000, Array.from({ length: 20 }, (_, i) => i))]);
        const b = result([seg(0x1000, Array.from({ length: 20 }, (_, i) => i + 1))]);
        const d = computeDiff(a, b);
        assert.deepStrictEqual(d.runs, [{ start: 0x1000, end: 0x1013 }]);
        assert.strictEqual(d.summary.changed, 20);
    });

    test('empty inputs -> empty result, identical', () => {
        const d = computeDiff(null, null);
        assert.strictEqual(d.rows.length, 0);
        assert.strictEqual(d.identical, true);
        assert.deepStrictEqual(d.runs, []);
    });

    test('one side empty -> all bytes added', () => {
        const d = computeDiff(null, result([seg(0x1000, [1, 2, 3, 4])]));
        assert.strictEqual(d.summary.added, 4);
        assert.strictEqual(d.summary.removed, 0);
    });

    test('address 0 is valid, never treated as absent', () => {
        const a = result([seg(0x0, [1, 2, 3, 4])]);
        const b = result([seg(0x0, [1, 2, 3, 4])]);
        const d = computeDiff(a, b);
        assert.strictEqual(d.summary.unchanged, 4);
        assert.strictEqual(d.rows[0].address, 0);
    });

    test('bytes per row constant is 16', () => {
        assert.strictEqual(DIFF_BPR, 16);
    });
});
