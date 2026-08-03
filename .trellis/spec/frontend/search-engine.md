# Search Engine Code-Spec

## Scenario: Find bytes, values, ASCII, or addresses across a document

### 1. Scope / Trigger

Applies to `core/search.ts` (deep module) and the webview glue `src/webview/search/searchEngine.ts`. The search bar UI unit is owned by [SearchBar Component Code-Spec](./component-search-bar.md); selection/inspector/copy contracts by [Selection, Inspector, and Byte Tools Code-Spec](./selection-inspect-copy.md).

### 2. Signatures

```typescript
type SearchMode = 'bytes' | 'value' | 'ascii' | 'addr';
type SearchEndianness = 'auto' | 'be' | 'le';
type SearchTrigger = 'button' | 'enter-next' | 'enter-prev';

class SearchEngine {
    search(req: SearchRequest, handlers: SearchHandlers): void;
    clear(): void;
}

function buildNeedles(mode, raw, endianness): number[][];
function canonicalizeQuery(mode: SearchMode, raw: string): string;
// webview glue: src/webview/search/searchEngine.ts
function runSearch(query: string, mode: SearchMode, endianness: SearchEndianness, trigger?: SearchTrigger): void;
function initSearch(switchToMemory: () => void, ui?: { setCount(count: number, current: number): void; setBusy(busy: boolean): void }): void;
function clearSearch(): void;
function nextMatch(): void;
function prevMatch(): void;
function shouldNavigateCompletedSearch(q: string, searchKey: string, trigger: SearchTrigger, lastCompletedSearchKey: string): boolean;
```

### 3. Contracts

- Empty/whitespace query completes with no matches.
- Search supports byte sequences, numeric values, ASCII, and direct address.
- Value mode honors Auto/LE/BE and may build multiple candidate needles where Auto requires it.
- Search is debounced, chunked across segments, streams progress, and uses a monotonically changing token so stale work cannot publish results.
- Chunk deadlines are checked after a bounded comparison batch, not after every candidate byte. Batch work targets about 4,096 byte comparisons so clock overhead stays amortized while cancellation remains responsive for long needles.
- A changed query/mode cancels current work immediately; same completed query navigates existing matches.
- Search never bridges unmapped segment gaps.
- Search UI state (mode/endianness/query) is owned by the `SearchBar` component; the engine glue takes explicit params (`runSearch(query, mode, endianness, trigger)`) and never reads `S.searchMode`/`S.searchEndianness`/the input DOM for its decision. `S.searchMode`/`S.searchEndianness` are kept in sync by the host for renderers that read them (e.g. memory needle-length). Match state (`S.matchAddrs`/`S.matchIdx`) is written by the glue and read by renderers.
- Match-count/busy feedback goes through host-registered callbacks (`initSearch(..., ui)` → `setCount`/`setBusy`); the engine glue does not write `#match-count`/`#search-progress` directly.
- Search-engine match selection reuses the selection contract (`S.selStart`/`S.selEnd`, gap-filtered reads) from the Selection spec.

### 4. Validation & Error Matrix

| Condition | Behavior |
|---|---|
| Empty search | Clear matches; complete immediately. |
| Invalid bytes/value/address | No unsafe parse; show no match/input feedback through UI owner. |
| New query during chunked search | Cancel old token; old callbacks publish nothing. |
| Large typed segment | Scan in bounded comparison batches; do not call `performance.now()` once per byte. |
| Address `0` | Valid address, never treated as absent. |
| Match crosses segment gap | Reject. |
| Search while not in memory view | Engine no-ops (host view gate). |

### 5. Good/Base/Bad Cases

- Base: byte query `DE AD BE EF` finds exact sequence in one segment and selects four bytes.
- Good: changing query while scanning cancels old results; first streamed current match may jump once, final match list remains current.
- Good: a 4 MiB no-match typed segment completes within the large-segment regression budget while preserving the 24 ms scheduling budget.
- Bad: concatenate all segments then search, producing matches across gaps.

### 6. Tests Required

- Search: every mode, endian candidate construction, canonicalization, empty/invalid input, gap isolation, progress, cancellation/latest-token, match navigation.
- Large search regression: exercise the real debounced `SearchEngine` on `Uint8Array`; assert identical matches and a budget that detects per-byte clock reads.
- Search bar UI behaviour lives in `src/test/webview/ui-components/search-bar.test.ts` (see SearchBar Component spec).

### 7. Wrong vs Correct

#### Wrong

```typescript
while (offset < end) {
    if (performance.now() >= deadline) break; // clock read dominates each byte
    testCandidate(offset++);
}
```

#### Correct

```typescript
while (offset < end) {
    const batchEnd = Math.min(offset + comparisonBudget, end);
    while (offset < batchEnd) testCandidate(offset++);
    if (performance.now() >= deadline) break;
}
```

Search engine is a deep module; UI owns query/navigation state, not scan mechanics.
