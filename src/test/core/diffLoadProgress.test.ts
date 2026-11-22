import * as assert from 'assert';
import { combinedLoadProgress } from '../../diff/loadProgress';

suite('combinedLoadProgress', () => {
    test('sums the two per-file fractions', () => {
        assert.strictEqual(combinedLoadProgress([0, 0]), 0);
        assert.strictEqual(combinedLoadProgress([0.5, 0.25]), 0.75);
        assert.strictEqual(combinedLoadProgress([1, 1]), 2);
    });

    test('never exceeds the file total and never goes negative', () => {
        assert.strictEqual(combinedLoadProgress([1.5, 1]), 2);
        assert.strictEqual(combinedLoadProgress([-0.5, 0.5]), 0.5);
    });

    test('is monotonic when one file advances while the other holds', () => {
        let previous = combinedLoadProgress([0, 0.4]);
        for (const fraction of [0.1, 0.25, 0.5, 0.75, 1]) {
            const next = combinedLoadProgress([fraction, 0.4]);
            assert.ok(next >= previous, `${next} regressed below ${previous}`);
            previous = next;
        }
        assert.strictEqual(previous, 1.4);
    });

    test('interleaved per-file reports never regress the combined value', () => {
        const fractions = [0, 0];
        let previous = combinedLoadProgress(fractions);
        const advance = (index: number, value: number): void => {
            fractions[index] = value;
            const next = combinedLoadProgress(fractions);
            assert.ok(next >= previous, `${next} regressed below ${previous}`);
            previous = next;
        };
        advance(0, 0.2);
        advance(1, 0.4);
        advance(0, 0.6);
        advance(1, 0.9);
        advance(0, 1);
        advance(1, 1);
        assert.strictEqual(previous, 2);
    });
});
