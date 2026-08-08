import * as assert from 'assert';
import { SearchEngine } from '../../core/search';

function runSearch(mode: string, raw: string, segments: { startAddress: number; data: Uint8Array }[]): Promise<number[]> {
    return new Promise(resolve => {
        new SearchEngine().search(
            { mode: mode as any, raw, segments } as any,
            { onComplete: resolve },
        );
    });
}

suite('SearchEngine large-segment performance', () => {
    test('scans a 4 MiB typed segment without per-byte clock overhead', async () => {
        const data = new Uint8Array(4 * 1024 * 1024);
        const started = performance.now();
        const matches = await runSearch('bytes', 'FF', [{ startAddress: 0, data }]);
        const elapsed = performance.now() - started;

        assert.deepStrictEqual(matches, []);
        assert.ok(elapsed < 300, `4 MiB search took ${Math.round(elapsed)} ms`);
    });
});
