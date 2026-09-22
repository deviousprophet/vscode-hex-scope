import * as assert from 'assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { WireParseResult } from '../../core/types';
import type { HexScopeFormat } from '../../core/document';
import { hydrateCompactParseResult, type SerializedCompactParseResult } from '../../core/parser/compact';
import { parseIntelHex, parseIntelHexLine } from '../../core/parser/intelHexParser';
import { parseSRec, parseSRecRecordLine } from '../../core/parser/srecParser';
import { BUILD_FLOOR, INITIAL_LOAD_FRACTION, nextLoadFraction, stageFraction } from '../../parse/parseWorker';
import { runParseJob } from '../../parse/parseWorkerClient';

/** `npm test` compiles the tree to `out/`, so the worker lives in the shared `parse/` folder. */
const WORKER_PATH = path.join(__dirname, '..', '..', 'parse', 'parseWorker.js');

interface WorkerMessage {
    type: string;
    fraction?: number;
    stage?: 'parse' | 'build';
    completed?: number;
    total?: number;
    format?: HexScopeFormat;
    wire?: WireParseResult;
    compact?: SerializedCompactParseResult;
    message?: string;
}

interface WorkerOutcome {
    progress: WorkerMessage[];
    final: WorkerMessage;
}

function spawnWorker(workerData: unknown, transferList: ArrayBuffer[]): Promise<WorkerOutcome> {
    return new Promise((resolve, reject) => {
        const worker = new Worker(WORKER_PATH, { workerData, transferList });
        const progress: WorkerMessage[] = [];
        let settled = false;
        const finish = (action: () => void): void => {
            if (settled) { return; }
            settled = true;
            void worker.terminate();
            action();
        };
        worker.on('message', (message: WorkerMessage) => {
            if (message.type === 'progress') {
                progress.push(message);
                return;
            }
            finish(() => resolve({ progress, final: message }));
        });
        worker.on('error', error => finish(() => reject(error)));
    });
}

function fractions(outcome: WorkerOutcome): number[] {
    return outcome.progress.map(message => message.fraction ?? 0);
}

function completedByStage(outcome: WorkerOutcome, stage: 'parse' | 'build'): number[] {
    return outcome.progress.filter(message => message.stage === stage).map(message => message.completed ?? 0);
}

function parseDiffInWorker(source: string, extension: string): Promise<WorkerOutcome> {
    const bytes = new TextEncoder().encode(source);
    const buffer = bytes.buffer as ArrayBuffer;
    return spawnWorker({ kind: 'diffParse', bytes: buffer, extension }, [buffer]);
}

function parseHexInWorker(source: string, extension: string): Promise<WorkerOutcome> {
    return spawnWorker({ kind: 'hexParse', source, extension }, []);
}

function bytesOf(wire: WireParseResult, index: number): number[] {
    return Array.from(new Uint8Array(wire.segments[index].data));
}

function hexByte(value: number): string {
    return value.toString(16).toUpperCase().padStart(2, '0');
}

function ihexChecksum(bytes: number[]): number {
    return (-bytes.reduce((sum, byte) => sum + byte, 0)) & 0xff;
}

function ihexRecord(address: number, data: number[]): string {
    const bytes = [data.length, (address >> 8) & 0xff, address & 0xff, 0x00, ...data];
    return ':' + [...bytes, ihexChecksum(bytes)].map(hexByte).join('');
}

/** Many data records so the parser emits far more progress events than the throttle allows. */
function largeIhex(recordCount: number): string {
    const lines: string[] = [];
    for (let i = 0; i < recordCount; i++) {
        const address = (i * 16) & 0xffff;
        lines.push(ihexRecord(address, Array.from({ length: 16 }, (_, k) => (i + k) & 0xff)));
    }
    lines.push(':00000001FF');
    return lines.join('\n') + '\n';
}

function assertMonotonic(values: number[]): void {
    assert.ok(values.every((value, index) => index === 0 || value >= values[index - 1]), `non-monotonic: ${values}`);
}

suite('parseWorker', () => {
    suiteSetup(() => {
        assert.ok(fs.existsSync(WORKER_PATH), `compiled worker missing: ${WORKER_PATH} (run npm run compile-tests)`);
    });

    test('parses an IHEX file and returns the serialized wire result', async () => {
        const outcome = await parseDiffInWorker(':0400000001020304F2\n:00000001FF\n', 'hex');
        assert.strictEqual(outcome.final.type, 'result');
        assert.strictEqual(outcome.final.format, 'ihex');
        const wire = outcome.final.wire!;
        assert.strictEqual(wire.segments.length, 1);
        assert.strictEqual(wire.segments[0].startAddress, 0);
        assert.deepStrictEqual(bytesOf(wire, 0), [1, 2, 3, 4]);
        assert.strictEqual(wire.checksumErrors, 0);
        assert.strictEqual(wire.malformedLines, 0);
        const progress = fractions(outcome);
        assertMonotonic(progress);
        assert.ok(progress.length <= 101, `expected <= 101 progress messages, got ${progress.length}`);
    });

    test('throttles diff progress to integer percent', async () => {
        const outcome = await parseDiffInWorker(largeIhex(3000), 'hex');
        assert.strictEqual(outcome.final.type, 'result');
        const progress = fractions(outcome);
        assert.ok(progress.length <= 101, `expected <= 101 progress messages, got ${progress.length}`);
        assert.ok(progress.length > 0, 'expected at least one progress message');
        assertMonotonic(progress);
        assert.ok(progress.every(fraction => fraction >= 0 && fraction <= 1), `out of range: ${progress}`);
    });

    test('parses an SREC file and returns the serialized wire result', async () => {
        const { final } = await parseDiffInWorker('S107000001020304EE\nS9030000FC\n', 'srec');
        assert.strictEqual(final.type, 'result');
        assert.strictEqual(final.format, 'srec');
        const wire = final.wire!;
        assert.strictEqual(wire.segments.length, 1);
        assert.strictEqual(wire.segments[0].startAddress, 0);
        assert.deepStrictEqual(bytesOf(wire, 0), [1, 2, 3, 4]);
    });

    test('propagates a parse-job failure as an error message', async () => {
        const { final } = await spawnWorker({ kind: 'diffParse', bytes: null, extension: 'hex' }, []);
        assert.strictEqual(final.type, 'error');
        assert.match(final.message ?? '', /invalid parse job/);
    });

    test('hexParse returns transferred segments and metadata that hydrate and materialize', async () => {
        const source = ':0400000001020304F2\n:00000001FF\n';
        const { final } = await parseHexInWorker(source, 'hex');
        assert.strictEqual(final.type, 'result');
        assert.strictEqual(final.format, 'ihex');
        const hydrated = hydrateCompactParseResult(final.compact!);
        assert.strictEqual(hydrated.segments.length, 1);
        assert.strictEqual(hydrated.segments[0].startAddress, 0);
        assert.deepStrictEqual(Array.from(hydrated.segments[0].data), [1, 2, 3, 4]);
        assert.strictEqual(hydrated.totalDataBytes, 4);
        const expected = parseIntelHex(source);
        assert.strictEqual(hydrated.records.length, expected.records.length);
        assert.deepStrictEqual(hydrated.records.materialize(0, source, parseIntelHexLine), expected.records[0]);
    });

    test('hexParse parses SREC into a hydratable compact result', async () => {
        const source = 'S107000001020304EE\nS9030000FC\n';
        const { final } = await parseHexInWorker(source, 'srec');
        assert.strictEqual(final.type, 'result');
        assert.strictEqual(final.format, 'srec');
        const hydrated = hydrateCompactParseResult(final.compact!);
        assert.deepStrictEqual(Array.from(hydrated.segments[0].data), [1, 2, 3, 4]);
        assert.deepStrictEqual(
            hydrated.records.materialize(1, source, parseSRecRecordLine),
            parseSRec(source).records[1],
        );
    });

    test('hexParse thins progress to one post per integer percent per stage', async () => {
        const outcome = await parseHexInWorker(largeIhex(3000), 'hex');
        assert.strictEqual(outcome.final.type, 'result');
        assert.ok(outcome.progress.length > 0, 'expected at least one progress message');
        assert.ok(outcome.progress.every(message => message.stage === 'parse' || message.stage === 'build'), 'stage-tagged progress only');
        const parse = completedByStage(outcome, 'parse');
        const build = completedByStage(outcome, 'build');
        assert.ok(parse.length <= 101, `parse throttled to <= 101 posts, got ${parse.length}`);
        assert.ok(build.length <= 101, `build throttled to <= 101 posts, got ${build.length}`);
        assertMonotonic(parse);
        assertMonotonic(build);
    });

    test('hexParse rejects an invalid job instead of crashing the thread', async () => {
        const { final } = await spawnWorker({ kind: 'hexParse', source: 42, extension: 'hex' }, []);
        assert.strictEqual(final.type, 'error');
        assert.match(final.message ?? '', /invalid parse job/);
    });

    test('runParseJob relays progress and resolves with the caller projection', async () => {
        const source = largeIhex(3000);
        const buffer = new TextEncoder().encode(source).buffer as ArrayBuffer;
        const fractions: number[] = [];
        const format = await runParseJob({
            job: { kind: 'diffParse', bytes: buffer, extension: 'hex' },
            signal: new AbortController().signal,
            transferList: [buffer],
            onProgress: message => { if ('fraction' in message) { fractions.push(message.fraction); } },
            onResult: message => ('wire' in message ? message.format : 'unexpected'),
        });

        assert.strictEqual(format, 'ihex');
        assert.ok(fractions.length > 0, 'progress relayed');
        assertMonotonic(fractions);
    });

    test('runParseJob rejects an already-aborted signal without a worker', async () => {
        const controller = new AbortController();
        controller.abort();

        await assert.rejects(
            runParseJob({
                job: { kind: 'hexParse', source: ':00000001FF\n', extension: 'hex' },
                signal: controller.signal,
                abortMessage: 'Parse cancelled',
                onResult: () => 'unexpected',
            }),
            /Parse cancelled/,
        );
    });

    test('runParseJob settles once on abort and never projects a late result', async () => {
        const controller = new AbortController();
        let results = 0;
        const pending = runParseJob({
            job: { kind: 'hexParse', source: largeIhex(20000), extension: 'hex' },
            signal: controller.signal,
            abortMessage: 'Parse cancelled',
            onProgress: () => controller.abort(),
            onResult: () => { results++; return 'unexpected'; },
        });

        await assert.rejects(pending, /Parse cancelled/);
        await new Promise(resolve => setTimeout(resolve, 250));
        assert.strictEqual(results, 0, 'a settled run never projects a late result');
    });

    test('maps the scan stage before the build stage into one fraction', () => {
        assert.strictEqual(stageFraction('parse', 0, 100), 0);
        assert.strictEqual(stageFraction('parse', 100, 100), BUILD_FLOOR);
        assert.strictEqual(stageFraction('build', 0, 100), BUILD_FLOOR);
        assert.strictEqual(stageFraction('build', 100, 100), 1);
        assert.ok(stageFraction('parse', 10, 0) >= 0, 'a zero total stays in range');
    });

    test('advances only on a new integer percent and never regresses across the stage switch', () => {
        const scan = nextLoadFraction(INITIAL_LOAD_FRACTION, 'parse', 1, 1000);
        assert.ok(scan, 'the first event posts');
        assert.strictEqual(scan!.percent, 0);
        assert.strictEqual(nextLoadFraction(scan!, 'parse', 2, 1000), null, 'an unchanged percent is dropped');
        const scanDone = nextLoadFraction(scan!, 'parse', 1000, 1000);
        assert.ok(scanDone);
        assert.strictEqual(scanDone!.fraction, BUILD_FLOOR);
        assert.strictEqual(nextLoadFraction(scanDone!, 'build', 0, 100), null, 'a build restart cannot regress below the scan');
        const done = nextLoadFraction(scanDone!, 'build', 100, 100);
        assert.strictEqual(done!.fraction, 1);
        assert.strictEqual(done!.percent, 100);
    });
});
