import * as assert from 'assert';
import { SearchEngine } from '../../core/search';

suite('SearchEngine large-segment performance', () => {
    test('scans a 4 MiB typed segment without per-byte clock overhead', async () => {
        const data = new Uint8Array(4 * 1024 * 1024);
        const started = performance.now();
        const matches = await new Promise<number[]>(resolve => {
            new SearchEngine().search(
                { mode: 'bytes', raw: 'FF', segments: [{ startAddress: 0, data }] },
                { onComplete: resolve },
            );
        });
        const elapsed = performance.now() - started;

        assert.deepStrictEqual(matches, []);
        assert.ok(elapsed < 300, `4 MiB search took ${Math.round(elapsed)} ms`);
    });
});
