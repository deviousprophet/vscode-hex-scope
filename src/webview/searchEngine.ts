// Combined SearchEngine + UI glue
import { S } from './state';
import { getByte } from './data';
import { applyMatchHighlights, scrollTo } from './memoryView';
import type { SearchEndianness, SearchMode, SerializedSegment } from './types';

export interface SearchRequest {
    mode: SearchMode;
    raw: string;
    segments: SerializedSegment[];
    endianness?: SearchEndianness;
}

export interface SearchHandlers {
    onStatus?: (text: string) => void;
    onProgressUpdate?: (matches: number[], percentComplete: number) => void;
    onComplete: (matches: number[]) => void;
}

const SEARCH_DEBOUNCE_MS = 120;
const SEARCH_CHUNK_BUDGET_MS = 100;
const SEARCH_PROGRESS_THROTTLE_MS = 500;  // Update UI at most every 500ms to avoid DOM thrashing

export class SearchEngine {
    private token = 0;
    private debounceHandle: number | null = null;
    private chunkHandle: number | null = null;

    private lastMode: SearchMode | null = null;
    private lastByteNeedleLength = 0;
    private lastByteNeedles: number[][] = [];
    private lastByteMatches: number[] = [];
    private lastAddrQuery = '';
    private lastAddrMatches: number[] = [];

    public search(req: SearchRequest, handlers: SearchHandlers): void {
        this.cancelPending();

        const raw = req.raw ?? '';
        if (raw.trim() === '') {
            this.resetCache();
            handlers.onComplete([]);
            return;
        }

        const token = ++this.token;
        const searchLabel = `[SEARCH] ${req.mode} search "${raw}"`;
        console.time(searchLabel);
        handlers.onStatus?.('Searching...');

        // Wrap handlers to log completion and emit progress
        const wrappedHandlers: SearchHandlers = {
            onStatus: handlers.onStatus,
            onProgressUpdate: (matches: number[], percent: number) => {
                if (percent === 100) {
                    console.timeEnd(searchLabel);
                }
                handlers.onProgressUpdate?.(matches, percent);
            },
            onComplete: (matches: number[]) => {
                console.log(`[SEARCH] Found ${matches.length} matches`);
                handlers.onComplete(matches);
            },
        };

        this.debounceHandle = window.setTimeout(() => {
            this.debounceHandle = null;
            if (req.mode === 'addr') {
                this.runAddressSearch(token, req, wrappedHandlers);
                return;
            }
            this.runByteSearch(token, req, wrappedHandlers);
        }, SEARCH_DEBOUNCE_MS);
    }

    public clear(): void {
        this.cancelPending();
        this.resetCache();
    }

    /**
     * Scan segments for byte patterns. Iterates through contiguous segment data,
     * checking for needle matches without materializing an address array.
     * Emits progressive results via onProgressUpdate as search continues.
     */
    private runByteSearch(token: number, req: SearchRequest, handlers: SearchHandlers): void {
        const needles = buildNeedles(req.mode, req.raw, req.endianness ?? 'le');
        if (needles.length === 0) {
            this.lastMode = req.mode;
            this.lastByteNeedleLength = 0;
            this.lastByteNeedles = [];
            this.lastByteMatches = [];
            handlers.onComplete([]);
            return;
        }

        const needleLen = needles[0].length;
        const matches: number[] = [];

        let segIdx = 0;
        let addrInSeg = 0;
        const totalSegmentBytes = req.segments.reduce((sum, seg) => sum + seg.data.length, 0);
        let scannedBytes = 0;
        let lastProgressUpdateTime = performance.now();

        const step = (): void => {
            if (token !== this.token) { return; }

            const deadline = performance.now() + SEARCH_CHUNK_BUDGET_MS;
            while (segIdx < req.segments.length && performance.now() < deadline) {
                const seg = req.segments[segIdx];
                const segData = seg.data;
                const segStart = seg.startAddress;

                // Scan this segment for patterns, checking deadline frequently for responsiveness
                while (addrInSeg <= segData.length - needleLen) {
                    // Check deadline during inner loop to prevent freezing on large matches
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

                // Move to next segment if we finished this one
                if (addrInSeg > segData.length - needleLen) {
                    segIdx++;
                    addrInSeg = 0;
                }
            }

            // Report progress only if enough time has passed (throttle UI updates)
            const now = performance.now();
            if (now - lastProgressUpdateTime >= SEARCH_PROGRESS_THROTTLE_MS || segIdx >= req.segments.length) {
                if (totalSegmentBytes > 0) {
                    const percent = Math.min(100, Math.floor((scannedBytes / totalSegmentBytes) * 100));
                    handlers.onProgressUpdate?.(matches, percent);
                    lastProgressUpdateTime = now;
                }
            }

            if (segIdx < req.segments.length) {
                this.chunkHandle = window.setTimeout(step, 0);
                return;
            }

            this.chunkHandle = null;
            if (token !== this.token) { return; }

            this.lastMode = req.mode;
            this.lastByteNeedleLength = needleLen;
            this.lastByteNeedles = needles;
            this.lastByteMatches = matches;
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
            this.lastMode = 'addr';
            this.lastAddrQuery = '';
            this.lastAddrMatches = [];
            handlers.onComplete([]);
            return;
        }

        const matches: number[] = [];
        const totalSegments = req.segments.length;
        let segmentIndex = 0;
        let lastProgressUpdateTime = performance.now();

        // Pre-calculate address range that matches query prefix
        // E.g., query "8" matches 0x80000000-0x8FFFFFFF
        // E.g., query "80" matches 0x80000000-0x80FFFFFF
        const queryMin = parseInt(query.padEnd(8, '0'), 16);
        const queryMax = parseInt(query.padEnd(8, 'F'), 16);

        const step = (): void => {
            if (token !== this.token) { return; }

            const deadline = performance.now() + SEARCH_CHUNK_BUDGET_MS;
            while (segmentIndex < req.segments.length && performance.now() < deadline) {
                const seg = req.segments[segmentIndex];
                const segStart = seg.startAddress;
                const segEnd = seg.startAddress + seg.data.length - 1;

                // SEGMENT-SMART SKIPPING: Only scan if segment range overlaps query range
                if (segEnd >= queryMin && segStart <= queryMax) {
                    // Scan addresses in this segment that match query prefix
                    for (let addr = segStart; addr <= segEnd; addr++) {
                        if (addr.toString(16).toUpperCase().startsWith(query)) {
                            matches.push(addr);
                        }
                    }
                }
                // If segment is entirely before queryMin or after queryMax, skip it entirely

                segmentIndex++;
            }

            // Report progress only if enough time has passed (throttle UI updates)
            const now = performance.now();
            if (now - lastProgressUpdateTime >= SEARCH_PROGRESS_THROTTLE_MS || segmentIndex >= req.segments.length) {
                if (totalSegments > 0) {
                    const percent = Math.min(100, Math.floor((segmentIndex / totalSegments) * 100));
                    handlers.onProgressUpdate?.(matches, percent);
                    lastProgressUpdateTime = now;
                }
            }

            if (segmentIndex < req.segments.length) {
                this.chunkHandle = window.setTimeout(step, 0);
                return;
            }

            this.chunkHandle = null;
            if (token !== this.token) { return; }

            this.lastMode = 'addr';
            this.lastAddrQuery = query;
            this.lastAddrMatches = matches;
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

    private resetCache(): void {
        this.lastMode = null;
        this.lastByteNeedleLength = 0;
        this.lastByteNeedles = [];
        this.lastByteMatches = [];
        this.lastAddrQuery = '';
        this.lastAddrMatches = [];
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
    if (mode === 'hex') {
        const tokens = raw.replace(/\s/g, '').match(/.{1,2}/g) ?? [];
        const bytes: number[] = [];
        for (const tok of tokens) {
            const v = parseInt(tok, 16);
            if (isNaN(v) || v < 0 || v > 255) { return []; }
            bytes.push(v);
        }
        if (bytes.length === 0) { return []; }
        // For flat hex searches, always return bytes as-is without endianness reversal
        // Endianness is a display concept, not a search concept
        return [bytes];
    }

    if (mode === 'ascii') {
        return [Array.from(new TextEncoder().encode(raw))];
    }

    return [];
}

// -------------------- UI glue (previously in search.ts) --------------------

let _switchToMemory: (() => void) | null = null;
const engine = new SearchEngine();

export function initSearch(switchToMemory: () => void): void {
    _switchToMemory = switchToMemory;
}

export function runSearch(): void {
    const raw = (document.getElementById('search-input') as HTMLInputElement | null)?.value ?? '';
    S.matchAddrs = [];
    S.matchIdx   = -1;

    if (raw.trim() === '') {
        engine.clear();
        applyMatchHighlights();
        updMC();
        return;
    }

    applyMatchHighlights();
    if (!S.parseResult) { return; }
    engine.search(
        {
            mode: S.searchMode,
            raw,
            segments: S.parseResult.segments,
        },
        {
            onStatus: updMC,
            onProgressUpdate: (matches: number[], percent: number) => {
                // Show progressive results as search continues (streaming results)
                S.matchAddrs = matches;
                if (S.matchIdx < 0 && matches.length > 0) {
                    S.matchIdx = 0;  // Auto-select first match when found
                }
                applyMatchHighlights();
                updMC();
                if (percent > 0 && percent < 100) {
                    console.log(`[SEARCH] Progress: ${percent}% (${matches.length} matches found)`);
                }
            },
            onComplete: (matches: number[]) => {
                S.matchAddrs = matches;
                S.matchIdx = matches.length > 0 ? 0 : -1;
                applyMatchHighlights();
                scrollToMatch();
                updMC();
            },
        }
    );
}

export function clearSearch(): void {
    engine.clear();
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

export function updMC(statusText?: string): void {
    updMCInternal(statusText);
}

function updMCInternal(statusText?: string): void {
    const el = document.getElementById('match-count');
    if (!el) { return; }
    if (statusText) {
        el.textContent = statusText;
        return;
    }
    if (S.matchAddrs.length === 0) {
        el.textContent = '';
    } else {
        el.textContent = `${S.matchIdx + 1} / ${S.matchAddrs.length}`;
    }
}

function goToMatch(): void {
    if (S.currentView !== 'memory') {
        if (_switchToMemory) { _switchToMemory(); }
    } else {
        applyMatchHighlights();
    }
    scrollToMatch();
    updMC();
}

function scrollToMatch(): void {
    if (S.matchIdx >= 0 && S.matchAddrs.length > 0) {
        scrollTo(S.matchAddrs[S.matchIdx]);
    }
}

