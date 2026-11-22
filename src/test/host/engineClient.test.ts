import * as assert from 'assert';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
    EngineClient,
    EngineError,
    engineBinaryPath,
    isSupportedEngineTarget,
    mapCompactResult
} from '../../host/engine/engineClient';
import {
    configureEngineRoot,
    engineUnavailableReason,
    parseLinesWithEngine,
    parseTextWithEngine,
    repairWithEngine,
    shutdownEngine
} from '../../host/engine/engineLoader';

/** `out/test/host` → repository root. */
const ROOT = path.resolve(__dirname, '..', '..', '..');

/** A fake engine: frames in, frames out, driven by a tiny Node script. */
function fakeEngine(script: string): ChildProcessWithoutNullStreams {
    return spawn(process.execPath, ['-e', script], { stdio: ['pipe', 'pipe', 'pipe'] });
}

/** Read frames from stdin and call `onHeader` for each; the script is standalone. */
const RESPONDER = `
let buffered = Buffer.alloc(0);
process.stdin.on('data', chunk => {
    buffered = Buffer.concat([buffered, chunk]);
    while (buffered.length >= 6) {
        const length = buffered.readUInt32LE(0);
        const headerLength = buffered.readUInt16LE(4);
        if (buffered.length < 6 + length) { return; }
        const header = JSON.parse(buffered.subarray(6, 6 + headerLength).toString('utf8'));
        buffered = buffered.subarray(6 + length);
        globalThis.respond(header);
    }
});
`;

function responder(body: 'protocol' | 'crash' | 'badframe'): string {
    const behaviour = body === 'protocol'
        ? `const json = Buffer.from(JSON.stringify({ id: header.id, ok: true, protocol: 9 })); write(json);`
        : body === 'badframe'
            ? `const bad = Buffer.from([2, 0, 0, 0, 3, 0]); process.stdout.write(bad);`
            : `if (header.op === 'ping') {
                const json = Buffer.from(JSON.stringify({ id: header.id, ok: true, protocol: 1 }));
                write(json);
            } else { process.exit(3); }`;
    return `${RESPONDER}
const write = json => {
    const prefix = Buffer.alloc(6);
    prefix.writeUInt32LE(json.length, 0);
    prefix.writeUInt16LE(json.length, 4);
    process.stdout.write(Buffer.concat([prefix, json]));
};
globalThis.respond = header => { ${behaviour} };
`;
}

suite('engine client', () => {
    test('binary paths are per platform and architecture', () => {
        assert.strictEqual(engineBinaryPath('/ext', 'win32', 'x64'), path.join('/ext', 'dist', 'engine', 'win32-x64', 'hex-engine.exe'));
        assert.strictEqual(engineBinaryPath('/ext', 'linux', 'x64'), path.join('/ext', 'dist', 'engine', 'linux-x64', 'hex-engine'));
        assert.ok(isSupportedEngineTarget('darwin', 'arm64'));
        assert.ok(!isSupportedEngineTarget('linux', 'arm64'));
    });

    test('a missing binary reports the build command', async () => {
        await assert.rejects(
            () => EngineClient.start({ binary: path.join('/ext', 'dist', 'engine', 'linux-x64', 'hex-engine') }),
            (error: unknown) => error instanceof EngineError && /not built/.test(error.message)
        );
    });

    test('a protocol mismatch fails the handshake', async () => {
        await assert.rejects(
            () => EngineClient.start({ binary: 'fake', spawnProcess: () => fakeEngine(responder('protocol')) }),
            (error: unknown) => error instanceof EngineError && /does not match/.test(error.message)
        );
    });

    test('a malformed frame closes the client instead of hanging', async () => {
        await assert.rejects(
            () => EngineClient.start({ binary: 'fake', spawnProcess: () => fakeEngine(responder('badframe')) }),
            (error: unknown) => error instanceof EngineError && /invalid frame|engine exited/.test(error.message)
        );
    });

    test('an engine crash rejects pending work and closes the client', async () => {
        const client = await EngineClient.start({ binary: 'fake', spawnProcess: () => fakeEngine(responder('crash')) });
        await assert.rejects(() => client.parse({ format: 'ihex', source: ':00000001FF\n' }), (error: unknown) => {
            assert.ok(error instanceof EngineError);
            assert.match(error.message, /engine exited/);
            return true;
        });
        assert.ok(client.isClosed);
        client.dispose();
    });

    test('compact metadata and body map to typed arrays and buffers', () => {
        const header = {
            recordCount: 2,
            pageLengths: [2],
            segments: [{ startAddress: 0x100, offset: 0, length: 2 }],
            totalDataBytes: 2,
            checksumErrors: 0,
            malformedLines: 0,
            startAddress: 0x100,
            baseAddress: undefined
        };
        const body = Buffer.alloc(2 * 24 + 2);
        body.writeUInt32LE(1, 0);
        body.writeUInt32LE(2, 4);
        body[2 * 24] = 0xAA;
        body[2 * 24 + 1] = 0xBB;
        const mapped = mapCompactResult(header, body);
        assert.strictEqual(mapped.pages[0].sourceStart[0], 1);
        assert.strictEqual(mapped.pages[0].sourceStart[1], 2);
        assert.strictEqual(mapped.segments[0].startAddress, 0x100);
        assert.deepStrictEqual(Array.from(new Uint8Array(mapped.segments[0].data)), [0xAA, 0xBB]);
    });

    test('the loader reports a missing engine instead of falling back', async () => {
        const emptyRoot = mkdtempSync(path.join(tmpdir(), 'hexscope-no-engine-'));
        configureEngineRoot(emptyRoot);
        await assert.rejects(
            () => parseTextWithEngine(':00000001FF\n', 'ihex'),
            /not built/
        );
        assert.match(engineUnavailableReason() ?? '', /not built/);
        configureEngineRoot(ROOT);
    });

    test('the loader serves parses, record lines and repairs from the real engine', async () => {
        configureEngineRoot(ROOT);
        const payload = await parseTextWithEngine(':0400100001020304E2\n:00000001FF\n', 'ihex');
        assert.strictEqual(payload.recordCount, 2);
        assert.strictEqual(payload.totalDataBytes, 4);

        const records = await parseLinesWithEngine('ihex', [
            { lineNumber: 1, raw: ':0400100001020304E2' },
        ]);
        assert.strictEqual(records.length, 1);
        assert.deepStrictEqual(Array.from(records[0].data), [1, 2, 3, 4]);
        assert.strictEqual(records[0].checksumValid, true);

        const repaired = await repairWithEngine(':0400100001020304E3\n:00000001FF\n', 'ihex');
        assert.strictEqual(repaired.repaired, 1);
        assert.strictEqual(repaired.text, ':0400100001020304E2\n:00000001FF\n');
        shutdownEngine();
    });
});
