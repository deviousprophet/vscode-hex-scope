// Search UI glue
import { S } from '../state';
import { applyMatchHighlights, applySel, scrollTo } from '../memory/memoryView';
import { SearchEngine, buildNeedles } from '../../core/search';
import type { SearchEndianness, SearchMode } from '../../core/types';
import { searchKeyFor, type SearchTrigger } from '../components/SearchBar/SearchBar';

// -------------------- UI glue (previously in search.ts) --------------------

let _switchToMemory: (() => void) | null = null;
let _setCount: ((count: number, current: number) => void) | null = null;
let _setBusy: ((busy: boolean) => void) | null = null;
const engine = new SearchEngine();
let _lastCompletedSearchKey = '';
let _streamFirstJumpDone = false;
let _searchRunning = false;
let _activeSearchKey = '';
let _activeMatchSpan = 1;

export function initSearch(
    switchToMemory: () => void,
    ui?: {
        setCount: (count: number, current: number) => void;
        setBusy: (busy: boolean) => void;
    },
): void {
    _switchToMemory = switchToMemory;
    _setCount = ui ? ui.setCount : null;
    _setBusy = ui ? ui.setBusy : null;
}

export function runSearch(query: string, mode: SearchMode, endianness: SearchEndianness, trigger: SearchTrigger = 'button'): void {
    if (S.currentView !== 'memory') { return; }

    const q = query.trim();
    const searchKey = searchKeyFor(mode, q, endianness);

    if (handleSearchNavigation(q, searchKey, trigger)) { return; }
    startFreshSearch(q, searchKey, mode, endianness);
}

function handleSearchNavigation(q: string, searchKey: string, trigger: SearchTrigger): boolean {
    return handleRunningSearch(q, searchKey, trigger) ||
        handleCompletedSearchNavigation(q, searchKey, trigger);
}

function startFreshSearch(q: string, searchKey: string, mode: SearchMode, endianness: SearchEndianness): void {
    S.matchAddrs = [];
    S.matchIdx = -1;

    if (q.length === 0) {
        clearEmptySearchQuery();
        return;
    }

    startSearch({
        searchKey,
        mode,
        raw: q,
        endianness,
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
    if (!shouldNavigateCompletedSearch(q, searchKey, trigger, _lastCompletedSearchKey)) {
        return false;
    }

    navigateBySearchTrigger(trigger);
    return true;
}

/** Pure decision: should Enter navigate an unchanged completed search instead of re-running it? */
export function shouldNavigateCompletedSearch(
    q: string,
    searchKey: string,
    trigger: SearchTrigger,
    lastCompletedSearchKey: string,
): boolean {
    return q.length > 0 && searchKey === lastCompletedSearchKey && trigger !== 'button';
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
    notifySearchBusy(false);
    applyMatchHighlights();
    notifySearchCount();
}

function startSearch(req: { searchKey: string; mode: SearchMode; raw: string; endianness: SearchEndianness }): void {
    notifySearchBusy(true);
    _streamFirstJumpDone = false;
    _searchRunning = true;
    _activeSearchKey = req.searchKey;
    _activeMatchSpan = getMatchSpan(req.mode, req.raw, req.endianness);
    applyMatchHighlights();

    if (!S.parseResult) {
        _searchRunning = false;
        _activeSearchKey = '';
        notifySearchBusy(false);
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
    notifySearchCount();
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
    notifySearchBusy(false);
    selectCurrentMatch();
    applyMatchHighlights();
    scrollToMatch();
    notifySearchCount();
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
    notifySearchBusy(false);
    _searchRunning = false;
    _activeSearchKey = '';
    _activeMatchSpan = 1;
    S.matchAddrs = [];
    S.matchIdx   = -1;
    applyMatchHighlights();
    notifySearchCount();
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

function notifySearchCount(): void {
    _setCount?.(S.matchAddrs.length, S.matchIdx);
}

function notifySearchBusy(isBusy: boolean): void {
    _setBusy?.(isBusy);
}

function goToMatch(): void {
    if (S.currentView !== 'memory') {
        if (_switchToMemory) { _switchToMemory(); }
    } else {
        applyMatchHighlights();
    }
    selectCurrentMatch();
    scrollToMatch();
    notifySearchCount();
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
    import('../sidebar/sidebar.js').then(m => m.updateInspector());
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
