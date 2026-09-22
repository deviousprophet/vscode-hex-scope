import * as assert from 'assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { WireParseResult } from '../../core/types';
import type { HexScopeFormat } from '../../core/document';
import { BUILD_FLOOR, INITIAL_LOAD_FRACTION, nextLoadFraction, stageFraction } from '../../diff/diffParseWorker';

/** `npm test` compiles the tree to `out/`, so the worker lives beside the compiled panel. */
const WORKER_PATH = path.join(__dirname, '..', '..', 'diff', 'diffParseWorker.js');

interface WorkerMessage {
    type: string;
    fraction?: number;
    format?: HexScopeFormat;
    wire?: WireParseResult;
    message?: string;
}

interface WorkerOutcome {
    progress: number[];
    final: WorkerMessage;
}

function spawnWorker(workerData: unknown, transferList: ArrayBuffer[]): Promise<WorkerOutcome> {
    return new Promise((resolve, reject) => {
        const worker = new Worker(WORKER_PATH, { workerData, transferList });
        const progress: number[] = [];
        let settled = false;
        const finish = (action: () => void): void => {
            if (settled) { return; }
            settled = true;
            void worker.terminate();
            action();
        };
        worker.on('message', (message: WorkerMessage) => {
            if (message.type === 'progress') {
                progress.push(message.fraction ?? 0);
                return;
            }
            finish(() => resolve({ progress, final: message }));
        });
        worker.on('error', error => finish(() => reject(error)));
    });
}

function parseInWorker(source: string, extension: string): Promise<WorkerOutcome> {
    const bytes = new TextEncoder().encode(source);
    const buffer = bytes.buffer as ArrayBuffer;
    return spawnWorker({ kind: 'diffParse', bytes: buffer, extension }, [buffer]);
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

suite('diffParseWorker', () => {
    suiteSetup(() => {
        assert.ok(fs.existsSync(WORKER_PATH), `compiled worker missing: ${WORKER_PATH} (run npm run compile-tests)`);
    });

    test('parses an IHEX file and returns the serialized wire result', async () => {
        const { progress, final } = await parseInWorker(':0400000001020304F2\n:00000001FF\n', 'hex');
        assert.strictEqual(final.type, 'result');
        assert.strictEqual(final.format, 'ihex');
        const wire = final.wire!;
        assert.strictEqual(wire.segments.length, 1);
        assert.strictEqual(wire.segments[0].startAddress, 0);
        assert.deepStrictEqual(bytesOf(wire, 0), [1, 2, 3, 4]);
        assert.strictEqual(wire.checksumErrors, 0);
        assert.strictEqual(wire.malformedLines, 0);
        assert.ok(progress.every((fraction, index) => index === 0 || fraction >= progress[index - 1]), `non-monotonic: ${progress}`);
        assert.ok(progress.length <= 101, `expected <= 101 progress messages, got ${progress.length}`);
    });

    test('throttles progress to integer percent', async () => {
        const { progress, final } = await parseInWorker(largeIhex(3000), 'hex');
        assert.strictEqual(final.type, 'result');
        assert.ok(progress.length <= 101, `expected <= 101 progress messages, got ${progress.length}`);
        assert.ok(progress.length > 0, 'expected at least one progress message');
        assert.ok(progress.every((fraction, index) => index === 0 || fraction >= progress[index - 1]), `non-monotonic: ${progress}`);
        assert.ok(progress.every(fraction => fraction >= 0 && fraction <= 1), `out of range: ${progress}`);
    });

    test('parses an SREC file and returns the serialized wire result', async () => {
        const { final } = await parseInWorker('S107000001020304EE\nS9030000FC\n', 'srec');
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
