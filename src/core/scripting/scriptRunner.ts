import * as fs from 'node:fs';
import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { ScriptHost, HexScopeAPI, ScriptOutput, ScriptErrorType } from './types';
import { buildAPI } from './apiFactory';
import { isScriptFile, readScript, compileScript } from './scriptCompiler';

const SCRIPTS_DIR = '.hexscope/scripts';
const SCRIPT_TIMEOUT_MS = 30_000;

export interface ScriptInfo {
    name: string;
    filePath: string;
    capabilities: string[];
}

function parseManifest(source: string): string[] {
    const first2k = source.slice(0, 2048);
    const re = /@requires\s+(\w+)/gi;
    const caps = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(first2k)) !== null) {
        caps.add(m[1].toLowerCase());
    }
    return [...caps];
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

// ---- worker-based isolate ----

const DISPATCH: Record<string, (api: HexScopeAPI, args: unknown[]) => unknown> = {
    'hex.read': (a, [addr, len]) => a.hex.read(addr as number, len as number),
    'hex.readSelected': (a) => a.hex.readSelected(),
    'hex.write': (a, [addr, data]) => a.hex.write(addr as number, new Uint8Array(data as number[])),
    'hex.size': (a) => a.hex.size,
    'crc.crc8': (a, [d]) => a.crc.crc8(d as number[] | Uint8Array),
    'crc.crc16': (a, [d]) => a.crc.crc16(d as number[] | Uint8Array),
    'crc.crc32': (a, [d]) => a.crc.crc32(d as number[] | Uint8Array),
    'hash.sha1': (a, [d]) => a.hash.sha1(new Uint8Array(d as number[])),
    'hash.sha256': (a, [d]) => a.hash.sha256(new Uint8Array(d as number[])),
    'hash.sha512': (a, [d]) => a.hash.sha512(new Uint8Array(d as number[])),
    'exec': (a, [cmd, args]) => a.exec(cmd as string, args as string[] | undefined),
    'fetch': (a, [url, opts]) => a.fetch(url as string, opts as RequestInit | undefined),
};

function makeAPIDispatch(api: HexScopeAPI): (method: string, args: unknown[]) => unknown {
    return (method: string, args: unknown[]): unknown => {
        const fn = DISPATCH[method];
        if (!fn) { throw new Error(`Unknown API method: ${method}`); }
        return fn(api, args);
    };
}

function reply(
    worker: Worker, lockView: Int32Array,
    id: number, result?: unknown, error?: string,
): void {
    worker.postMessage({ id, result, error });
    Atomics.store(lockView, 0, 1);
    Atomics.notify(lockView, 0);
}

export function scanScripts(workspaceRoot: string, trusted: boolean = true): ScriptInfo[] {
    const dir = path.join(workspaceRoot, SCRIPTS_DIR);
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        return entries
            .filter(e => e.isFile() && isScriptFile(e.name))
            .map(e => {
                const filePath = path.join(dir, e.name);
                let capabilities: string[] = [];
                try {
                    const header = fs.readFileSync(filePath, 'utf-8').slice(0, 2048);
                    capabilities = parseManifest(header);
                } catch { /* if file can't be read, no capabilities */ }
                return { name: e.name, filePath, capabilities };
            })
            .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
        return [];
    }
}

async function runInWorker(
    jsCode: string,
    api: HexScopeAPI,
    host: ScriptHost,
    timeoutMs: number,
    signal?: AbortSignal,
): Promise<ScriptOutput> {
    const lockBuffer = new SharedArrayBuffer(4);
    const lockView = new Int32Array(lockBuffer);
    const workerPath = path.join(__dirname, 'scriptWorker.js');
    const dispatch = makeAPIDispatch(api);

    let done = false;
    let timerId: ReturnType<typeof setTimeout> | undefined;

    function snap(): ScriptOutput { const h = host.collectOutput(); return { results: h.results, log: h.log }; }

    let abortCleanup: (() => void) | null = null;

    return new Promise<ScriptOutput>((resolve) => {
        const worker = new Worker(workerPath, {
            workerData: { lockBuffer },
        });

        const finish = (result: ScriptOutput) => {
            if (done) { return; }
            done = true;
            clearTimeout(timerId);
            abortCleanup?.();
            worker.terminate();
            resolve(result);
        };

        timerId = setTimeout(() => {
            finish({ ...snap(), error: `Script timed out after ${timeoutMs}ms.`, errorType: 'timeout' });
        }, timeoutMs);

        function handleApi(id: number, method: string, args: unknown[]): void {
            try {
                const result = dispatch(method, args);
                if (result instanceof Promise) {
                    result.then(
                        v => reply(worker, lockView, id, v),
                        e => reply(worker, lockView, id, undefined, errorMessage(e)),
                    ).catch(() => { /* reply failed — worker likely terminated */ });
                } else {
                    reply(worker, lockView, id, result);
                }
            } catch (err: unknown) {
                reply(worker, lockView, id, undefined, errorMessage(err));
            }
        }

        function handleResult(out: { results: Array<{ label: string; value: string }>; log: string[] }, err?: string, errType?: ScriptErrorType): void {
            for (const r of out.results) { host.setResult(r.label, r.value); }
            // output was already streamed via individual 'output' messages — don't replay
            const h = snap();
            if (err) { finish({ ...h, error: err, errorType: errType }); }
            else { finish(h); }
        }

        worker.on('message', (msg: Record<string, unknown>) => {
            switch (msg.type) {
                case 'api': handleApi(msg.id as number, msg.method as string, msg.args as unknown[]); break;
                case 'output': host.output(msg.text as string); break;
                case 'result': handleResult(
                    msg.output as { results: Array<{ label: string; value: string }>; log: string[] },
                    msg.error as string | undefined,
                    msg.errorType as ScriptErrorType | undefined,
                ); break;
            }
        });

        worker.on('error', (err: Error) => {
            finish({ ...snap(), error: err.message, errorType: 'runtime' });
        });

        worker.on('exit', (code: number) => {
            if (code !== 0) {
                finish({ ...snap(), error: `Worker exited with code ${code}`, errorType: 'runtime' });
            }
        });

        worker.postMessage({ type: 'run', code: jsCode, timeoutMs });

        if (signal) {
            const onAbort = () => finish({ ...snap(), error: 'Cancelled', errorType: 'cancel' });
            signal.addEventListener('abort', onAbort, { once: true });
            abortCleanup = () => signal.removeEventListener('abort', onAbort);
        }
    });
}

function earlyExit(signal: AbortSignal | undefined, trusted: boolean): ScriptOutput | null {
    if (signal?.aborted) { return { results: [], log: [], error: 'Cancelled', errorType: 'cancel' }; }
    if (!trusted) { return { results: [], log: [], error: 'Workspace not trusted', errorType: 'cancel' }; }
    return null;
}

export async function execute(
    filePath: string,
    host: ScriptHost,
    timeoutMs: number = SCRIPT_TIMEOUT_MS,
    signal?: AbortSignal,
    trusted: boolean = true,
): Promise<ScriptOutput> {
    const blocked = earlyExit(signal, trusted);
    if (blocked) { return blocked; }
    try {
        const api = buildAPI(host);
        const jsCode = await compileScript(readScript(filePath), filePath);
        return await runInWorker(jsCode, api, host, timeoutMs, signal);
    } catch (err: unknown) {
        return { results: [], log: [errorMessage(err)], error: errorMessage(err), errorType: 'compile' };
    }
}
