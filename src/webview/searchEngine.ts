// Combined SearchEngine + UI glue
import { S } from './state';
import { applyMatchHighlights, applySel, scrollTo } from './memoryView';
import type { SearchEndianness, SearchMode, SerializedSegment } from './types';

interface SearchRequest {
    mode: SearchMode;
    raw: string;
    segments: SerializedSegment[];
    endianness?: SearchEndianness;
}

interface SearchHandlers {
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

class SearchEngine {
    private token = 0;
    private debounceHandle: number | null = null;
    private chunkHandle: number | null = null;

    public search(req: SearchRequest, handlers: SearchHandlers): void {
        this.cancelPending();

        const raw = req.raw ?? '';
        if (raw.trim() === '') {
            handlers.onComplete([]);
            return;
        }

        const token = ++this.token;

        this.debounceHandle = window.setTimeout(() => {
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

        const step = (): void => {
            if (token !== this.token) { return; }

            progress.scanned += scanByteSearchChunk(segments, needles, needleLen, cursor, matches);
            updateSearchProgress(handlers, matches, progress, cursor.segmentIndex >= segments.length);
            this.continueOrCompleteSearch(token, cursor, segments.length, step, handlers, matches);
        };

        step();
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

        const step = (): void => {
            if (token !== this.token) { return; }

            progress.scanned += scanAddressSearchChunk(segments, bounds, cursor, matches);
            updateSearchProgress(handlers, matches, progress, cursor.segmentIndex >= segments.length);
            this.continueOrCompleteSearch(token, cursor, segments.length, step, handlers, matches);
        };

        step();
    }

    private cancelPending(): void {
        this.token++;
        if (this.debounceHandle !== null) {
            window.clearTimeout(this.debounceHandle);
            this.debounceHandle = null;
        }
        if (this.chunkHandle !== null) {
            window.clearTimeout(this.chunkHandle);
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
            this.chunkHandle = window.setTimeout(step, 0);
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
    while (cursor.offset <= seg.data.length - needleLen) {
        if (performance.now() >= deadline) { break; }
        if (matchesAnyNeedle(seg.data, cursor.offset, needles)) {
            matches.push(seg.startAddress + cursor.offset);
        }
        cursor.offset++;
        scanned++;
    }
    return scanned;
}

function matchesAnyNeedle(segmentData: number[], offset: number, needles: number[][]): boolean {
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
        if (performance.now() >= deadline) { break; }
        const addr = (seg.startAddress + cursor.offset) >>> 0;
        if ((addr >>> bounds.prefixShift) === bounds.prefixValue) {
            matches.push(addr);
        }
        cursor.offset++;
        scanned++;
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

function matchSequenceInSegment(segmentData: number[], offset: number, needle: number[]): boolean {
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

function buildNeedles(mode: SearchMode, raw: string, endianness: SearchEndianness): number[][] {
    if (mode === 'bytes') {
        const bytes = parseBytePattern(raw);
        return bytes.length ? [bytes] : [];
    }

    if (mode === 'value') {
        const beBytes = parseValuePattern(raw);
        if (beBytes.length === 0) { return []; }
        return buildEndianNeedles(beBytes, endianness);
    }

    if (mode === 'ascii') {
        return [Array.from(new TextEncoder().encode(raw))];
    }

    return [];
}

function parseBytePattern(raw: string): number[] {
    return parseHexBytes(raw.replace(/\s/g, ''));
}

function parseHexBytes(hex: string): number[] {
    const tokens = hex.match(/.{1,2}/g) ?? [];
    const bytes: number[] = [];
    for (const tok of tokens) {
        const v = parseInt(tok, 16);
        if (isNaN(v) || v < 0 || v > 255) { return []; }
        bytes.push(v);
    }
    return bytes;
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

    if (arraysEqual(beBytes, leBytes)) {
        return [beBytes];
    }
    return [beBytes, leBytes];
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

// -------------------- UI glue (previously in search.ts) --------------------

let _switchToMemory: (() => void) | null = null;
const engine = new SearchEngine();
let _lastCompletedSearchKey = '';
let _streamFirstJumpDone = false;
let _searchRunning = false;
let _activeSearchKey = '';
let _activeMatchSpan = 1;

type SearchTrigger = 'enter-next' | 'enter-prev' | 'button';

export function initSearch(switchToMemory: () => void): void {
    _switchToMemory = switchToMemory;
}

export function runSearch(trigger: SearchTrigger = 'button'): void {
    if (S.currentView !== 'memory') { return; }

    const raw = (document.getElementById('search-input') as HTMLInputElement | null)?.value ?? '';
    const q = raw.trim();
    const searchKey = makeSearchKey(S.searchMode, q, S.searchEndianness);

    if (handleRunningSearch(q, searchKey, trigger)) { return; }
    if (handleCompletedSearchNavigation(q, searchKey, trigger)) { return; }

    S.matchAddrs = [];
    S.matchIdx = -1;

    if (q.length === 0) {
        clearEmptySearchQuery();
        return;
    }

    startSearch({
        searchKey,
        mode: S.searchMode,
        raw: q,
        endianness: S.searchEndianness,
    });
}

function handleRunningSearch(q: string, searchKey: string, trigger: SearchTrigger): boolean {
    if (!_searchRunning) { return false; }

    if (q.length === 0) {
        clearSearch();
        return true;
    }

    if (searchKey === _activeSearchKey) {
        navigateBySearchTrigger(trigger);
        return true;
    }

    // New query/mode while running: cancel current search and start latest immediately.
    engine.clear();
    _searchRunning = false;
    return false;
}

function handleCompletedSearchNavigation(q: string, searchKey: string, trigger: SearchTrigger): boolean {
    if (q.length === 0 || searchKey !== _lastCompletedSearchKey || trigger === 'button') {
        return false;
    }

    navigateBySearchTrigger(trigger);
    return true;
}

function navigateBySearchTrigger(trigger: SearchTrigger): void {
    if (trigger === 'enter-prev') {
        prevMatch();
    } else if (trigger === 'enter-next') {
        nextMatch();
    }
}

function clearEmptySearchQuery(): void {
    _lastCompletedSearchKey = '';
    engine.clear();
    setSearchBusy(false);
    applyMatchHighlights();
    updMC();
}

function startSearch(req: { searchKey: string; mode: SearchMode; raw: string; endianness: SearchEndianness }): void {
    setSearchBusy(true);
    _streamFirstJumpDone = false;
    _searchRunning = true;
    _activeSearchKey = req.searchKey;
    _activeMatchSpan = getMatchSpan(req.mode, req.raw, req.endianness);
    applyMatchHighlights();

    if (!S.parseResult) {
        _searchRunning = false;
        _activeSearchKey = '';
        setSearchBusy(false);
        return;
    }

    engine.search(
        {
            mode: req.mode,
            raw: req.raw,
            segments: S.parseResult.segments,
            endianness: req.endianness,
        },
        {
            onProgressUpdate: (matches: number[]) => {
                S.matchAddrs = matches;
                if (S.matchIdx < 0 && matches.length > 0) {
                    S.matchIdx = 0;
                }
                if (!_streamFirstJumpDone && matches.length > 0) {
                    _streamFirstJumpDone = true;
                    selectCurrentMatch();
                    scrollToMatch();
                }
                applyMatchHighlights();
                updMC();
            },
            onComplete: (matches: number[]) => {
                _lastCompletedSearchKey = req.searchKey;
                const activeAddr =
                    S.matchIdx >= 0 && S.matchIdx < S.matchAddrs.length
                        ? S.matchAddrs[S.matchIdx]
                        : null;
                S.matchAddrs = matches;
                if (matches.length === 0) {
                    S.matchIdx = -1;
                } else if (activeAddr !== null) {
                    const idx = matches.indexOf(activeAddr);
                    S.matchIdx = idx >= 0 ? idx : Math.min(Math.max(S.matchIdx, 0), matches.length - 1);
                } else {
                    S.matchIdx = 0;
                }

                _searchRunning = false;
                _activeSearchKey = '';
                setSearchBusy(false);
                selectCurrentMatch();
                applyMatchHighlights();
                scrollToMatch();
                updMC();
            },
        }
    );
}

export function clearSearch(): void {
    engine.clear();
    setSearchBusy(false);
    _searchRunning = false;
    _activeSearchKey = '';
    _activeMatchSpan = 1;
    S.matchAddrs = [];
    S.matchIdx   = -1;
    const inp = document.getElementById('search-input') as HTMLInputElement | null;
    if (inp) { inp.value = ''; }
    applyMatchHighlights();
    updMC();
}

export function nextMatch(): void {
    if (S.matchAddrs.length === 0) { return; }
    S.matchIdx = (S.matchIdx + 1) % S.matchAddrs.length;
    goToMatch();
}

export function prevMatch(): void {
    if (S.matchAddrs.length === 0) { return; }
    S.matchIdx = (S.matchIdx - 1 + S.matchAddrs.length) % S.matchAddrs.length;
    goToMatch();
}

function updMC(): void {
    const el = document.getElementById('match-count');
    if (!el) { return; }
    const raw = (document.getElementById('search-input') as HTMLInputElement | null)?.value ?? '';
    if (raw.trim().length > 0 && S.matchAddrs.length === 0) {
        el.textContent = '0 / 0';
        return;
    }
    if (S.matchAddrs.length === 0) {
        el.textContent = '';
    } else {
        el.textContent = `${S.matchIdx + 1} / ${S.matchAddrs.length}`;
    }
}

function setSearchBusy(isBusy: boolean): void {
    const el = document.getElementById('search-progress');
    if (!el) { return; }
    el.classList.toggle('active', isBusy);
    el.setAttribute('aria-hidden', String(!isBusy));
}

function goToMatch(): void {
    if (S.currentView !== 'memory') {
        if (_switchToMemory) { _switchToMemory(); }
    } else {
        applyMatchHighlights();
    }
    selectCurrentMatch();
    scrollToMatch();
    updMC();
}

function scrollToMatch(): void {
    if (S.matchIdx >= 0 && S.matchAddrs.length > 0) {
        scrollTo(S.matchAddrs[S.matchIdx]);
    }
}

function selectCurrentMatch(): void {
    if (S.matchIdx < 0 || S.matchIdx >= S.matchAddrs.length) { return; }

    const start = S.matchAddrs[S.matchIdx];
    const span = _activeMatchSpan;
    const end = start + span - 1;

    if (S.selStart === start && S.selEnd === end) { return; }

    S.selStart = start;
    S.selEnd = end;
    applySel();
    import('./sidebar.js').then(m => m.updateInspector());
}

function getMatchSpan(mode: SearchMode, raw: string, endianness: SearchEndianness): number {
    if (mode === 'addr') { return 1; }
    const needles = buildNeedles(mode, raw, endianness);
    const span = needles[0]?.length ?? 1;
    return Math.max(1, span);
}

function makeSearchKey(mode: SearchMode, raw: string, endianness: SearchEndianness): string {
    const canonical = canonicalizeQuery(mode, raw);
    const endianKey = mode === 'value' ? endianness : 'n/a';
    return `${mode}|${endianKey}|${canonical}`;
}

function canonicalizeQuery(mode: SearchMode, raw: string): string {
    if (mode === 'bytes') {
        const bytes = parseBytePattern(raw);
        const canonical = canonicalizeBytes(bytes);
        if (canonical) { return canonical; }
        return raw.replace(/\s/g, '').toUpperCase();
    }

    if (mode === 'value') {
        const bytes = parseValuePattern(raw);
        const canonical = canonicalizeBytes(bytes);
        if (canonical) { return canonical; }
        return raw.replace(/_/g, '').toUpperCase();
    }

    if (mode === 'addr') {
        return normalizeAddrQuery(raw) ?? raw.replace(/^0x/i, '').toUpperCase();
    }

    return raw;
}

function canonicalizeBytes(bytes: number[]): string | null {
    if (bytes.length === 0) { return null; }
    return bytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join('');
}
