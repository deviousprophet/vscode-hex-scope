// Pure search-navigation decisions shared by the single-file and diff search hosts.
// DOM-free and state-free (no `S`, no memoryGrid) so the isolated diff bundle can import it.

import type { SearchEndianness, SearchMode } from '../../core/types';
import { searchKeyFor, type SearchTrigger } from '../components/searchBar/searchBarRender';

/** Pure decision: should Enter navigate an unchanged completed search instead of re-running it? */
export function shouldNavigateCompletedSearch(
    query: string,
    searchKey: string,
    trigger: SearchTrigger,
    lastCompletedSearchKey: string,
): boolean {
    return query.length > 0 && searchKey === lastCompletedSearchKey && trigger !== 'button';
}

/** Empty query, or a visible key differing from the active/completed search, counts as diverged. */
export function isSearchDiverged(
    query: string,
    mode: SearchMode,
    endianness: SearchEndianness,
    activeKey: string,
    completedKey: string,
): boolean {
    const q = query.trim();
    if (q.length === 0) { return true; }
    const key = searchKeyFor(mode, q, endianness);
    return key !== activeKey && key !== completedKey;
}
