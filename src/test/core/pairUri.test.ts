import * as assert from 'assert';
import { decodePairKey, encodePairKey } from '../../core/pairUri';

suite('pair URI encoding (D14)', () => {
    test('round-trip preserves both paths', () => {
        const a = 'C:\\fw\\v1.hex';
        const b = 'C:\\fw\\v2.hex';
        const back = decodePairKey(encodePairKey(a, b));
        assert.strictEqual(back.aPath, a);
        assert.strictEqual(back.bPath, b);
    });

    test('canonical: same pair maps to same key regardless of argument order', () => {
        const a = 'C:\\fw\\a.hex';
        const b = 'C:\\fw\\b.hex';
        const k1 = encodePairKey(a, b);
        const k2 = encodePairKey(b, a);
        assert.strictEqual(k1, k2);
    });

    test('canonical: decode always returns A < B by fsPath', () => {
        const first = 'C:\\fw\\zeta.hex';
        const second = 'C:\\fw\\alpha.hex';
        const back = decodePairKey(encodePairKey(first, second));
        assert.strictEqual(back.aPath, second); // alpha is A
        assert.strictEqual(back.bPath, first);  // zeta is B
    });

    test('same-name different-folder pairs stay distinct', () => {
        const k1 = encodePairKey('C:\\one\\f.hex', 'C:\\one\\g.hex');
        const k2 = encodePairKey('C:\\two\\f.hex', 'C:\\two\\g.hex');
        assert.notStrictEqual(k1, k2);
    });

    test('same URI pair is stable and equal to itself', () => {
        const a = 'C:\\fw\\same.hex';
        const k1 = encodePairKey(a, a);
        const k2 = encodePairKey(a, a);
        assert.strictEqual(k1, k2);
        const back = decodePairKey(k1);
        assert.strictEqual(back.aPath, a);
        assert.strictEqual(back.bPath, a);
    });

    test('spaces and unicode in paths survive round-trip', () => {
        const a = 'C:\\my files\\vérsión 1.hex';
        const b = 'C:\\my files\\v2.hex';
        const key = encodePairKey(a, b);
        const back = decodePairKey(key);
        // Canonical order is deterministic (UTF-16 compare); both paths must
        // come back intact regardless of which is A.
        const returned = [back.aPath, back.bPath];
        assert.ok(returned.includes(a), `expected ${a} in [${returned}]`);
        assert.ok(returned.includes(b), `expected ${b} in [${returned}]`);
        // Same key for swapped args.
        assert.strictEqual(encodePairKey(b, a), key);
    });
});
