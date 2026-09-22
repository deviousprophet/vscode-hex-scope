import * as assert from 'assert';
import { buildDiffState, reloadIsStale, reloadState, sideDefects } from '../../diff/diffReload';
import type { WireParseResult } from '../../core/types';

function wire(segments: Array<[number, number[]]>, defects: { checksumErrors?: number; malformedLines?: number } = {}): WireParseResult {
    return {
        recordCount: segments.length,
        segments: segments.map(([startAddress, bytes]) => ({
            startAddress,
            data: Uint8Array.from(bytes).buffer as ArrayBuffer,
        })),
        totalDataBytes: segments.reduce((sum, [, bytes]) => sum + bytes.length, 0),
        checksumErrors: defects.checksumErrors ?? 0,
        malformedLines: defects.malformedLines ?? 0,
        format: 'ihex',
    };
}

const REF_A = { name: 'a.hex', path: '/fw/a.hex' };
const REF_B = { name: 'b.srec', path: '/fw/b.srec' };

suite('diffExternalChange host decisions', () => {
    test('a clean side has no defects', () => {
        assert.strictEqual(sideDefects(wire([[0x1000, [0x01]]])), null);
    });

    test('checksum-only errors stay quick-repairable', () => {
        assert.deepStrictEqual(sideDefects(wire([[0x1000, [0x01]]], { checksumErrors: 2 })), {
            checksumErrors: 2,
            malformedLines: 0,
            canQuickRepair: true,
        });
    });

    test('malformed lines block quick repair', () => {
        assert.deepStrictEqual(sideDefects(wire([[0x1000, [0x01]]], { checksumErrors: 1, malformedLines: 3 })), {
            checksumErrors: 1,
            malformedLines: 3,
            canQuickRepair: false,
        });
    });

    test('building the initial state carries both refs and the diff', () => {
        const state = buildDiffState(REF_A, { format: 'ihex', wire: wire([[0x1000, [0x01]]]) }, REF_B, { format: 'srec', wire: wire([[0x1000, [0x02]]]) });
        assert.strictEqual(state.a.name, 'a.hex');
        assert.strictEqual(state.a.format, 'ihex');
        assert.strictEqual(state.b.name, 'b.srec');
        assert.strictEqual(state.b.format, 'srec');
        assert.deepStrictEqual(state.diff.summary, { changed: 1, added: 0, removed: 0 });
    });

    test('reloading one side leaves the other untouched and recomputes the diff', () => {
        const state = buildDiffState(REF_A, { format: 'ihex', wire: wire([[0x1000, [0x01]]]) }, REF_B, { format: 'srec', wire: wire([[0x1000, [0x01]]]) });
        assert.deepStrictEqual(state.diff.summary, { changed: 0, added: 0, removed: 0 });

        const reloaded = reloadState(state, 'b', REF_B, { format: 'srec', wire: wire([[0x1000, [0x01, 0xAA]]]) });
        assert.strictEqual(reloaded.a, state.a, 'the untouched side is reused');
        assert.deepStrictEqual(reloaded.diff.summary, { changed: 0, added: 1, removed: 0 }, 'B-only bytes read as added');

        const swapped = reloadState(reloaded, 'a', REF_A, { format: 'ihex', wire: wire([[0x1000, [0x01, 0xAA]]]) });
        assert.deepStrictEqual(swapped.diff.summary, { changed: 0, added: 0, removed: 0 }, 'matching the other side clears the diff');
    });

    test('a pending reload survives the other side reloading first (per-side generation)', () => {
        const state = buildDiffState(REF_A, { format: 'ihex', wire: wire([[0x1000, [0x01]]]) }, REF_B, { format: 'srec', wire: wire([[0x1000, [0x01]]]) });
        // Side A read is in flight (gen 1); side B bumps *its own* counter to 1 and reloads.
        const afterB = reloadState(state, 'b', REF_B, { format: 'srec', wire: wire([[0x1000, [0x01, 0x02]]]) });
        assert.strictEqual(reloadIsStale(false, 1, 1, afterB), false, 'A is not staled out by B');
        // A applies against the *current* state, so B's fresh bytes survive.
        const afterA = reloadState(afterB, 'a', REF_A, { format: 'ihex', wire: wire([[0x1000, [0x09]]]) });
        assert.deepStrictEqual(afterA.diff.summary, { changed: 1, added: 1, removed: 0 });
    });

    test('the reload guard drops stale/disposed/no-state reloads', () => {
        const state = buildDiffState(REF_A, { format: 'ihex', wire: wire([[0x1000, [0x01]]]) }, REF_B, { format: 'srec', wire: wire([[0x1000, [0x01]]]) });
        assert.strictEqual(reloadIsStale(false, 1, 1, state), false);
        assert.strictEqual(reloadIsStale(false, 1, 2, state), true, 'a newer reload of the same side wins');
        assert.strictEqual(reloadIsStale(true, 1, 1, state), true, 'a disposed panel posts nothing');
        assert.strictEqual(reloadIsStale(false, 1, 1, null), true, 'no loaded state means nothing to reload');
    });
});
