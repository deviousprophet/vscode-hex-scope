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
import { EngineClient, EngineError, engineBinaryPath, isSupportedEngineTarget, type EngineFrame } from './engineClient';

let configuredRoot: string | undefined;
let client: EngineClient | null = null;
let starting: Promise<EngineClient> | null = null;
let unavailableReason: string | null = null;
let generation = 0;

/** Point the loader at the extension root (the directory holding `dist/engine`). */
export function configureEngineRoot(root: string): void {
    if (configuredRoot === root) {
        return;
    }
    configuredRoot = root;
    generation += 1;
    shutdownEngine();
    unavailableReason = null;
}

/** The directory holding `dist/engine`, found by walking up from this module's output. */
function resolveRoot(): string {
    if (configuredRoot) {
        return configuredRoot;
    }
    return walkForRoot(__dirname) ?? path.resolve(__dirname, '..');
}

function walkForRoot(start: string): string | null {
    let current = start;
    for (;;) {
        if (isExtensionRoot(current)) { return current; }
        const parent = path.dirname(current);
        if (parent === current) { return null; }
        current = parent;
    }
}

function isExtensionRoot(dir: string): boolean {
    return existsSync(path.join(dir, 'package.json')) && existsSync(path.join(dir, 'dist', 'engine'));
}

/** Why the engine last failed, or null when it has not failed. */
export function engineUnavailableReason(): string | null {
    return unavailableReason;
}

/** The live engine. Throws `EngineError` when this build cannot run one. */
async function getEngine(): Promise<EngineClient> {
    if (client) {
        return client;
    }
    try {
        client = await startBody(generation);
        unavailableReason = null;
        return client;
    } catch (error) {
        unavailableReason = messageOf(error);
        throw error;
    }
}

async function startBody(started: number): Promise<EngineClient> {
    const engine = await pendingStart();
    if (started !== generation) {
        engine.dispose();
        throw new EngineError('engine was reconfigured while starting');
    }
    return engine;
}

async function pendingStart(): Promise<EngineClient> {
    const pending = starting ?? (starting = startEngine());
    try {
        return await pending;
    } catch (error) {
        if (starting === pending) {
            starting = null;
        }
        throw error;
    }
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
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
    try {
        return await run(await getEngine());
    } catch {
        return retryOnce(run);
    }
}

async function retryOnce<T>(run: (engine: EngineClient) => Promise<T>): Promise<T> {
    shutdownEngine();
    try {
        return await run(await getEngine());
    } catch (error) {
        unavailableReason = messageOf(error);
        shutdownEngine();
        throw error;
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
            const progress = progressFromFrame(frame);
            if (progress) { onProgress?.(progress); }
        })
    );
}

function progressFromFrame(frame: EngineFrame): ParseProgress | null {
    if (frame.event !== 'progress' || !frame.stage) { return null; }
    return {
        stage: frame.stage,
        completed: numberOr(frame.completed),
        total: numberOr(frame.total),
    };
}

function numberOr(value: unknown): number {
    return typeof value === 'number' ? value : 0;
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
    starting = null;
    client?.dispose();
    client = null;
}
