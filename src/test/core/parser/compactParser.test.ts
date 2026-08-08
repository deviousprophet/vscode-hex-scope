import * as assert from 'assert';
import { parseIntelHex, parseIntelHexCompact, parseIntelHexLine } from '../../../core/parser/intelHexParser';
import { parseSRec, parseSRecCompact, parseSRecRecordLine } from '../../../core/parser/srecParser';
import { CompactRecordStore, createCompactParseResult } from '../../../core/parser/compact';
import { collectSegmentRanges } from '../../../core/parser/segments';
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

    test('build progress reports intermediate values without silent gap', async () => {
        const record: HexRecord = {
            lineNumber: 1,
            raw: ':100000000102030405060708090A0B0C0D0E0F56',
            byteCount: 16,
            address: 0,
            recordType: 0,
            data: new Uint8Array(16).map((_, i) => i),
            checksum: 0x56,
            checksumValid: true,
            resolvedAddress: 0,
        };
        const count = 10_000;
        const records = Array.from({ length: count }, (_, i) => ({
            ...record,
            address: i * 16,
            resolvedAddress: i * 16,
        }));
        const ranges = records.map(r => ({ start: 0, end: r.raw.length }));
        const segRanges = collectSegmentRanges(records, () => true);
        const progress: number[] = [];
        let clock = 0;

        const result = await createCompactParseResult(
            { records, ranges, checksumErrors: 0, malformedLines: 0 },
            segRanges,
            { timeBudgetMs: 1, now: () => ++clock, onProgress: u => { progress.push(u.completed); } },
        );
        assert.strictEqual(result.segments.length, 1);
        assert.strictEqual(result.segments[0].data.length, count * 16);
        assert.ok(progress.length >= 3, `expected ≥3 progress updates, got ${progress.length}: [${progress.slice(0, 10).join(',')}…]`);
        assert.deepStrictEqual(progress, [...progress].sort((a, b) => a - b));
        assert.strictEqual(progress.at(-1), count);
    });

    test('segment data built during compaction matches sync parser', async () => {
        const source = ':100000000102030405060708090A0B0C0D0E0F56\n:10001000101112131415161718191A1B1C1D1E1FF4\n:00000001FF\n';
        const expected = parseIntelHex(source);
        const actual = await parseIntelHexCompact(source);

        assert.strictEqual(actual.segments.length, expected.segments.length);
        assert.deepStrictEqual(
            actual.segments.map(s => Array.from(s.data)),
            expected.segments.map(s => Array.from(s.data)),
        );
    });
});
