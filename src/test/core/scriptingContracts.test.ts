import * as assert from 'assert';
import * as vm from 'node:vm';
import { normalizeScriptValue } from '../../core/scripting/contracts';

suite('normalizeScriptValue', () => {
    test('getAddress accepts unsigned 32-bit integers', () => {
        assert.deepStrictEqual(normalizeScriptValue('getAddress', 0), { ok: true, value: 0 });
        assert.deepStrictEqual(normalizeScriptValue('getAddress', 0xFFFF_FFFF), { ok: true, value: 0xFFFF_FFFF });
    });

    test('getAddress rejects fractions, negatives, overflow, and non-numbers', () => {
        for (const value of [-1, 1.5, 0x1_0000_0000, NaN, Infinity, '0x10', null, {}]) {
            const out = normalizeScriptValue('getAddress', value);
            assert.strictEqual(out.ok, false, `rejects ${String(value)}`);
        }
    });

    test('getSize requires a positive safe integer', () => {
        assert.deepStrictEqual(normalizeScriptValue('getSize', 1), { ok: true, value: 1 });
        assert.deepStrictEqual(normalizeScriptValue('getSize', 1_000_000), { ok: true, value: 1_000_000 });
        for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 2, '4']) {
            assert.strictEqual(normalizeScriptValue('getSize', value).ok, false, `rejects ${String(value)}`);
        }
    });

    test('verifyIntegrity accepts booleans only', () => {
        assert.deepStrictEqual(normalizeScriptValue('verifyIntegrity', true), { ok: true, value: true });
        assert.deepStrictEqual(normalizeScriptValue('verifyIntegrity', false), { ok: true, value: false });
        for (const value of [1, 0, 'true', null]) {
            assert.strictEqual(normalizeScriptValue('verifyIntegrity', value).ok, false);
        }
    });

    test('getIntegrityValue accepts number[] and a cross-realm Uint8Array', () => {
        assert.deepStrictEqual(normalizeScriptValue('getIntegrityValue', [0, 1, 255]), { ok: true, value: [0, 1, 255] });
        const foreign = vm.runInNewContext('new Uint8Array([1, 2, 3])') as Uint8Array;
        assert.deepStrictEqual(normalizeScriptValue('getIntegrityValue', foreign), { ok: true, value: [1, 2, 3] });
    });

    test('getIntegrityValue rejects empty, sparse, out-of-range, and non-byte input', () => {
        const sparse = [1, , 3];
        for (const value of [[], sparse, [256], [-1], [1.5], ['1'], 'bytes', null]) {
            assert.strictEqual(normalizeScriptValue('getIntegrityValue', value).ok, false, `rejects ${String(value)}`);
        }
    });

    test('run has no value contract', () => {
        assert.strictEqual(normalizeScriptValue('run', 1).ok, false);
    });
});
