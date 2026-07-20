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

export async function execute(
    filePath: string,
    host: ScriptHost,
    timeoutMs: number = SCRIPT_TIMEOUT_MS,
): Promise<ScriptOutput> {
    const source = readScript(filePath);
    const jsCode = await compileScript(source, filePath);

    const script = new vm.Script(jsCode, {
        filename: path.basename(filePath),
    });

    const sandbox: Record<string, unknown> = vm.createContext({
        module: { exports: {} },
        exports: {},
        console: {
            log: (...args: unknown[]) => host.output(args.map(String).join(' ')),
            warn: (...args: unknown[]) => host.output(`WARN: ${args.map(String).join(' ')}`),
            error: (...args: unknown[]) => host.output(`ERROR: ${args.map(String).join(' ')}`),
        },
        setTimeout,
        clearTimeout,
        Buffer,
        Uint8Array,
        ArrayBuffer,
        DataView,
        TextEncoder,
        TextDecoder,
        URL,
    });

    let execError: string | undefined;
    try {
        script.runInNewContext(sandbox, { timeout: timeoutMs, breakOnSigint: true });
    } catch (err: unknown) {
        execError = err instanceof Error ? err.message : String(err);
        return { results: [], log: [execError], error: execError };
    }

    const mod = sandbox.module as { exports: Record<string, unknown> };
    const run = mod.exports?.run as ((api: HexScopeAPI) => void | Promise<void>) | undefined;

    if (typeof run !== 'function') {
        return { results: [], log: [], error: 'Script must export a \'run\' function.' };
    }

    const api = buildAPI(host);
    try {
        const result = run(api);
        if (result instanceof Promise) {
            const timer = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error(`Script timed out after ${timeoutMs}ms.`)), timeoutMs)
            );
            await Promise.race([result, timer]);
        }
    } catch (err: unknown) {
        execError = err instanceof Error ? err.message : String(err);
        host.output(`Error: ${execError}`);
    }

    return {
        results: [],
        log: [],
        ...(execError ? { error: execError } : {}),
    };
}
