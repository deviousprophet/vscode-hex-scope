import { parentPort, receiveMessageOnPort, workerData } from 'node:worker_threads';
import * as vm from 'node:vm';
import type {
    HexScopeAPI, ExecResult, FetchResult, FetchOptions, ScriptContext, ScriptEntry, ScriptValue,
} from './types';
import { normalizeScriptValue } from './contracts';

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

function buildAPI(
    collected: { results: Array<{ label: string; value: string }>; log: string[] },
    rpcOut: (text: string) => void,
    context: ScriptContext,
): HexScopeAPI {
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
        exec: (command: string, args?: string[]): Promise<ExecResult | null> =>
            Promise.resolve(rpcCall('exec', [command, args]) as ExecResult | null),
        fetch: (url: string, options?: FetchOptions): Promise<FetchResult | null> =>
            Promise.resolve(rpcCall('fetch', [url, options]) as FetchResult | null),
        output: (text: string): void => rpcOut(text),
        setResult: (label: string, value: string): void => { collected.results.push({ label, value }); },
        assert: (condition: boolean, label: string): void => {
            collected.results.push({ label, value: condition ? 'PASS' : 'FAIL' });
        },
        context,
    };
}

function sendResult(
    output: { results: Array<{ label: string; value: string }>; log: string[] },
    error?: string,
    errorType?: string,
    value?: ScriptValue,
): void {
    const msg: Record<string, unknown> = { type: 'result', output };
    if (error) { msg.error = error; msg.errorType = errorType; }
    if (value !== undefined) { msg.value = value; }
    parentPort!.postMessage(msg);
}

async function awaitThenable<T>(value: T | PromiseLike<T>): Promise<T> {
    const v = value as unknown;
    if (v && typeof (v as Record<string, unknown>).then === 'function') {
        return await (v as PromiseLike<T>);
    }
    await Promise.resolve();
    return value as T;
}

function formatErr(err: unknown): { message: string; type: string } {
    const m = err instanceof Error ? err.message : String(err);
    return { message: m, type: m.includes('timed out') ? 'timeout' : 'runtime' };
}

async function runEntry(
    code: string,
    entry: ScriptEntry,
    timeoutMs: number,
    context: ScriptContext,
): Promise<void> {
    const collected: { results: Array<{ label: string; value: string }>; log: string[] } = { results: [], log: [] };
    const rpcOut = (text: string) => {
        collected.log.push(text);
        parentPort!.postMessage({ type: 'output', text });
    };
    const api = buildAPI(collected, rpcOut, context);

    const moduleObj: { exports: Record<string, unknown> } = { exports: {} };
    const sandbox = vm.createContext({
        module: moduleObj,
        // CommonJS alias: `exports.run = fn` must reach `module.exports`.
        exports: moduleObj.exports,
        console: {
            log: (...args: unknown[]) => rpcOut(args.map(String).join(' ')),
            warn: (...args: unknown[]) => rpcOut(`WARN: ${args.map(String).join(' ')}`),
            error: (...args: unknown[]) => rpcOut(`ERROR: ${args.map(String).join(' ')}`),
        },
        setTimeout, clearTimeout,
        Uint8Array, ArrayBuffer, DataView,
        TextEncoder, TextDecoder, URL,
    });

    new vm.Script(code).runInNewContext(sandbox, { timeout: timeoutMs, breakOnSigint: true });

    const fn = entryFunction(moduleObj, entry);
    if (!fn) {
        const { message, errorType } = missingExportError(entry);
        return sendResult(collected, message, errorType);
    }

    api.hex.size = rpcCall('hex.size', []) as number;
    const returned = await awaitThenable(fn(api));
    if (entry === 'run') {
        sendResult(collected);
        return;
    }

    const normalized = normalizeScriptValue(entry, returned);
    if (!normalized.ok) {
        return sendResult(collected, normalized.error, 'contract');
    }
    sendResult(collected, undefined, undefined, normalized.value);
}

/** The entry export as a callable, or undefined when it is missing/mistyped. */
function entryFunction(
    moduleObj: { exports: Record<string, unknown> },
    entry: ScriptEntry,
): ((api: unknown) => unknown) | undefined {
    const fn = (moduleObj.exports ?? {})[entry];
    return typeof fn === 'function' ? (fn as (api: unknown) => unknown) : undefined;
}

/** Why the run failed before executing: `run` is a compile error, roles a contract error. */
function missingExportError(entry: ScriptEntry): { message: string; errorType: string } {
    return entry === 'run'
        ? { message: "Script must export a 'run' function.", errorType: 'compile' }
        : { message: `Script must export a '${entry}' function.`, errorType: 'contract' };
}

/** One `run` message: dispatch to the entry runner; anything else is ignored. */
async function handleMessage(msg: unknown): Promise<void> {
    const data = msg as {
        type: string; code: string; entry?: ScriptEntry; timeoutMs: number; context?: ScriptContext;
    };
    if (data.type !== 'run') { return; }
    await runEntry(data.code, data.entry ?? 'run', data.timeoutMs, data.context ?? {});
}

parentPort.on('message', async (msg: unknown) => {
    try {
        await handleMessage(msg);
    } catch (err: unknown) {
        const e = formatErr(err);
        sendResult({ results: [], log: [] }, e.message, e.type);
    }
});
