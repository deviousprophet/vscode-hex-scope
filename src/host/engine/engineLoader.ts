/**
 * Session-scoped Rust engine: one required process, lazily started, shared by every parse in
 * the extension host. There is no TypeScript parsing fallback: a start or request failure is
 * surfaced to the caller (and fails activation when the engine cannot start at all).
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

import { hydrateCompactParseResult, type SerializedCompactParseResult } from '../../core/parser/compact';
import type { HexRecord, ParseProgress } from '../../core/parser/types';
import type { WireParseResult } from '../../core/types';
import { serializeParseResult } from '../../core/wire';
import { EngineClient, EngineError, engineBinaryPath, isSupportedEngineTarget } from './engineClient';

let configuredRoot: string | undefined;
let client: EngineClient | null = null;
let starting: Promise<EngineClient> | null = null;
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

/** Why the engine last failed, or null when it has not failed. */
export function engineUnavailableReason(): string | null {
    return unavailableReason;
}

/** The live engine. Throws `EngineError` when this build cannot run one. */
export async function getEngine(): Promise<EngineClient> {
    if (client) {
        return client;
    }
    if (!starting) {
        starting = startEngine();
    }
    try {
        client = await starting;
        unavailableReason = null;
        return client;
    } catch (error) {
        unavailableReason = error instanceof Error ? error.message : String(error);
        throw error;
    } finally {
        starting = null;
    }
}

async function startEngine(): Promise<EngineClient> {
    const root = resolveRoot();
    if (!isSupportedEngineTarget()) {
        throw new EngineError(
            `no Rust engine for ${process.platform}-${process.arch}. ` +
                `Supported: linux-x64, win32-x64, darwin-x64, darwin-arm64.`
        );
    }
    const binary = engineBinaryPath(root);
    return EngineClient.start({ binary });
}

/** Start the engine during activation; a failure must abort activation. */
export async function ensureEngine(): Promise<void> {
    await getEngine();
}

/**
 * Run one request. A crashed engine is replaced once and the request retried; a second failure
 * is reported to the caller instead of silently parsing elsewhere.
 */
async function withEngine<T>(run: (engine: EngineClient) => Promise<T>): Promise<T> {
    const engine = await getEngine();
    try {
        return await run(engine);
    } catch (first) {
        shutdownEngine();
        try {
            return await run(await getEngine());
        } catch (second) {
            unavailableReason = second instanceof Error ? second.message : String(second);
            shutdownEngine();
            throw second;
        }
    }
}

/** Parse a text source in Rust. */
export function parseTextWithEngine(
    source: string,
    format: 'ihex' | 'srec',
    onProgress?: (progress: ParseProgress) => void
): Promise<SerializedCompactParseResult> {
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

/** Parse raw binary bytes in Rust. */
export function parseBinaryWithEngine(
    bytes: Uint8Array,
    baseAddress: number
): Promise<SerializedCompactParseResult> {
    return withEngine(engine => engine.parse({ format: 'bin', bytes, baseAddress }));
}

/** Parse the physical lines of one record page in Rust. */
export function parseLinesWithEngine(
    format: 'ihex' | 'srec',
    lines: ReadonlyArray<{ lineNumber: number; raw: string }>
): Promise<HexRecord[]> {
    return withEngine(engine => engine.parseLines(format, lines));
}

/** Repair checksum fields in Rust. */
export function repairWithEngine(
    source: string,
    format: 'ihex' | 'srec'
): Promise<{ text: string; repaired: number }> {
    return withEngine(engine => engine.repair(format, source));
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
