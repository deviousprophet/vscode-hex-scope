import type { SearchEndianness, SearchMode, SerializedSegment } from './types';

export interface SearchRequest {
    mode: SearchMode;
    raw: string;
    segments: SerializedSegment[];
    endianness?: SearchEndianness;
}

export interface SearchHandlers {
    onProgressUpdate?: (matches: number[], percentComplete: number) => void;
    onComplete: (matches: number[]) => void;
}

interface SearchCursor {
    segmentIndex: number;
    offset: number;
}

interface AddressSearchBounds {
    queryMin: number;
    queryMax: number;
    prefixShift: number;
    prefixValue: number;
}

interface SearchProgressState {
    total: number;
    scanned: number;
    lastUpdateTime: number;
}

const SEARCH_DEBOUNCE_MS = 120;
const SEARCH_CHUNK_BUDGET_MS = 24;
const SEARCH_PROGRESS_THROTTLE_MS = 150;
const SEARCH_CLOCK_CHECK_COMPARISONS = 4_096;

export class SearchEngine {
    private token = 0;
    private debounceHandle: ReturnType<typeof setTimeout> | null = null;
    private chunkHandle: ReturnType<typeof setTimeout> | null = null;

    public search(req: SearchRequest, handlers: SearchHandlers): void {
        this.cancelPending();

        const raw = req.raw ?? '';
        if (raw.trim() === '') {
            handlers.onComplete([]);
            return;
        }

        const token = ++this.token;

        this.debounceHandle = setTimeout(() => {
            this.debounceHandle = null;
            if (req.mode === 'addr') {
                this.runAddressSearch(token, req, handlers);
                return;
            }
            this.runByteSearch(token, req, handlers);
        }, SEARCH_DEBOUNCE_MS);
    }

    public clear(): void {
        this.cancelPending();
    }

    /**
     * Scan segments for byte patterns. Iterates through contiguous segment data,
     * checking for needle matches without materializing an address array.
     * Emits progressive results via onProgressUpdate as search continues.
     */
    private runByteSearch(token: number, req: SearchRequest, handlers: SearchHandlers): void {
        const needles = buildNeedles(req.mode, req.raw, req.endianness ?? 'le');
        if (needles.length === 0) {
            handlers.onComplete([]);
            return;
        }

        const needleLen = needles[0].length;
        const matches: number[] = [];
        const segments = sortSegmentsByStart(req.segments);

        const cursor: SearchCursor = { segmentIndex: 0, offset: 0 };
        const progress = createSearchProgress(segments);
        this.runChunkedSearch(token, segments.length, cursor, progress, handlers, matches, () =>
            scanByteSearchChunk(segments, needles, needleLen, cursor, matches)
        );
    }

    /**
     * Search segment address ranges for prefix matches using segment-smart skipping.
     * Only iterates addresses within segments that could contain matches.
     * Skips entire segments if they don't overlap with the possible address range.
     */
    private runAddressSearch(token: number, req: SearchRequest, handlers: SearchHandlers): void {
        const query = normalizeAddrQuery(req.raw);
        if (!query) {
            handlers.onComplete([]);
            return;
        }

        const matches: number[] = [];
        const segments = sortSegmentsByStart(req.segments);
        const cursor: SearchCursor = { segmentIndex: 0, offset: 0 };
        const progress = createSearchProgress(segments);

        const bounds = buildAddressSearchBounds(query);
        this.runChunkedSearch(token, segments.length, cursor, progress, handlers, matches, () =>
            scanAddressSearchChunk(segments, bounds, cursor, matches)
        );
    }

    private runChunkedSearch(
        token: number,
        segmentCount: number,
        cursor: SearchCursor,
        progress: SearchProgressState,
        handlers: SearchHandlers,
        matches: number[],
        scanNextChunk: () => number,
    ): void {
        const step = (): void => {
            if (token !== this.token) { return; }

            progress.scanned += scanNextChunk();
            updateSearchProgress(handlers, matches, progress, cursor.segmentIndex >= segmentCount);
            this.continueOrCompleteSearch(token, cursor, segmentCount, step, handlers, matches);
        };

        step();
    }

    private cancelPending(): void {
        this.token++;
        if (this.debounceHandle !== null) {
            clearTimeout(this.debounceHandle);
            this.debounceHandle = null;
        }
        if (this.chunkHandle !== null) {
            clearTimeout(this.chunkHandle);
            this.chunkHandle = null;
        }
    }

    private continueOrCompleteSearch(
        token: number,
        cursor: SearchCursor,
        segmentCount: number,
        step: () => void,
        handlers: SearchHandlers,
        matches: number[],
    ): void {
        if (cursor.segmentIndex < segmentCount) {
            this.chunkHandle = setTimeout(step, 0);
            return;
        }

        this.chunkHandle = null;
        if (token !== this.token) { return; }

        handlers.onComplete(matches);
    }

}

function scanByteSearchChunk(
    segments: SerializedSegment[],
    needles: number[][],
    needleLen: number,
    cursor: SearchCursor,
    matches: number[],
): number {
    return scanSegmentsWithinBudget(
        segments,
        cursor,
        (seg, deadline) => scanByteSegment(seg, needles, needleLen, cursor, matches, deadline),
        seg => cursor.offset > seg.data.length - needleLen,
    );
}

function scanByteSegment(
    seg: SerializedSegment,
    needles: number[][],
    needleLen: number,
    cursor: SearchCursor,
    matches: number[],
    deadline: number,
): number {
    let scanned = 0;
    const comparisonsPerCandidate = Math.max(1, needleLen * needles.length);
    const batchSize = Math.max(32, Math.floor(SEARCH_CLOCK_CHECK_COMPARISONS / comparisonsPerCandidate));
    while (cursor.offset <= seg.data.length - needleLen) {
        const end = Math.min(cursor.offset + batchSize, seg.data.length - needleLen + 1);
        while (cursor.offset < end) {
            if (matchesAnyNeedle(seg.data, cursor.offset, needles)) {
                matches.push(seg.startAddress + cursor.offset);
            }
            cursor.offset++;
            scanned++;
        }
        if (performance.now() >= deadline) { break; }
    }
    return scanned;
}

function matchesAnyNeedle(segmentData: ArrayLike<number>, offset: number, needles: number[][]): boolean {
    for (const needle of needles) {
        if (matchSequenceInSegment(segmentData, offset, needle)) { return true; }
    }
    return false;
}

function buildAddressSearchBounds(query: string): AddressSearchBounds {
    return {
        queryMin: parseInt(query.padEnd(8, '0'), 16),
        queryMax: parseInt(query.padEnd(8, 'F'), 16),
        prefixShift: (8 - query.length) * 4,
        prefixValue: parseInt(query, 16) >>> 0,
    };
}

function scanAddressSearchChunk(
    segments: SerializedSegment[],
    bounds: AddressSearchBounds,
    cursor: SearchCursor,
    matches: number[],
): number {
    return scanSegmentsWithinBudget(
        segments,
        cursor,
        (seg, deadline) => scanAddressSearchSegment(seg, bounds, cursor, matches, deadline),
        seg => cursor.offset >= seg.data.length,
    );
}

function scanSegmentsWithinBudget(
    segments: SerializedSegment[],
    cursor: SearchCursor,
    scanSegment: (seg: SerializedSegment, deadline: number) => number,
    isSegmentComplete: (seg: SerializedSegment) => boolean,
): number {
    const deadline = performance.now() + SEARCH_CHUNK_BUDGET_MS;
    let scanned = 0;

    while (cursor.segmentIndex < segments.length && performance.now() < deadline) {
        const seg = segments[cursor.segmentIndex];
        scanned += scanSegment(seg, deadline);

        if (isSegmentComplete(seg)) {
            cursor.segmentIndex++;
            cursor.offset = 0;
        }
    }

    return scanned;
}

function segmentOverlapsAddressBounds(seg: SerializedSegment, bounds: AddressSearchBounds): boolean {
    const segStart = seg.startAddress;
    const segEnd = seg.startAddress + seg.data.length - 1;
    return segEnd >= bounds.queryMin && segStart <= bounds.queryMax;
}

function scanAddressSegment(
    seg: SerializedSegment,
    bounds: AddressSearchBounds,
    cursor: SearchCursor,
    matches: number[],
    deadline: number,
): number {
    let scanned = 0;
    while (cursor.offset < seg.data.length) {
        const end = Math.min(cursor.offset + SEARCH_CLOCK_CHECK_COMPARISONS, seg.data.length);
        while (cursor.offset < end) {
            const addr = (seg.startAddress + cursor.offset) >>> 0;
            if ((addr >>> bounds.prefixShift) === bounds.prefixValue) {
                matches.push(addr);
            }
            cursor.offset++;
            scanned++;
        }
        if (performance.now() >= deadline) { break; }
    }
    return scanned;
}

function scanAddressSearchSegment(
    seg: SerializedSegment,
    bounds: AddressSearchBounds,
    cursor: SearchCursor,
    matches: number[],
    deadline: number,
): number {
    if (segmentOverlapsAddressBounds(seg, bounds)) {
        return scanAddressSegment(seg, bounds, cursor, matches, deadline);
    }

    cursor.offset = seg.data.length;
    return seg.data.length;
}

function createSearchProgress(segments: SerializedSegment[]): SearchProgressState {
    return {
        total: segments.reduce((sum, seg) => sum + seg.data.length, 0),
        scanned: 0,
        lastUpdateTime: performance.now(),
    };
}

function updateSearchProgress(
    handlers: SearchHandlers,
    matches: number[],
    progress: SearchProgressState,
    complete: boolean,
): void {
    progress.lastUpdateTime = reportSearchProgress(
        handlers,
        matches,
        progress.total,
        progress.scanned,
        progress.lastUpdateTime,
        complete,
    );
}

function reportSearchProgress(
    handlers: SearchHandlers,
    matches: number[],
    total: number,
    scanned: number,
    lastProgressUpdateTime: number,
    complete: boolean,
): number {
    const now = performance.now();
    const throttled = [
        now - lastProgressUpdateTime < SEARCH_PROGRESS_THROTTLE_MS,
        !complete,
    ].every(Boolean);
    if (total <= 0 || throttled) {
        return lastProgressUpdateTime;
    }

    const percent = Math.min(100, Math.floor((scanned / total) * 100));
    handlers.onProgressUpdate?.(matches, percent);
    return now;
}

function matchSequenceInSegment(segmentData: ArrayLike<number>, offset: number, needle: number[]): boolean {
    for (let i = 0; i < needle.length; i++) {
        if (offset + i >= segmentData.length || segmentData[offset + i] !== needle[i]) {
            return false;
        }
    }
    return true;
}

function normalizeAddrQuery(raw: string): string | null {
    const s = raw.trim().replace(/^0x/i, '');
    if (s.length === 0) { return null; }
    if (!/^[0-9a-fA-F]{1,8}$/.test(s)) { return null; }
    return s.toUpperCase();
}

export function buildNeedles(mode: SearchMode, raw: string, endianness: SearchEndianness): number[][] {
    if (mode === 'bytes') {
        return singleNeedle(parseBytePattern(raw));
    }

    if (mode === 'value') {
        return buildValueNeedles(raw, endianness);
    }

    if (mode === 'ascii') {
        return [Array.from(new TextEncoder().encode(raw))];
    }

    return [];
}

function singleNeedle(bytes: number[]): number[][] {
    return bytes.length ? [bytes] : [];
}

function buildValueNeedles(raw: string, endianness: SearchEndianness): number[][] {
    const beBytes = parseValuePattern(raw);
    if (beBytes.length === 0) { return []; }
    return buildEndianNeedles(beBytes, endianness);
}

function parseBytePattern(raw: string): number[] {
    return parseHexBytes(raw.replace(/\s/g, ''));
}

function parseHexBytes(hex: string): number[] {
    const tokens = hex.match(/.{1,2}/g) ?? [];
    const bytes: number[] = [];
    for (const tok of tokens) {
        const v = parseInt(tok, 16);
        if (!isParsedByte(v)) { return []; }
        bytes.push(v);
    }
    return bytes;
}

function isParsedByte(value: number): boolean {
    return !isNaN(value) && value >= 0 && value <= 255;
}

function parseValuePattern(raw: string): number[] {
    const s = raw.trim().replace(/_/g, '');
    if (!s) { return []; }

    if (/^0x[0-9a-fA-F]+$/.test(s)) { return parseHexValueBytes(s.slice(2)); }

    if (!/^\d+$/.test(s)) { return []; }

    return parseDecimalValueBytes(s);
}

function parseDecimalValueBytes(s: string): number[] {
    const value = parseDecimalBigInt(s);
    return value === null ? [] : bigIntToBigEndianBytes(value);
}

function parseHexValueBytes(hexValue: string): number[] {
    const hex = hexValue.length % 2 === 1 ? `0${hexValue}` : hexValue;
    return parseHexBytes(hex);
}

function parseDecimalBigInt(s: string): bigint | null {
    try {
        return BigInt(s);
    } catch {
        return null;
    }
}

function bigIntToBigEndianBytes(value: bigint): number[] {
    if (value === 0n) { return [0]; }

    const out: number[] = [];
    while (value > 0n) {
        out.push(Number(value & 0xFFn));
        value >>= 8n;
        if (out.length > 8) { return []; }
    }
    return out.reverse();
}

function buildEndianNeedles(beBytes: number[], endianness: SearchEndianness): number[][] {
    if (beBytes.length <= 1) {
        return [beBytes];
    }

    if (endianness === 'be') {
        return [beBytes];
    }

    const leBytes = [...beBytes].reverse();
    if (endianness === 'le') {
        return [leBytes];
    }

    return buildAutoEndianNeedles(beBytes, leBytes);
}

function buildAutoEndianNeedles(beBytes: number[], leBytes: number[]): number[][] {
    return arraysEqual(beBytes, leBytes) ? [beBytes] : [beBytes, leBytes];
}

function arraysEqual(a: number[], b: number[]): boolean {
    if (a.length !== b.length) { return false; }
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) { return false; }
    }
    return true;
}

function sortSegmentsByStart(segments: SerializedSegment[]): SerializedSegment[] {
    for (let i = 1; i < segments.length; i++) {
        if (segments[i].startAddress < segments[i - 1].startAddress) {
            return [...segments].sort((a, b) => a.startAddress - b.startAddress);
        }
    }
    return segments;
}

export function canonicalizeQuery(mode: SearchMode, raw: string): string {
    const canonicalizers: Record<SearchMode, (value: string) => string> = {
        bytes: canonicalizeByteQuery,
        value: canonicalizeValueQuery,
        addr: canonicalizeAddrQuery,
        ascii: value => value,
    };
    return canonicalizers[mode](raw);
}

function canonicalizeByteQuery(raw: string): string {
    return canonicalizeBytes(parseBytePattern(raw)) ?? raw.replace(/\s/g, '').toUpperCase();
}

function canonicalizeValueQuery(raw: string): string {
    return canonicalizeBytes(parseValuePattern(raw)) ?? raw.replace(/_/g, '').toUpperCase();
}

function canonicalizeAddrQuery(raw: string): string {
    return normalizeAddrQuery(raw) ?? raw.replace(/^0x/i, '').toUpperCase();
}

function canonicalizeBytes(bytes: number[]): string | null {
    if (bytes.length === 0) { return null; }
    return bytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join('');
}
