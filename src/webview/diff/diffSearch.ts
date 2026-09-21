import { buildNeedles, SearchEngine } from '../../core/search';
import type { SearchEndianness, SearchMode, SerializedSegment } from '../../core/types';
import { SearchBar } from '../components/searchBar/searchBar';
import { searchKeyFor, type SearchTrigger } from '../components/searchBar/searchBarRender';
import { isSearchDiverged, shouldNavigateCompletedSearch } from '../search/searchNavigation';
import { currentSides, scrollToDiff, setSearchMatches } from './diffGrid';

let bar: SearchBar | null = null;
const engine = new SearchEngine();
let matches: number[] = [];
let index = -1;
let span = 1;
let pendingTrigger: SearchTrigger = 'button';
let completedKey = '';
let activeKey = '';
let running = false;
let streamFirstJumpDone = false;

/** Drop matches and the bar for a replaced document. */
export function resetDiffSearch(): void {
    engine.clear();
    matches = [];
    index = -1;
    span = 1;
    bar = null;
    pendingTrigger = 'button';
    completedKey = '';
    activeKey = '';
    running = false;
    streamFirstJumpDone = false;
}

/** Inject the always-visible search bar into the toolbar slot (re-run after a toolbar re-render). */
export function mountDiffSearch(): void {
    const container = document.getElementById('diff-search');
    if (!container) { return; }
    const searchBar = ensureBar();
    container.innerHTML = searchBar.toHtml();
    searchBar.mount();
    refreshDiffSearchCount();
}

/** Re-push the match count after the toolbar re-render dropped the injected markup. */
export function refreshDiffSearchCount(): void {
    bar?.setCount(matches.length, index);
}

function ensureBar(): SearchBar {
    if (bar) { return bar; }
    bar = new SearchBar({
        onSearch: (query, mode, endianness, trigger) => handleSearch(query, mode, endianness, trigger),
        onPrev: () => stepMatch(-1),
        onNext: () => stepMatch(1),
        onClear: dropSearchState,
        onQueryChanged: (query, mode, endianness) => {
            if (!isSearchDiverged(query, mode, endianness, activeKey, completedKey)) { return; }
            dropSearchState();
        },
    });
    return bar;
}

function handleSearch(query: string, mode: SearchMode, endianness: SearchEndianness, trigger: SearchTrigger): void {
    const q = query.trim();
    const key = searchKeyFor(mode, q, endianness);
    if (q.length === 0) { dropSearchState(); return; }
    if (navigateRunningSearch(key, trigger)) { return; }
    if (navigateCompletedSearch(q, key, trigger)) { return; }
    pendingTrigger = trigger;
    runDiffSearch(q, mode, endianness, key);
}

/** Enter/Shift+Enter steps the in-flight same-key search; a Run click on it is a no-op (hex parity). */
function navigateRunningSearch(key: string, trigger: SearchTrigger): boolean {
    if (!running || key !== activeKey) { return false; }
    navigateByTrigger(trigger);
    return true;
}

function navigateCompletedSearch(q: string, key: string, trigger: SearchTrigger): boolean {
    if (!shouldNavigateCompletedSearch(q, key, trigger, completedKey)) { return false; }
    navigateByTrigger(trigger);
    return true;
}

/** Mirrors the hex host: only Enter/Shift+Enter navigate, a Run click never does. */
function navigateByTrigger(trigger: SearchTrigger): void {
    if (trigger === 'enter-prev') { stepMatch(-1); }
    if (trigger === 'enter-next') { stepMatch(1); }
}

function runDiffSearch(query: string, mode: SearchMode, endianness: SearchEndianness, searchKey: string): void {
    const sides = currentSides();
    if (!sides) { dropSearchState(); return; }
    const segments: SerializedSegment[] = [...sides.a.parseResult.segments, ...sides.b.parseResult.segments];
    engine.clear();
    matches = [];
    index = -1;
    span = needleSpan(mode, query, endianness);
    activeKey = searchKey;
    running = true;
    streamFirstJumpDone = false;
    paintMatches();
    bar?.setBusy(true);
    engine.search({ mode, raw: query, segments, endianness }, {
        onProgressUpdate: found => onProgress(found),
        onComplete: found => onComplete(searchKey, found),
    });
}

/** Streamed results paint + count immediately; the first non-empty batch jumps to the match once. */
function onProgress(found: number[]): void {
    matches = dedupeSorted(found);
    adoptStreamedMatch();
    paintMatches();
    jumpToFirstStreamedMatch();
}

function adoptStreamedMatch(): void {
    if (matches.length === 0 || index >= 0) { return; }
    index = initialIndex();
}

function jumpToFirstStreamedMatch(): void {
    if (streamFirstJumpDone || matches.length === 0) { return; }
    streamFirstJumpDone = true;
    scrollToActive();
}

function onComplete(searchKey: string, found: number[]): void {
    const activeAddr = currentActiveAddress();
    completedKey = searchKey;
    activeKey = '';
    running = false;
    matches = dedupeSorted(found);
    index = resolveIndex(activeAddr);
    bar?.setBusy(false);
    paintMatches();
    scrollToActive();
}

function currentActiveAddress(): number | null {
    return index >= 0 && index < matches.length ? matches[index] : null;
}

function resolveIndex(activeAddr: number | null): number {
    if (matches.length === 0) { return -1; }
    if (activeAddr === null) { return initialIndex(); }
    const found = matches.indexOf(activeAddr);
    return found >= 0 ? found : 0;
}

function initialIndex(): number {
    return pendingTrigger === 'enter-prev' ? matches.length - 1 : 0;
}

function needleSpan(mode: SearchMode, raw: string, endianness: SearchEndianness): number {
    const needles = buildNeedles(mode, raw, endianness);
    return needles.length > 0 ? needles[0].length : 1;
}

function stepMatch(delta: number): void {
    if (matches.length === 0) { return; }
    index = (index + delta + matches.length) % matches.length;
    applyMatches();
}

function applyMatches(): void {
    paintMatches();
    scrollToActive();
}

/** Highlight + count only (no scroll) — used for every streamed batch. */
function paintMatches(): void {
    setSearchMatches(matches, index, span);
    bar?.setCount(matches.length, index);
}

function scrollToActive(): void {
    if (index < 0) { return; }
    scrollToDiff({ start: matches[index], end: matches[index] + span - 1 }, { selection: true });
}

/** Cancel the running search and drop matches for a cleared/diverged query. */
function dropSearchState(): void {
    engine.clear();
    running = false;
    activeKey = '';
    completedKey = '';
    clearMatches();
}

function clearMatches(): void {
    matches = [];
    index = -1;
    setSearchMatches([], -1, span);
    bar?.setCount(0, 0);
}

function dedupeSorted(found: readonly number[]): number[] {
    return [...new Set(found)].sort((a, b) => a - b);
}
