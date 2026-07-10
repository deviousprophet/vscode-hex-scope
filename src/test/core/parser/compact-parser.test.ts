import * as assert from 'assert';
import { parseIntelHex, parseIntelHexCompact, parseIntelHexLine } from '../../../core/parser/intelHexParser';
import { parseSRec, parseSRecCompact, parseSRecRecordLine } from '../../../core/parser/srecParser';

suite('compact async parsers', () => {
    test('IHEX compact output matches synchronous parser', async () => {
        const source = ':0400000001020304F2\r\n\r\n:00000001FF\r\n';
        const expected = parseIntelHex(source);
        const actual = await parseIntelHexCompact(source);

        assert.deepStrictEqual(actual.segments.map(segment => Array.from(segment.data)),
            expected.segments.map(segment => Array.from(segment.data)));
        assert.strictEqual(actual.records.length, expected.records.length);
        assert.deepStrictEqual(
            actual.records.materialize(0, source, parseIntelHexLine),
            expected.records[0],
        );
    });

    test('SREC compact output matches synchronous parser', async () => {
        const source = 'S107000001020304EE\nS9030000FC\n';
        const expected = parseSRec(source);
        const actual = await parseSRecCompact(source);

        assert.deepStrictEqual(actual.segments.map(segment => Array.from(segment.data)),
            expected.segments.map(segment => Array.from(segment.data)));
        assert.deepStrictEqual(
            actual.records.materialize(1, source, parseSRecRecordLine),
            expected.records[1],
        );
    });

    test('honors cancellation before parsing', async () => {
        const controller = new AbortController();
        controller.abort();
        await assert.rejects(() => parseIntelHexCompact(':00000001FF', { signal: controller.signal }), /cancelled/);
    });

    test('yields and reports monotonic progress under injected timing', async () => {
        const source = `${Array.from({ length: 32 }, () => ':0400000001020304F2').join('\n')}\n:00000001FF`;
        let clock = 0;
        let yields = 0;
        const progress: number[] = [];
        await parseIntelHexCompact(source, {
            timeBudgetMs: 24,
            now: () => (clock += 8),
            yieldControl: async () => { yields++; },
            onProgress: update => {
                if (update.stage === 'parse') { progress.push(update.completed); }
            },
        });

        assert.ok(yields > 0);
        assert.ok(progress.length > 0);
        assert.deepStrictEqual(progress, [...progress].sort((a, b) => a - b));
        assert.strictEqual(progress.at(-1), source.length);
    });
});
