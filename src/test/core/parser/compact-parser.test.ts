import * as assert from 'assert';
import { parseIntelHex, parseIntelHexCompact, parseIntelHexLine } from '../../../core/parser/intelHexParser';
import { parseSRec, parseSRecCompact, parseSRecRecordLine } from '../../../core/parser/srecParser';
import { CompactRecordStore } from '../../../core/parser/compact';
import type { HexRecord } from '../../../core/parser/types';

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
        const parseProgress: number[] = [];
        const buildProgress: number[] = [];
        await parseIntelHexCompact(source, {
            timeBudgetMs: 24,
            now: () => (clock += 8),
            yieldControl: async () => { yields++; },
            onProgress: update => {
                if (update.stage === 'parse') { parseProgress.push(update.completed); }
                else { buildProgress.push(update.completed); }
            },
        });

        assert.ok(yields > 0);
        assert.ok(parseProgress.length > 0);
        assert.deepStrictEqual(parseProgress, [...parseProgress].sort((a, b) => a - b));
        assert.strictEqual(parseProgress.at(-1), source.length);
        assert.deepStrictEqual(buildProgress, [...buildProgress].sort((a, b) => a - b));
        assert.strictEqual(buildProgress.at(-1), 33);
    });

    test('yields while compacting large record metadata', async () => {
        const record: HexRecord = {
            lineNumber: 1,
            raw: ':00000001FF',
            byteCount: 0,
            address: 0,
            recordType: 1,
            data: new Uint8Array(0),
            checksum: 0xFF,
            checksumValid: true,
            resolvedAddress: 0,
        };
        const records = Array.from({ length: 4_096 }, () => record);
        const ranges = Array.from({ length: records.length }, () => ({ start: 0, end: record.raw.length }));
        let clock = 0;
        let yields = 0;
        const store = await CompactRecordStore.create(records, ranges, {
            timeBudgetMs: 1,
            now: () => ++clock,
            yieldControl: async () => { yields++; },
        });

        assert.strictEqual(store.length, records.length);
        assert.ok(yields >= 1);
    });
});
