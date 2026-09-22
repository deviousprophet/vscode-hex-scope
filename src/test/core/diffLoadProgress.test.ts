import * as assert from 'assert';
import { advanceFraction, combinedLoadProgress } from '../../diff/loadProgress';

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

suite('advanceFraction', () => {
    test('never decreases and clamps to [0, 1]', () => {
        assert.strictEqual(advanceFraction(0, 0.4), 0.4);
        assert.strictEqual(advanceFraction(0.4, 0.2), 0.4);
        assert.strictEqual(advanceFraction(0.9, 1.5), 1);
        assert.strictEqual(advanceFraction(0.2, -0.5), 0.2);
    });

    test('keeps the combined value monotonic across a scan→build stage switch', () => {
        // The parser's build stage restarts at 0 after the scan reached ~1.0.
        const fractions = [0, 0];
        const advance = (index: number, stageValue: number): number => {
            fractions[index] = advanceFraction(fractions[index], stageValue);
            return combinedLoadProgress(fractions);
        };
        let previous = advance(0, 0.9);
        previous = Math.max(previous, advance(1, 0.9));
        const afterReset = advance(0, 0);
        assert.strictEqual(afterReset, previous, 'build restart must not regress the combined value');
        const afterBuild = advance(0, 1);
        assert.ok(Math.abs(afterBuild - (previous + 0.1)) < 1e-9, `${afterBuild} != ${previous + 0.1}`);
    });
});
