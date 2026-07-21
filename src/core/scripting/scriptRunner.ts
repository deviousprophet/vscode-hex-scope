import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import type { ScriptHost, HexScopeAPI, ScriptOutput, ScriptErrorType } from './types';
import { buildAPI } from './apiFactory';
import { isScriptFile, readScript, compileScript } from './scriptCompiler';

const SCRIPTS_DIR = '.hexscope/scripts';
const SCRIPT_TIMEOUT_MS = 30_000;

export interface ScriptInfo {
    name: string;
    filePath: string;
}

function createSandbox(host: ScriptHost): Record<string, unknown> {
    return vm.createContext({
        module: { exports: {} },
        exports: {},
        console: {
            log: (...args: unknown[]) => host.output(args.map(String).join(' ')),
            warn: (...args: unknown[]) => host.output(`WARN: ${args.map(String).join(' ')}`),
            error: (...args: unknown[]) => host.output(`ERROR: ${args.map(String).join(' ')}`),
        },
        setTimeout,
        clearTimeout,
        Buffer, Uint8Array, ArrayBuffer, DataView,
        TextEncoder, TextDecoder, URL,
    });
}

function loadModule(jsCode: string, sandbox: Record<string, unknown>, timeoutMs: number): Error | null {
    try {
        new vm.Script(jsCode).runInNewContext(sandbox, { timeout: timeoutMs, breakOnSigint: true });
        return null;
    } catch (err: unknown) {
        return err instanceof Error ? err : new Error(String(err));
    }
}

function extractRun(sandbox: Record<string, unknown>): ((api: HexScopeAPI) => void | Promise<void>) | null {
    const mod = sandbox.module as { exports: Record<string, unknown> };
    const fn = mod.exports?.run as ((api: HexScopeAPI) => void | Promise<void>) | undefined;
    return typeof fn === 'function' ? fn : null;
}

function isPromise(value: unknown): value is Promise<unknown> {
    return typeof value === 'object' && value !== null && typeof (value as Record<string, unknown>).then === 'function';
}

function timeoutPromise(timeoutMs: number): { promise: Promise<never>; cancel: () => void } {
    let timerId: ReturnType<typeof setTimeout> | undefined;
    const promise = new Promise<never>((_, reject) => {
        timerId = setTimeout(() => reject(new Error(`Script timed out after ${timeoutMs}ms.`)), timeoutMs);
    });
    return { promise, cancel: () => clearTimeout(timerId) };
}

function cancelPromise(signal: AbortSignal): Promise<never> {
    return new Promise<never>((_, reject) => {
        if (signal.aborted) { reject(new Error('Cancelled')); return; }
        signal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true });
    });
}

function classifyError(err: unknown): { type: ScriptErrorType; message: string } {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'Cancelled') { return { type: 'cancel', message: 'Cancelled by user' }; }
    if (msg.includes('timed out')) { return { type: 'timeout', message: msg }; }
    return { type: 'runtime', message: msg };
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

async function runWithTimeout(fn: () => void | Promise<void>, timeoutMs: number, signal?: AbortSignal): Promise<{ type: ScriptErrorType; message: string } | null> {
    const { promise: timer, cancel: clearTimer } = timeoutPromise(timeoutMs);
    const cancel = signal ? cancelPromise(signal) : timer;
    try {
        const result = fn();
        if (!isPromise(result)) {
            clearTimer();
            return null;
        }
        await Promise.race([result, timer, cancel]);
        clearTimer();
        return null;
    } catch (err: unknown) {
        clearTimer();
        return classifyError(err);
    }
}

export function scanScripts(workspaceRoot: string): ScriptInfo[] {
    const dir = path.join(workspaceRoot, SCRIPTS_DIR);
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        return entries
            .filter(e => e.isFile() && isScriptFile(e.name))
            .map(e => ({ name: e.name, filePath: path.join(dir, e.name) }))
            .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
        return [];
    }
}

async function runOrError(
    jsCode: string,
    sandbox: Record<string, unknown>,
    api: HexScopeAPI,
    host: ScriptHost,
    timeoutMs: number,
    signal?: AbortSignal,
): Promise<ScriptOutput> {
    const loadError = loadModule(jsCode, sandbox, timeoutMs);
    if (loadError) {
        return { results: [], log: [loadError.message], error: loadError.message, errorType: 'compile' };
    }

    const run = extractRun(sandbox);
    if (!run) {
        return { results: [], log: [], error: 'Script must export a \'run\' function.', errorType: 'compile' };
    }

    const collected = host.collectOutput();
    const execError = await runWithTimeout(() => run(api), timeoutMs, signal);
    const execResult = execError ? { error: execError.message, errorType: execError.type } : {};
    return { results: collected.results, log: collected.log, ...execResult };
}

export async function execute(
    filePath: string,
    host: ScriptHost,
    timeoutMs: number = SCRIPT_TIMEOUT_MS,
    signal?: AbortSignal,
): Promise<ScriptOutput> {
    if (signal?.aborted) { return { results: [], log: [], error: 'Cancelled', errorType: 'cancel' }; }
    try {
        const api = buildAPI(host);
        return runOrError(await compileScript(readScript(filePath), filePath), createSandbox(host), api, host, timeoutMs, signal);
    } catch (err: unknown) {
        return { results: [], log: [errorMessage(err)], error: errorMessage(err), errorType: 'compile' };
    }
}
