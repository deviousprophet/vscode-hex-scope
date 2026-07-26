import { parentPort, receiveMessageOnPort, workerData } from 'node:worker_threads';
import * as vm from 'node:vm';

const lockView = new Int32Array((workerData as { lockBuffer: SharedArrayBuffer }).lockBuffer);
let callId = 0;

if (!parentPort) { throw new Error('scriptWorker must run as a Worker'); }

function matchResponse(msg: { message: Record<string, unknown> } | undefined, id: number): unknown | undefined {
    if (!msg) { return undefined; }
    const data = msg.message;
    if (data.id !== id) { return undefined; }
    if (data.error) { throw new Error(data.error as string); }
    return data.result;
}

function rpcCall(method: string, args: unknown[]): unknown {
    const id = ++callId;
    parentPort!.postMessage({ type: 'api', id, method, args });
    for (;;) {
        while (Atomics.load(lockView, 0) === 0) { Atomics.wait(lockView, 0, 0); }
        Atomics.store(lockView, 0, 0);
        const found = matchResponse(receiveMessageOnPort(parentPort!), id);
        if (found !== undefined) { return found; }
    }
}

function buildAPI(collected: { results: Array<{ label: string; value: string }>; log: string[] }, rpcOut: (text: string) => void): Record<string, unknown> {
    return {
        hex: {
            read: (address: number, length: number): Uint8Array =>
                new Uint8Array((rpcCall('hex.read', [address, length]) as number[])),
            readSelected: (): Uint8Array =>
                new Uint8Array((rpcCall('hex.readSelected', []) as number[])),
            write: (address: number, data: Uint8Array): Promise<boolean> =>
                Promise.resolve(rpcCall('hex.write', [address, Array.from(data)]) as boolean),
            size: 0,
        },
        crc: {
            crc8: (data: Uint8Array | number[]): number => rpcCall('crc.crc8', [Array.from(data)]) as number,
            crc16: (data: Uint8Array | number[]): number => rpcCall('crc.crc16', [Array.from(data)]) as number,
            crc32: (data: Uint8Array | number[]): number => rpcCall('crc.crc32', [Array.from(data)]) as number,
        },
        hash: {
            sha1: (data: Uint8Array): Promise<Uint8Array> =>
                Promise.resolve(new Uint8Array((rpcCall('hash.sha1', [Array.from(data)]) as number[]))),
            sha256: (data: Uint8Array): Promise<Uint8Array> =>
                Promise.resolve(new Uint8Array((rpcCall('hash.sha256', [Array.from(data)]) as number[]))),
            sha512: (data: Uint8Array): Promise<Uint8Array> =>
                Promise.resolve(new Uint8Array((rpcCall('hash.sha512', [Array.from(data)]) as number[]))),
        },
        exec: (command: string, args?: string[]): Promise<unknown> =>
            Promise.resolve(rpcCall('exec', [command, args])),
        fetch: (url: string, options?: RequestInit): Promise<unknown> =>
            Promise.resolve(rpcCall('fetch', [url, options])),
        output: (text: string): void => rpcOut(text),
        setResult: (label: string, value: string): void => { collected.results.push({ label, value }); },
        assert: (condition: boolean, label: string): void => {
            collected.results.push({ label, value: condition ? 'PASS' : 'FAIL' });
        },
    };
}

function sendResult(output: { results: Array<{ label: string; value: string }>; log: string[] }, error?: string, errorType?: string): void {
    const msg: Record<string, unknown> = { type: 'result', output };
    if (error) { msg.error = error; msg.errorType = errorType; }
    parentPort!.postMessage(msg);
}

async function awaitThenable(value: unknown): Promise<void> {
    const v = value as unknown;
    if (v && typeof (v as Record<string, unknown>).then === 'function') {
        await (v as Promise<void>);
    } else {
        await Promise.resolve();
    }
}

function formatErr(err: unknown): { message: string; type: string } {
    const m = err instanceof Error ? err.message : String(err);
    return { message: m, type: m.includes('timed out') ? 'timeout' : 'runtime' };
}

async function runScript(code: string, timeoutMs: number): Promise<void> {
    const collected: { results: Array<{ label: string; value: string }>; log: string[] } = { results: [], log: [] };
    const rpcOut = (text: string) => {
        collected.log.push(text);
        parentPort!.postMessage({ type: 'output', text });
    };
    const api = buildAPI(collected, rpcOut);

    const sandbox = vm.createContext({
        module: { exports: {} },
        exports: {},
        console: {
            log: (...args: unknown[]) => rpcOut(args.map(String).join(' ')),
            warn: (...args: unknown[]) => rpcOut(`WARN: ${args.map(String).join(' ')}`),
            error: (...args: unknown[]) => rpcOut(`ERROR: ${args.map(String).join(' ')}`),
        },
        setTimeout, clearTimeout,
        Buffer, Uint8Array, ArrayBuffer, DataView,
        TextEncoder, TextDecoder, URL,
    });

    new vm.Script(code).runInNewContext(sandbox, { timeout: timeoutMs, breakOnSigint: true });

    const run = (sandbox.module as { exports: Record<string, unknown> }).exports?.run as ((a: unknown) => void | Promise<void>) | undefined;
    if (typeof run !== 'function') {
        return sendResult(collected, "Script must export a 'run' function.", 'compile');
    }

    (api.hex as Record<string, unknown>).size = rpcCall('hex.size', []);
    // ponytail: duck-type thenable check because sandbox has its own Promise realm
    await awaitThenable(run(api));
    sendResult(collected);
}

parentPort.on('message', async (msg: unknown) => {
    const data = msg as { type: string; code: string; timeoutMs: number };
    if (data.type !== 'run') { return; }
    try {
        await runScript(data.code, data.timeoutMs);
    } catch (err: unknown) {
        const e = formatErr(err);
        sendResult({ results: [], log: [] }, e.message, e.type);
    }
});
