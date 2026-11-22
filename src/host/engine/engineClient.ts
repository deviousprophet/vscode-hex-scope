/**
 * Client for the packaged Rust parsing engine.
 *
 * One long-lived process speaks a framed protocol over stdio:
 * `[u32 LE payload_len][u16 LE header_len][header JSON][body bytes]`. Record bytes travel in
 * the body, so a parse response is never JSON-escaped or copied through object literals.
 *
 * Pure Node: no `vscode` import. The extension host owns one client; the loader starts it
 * and surfaces failures to the caller. There is no TypeScript parser fallback.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import type { HexRecord, ParseProgress } from '../../core/parser/types';
import type { SerializedCompactPage, SerializedCompactParseResult } from '../../core/parser/compact';

/** The protocol version this client speaks. */
const ENGINE_PROTOCOL = 1;

const MAX_FRAME = 64 * 1024 * 1024;
const MAX_HEADER = 0xffff;

/** Platforms a build ships an engine binary for. */
const SUPPORTED_ENGINE_TARGETS = ['linux-x64', 'win32-x64', 'darwin-x64', 'darwin-arm64'] as const;

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
    repaired?: unknown;
}

/** Boundary parser: reject a malformed header instead of casting JSON into `EngineFrame`. */
function parseEngineFrame(text: string): EngineFrame | null {
    const source = parseObject(text);
    if (!source) { return null; }
    if (!scalarsValid(source)) { return null; }
    return buildFrame(source);
}

function parseObject(text: string): Record<string, unknown> | null {
    try {
        return objectValue(JSON.parse(text));
    } catch {
        return null;
    }
}

function objectValue(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) { return null; }
    return value as Record<string, unknown>;
}

function scalarsValid(source: Record<string, unknown>): boolean {
    return idValid(source) && okValid(source) && stageValid(source);
}

function idValid(source: Record<string, unknown>): boolean {
    return source.id === undefined || typeof source.id === 'number';
}

function okValid(source: Record<string, unknown>): boolean {
    return source.ok === undefined || typeof source.ok === 'boolean';
}

function stageValid(source: Record<string, unknown>): boolean {
    return source.stage === undefined || source.stage === 'parse' || source.stage === 'build';
}

function buildFrame(source: Record<string, unknown>): EngineFrame {
    return {
        id: numberField(source.id),
        ok: booleanField(source.ok),
        error: stringField(source.error),
        event: stringField(source.event),
        stage: stageField(source.stage),
        completed: numberField(source.completed),
        total: numberField(source.total),
        protocol: numberField(source.protocol),
        recordCount: source.recordCount,
        totalDataBytes: source.totalDataBytes,
        checksumErrors: source.checksumErrors,
        malformedLines: source.malformedLines,
        startAddress: source.startAddress,
        baseAddress: source.baseAddress,
        pageLengths: source.pageLengths,
        segments: source.segments,
        repaired: source.repaired,
    };
}

function numberField(value: unknown): number | undefined {
    return typeof value === 'number' ? value : undefined;
}

function booleanField(value: unknown): boolean | undefined {
    return typeof value === 'boolean' ? value : undefined;
}

function stringField(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

function stageField(value: unknown): ParseProgress['stage'] | undefined {
    return value === 'parse' || value === 'build' ? value : undefined;
}

interface Pending {
    resolve: (response: EngineResponse) => void;
    reject: (error: Error) => void;
    onProgress?: (frame: EngineFrame) => void;
}

interface EngineResponse {
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

function assertEngineBuilt(options: EngineClientOptions): void {
    if (options.spawnProcess) { return; }
    if (existsSync(options.binary)) { return; }
    throw new EngineError(`Rust engine is not built at ${options.binary}; run "npm run engine:build"`);
}

function spawnFor(options: EngineClientOptions): ChildProcessWithoutNullStreams {
    return options.spawnProcess
        ? options.spawnProcess(options.binary)
        : spawn(options.binary, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
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

function parseHeader(request: EngineParseRequest): Record<string, unknown> {
    return request.baseAddress === undefined
        ? { op: 'parse', format: request.format }
        : { op: 'parse', format: request.format, baseAddress: request.baseAddress };
}

function parseBody(request: EngineParseRequest): Buffer {
    return request.format === 'bin' ? binaryBody(request.bytes) : textBody(request.source);
}

function binaryBody(bytes: Uint8Array | undefined): Buffer {
    return Buffer.from(bytes ?? new Uint8Array(0));
}

function textBody(source: string | undefined): Buffer {
    return Buffer.from(source ?? '', 'utf8');
}

/**
 * A started engine process. Requests are correlated by id; progress frames carry the request id
 * and `event: "progress"`, and are delivered to that pending request before its final frame.
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
        assertEngineBuilt(options);
        const client = new EngineClient(spawnFor(options));
        return client.handshake();
    }

    private async handshake(): Promise<EngineClient> {
        try {
            await this.assertProtocol();
            return this;
        } catch (error) {
            this.dispose();
            throw error;
        }
    }

    private async assertProtocol(): Promise<void> {
        const response = await this.request({ op: 'ping' });
        if (response.header.protocol !== ENGINE_PROTOCOL) {
            throw new EngineError(`engine protocol ${String(response.header.protocol)} does not match ${ENGINE_PROTOCOL}`);
        }
    }

    public get isClosed(): boolean {
        return this.closed;
    }

    /** Parse one file and return the worker-transferable compact payload. */
    public async parse(
        request: EngineParseRequest,
        onProgress?: (progress: EngineFrame) => void
    ): Promise<SerializedCompactParseResult> {
        const response = await this.request(parseHeader(request), parseBody(request), onProgress);
        return mapCompactResult(response.header, response.body);
    }

    /** Parse selected physical lines for a record page (no full-file reparse). */
    public async parseLines(
        format: 'ihex' | 'srec',
        lines: ReadonlyArray<{ lineNumber: number; raw: string }>
    ): Promise<HexRecord[]> {
        const body = Buffer.from(JSON.stringify(lines), 'utf8');
        const response = await this.request({ op: 'records', format }, body);
        let parsed: unknown;
        try {
            parsed = JSON.parse(response.body.toString('utf8'));
        } catch {
            throw new EngineError('engine records response is not valid JSON');
        }
        if (!Array.isArray(parsed)) {
            throw new EngineError('engine records response is not an array');
        }
        return parsed.map(recordFromJson);
    }

    /** Rewrite wrong checksum fields and return the repaired source. */
    public async repair(
        format: 'ihex' | 'srec',
        source: string
    ): Promise<{ text: string; repaired: number }> {
        const response = await this.request({ op: 'repair', format }, Buffer.from(source, 'utf8'));
        return { text: response.body.toString('utf8'), repaired: count(response.header.repaired) };
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
        this.drainFrames();
    }

    private drainFrames(): void {
        for (;;) {
            const frame = this.takeFrame();
            if (!frame) { return; }
            this.dispatch(frame.header, frame.body);
        }
    }

    private takeFrame(): { header: Buffer; body: Buffer } | null {
        if (this.buffered < 6) { return null; }
        const prefix = this.framePrefix();
        const payloadLength = prefix.readUInt32LE(0);
        const headerLength = prefix.readUInt16LE(4);
        if (isInvalidFrame(payloadLength, headerLength)) {
            this.handleExit(null, 'engine sent an invalid frame');
            return null;
        }
        const total = 6 + payloadLength;
        if (this.buffered < total) { return null; }
        const all = Buffer.concat(this.chunks, this.buffered);
        this.chunks = [all.subarray(total)];
        this.buffered = all.length - total;
        const payload = all.subarray(6, total);
        return {
            header: payload.subarray(0, headerLength),
            body: payload.subarray(headerLength),
        };
    }

    private framePrefix(): Buffer {
        return this.chunks[0].length >= 6 ? this.chunks[0] : Buffer.concat(this.chunks);
    }

    private dispatch(headerBytes: Buffer, body: Buffer): void {
        const header = parseEngineFrame(headerBytes.toString('utf8'));
        if (!header) {
            this.handleExit(null, 'engine sent an invalid header');
            return;
        }
        this.route(header, body);
    }

    private route(header: EngineFrame, body: Buffer): void {
        if (isProgressFrame(header)) {
            this.progress(header);
            return;
        }
        this.settle(header, body);
    }

    private progress(header: EngineFrame): void {
        const id = header.id;
        if (typeof id !== 'number') { return; }
        this.pending.get(id)?.onProgress?.(header);
    }

    private settle(header: EngineFrame, body: Buffer): void {
        const id = header.id;
        if (typeof id !== 'number') { return; }
        const pending = this.pending.get(id);
        if (!pending) { return; }
        this.pending.delete(id);
        resolvePending(pending, header, body);
    }

    private handleExit(code: number | null, signal: string | null): void {
        if (this.exitIsIgnorable()) { return; }
        this.closed = true;
        this.rejectAll(this.exitError(code, signal));
    }

    private exitIsIgnorable(): boolean {
        return this.closed && this.pending.size === 0;
    }

    private exitError(code: number | null, signal: string | null): EngineError {
        const reason = code ?? signal;
        const detail = this.lastStderr ? `: ${this.lastStderr}` : '';
        return new EngineError(`engine exited (${reason})${detail}`);
    }

    private rejectAll(error: Error): void {
        for (const pending of this.pending.values()) {
            pending.reject(error);
        }
        this.pending.clear();
    }
}

function isInvalidFrame(payloadLength: number, headerLength: number): boolean {
    return payloadLength > MAX_FRAME || headerLength > payloadLength;
}

function isProgressFrame(header: EngineFrame): boolean {
    return header.event === 'progress';
}

function resolvePending(pending: Pending, header: EngineFrame, body: Buffer): void {
    if (header.ok === false) {
        pending.reject(new EngineError(header.error ?? 'engine request failed'));
        return;
    }
    pending.resolve({ header, body });
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

function recordFromJson(value: unknown): HexRecord {
    const source = recordObject(value);
    return {
        lineNumber: numeric(source.lineNumber),
        raw: textOrEmpty(source.raw),
        byteCount: count(source.byteCount),
        address: count(source.address),
        recordType: count(source.recordType),
        data: Uint8Array.from(recordBytes(source.data)),
        checksum: count(source.checksum),
        checksumValid: source.checksumValid === true,
        resolvedAddress: count(source.resolvedAddress),
        ...errorField(source.error),
    };
}

function recordObject(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object') { return value as Record<string, unknown>; }
    throw new EngineError('engine record is not an object');
}

function textOrEmpty(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function recordBytes(value: unknown): number[] {
    return Array.isArray(value) ? value.map(byte => count(byte) & 0xff) : [];
}

function errorField(value: unknown): { error?: string } {
    return typeof value === 'string' ? { error: value } : {};
}

/** Map the engine's page/segment body into the worker's compact payload shape. */
export function mapCompactResult(frame: EngineFrame, body: Buffer): SerializedCompactParseResult {
    const lengths = pageLengths(frame, body.length);
    const cursor = { at: 0 };
    const pages = lengths.map(length => readPage(body, cursor, length));
    const segments = readSegments(frame.segments, body, cursor.at);
    return compactResult(frame, pages, segments);
}

function pageLengths(frame: EngineFrame, bodyLength: number): number[] {
    if (!Array.isArray(frame.pageLengths) || !Array.isArray(frame.segments)) {
        throw new EngineError('engine response is missing page or segment metadata');
    }
    const lengths = frame.pageLengths.map(count);
    const pageBytes = lengths.reduce((total, length) => total + length * 24, 0);
    if (pageBytes > bodyLength) {
        throw new EngineError('engine response is truncated');
    }
    return lengths;
}

function readPage(body: Buffer, cursor: { at: number }, length: number): SerializedCompactPage {
    return {
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
    };
}

function readSegments(headers: unknown, body: Buffer, base: number): SerializedCompactParseResult['segments'] {
    if (!Array.isArray(headers)) {
        throw new EngineError('engine response is missing segment metadata');
    }
    return headers.map(raw => readSegment(raw, body, base));
}

function readSegment(raw: unknown, body: Buffer, base: number): { startAddress: number; data: ArrayBuffer } {
    const entry = segmentEntry(raw);
    const offset = count(entry.offset);
    const length = count(entry.length);
    const start = base + offset;
    if (start + length > body.length) {
        throw new EngineError('engine response is truncated');
    }
    const data = new ArrayBuffer(length);
    body.copy(new Uint8Array(data), 0, start, start + length);
    return { startAddress: count(entry.startAddress), data };
}

function segmentEntry(raw: unknown): Record<string, unknown> {
    return raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
}

function compactResult(
    frame: EngineFrame,
    pages: SerializedCompactParseResult['pages'],
    segments: SerializedCompactParseResult['segments']
): SerializedCompactParseResult {
    const result: SerializedCompactParseResult = {
        recordCount: count(frame.recordCount),
        pages,
        segments,
        totalDataBytes: count(frame.totalDataBytes),
        checksumErrors: count(frame.checksumErrors),
        malformedLines: count(frame.malformedLines),
    };
    assignStartAddress(result, frame.startAddress);
    assignBaseAddress(result, frame.baseAddress);
    return result;
}

function assignStartAddress(result: SerializedCompactParseResult, value: unknown): void {
    const startAddress = numeric(value, Number.NaN);
    if (!Number.isNaN(startAddress)) {
        result.startAddress = startAddress;
    }
}

function assignBaseAddress(result: SerializedCompactParseResult, value: unknown): void {
    if (typeof value === 'number') {
        result.baseAddress = count(value);
    }
}
