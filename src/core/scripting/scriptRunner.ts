import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import type { ScriptHost, HexScopeAPI, ScriptOutput } from './types';
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

async function runWithTimeout(fn: () => void | Promise<void>, timeoutMs: number): Promise<Error | null> {
    try {
        const result = fn();
        if (result instanceof Promise) {
            const timer = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error(`Script timed out after ${timeoutMs}ms.`)), timeoutMs)
            );
            await Promise.race([result, timer]);
        }
        return null;
    } catch (err: unknown) {
        return err instanceof Error ? err : new Error(String(err));
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
    timeoutMs: number,
): Promise<ScriptOutput> {
    const loadError = loadModule(jsCode, sandbox, timeoutMs);
    if (loadError) { return { results: [], log: [loadError.message], error: loadError.message }; }
    const run = extractRun(sandbox);
    if (!run) { return { results: [], log: [], error: 'Script must export a \'run\' function.' }; }
    const execError = await runWithTimeout(() => run(api), timeoutMs);
    return { results: [], log: [], error: execError ? execError.message : undefined };
}

export async function execute(
    filePath: string,
    host: ScriptHost,
    timeoutMs: number = SCRIPT_TIMEOUT_MS,
): Promise<ScriptOutput> {
    const api = buildAPI(host);
    return runOrError(await compileScript(readScript(filePath), filePath), createSandbox(host), api, timeoutMs);
}
