// Search UI glue
import { S } from '../state';
import { applyMatchHighlights, applySel, scrollTo } from '../memory/memoryView';
import { SearchEngine, buildNeedles, canonicalizeQuery } from '../../core/search';
import type { SearchEndianness, SearchMode } from '../../core/types';

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

    const q = currentSearchQuery();
    const searchKey = makeSearchKey(S.searchMode, q, S.searchEndianness);

    if (handleSearchNavigation(q, searchKey, trigger)) { return; }
    startFreshSearch(q, searchKey);
}

function currentSearchQuery(): string {
    return ((document.getElementById('search-input') as HTMLInputElement | null)?.value ?? '').trim();
}

function handleSearchNavigation(q: string, searchKey: string, trigger: SearchTrigger): boolean {
    return handleRunningSearch(q, searchKey, trigger) ||
        handleCompletedSearchNavigation(q, searchKey, trigger);
}

function startFreshSearch(q: string, searchKey: string): void {
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
                onSearchProgress(matches);
            },
            onComplete: (matches: number[]) => {
                onSearchComplete(req.searchKey, matches);
            },
        }
    );
}

function onSearchProgress(matches: number[]): void {
    S.matchAddrs = matches;
    if (matches.length > 0) {
        initStreamingMatchIndex();
    }
    applyMatchHighlights();
    updMC();
}

function initStreamingMatchIndex(): void {
    if (S.matchIdx < 0) { S.matchIdx = 0; }
    if (_streamFirstJumpDone) { return; }
    _streamFirstJumpDone = true;
    selectCurrentMatch();
    scrollToMatch();
}

function onSearchComplete(searchKey: string, matches: number[]): void {
    _lastCompletedSearchKey = searchKey;
    const activeAddr = activeMatchAddress();
    S.matchAddrs = matches;
    S.matchIdx = completedMatchIndex(matches, activeAddr);
    _searchRunning = false;
    _activeSearchKey = '';
    setSearchBusy(false);
    selectCurrentMatch();
    applyMatchHighlights();
    scrollToMatch();
    updMC();
}

function activeMatchAddress(): number | null {
    return S.matchIdx >= 0 && S.matchIdx < S.matchAddrs.length
        ? S.matchAddrs[S.matchIdx]
        : null;
}

function completedMatchIndex(matches: number[], activeAddr: number | null): number {
    if (matches.length === 0) { return -1; }
    if (activeAddr === null) { return 0; }
    const idx = matches.indexOf(activeAddr);
    return idx >= 0 ? idx : Math.min(Math.max(S.matchIdx, 0), matches.length - 1);
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
    el.textContent = matchCountText(currentSearchQuery(), S.matchAddrs.length, S.matchIdx);
}

function matchCountText(query: string, count: number, index: number): string {
    if (query.length > 0 && count === 0) { return '0 / 0'; }
    if (count === 0) { return ''; }
    return `${index + 1} / ${count}`;
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
    if (!hasCurrentMatch()) { return; }

    const start = S.matchAddrs[S.matchIdx];
    const span = _activeMatchSpan;
    const end = start + span - 1;

    if (isCurrentSelection(start, end)) { return; }

    S.selStart = start;
    S.selEnd = end;
    applySel();
    import('../panels/sidebar/index.js').then(m => m.updateInspector());
}

function hasCurrentMatch(): boolean {
    return S.matchIdx >= 0 && S.matchIdx < S.matchAddrs.length;
}

function isCurrentSelection(start: number, end: number): boolean {
    return S.selStart === start && S.selEnd === end;
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
