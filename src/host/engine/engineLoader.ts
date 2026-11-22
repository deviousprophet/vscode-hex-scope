/**
 * Session-scoped Rust engine: one process, lazily started, shared by every parse in the
 * extension host. A missing binary or a start failure is remembered and the caller falls back
 * to the TypeScript parser for the rest of the session.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

import { hydrateCompactParseResult, type SerializedCompactParseResult } from '../../core/parser/compact';
import type { ParseProgress } from '../../core/parser/types';
import type { WireParseResult } from '../../core/types';
import { serializeParseResult } from '../../core/wire';
import { EngineClient, engineBinaryPath, isSupportedEngineTarget } from './engineClient';

let configuredRoot: string | undefined;
let client: EngineClient | null = null;
let starting: Promise<EngineClient | null> | null = null;
let unavailableReason: string | null = null;

/** Point the loader at the extension root (the directory holding `dist/engine`). */
export function configureEngineRoot(root: string): void {
    if (configuredRoot === root) {
        return;
    }
    configuredRoot = root;
    shutdownEngine();
    unavailableReason = null;
}

/** The directory holding `dist/engine`, found by walking up from this module's output. */
function resolveRoot(): string {
    if (configuredRoot) {
        return configuredRoot;
    }
    let current = __dirname;
    for (;;) {
        if (existsSync(path.join(current, 'package.json')) && existsSync(path.join(current, 'dist', 'engine'))) {
            return current;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            return path.resolve(__dirname, '..');
        }
        current = parent;
    }
}

/** Why the engine is unavailable, or null when it started (or has not been tried). */
export function engineUnavailableReason(): string | null {
    return unavailableReason;
}

/** The live engine, or null when this build cannot run one. */
export async function getEngine(): Promise<EngineClient | null> {
    if (client) {
        return client;
    }
    if (unavailableReason) {
        return null;
    }
    if (!starting) {
        starting = startEngine();
    }
    const started = await starting;
    starting = null;
    return started;
}

async function startEngine(): Promise<EngineClient | null> {
    const root = resolveRoot();
    if (!isSupportedEngineTarget()) {
        unavailableReason = `no Rust engine for ${process.platform}-${process.arch}`;
        return null;
    }
    const binary = engineBinaryPath(root);
    try {
        client = await EngineClient.start({ binary });
        return client;
    } catch (error) {
        unavailableReason = error instanceof Error ? error.message : String(error);
        console.warn(`[hexscope] Rust engine unavailable: ${unavailableReason}`);
        return null;
    }
}

async function withEngine<T>(
    run: (engine: EngineClient) => Promise<T>
): Promise<T | null> {
    const engine = await getEngine();
    if (!engine) {
        return null;
    }
    try {
        return await run(engine);
    } catch (error) {
        // A crashed or wedged engine must not take the parse path down with it: drop the
        // process, remember why, and let the caller use the TypeScript parser.
        unavailableReason = error instanceof Error ? error.message : String(error);
        console.warn(`[hexscope] Rust engine failed, falling back to TypeScript: ${unavailableReason}`);
        shutdownEngine();
        return null;
    }
}

/** Parse a text source in Rust, or null when the engine cannot serve it. */
export function parseTextWithEngine(
    source: string,
    format: 'ihex' | 'srec',
    onProgress?: (progress: ParseProgress) => void
): Promise<SerializedCompactParseResult | null> {
    return withEngine(engine =>
        engine.parse({ format, source }, frame => {
            if (frame.event !== 'progress' || !frame.stage) {
                return;
            }
            onProgress?.({
                stage: frame.stage,
                completed: typeof frame.completed === 'number' ? frame.completed : 0,
                total: typeof frame.total === 'number' ? frame.total : 0,
            });
        })
    );
}

/** Parse raw binary bytes in Rust, or null when the engine cannot serve it. */
export function parseBinaryWithEngine(
    bytes: Uint8Array,
    baseAddress: number
): Promise<SerializedCompactParseResult | null> {
    return withEngine(engine => engine.parse({ format: 'bin', bytes, baseAddress }));
}

/** Project an engine compact payload onto the webview wire shape. */
export function engineWire(
    payload: SerializedCompactParseResult,
    format: 'ihex' | 'srec' | 'bin'
): WireParseResult {
    return serializeParseResult(hydrateCompactParseResult(payload), format);
}

/** Stop the engine process (used on deactivate and when tests reconfigure the root). */
export function shutdownEngine(): void {
    client?.dispose();
    client = null;
}
