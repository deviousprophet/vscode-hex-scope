import * as assert from 'assert';
import { SearchEngine, canonicalizeQuery } from '../../core/search';

function segWithMarkerAt(length: number, markerAddr: number): { startAddress: number; data: Uint8Array } {
    const data = new Uint8Array(length);
    data[markerAddr] = 0xFF;
    return { startAddress: 0, data };
}

function runSearch(mode: string, raw: string, segments: { startAddress: number; data: Uint8Array }[]): Promise<number[]> {
    return new Promise(resolve => {
        new SearchEngine().search(
            { mode: mode as any, raw, segments } as any,
            { onComplete: resolve },
        );
    });
}

suite('SearchEngine address search', () => {
    test('address queries match their canonical form', async () => {
        for (const query of ['1A0', '0x1A0', '000001A0']) {
            const matches = await runSearch('addr', query, [segWithMarkerAt(417, 0x1A0)]);
            assert.deepStrictEqual(matches, [0x1A0], query);
        }
    });

    test('address "FFFFFFFF" matches max 32-bit address', async () => {
        const matches = await runSearch('addr', 'FFFFFFFF', [{ startAddress: 0xFFFFFFF0, data: new Uint8Array(16) }]);
        assert.deepStrictEqual(matches, [0xFFFFFFFF]);
    });

    test('no false positive: "1A0" does not match 0x100001A0', async () => {
        const matches = await runSearch('addr', '1A0', [{ startAddress: 0x100001A0, data: new Uint8Array(2) }]);
        assert.deepStrictEqual(matches, []);
    });

    test('empty query returns empty matches', async () => {
        const matches = await runSearch('addr', '', [{ startAddress: 0, data: new Uint8Array(10) }]);
        assert.deepStrictEqual(matches, []);
    });

    test('non-hex query returns empty matches without crash', async () => {
        const matches = await runSearch('addr', 'ZZZ', [{ startAddress: 0, data: new Uint8Array(10) }]);
        assert.deepStrictEqual(matches, []);
    });

    test('overflow: >8 hex chars returns empty (no silent wrap)', async () => {
        for (const query of ['100000000', '0x100000000']) {
            const matches = await runSearch('addr', query, [{ startAddress: 0, data: new Uint8Array(10) }]);
            assert.deepStrictEqual(matches, [], query);
        }
    });

    test('canonicalizeQuery normalizes address inputs', () => {
        assert.strictEqual(canonicalizeQuery('addr', '0x1A0'), '1A0');
        assert.strictEqual(canonicalizeQuery('addr', '1A0'), '1A0');
        assert.strictEqual(canonicalizeQuery('addr', '000001A0'), '000001A0');
    });
});
