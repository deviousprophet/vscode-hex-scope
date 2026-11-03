import * as assert from 'assert';
import {
    applyRangePatch,
    collectRemovedRuns,
    deleteRange,
    insertBytes,
    invertRangePatch,
    normalizeSegments,
    replaceRange,
    segmentsEqual,
    type StructuralSegment,
} from '../../core/structural';

function seg(startAddress: number, bytes: number[]): StructuralSegment {
    return { startAddress, data: Uint8Array.from(bytes) };
}

function bytesOf(segments: readonly StructuralSegment[]): number[] {
    return segments.flatMap(segment => Array.from(segment.data));
}

function layout(segments: readonly StructuralSegment[]): string {
    return segments.map(segment => `${segment.startAddress.toString(16)}:${Array.from(segment.data).map(b => b.toString(16).padStart(2, '0')).join('')}`).join('|');
}

suite('structural segments', () => {
    test('normalize sorts, drops empties, and merges adjacent segments', () => {
        const out = normalizeSegments([
            seg(0x10, []),
            seg(0x14, [4, 5]),
            seg(0x10, [1, 2, 3, 4]),
        ]);
        assert.strictEqual(layout(out), '10:010203040405');
    });

    test('insert inside a segment grows it and shifts later segments', () => {
        const out = insertBytes([seg(0x1000, [1, 2, 3]), seg(0x2000, [9])], 0x1001, [0xAA, 0xBB]);
        assert.strictEqual(layout(out), '1000:01aabb0203|2002:09');
    });

    test('insert at segment start prepends and shifts the segment', () => {
        const out = insertBytes([seg(0x1000, [1, 2]), seg(0x1010, [3])], 0x1000, [0xAA]);
        assert.strictEqual(layout(out), '1000:aa0102|1011:03');
    });

    test('insert into a gap creates a segment and shifts later data', () => {
        const out = insertBytes([seg(0x1000, [1]), seg(0x1010, [2])], 0x1008, [0xAA, 0xBB]);
        assert.strictEqual(layout(out), '1000:01|1008:aabb|1012:02');
    });

    test('insert after the last segment appends without shifting', () => {
        const out = insertBytes([seg(0x1000, [1])], 0x1001, [2, 3]);
        assert.strictEqual(layout(out), '1000:010203');
    });

    test('delete inside a segment shifts following bytes left', () => {
        const out = deleteRange([seg(0x1000, [1, 2, 3, 4, 5])], 0x1001, 0x1003);
        assert.strictEqual(layout(out), '1000:0105');
    });

    test('delete at address zero works', () => {
        const out = deleteRange([seg(0, [1, 2, 3])], 0, 0);
        assert.strictEqual(layout(out), '0:0203');
    });

    test('delete spanning a gap removes only mapped bytes', () => {
        const out = deleteRange([seg(0x1000, [1, 2]), seg(0x1010, [3, 4])], 0x1001, 0x1010);
        assert.strictEqual(layout(out), '1000:01|100f:04');
    });

    test('replace grow shifts later data by the net delta', () => {
        const { segments, patch } = replaceRange([seg(0x1000, [1, 2, 3, 4])], 0x1001, 0x1002, [0xAA, 0xBB, 0xCC]);
        assert.strictEqual(layout(segments), '1000:01aabbcc04');
        assert.deepStrictEqual(bytesOf(segments), [1, 0xAA, 0xBB, 0xCC, 4]);
        assert.deepStrictEqual(patch.removed.map(run => [run.start, Array.from(run.data)]), [[0x1001, [2, 3]]]);
    });

    test('replace shrink shifts later data left', () => {
        const { segments } = replaceRange([seg(0x1000, [1, 2, 3, 4])], 0x1001, 0x1003, [0xAA]);
        assert.strictEqual(layout(segments), '1000:01aa');
    });

    test('replace with equal length keeps the document length', () => {
        const { segments } = replaceRange([seg(0x1000, [1, 2, 3])], 0x1000, 0x1002, [7, 8, 9]);
        assert.strictEqual(layout(segments), '1000:070809');
    });

    test('replace a gap-spanning selection preserves the gap after the range', () => {
        const { segments } = replaceRange([seg(0x1000, [1, 2]), seg(0x1010, [3, 4])], 0x1001, 0x1010, [0xAA]);
        assert.strictEqual(layout(segments), '1000:01aa|1010:04');
    });

    test('apply then invert a patch restores the original document', () => {
        const original = [seg(0x1000, [1, 2, 3]), seg(0x1010, [4, 5])];
        const { segments, patch } = replaceRange(original, 0x1001, 0x1010, [0xAA, 0xBB]);
        const restored = invertRangePatch(segments, patch);
        assert.strictEqual(layout(restored), layout(normalizeSegments(original)));
        assert.deepStrictEqual(bytesOf(restored), bytesOf(normalizeSegments(original)));
    });

    test('applyRangePatch is the forward operation', () => {
        const original = [seg(0x1000, [1, 2, 3])];
        const { segments, patch } = replaceRange(original, 0x1001, 0x1001, [0xAA, 0xBB]);
        assert.strictEqual(layout(applyRangePatch(original, patch)), layout(segments));
    });

    test('pure insert and pure delete patches invert', () => {
        const original = [seg(0x1000, [1, 2])];
        const insertPatch = { start: 0x1001, end: 0x1000, inserted: Uint8Array.from([9]), removed: [] };
        const inserted = applyRangePatch(original, insertPatch);
        assert.strictEqual(layout(inserted), '1000:010902');
        assert.strictEqual(layout(invertRangePatch(inserted, insertPatch)), '1000:0102');

        const deletePatch = { start: 0x1000, end: 0x1000, inserted: new Uint8Array(0), removed: [{ start: 0x1000, data: Uint8Array.from([1]) }] };
        const deleted = applyRangePatch(original, deletePatch);
        assert.strictEqual(layout(deleted), '1000:02');
        assert.strictEqual(layout(invertRangePatch(deleted, deletePatch)), '1000:0102');
    });

    test('collectRemovedRuns reports each mapped run', () => {
        const runs = collectRemovedRuns([seg(0x1000, [1, 2]), seg(0x1010, [3, 4])], 0x1001, 0x1010);
        assert.deepStrictEqual(runs.map(run => [run.start, Array.from(run.data)]), [[0x1001, [2]], [0x1010, [3]]]);
    });

    test('zero-length insert is a no-op', () => {
        const original = [seg(0x1000, [1])];
        assert.strictEqual(layout(insertBytes(original, 0x1000, [])), layout(original));
    });
});

suite('structural segment equality', () => {
    test('compares addresses and bytes', () => {
        assert.strictEqual(segmentsEqual([seg(0x1000, [1, 2])], [seg(0x1000, [1, 2])]), true);
        assert.strictEqual(segmentsEqual([seg(0x1000, [1, 2])], [seg(0x1000, [1, 3])]), false);
        assert.strictEqual(segmentsEqual([seg(0x1000, [1])], [seg(0x1001, [1])]), false);
        assert.strictEqual(segmentsEqual([], []), true);
    });
});
