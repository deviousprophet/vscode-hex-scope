// Combined SearchEngine + UI glue
import { S } from './state';
import { applyMatchHighlights, applySel, scrollTo } from './memoryView';
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

const SEARCH_DEBOUNCE_MS = 120;
const SEARCH_CHUNK_BUDGET_MS = 24;
const SEARCH_PROGRESS_THROTTLE_MS = 150;

export class SearchEngine {
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

        let segIdx = 0;
        let addrInSeg = 0;
        const totalSegmentBytes = segments.reduce((sum, seg) => sum + seg.data.length, 0);
        let scannedBytes = 0;
        let lastProgressUpdateTime = performance.now();

        const step = (): void => {
            if (token !== this.token) { return; }

            const deadline = performance.now() + SEARCH_CHUNK_BUDGET_MS;
            while (segIdx < segments.length && performance.now() < deadline) {
                const seg = segments[segIdx];
                const segData = seg.data;
                const segStart = seg.startAddress;

                while (addrInSeg <= segData.length - needleLen) {
                    if (performance.now() >= deadline) {
                        break;
                    }
                    
                    for (const needle of needles) {
                        if (matchSequenceInSegment(segData, addrInSeg, needle)) {
                            matches.push(segStart + addrInSeg);
                            break;
                        }
                    }
                    addrInSeg++;
                    scannedBytes++;
                }

                if (addrInSeg > segData.length - needleLen) {
                    segIdx++;
                    addrInSeg = 0;
                }
            }

            const now = performance.now();
            if (now - lastProgressUpdateTime >= SEARCH_PROGRESS_THROTTLE_MS || segIdx >= segments.length) {
                if (totalSegmentBytes > 0) {
                    const percent = Math.min(100, Math.floor((scannedBytes / totalSegmentBytes) * 100));
                    handlers.onProgressUpdate?.(matches, percent);
                    lastProgressUpdateTime = now;
                }
            }

            if (segIdx < segments.length) {
                this.chunkHandle = window.setTimeout(step, 0);
                return;
            }

            this.chunkHandle = null;
            if (token !== this.token) { return; }

            handlers.onComplete(matches);
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
        const totalAddresses = segments.reduce((sum, seg) => sum + seg.data.length, 0);
        let segmentIndex = 0;
        let addrInSegment = 0;
        let scannedAddresses = 0;
        let lastProgressUpdateTime = performance.now();

        const queryMin = parseInt(query.padEnd(8, '0'), 16);
        const queryMax = parseInt(query.padEnd(8, 'F'), 16);
        const prefixShift = (8 - query.length) * 4;
        const prefixValue = parseInt(query, 16) >>> 0;

        const step = (): void => {
            if (token !== this.token) { return; }

            const deadline = performance.now() + SEARCH_CHUNK_BUDGET_MS;
            while (segmentIndex < segments.length && performance.now() < deadline) {
                const seg = segments[segmentIndex];
                const segStart = seg.startAddress;
                const segEnd = seg.startAddress + seg.data.length - 1;

                if (segEnd >= queryMin && segStart <= queryMax) {
                    while (addrInSegment < seg.data.length) {
                        if (performance.now() >= deadline) {
                            break;
                        }
                        const addr = (segStart + addrInSegment) >>> 0;
                        if ((addr >>> prefixShift) === prefixValue) {
                            matches.push(addr);
                        }
                        addrInSegment++;
                        scannedAddresses++;
                    }
                } else {
                    addrInSegment = seg.data.length;
                    scannedAddresses += seg.data.length;
                }

                if (addrInSegment >= seg.data.length) {
                    segmentIndex++;
                    addrInSegment = 0;
                }
            }

            const now = performance.now();
            if (now - lastProgressUpdateTime >= SEARCH_PROGRESS_THROTTLE_MS || segmentIndex >= segments.length) {
                if (totalAddresses > 0) {
                    const percent = Math.min(100, Math.floor((scannedAddresses / totalAddresses) * 100));
                    handlers.onProgressUpdate?.(matches, percent);
                    lastProgressUpdateTime = now;
                }
            }

            if (segmentIndex < segments.length) {
                this.chunkHandle = window.setTimeout(step, 0);
                return;
            }

            this.chunkHandle = null;
            if (token !== this.token) { return; }

            handlers.onComplete(matches);
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
    const tokens = raw.replace(/\s/g, '').match(/.{1,2}/g) ?? [];
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

    if (/^0x[0-9a-fA-F]+$/.test(s)) {
        let hex = s.slice(2);
        if (hex.length % 2 === 1) {
            hex = `0${hex}`;
        }
        const out: number[] = [];
        for (let i = 0; i < hex.length; i += 2) {
            const v = parseInt(hex.slice(i, i + 2), 16);
            if (isNaN(v)) { return []; }
            out.push(v);
        }
        return out;
    }

    if (!/^\d+$/.test(s)) { return []; }

    let value: bigint;
    try {
        value = BigInt(s);
    } catch {
        return [];
    }

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
    const isUnchangedCompleted = searchKey === _lastCompletedSearchKey;

    if (_searchRunning) {
        if (q.length === 0) {
            clearSearch();
            return;
        }

        if (searchKey === _activeSearchKey) {
            if (trigger === 'enter-prev') {
                prevMatch();
            } else if (trigger === 'enter-next') {
                nextMatch();
            }
            return;
        }

        // New query/mode while running: cancel current search and start latest immediately.
        engine.clear();
        _searchRunning = false;
    }

    if (q.length > 0 && isUnchangedCompleted && trigger !== 'button') {
        if (trigger === 'enter-prev') {
            prevMatch();
        } else {
            nextMatch();
        }
        return;
    }

    S.matchAddrs = [];
    S.matchIdx = -1;

    if (q.length === 0) {
        _lastCompletedSearchKey = '';
        engine.clear();
        setSearchBusy(false);
        applyMatchHighlights();
        updMC();
        return;
    }

    startSearch({
        searchKey,
        mode: S.searchMode,
        raw: q,
        endianness: S.searchEndianness,
    });
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

export function updMC(): void {
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
        if (bytes.length > 0) {
            return bytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join('');
        }
        return raw.replace(/\s/g, '').toUpperCase();
    }

    if (mode === 'value') {
        const bytes = parseValuePattern(raw);
        if (bytes.length > 0) {
            return bytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join('');
        }
        return raw.replace(/_/g, '').toUpperCase();
    }

    if (mode === 'addr') {
        return normalizeAddrQuery(raw) ?? raw.replace(/^0x/i, '').toUpperCase();
    }

    return raw;
}

