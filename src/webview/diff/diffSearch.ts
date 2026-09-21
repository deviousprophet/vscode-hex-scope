import { buildNeedles, SearchEngine } from '../../core/search';
import type { SearchEndianness, SearchMode, SerializedSegment } from '../../core/types';
import { SearchBar } from '../components/searchBar/searchBar';
import type { SearchTrigger } from '../components/searchBar/searchBarRender';
import { currentSides, scrollToDiff, setSearchMatches } from './diffGrid';

let bar: SearchBar | null = null;
let engine = new SearchEngine();
let matches: number[] = [];
let index = -1;
let span = 1;
let pendingTrigger: SearchTrigger = 'button';

/** Drop matches and the bar for a replaced document. */
export function resetDiffSearch(): void {
    engine.clear();
    matches = [];
    index = -1;
    bar = null;
    pendingTrigger = 'button';
}

/** Inject the always-visible search bar into the toolbar slot (re-run after a toolbar re-render). */
export function mountDiffSearch(): void {
    const container = document.getElementById('diff-search');
    if (!container) { return; }
    const searchBar = ensureBar();
    container.innerHTML = searchBar.toHtml();
    searchBar.mount();
}

function ensureBar(): SearchBar {
    if (bar) { return bar; }
    bar = new SearchBar({
        onSearch: (query, mode, endianness, trigger) => {
            pendingTrigger = trigger;
            runDiffSearch(query, mode, endianness);
        },
        onPrev: () => stepMatch(-1),
        onNext: () => stepMatch(1),
        onClear: clearMatches,
        onQueryChanged: () => {
            engine.clear();
            clearMatches();
        },
    });
    return bar;
}

function runDiffSearch(query: string, mode: SearchMode, endianness: SearchEndianness): void {
    const sides = currentSides();
    if (!sides || query.trim() === '') { clearMatches(); return; }
    const segments: SerializedSegment[] = [...sides.a.parseResult.segments, ...sides.b.parseResult.segments];
    bar?.setBusy(true);
    engine.search({ mode, raw: query, segments, endianness }, {
        onComplete: found => {
            matches = dedupeSorted(found);
            span = needleSpan(mode, query, endianness);
            index = nextIndexAfterSearch();
            bar?.setBusy(false);
            applyMatches();
        },
    });
}

function nextIndexAfterSearch(): number {
    if (matches.length === 0) { return -1; }
    return pendingTrigger === 'enter-prev' ? matches.length - 1 : 0;
}

function needleSpan(mode: SearchMode, raw: string, endianness: SearchEndianness): number {
    const needles = buildNeedles(mode, raw, endianness);
    return needles.length > 0 ? needles[0].length : 1;
}

function stepMatch(delta: number): void {
    if (matches.length === 0) { return; }
    index = Math.min(Math.max(index + delta, 0), matches.length - 1);
    applyMatches();
}

function applyMatches(): void {
    const active = index;
    setSearchMatches(matches, active, span);
    bar?.setCount(matches.length, active);
    if (active >= 0) {
        scrollToDiff({ start: matches[active], end: matches[active] + span - 1 }, { selection: false });
    }
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
