/**
 * Client for the packaged Rust parsing engine.
 *
 * One long-lived process speaks a framed protocol over stdio:
 * `[u32 LE payload_len][u16 LE header_len][header JSON][body bytes]`. Record bytes travel in
 * the body, so a parse response is never JSON-escaped or copied through object literals.
 *
 * Pure Node: no `vscode` import. The extension host owns one client; the loader starts it
 * lazily and every caller falls back to the TypeScript parser when the engine cannot serve.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import type { SerializedCompactPage, SerializedCompactParseResult } from '../../core/parser/compact';
import type { ParseProgress } from '../../core/parser/types';

/** The protocol version this client speaks. */
export const ENGINE_PROTOCOL = 1;

const MAX_FRAME = 64 * 1024 * 1024;
const MAX_HEADER = 0xffff;

/** Platforms a build ships an engine binary for. */
export const SUPPORTED_ENGINE_TARGETS = ['linux-x64', 'win32-x64', 'darwin-x64', 'darwin-arm64'] as const;

export class EngineError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'EngineError';
    }
}

/** The packaged engine binary for one platform/architecture. */
export function engineBinaryPath(
    root: string,
    platform: string = process.platform,
    arch: string = process.arch
): string {
    const name = platform === 'win32' ? 'hex-engine.exe' : 'hex-engine';
    return path.join(root, 'dist', 'engine', `${platform}-${arch}`, name);
}

/** True when this build has an engine for the target. */
export function isSupportedEngineTarget(
    platform: string = process.platform,
    arch: string = process.arch
): boolean {
    return (SUPPORTED_ENGINE_TARGETS as readonly string[]).includes(`${platform}-${arch}`);
}

export interface EngineParseRequest {
    format: 'ihex' | 'srec' | 'bin';
    /** Text source for `ihex` / `srec`. */
    source?: string;
    /** Raw bytes for `bin`. */
    bytes?: Uint8Array;
    /** Required for `bin`. */
    baseAddress?: number;
}

/** A validated frame header. Payload fields stay `unknown` until the mapper checks them. */
export interface EngineFrame {
    id?: number;
    ok?: boolean;
    error?: string;
    event?: string;
    stage?: ParseProgress['stage'];
    completed?: number;
    total?: number;
    protocol?: number;
    recordCount?: unknown;
    totalDataBytes?: unknown;
    checksumErrors?: unknown;
    malformedLines?: unknown;
    startAddress?: unknown;
    baseAddress?: unknown;
    pageLengths?: unknown;
    segments?: unknown;
}

/** Boundary parser: reject a malformed header instead of casting JSON into `EngineFrame`. */
export function parseEngineFrame(text: string): EngineFrame | null {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        return null;
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return null;
    }
    const source = raw as Record<string, unknown>;
    if (source.id !== undefined && typeof source.id !== 'number') {
        return null;
    }
    if (source.ok !== undefined && typeof source.ok !== 'boolean') {
        return null;
    }
    if (source.stage !== undefined && source.stage !== 'parse' && source.stage !== 'build') {
        return null;
    }
    const frame: EngineFrame = {};
    if (typeof source.id === 'number') { frame.id = source.id; }
    if (typeof source.ok === 'boolean') { frame.ok = source.ok; }
    if (typeof source.error === 'string') { frame.error = source.error; }
    if (typeof source.event === 'string') { frame.event = source.event; }
    if (source.stage === 'parse' || source.stage === 'build') { frame.stage = source.stage; }
    if (typeof source.completed === 'number') { frame.completed = source.completed; }
    if (typeof source.total === 'number') { frame.total = source.total; }
    if (typeof source.protocol === 'number') { frame.protocol = source.protocol; }
    frame.recordCount = source.recordCount;
    frame.totalDataBytes = source.totalDataBytes;
    frame.checksumErrors = source.checksumErrors;
    frame.malformedLines = source.malformedLines;
    frame.startAddress = source.startAddress;
    frame.baseAddress = source.baseAddress;
    frame.pageLengths = source.pageLengths;
    frame.segments = source.segments;
    return frame;
}

interface Pending {
    resolve: (response: EngineResponse) => void;
    reject: (error: Error) => void;
    onProgress?: (frame: EngineFrame) => void;
}

export interface EngineResponse {
    header: EngineFrame;
    body: Buffer;
}

export interface EngineClientOptions {
    binary: string;
    /** Spawn implementation, for tests. */
    spawnProcess?: (binary: string) => ChildProcessWithoutNullStreams;
}

function prefixFor(headerLength: number, payloadLength: number): Buffer {
    const prefix = Buffer.alloc(6);
    prefix.writeUInt32LE(payloadLength, 0);
    prefix.writeUInt16LE(headerLength, 4);
    return prefix;
}

function joinFrames(header: Record<string, unknown>, body: Buffer | Uint8Array): Buffer {
    const json = Buffer.from(JSON.stringify(header), 'utf8');
    if (json.length > MAX_HEADER) {
        throw new EngineError('request header is too large');
    }
    const payloadLength = json.length + body.length;
    if (payloadLength > MAX_FRAME) {
        throw new EngineError('request exceeds the frame limit');
    }
    return Buffer.concat([prefixFor(json.length, payloadLength), json, Buffer.from(body)]);
}

/**
 * A started engine process. Requests are correlated by id; progress frames (`id: 0`,
 * `event: "progress"`) are delivered to the pending request before its final frame.
 */
export class EngineClient {
    private readonly child: ChildProcessWithoutNullStreams;
    private readonly pending = new Map<number, Pending>();
    private nextId = 1;
    private chunks: Buffer[] = [];
    private buffered = 0;
    private closed = false;

    private constructor(child: ChildProcessWithoutNullStreams) {
        this.child = child;
        child.stdout.on('data', (chunk: Buffer) => this.receive(chunk));
        child.on('exit', (code, signal) => this.handleExit(code, signal));
        child.on('error', (error) => this.handleExit(null, String(error)));
        child.stderr.on('data', (chunk: Buffer) => {
            // The engine reports fatal problems on stderr; keep the last line for the caller.
            this.lastStderr = chunk.toString('utf8').trim();
        });
    }

    private lastStderr = '';

    /** Spawn the engine and validate the protocol handshake. */
    public static async start(options: EngineClientOptions): Promise<EngineClient> {
        if (!options.spawnProcess && !existsSync(options.binary)) {
            throw new EngineError(`Rust engine is not built at ${options.binary}; run "npm run engine:build"`);
        }
        const child = options.spawnProcess
            ? options.spawnProcess(options.binary)
            : spawn(options.binary, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
        const client = new EngineClient(child);
        try {
            const response = await client.request({ op: 'ping' });
            if (response.header.protocol !== ENGINE_PROTOCOL) {
                throw new EngineError(`engine protocol ${String(response.header.protocol)} does not match ${ENGINE_PROTOCOL}`);
            }
        } catch (error) {
            client.dispose();
            throw error;
        }
        return client;
    }

    public get isClosed(): boolean {
        return this.closed;
    }

    /** Parse one file and return the worker-transferable compact payload. */
    public async parse(
        request: EngineParseRequest,
        onProgress?: (progress: EngineFrame) => void
    ): Promise<SerializedCompactParseResult> {
        const body = request.format === 'bin' ? Buffer.from(request.bytes ?? new Uint8Array(0)) : Buffer.from(request.source ?? '', 'utf8');
        const header: Record<string, unknown> = { op: 'parse', format: request.format };
        if (request.baseAddress !== undefined) {
            header.baseAddress = request.baseAddress;
        }
        const response = await this.request(header, body, onProgress);
        return mapCompactResult(response.header, response.body);
    }

    public dispose(): void {
        this.closed = true;
        for (const pending of this.pending.values()) {
            pending.reject(new EngineError('engine disposed'));
        }
        this.pending.clear();
        try {
            this.child.stdin.end();
            this.child.kill();
        } catch {
            /* already gone */
        }
    }

    private request(
        header: Record<string, unknown>,
        body: Uint8Array = new Uint8Array(0),
        onProgress?: (frame: EngineFrame) => void
    ): Promise<EngineResponse> {
        if (this.closed) {
            return Promise.reject(new EngineError('engine is closed'));
        }
        const id = this.nextId++;
        const frame = joinFrames({ id, ...header }, body);
        return new Promise<EngineResponse>((resolve, reject) => {
            this.pending.set(id, { resolve, reject, onProgress });
            this.child.stdin.write(frame, error => {
                if (!error) {
                    return;
                }
                this.pending.delete(id);
                reject(new EngineError(`engine write failed: ${error.message}`));
            });
        });
    }

    private receive(chunk: Buffer): void {
        this.chunks.push(chunk);
        this.buffered += chunk.length;
        while (this.buffered >= 6) {
            const prefix = this.chunks[0].length >= 6 ? this.chunks[0] : Buffer.concat(this.chunks);
            if (prefix.length < 6) {
                return;
            }
            const payloadLength = prefix.readUInt32LE(0);
            const headerLength = prefix.readUInt16LE(4);
            if (payloadLength > MAX_FRAME || headerLength > payloadLength) {
                this.handleExit(null, 'engine sent an invalid frame');
                return;
            }
            const total = 6 + payloadLength;
            if (this.buffered < total) {
                return;
            }
            const all = Buffer.concat(this.chunks, this.buffered);
            this.chunks = [all.subarray(total)];
            this.buffered = all.length - total;
            const payload = all.subarray(6, total);
            this.dispatch(payload.subarray(0, headerLength), payload.subarray(headerLength));
        }
    }

    private dispatch(headerBytes: Buffer, body: Buffer): void {
        const header = parseEngineFrame(headerBytes.toString('utf8'));
        if (!header) {
            this.handleExit(null, 'engine sent an invalid header');
            return;
        }
        if (header.id === 0 && header.event === 'progress') {
            for (const pending of this.pending.values()) {
                pending.onProgress?.(header);
            }
            return;
        }
        if (typeof header.id !== 'number') {
            return;
        }
        const pending = this.pending.get(header.id);
        if (!pending) {
            return;
        }
        this.pending.delete(header.id);
        if (header.ok === false) {
            pending.reject(new EngineError(header.error ?? 'engine request failed'));
            return;
        }
        pending.resolve({ header, body });
    }

    private handleExit(code: number | null, signal: string | null): void {
        if (this.closed && this.pending.size === 0) {
            return;
        }
        this.closed = true;
        const detail = this.lastStderr ? `: ${this.lastStderr}` : '';
        const error = new EngineError(`engine exited (${code ?? signal})${detail}`);
        for (const pending of this.pending.values()) {
            pending.reject(error);
        }
        this.pending.clear();
    }
}

function readUint32Array(body: Buffer, cursor: { at: number }, length: number): Uint32Array {
    const buffer = new ArrayBuffer(length * 4);
    const view = new Uint32Array(buffer);
    for (let index = 0; index < length; index++) {
        view[index] = body.readUInt32LE(cursor.at);
        cursor.at += 4;
    }
    return view;
}

function readUint8Array(body: Buffer, cursor: { at: number }, length: number): Uint8Array {
    const buffer = new ArrayBuffer(length);
    const view = new Uint8Array(buffer);
    body.copy(view, 0, cursor.at, cursor.at + length);
    cursor.at += length;
    return view;
}

function numeric(value: unknown, fallback = 0): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function count(value: unknown): number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/** Map the engine's page/segment body into the worker's compact payload shape. */
export function mapCompactResult(frame: EngineFrame, body: Buffer): SerializedCompactParseResult {
    const rawLengths = frame.pageLengths;
    const segmentHeaders = frame.segments;
    if (!Array.isArray(rawLengths) || !Array.isArray(segmentHeaders)) {
        throw new EngineError('engine response is missing page or segment metadata');
    }
    const lengths = rawLengths.map(count);
    const pageBytes = lengths.reduce((total, length) => total + length * 24, 0);
    if (pageBytes > body.length) {
        throw new EngineError('engine response is truncated');
    }

    const cursor = { at: 0 };
    const pages: SerializedCompactPage[] = lengths.map(length => ({
        length,
        sourceStart: readUint32Array(body, cursor, length),
        sourceEnd: readUint32Array(body, cursor, length),
        lineNumber: readUint32Array(body, cursor, length),
        address: readUint32Array(body, cursor, length),
        resolvedAddress: readUint32Array(body, cursor, length),
        byteCount: readUint8Array(body, cursor, length),
        recordType: readUint8Array(body, cursor, length),
        checksum: readUint8Array(body, cursor, length),
        flags: readUint8Array(body, cursor, length),
    }));

    const segmentBase = cursor.at;
    const segments = segmentHeaders.map(raw => {
        const entry = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
        const offset = count(entry.offset);
        const length = count(entry.length);
        if (segmentBase + offset + length > body.length) {
            throw new EngineError('engine response is truncated');
        }
        const data = new ArrayBuffer(length);
        body.copy(new Uint8Array(data), 0, segmentBase + offset, segmentBase + offset + length);
        return { startAddress: count(entry.startAddress), data };
    });

    const result: SerializedCompactParseResult = {
        recordCount: count(frame.recordCount),
        pages,
        segments,
        totalDataBytes: count(frame.totalDataBytes),
        checksumErrors: count(frame.checksumErrors),
        malformedLines: count(frame.malformedLines),
    };
    const startAddress = numeric(frame.startAddress, Number.NaN);
    if (!Number.isNaN(startAddress)) {
        result.startAddress = startAddress;
    }
    const baseAddress = count(frame.baseAddress);
    if (typeof frame.baseAddress === 'number') {
        result.baseAddress = baseAddress;
    }
    return result;
}
