import * as assert from 'assert';
import { computeByteDiff } from '../../core/diff';
import type { MemorySegment } from '../../core/parser/types';
import { disambiguatedLabels } from '../../core/diffLabels';

function seg(startAddress: number, bytes: number[]): MemorySegment {
    return { startAddress, data: Uint8Array.from(bytes) };
}

suite('computeByteDiff', () => {
    test('identical segments report an empty diff', () => {
        const a = [seg(0x1000, [0xDE, 0xAD, 0xBE, 0xEF])];
        const model = computeByteDiff(a, [seg(0x1000, [0xDE, 0xAD, 0xBE, 0xEF])]);
        assert.deepStrictEqual(model.summary, { changed: 0, added: 0, removed: 0 });
        assert.deepStrictEqual(model.runs, []);
    });

    test('a single differing byte reports one changed run', () => {
        const model = computeByteDiff([seg(0x1000, [0x01, 0x02, 0x03])], [seg(0x1000, [0x01, 0x09, 0x03])]);
        assert.deepStrictEqual(model.summary, { changed: 1, added: 0, removed: 0 });
        assert.deepStrictEqual(model.runs, [{ start: 0x1001, end: 0x1001, kind: 'changed', count: 1 }]);
    });

    test('adjacent differing addresses merge into one run', () => {
        const model = computeByteDiff([seg(0, [1, 2, 3, 4])], [seg(0, [9, 8, 7, 4])]);
        assert.deepStrictEqual(model.summary, { changed: 3, added: 0, removed: 0 });
        assert.deepStrictEqual(model.runs, [{ start: 0, end: 2, kind: 'changed', count: 3 }]);
    });

    test('addresses mapped only in B are added', () => {
        const model = computeByteDiff([], [seg(0x2000, [0xAA, 0xBB])]);
        assert.deepStrictEqual(model.summary, { changed: 0, added: 2, removed: 0 });
        assert.deepStrictEqual(model.runs, [{ start: 0x2000, end: 0x2001, kind: 'added', count: 2 }]);
    });

    test('addresses mapped only in A are removed', () => {
        const model = computeByteDiff([seg(0x3000, [0xAA, 0xBB])], []);
        assert.deepStrictEqual(model.summary, { changed: 0, added: 0, removed: 2 });
        assert.deepStrictEqual(model.runs, [{ start: 0x3000, end: 0x3001, kind: 'removed', count: 2 }]);
    });

    test('true address holes never appear in the diff', () => {
        const a = [seg(0x10, [0x01, 0x02])];
        const b = [seg(0x20, [0x03, 0x04])];
        const model = computeByteDiff(a, b);
        assert.deepStrictEqual(model.summary, { changed: 0, added: 2, removed: 2 });
        assert.deepStrictEqual(model.runs, [
            { start: 0x10, end: 0x11, kind: 'removed', count: 2 },
            { start: 0x20, end: 0x21, kind: 'added', count: 2 },
        ]);
    });

    test('different run kinds at adjacent addresses stay separate', () => {
        const a = [seg(0x100, [0x01, 0x02, 0x03])];
        const b = [seg(0x100, [0x01, 0xFF, 0x03]), seg(0x103, [0xEE])];
        const model = computeByteDiff(a, b);
        assert.deepStrictEqual(model.runs, [
            { start: 0x101, end: 0x101, kind: 'changed', count: 1 },
            { start: 0x103, end: 0x103, kind: 'added', count: 1 },
        ]);
    });

    test('empty inputs report an empty diff', () => {
        const model = computeByteDiff([], []);
        assert.deepStrictEqual(model.summary, { changed: 0, added: 0, removed: 0 });
        assert.deepStrictEqual(model.runs, []);
    });

    test('address 0 and the last byte of a segment are compared', () => {
        const model = computeByteDiff([seg(0, [0x00, 0x11, 0x22])], [seg(0, [0xFF, 0x11, 0x33])]);
        assert.deepStrictEqual(model.runs, [
            { start: 0, end: 0, kind: 'changed', count: 1 },
            { start: 2, end: 2, kind: 'changed', count: 1 },
        ]);
    });

    test('segments are sorted by resolved address before comparison', () => {
        const a = [seg(0x1010, [0x01]), seg(0x1000, [0x02])];
        const b = [seg(0x1000, [0x02])];
        const model = computeByteDiff(a, b);
        assert.deepStrictEqual(model.runs, [{ start: 0x1010, end: 0x1010, kind: 'removed', count: 1 }]);
    });

    test('comparison works at the top of the 32-bit address space', () => {
        const model = computeByteDiff(
            [seg(0xFFFFFFFC, [0x01, 0x02, 0x03, 0x04])],
            [seg(0xFFFFFFFC, [0x01, 0x02, 0x03, 0x05])],
        );
        assert.deepStrictEqual(model.runs, [{ start: 0xFFFFFFFF, end: 0xFFFFFFFF, kind: 'changed', count: 1 }]);
    });
});

suite('disambiguatedLabels', () => {
    test('uses basenames when they differ', () => {
        assert.deepStrictEqual(
            disambiguatedLabels({ name: 'a.hex', path: '/x/a.hex' }, { name: 'b.hex', path: '/x/b.hex' }),
            ['a.hex', 'b.hex'],
        );
    });

    test('uses the shortest disambiguating suffix when basenames collide', () => {
        assert.deepStrictEqual(
            disambiguatedLabels({ name: 'firmware.hex', path: '/one/fw/firmware.hex' }, { name: 'firmware.hex', path: '/two/fw/firmware.hex' }),
            ['one/fw/firmware.hex', 'two/fw/firmware.hex'],
        );
    });

    test('grows the suffix until the paths differ', () => {
        assert.deepStrictEqual(
            disambiguatedLabels({ name: 'firmware.hex', path: '/one/firmware.hex' }, { name: 'firmware.hex', path: '/two/firmware.hex' }),
            ['one/firmware.hex', 'two/firmware.hex'],
        );
    });
});
