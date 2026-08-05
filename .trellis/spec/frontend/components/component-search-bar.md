# SearchBar Component Code-Spec

## Scope / Trigger

Owns `src/webview/components/SearchBar/SearchBar.ts` + `SearchBar.css`: the self-contained search bar UI unit extracted from `search/searchControls.ts` (wiring), `search/searchEngine.ts` (decision glue), and `hexViewer.ts` (markup). The search engine itself lives in `core/search.ts` (deep module) and the search glue stays in `webview/search/searchEngine.ts`.

Component boundary : each component owns its markup, UI state, input behaviours, and styles. Host owns search execution, match data, navigation, and match-count/busy feedback.

## Layout

```text
src/webview/components/SearchBar/
    SearchBar.ts         class SearchBar + SearchBarCallbacks + SearchBarSeedOptions
    searchBarRender.ts   pure helpers: MODE_LABELS, PLACEHOLDERS, searchKeyFor, SearchTrigger, activeClass, modeOptions
    SearchBar.css        extracted search styles
src/webview/search/searchEngine.ts   explicit-param runSearch; imports searchKeyFor/SearchTrigger from searchBarRender; no S/DOM reads in decision path
src/webview/hexViewer.ts             host wiring; undo keydown; no inline search markup
src/webview/styles/stats-bar.css    stats bar (chrome/search/banners extracted to components)
src/hexEditorSession.ts              links dist/webview.css (bundled)
src/test/webview/components/search-bar.test.ts
```

## Contracts

```typescript
type SearchMode = 'bytes' | 'value' | 'ascii' | 'addr';
type SearchEndianness = 'auto' | 'be' | 'le';
type SearchTrigger = 'button' | 'enter-next' | 'enter-prev';

interface SearchBarCallbacks {
    onSearch: (query: string, mode: SearchMode, endianness: SearchEndianness, trigger: SearchTrigger) => void;
    onPrev: () => void;
    onNext: () => void;
    onClear: () => void;
}
interface SearchBarSeedOptions { mode?: SearchMode; endianness?: SearchEndianness; query?: string }

class SearchBar {
    constructor(cb: SearchBarCallbacks, seed?: SearchBarSeedOptions);
    toHtml(): string;                              // markup; host injects into toolbar
    mount(): void;                                 // document-delegated listeners
setCount(count: number, current: number): void;
setBusy(busy: boolean): void;
setVisible(visible: boolean): void;              // toggles #search-box display; host calls on view switch
}
function searchKeyFor(mode: SearchMode, raw: string, endianness: SearchEndianness): string;

// engine glue
function runSearch(query: string, mode: SearchMode, endianness: SearchEndianness, trigger?: SearchTrigger): void;
```

## Rules

- Component owns UI state (`mode`, `endianness`, `query`) internally. It never reads or writes the `S` global.
- Host seeds from `S.searchMode`/`S.searchEndianness` on boot via constructor `seed`, and writes `S.searchMode`/`S.searchEndianness` in the `onSearch` handler (memoryView `NEEDLE_LEN_BY_MODE` and search glue still read them for rendering).
- `runSearch(query, mode, endianness, trigger)` takes explicit params; search-decision path never reads `#search-input` value or `S.searchMode`/`S.searchEndianness`. Match state (`S.matchAddrs`/`S.matchIdx`) writes stay in the engine glue.
- Engine match-count/busy feedback goes through host-registered callbacks, not `#match-count`/`#search-progress` DOM writes from the engine. (Transition note: `clearSearch`/`clearEmptySearchQuery` still touch DOM via the same setter hook.)
- Ctrl+F (focus/select input) belongs to the component. Ctrl+Z undo belongs to the host (`hexViewer.ts`), gated on `S.editMode`.
- Search bar markup lives only in `SearchBar.toHtml()`. `#search-box` id/class structure unchanged from the pre-refactor template.
- All styles specific to search UI live in `SearchBar.css` (moved verbatim from `toolbar.css`). `toolbar.css` is now `stats-bar.css` (only `#stats-bar`/`.si*` rules); toolbar chrome lives in `components/Toolbar/Toolbar.css`, search in `SearchBar.css`, banners in `ExternalChange.css`. Design tokens stay in `base.css`.
- Global DOM IDs (`#search-input`, `#match-count`, `#search-mode`, …), single instance. Multi-instance/scoped selectors are out of scope (diff view, future).
- Component HTML/behaviour escapes untrusted input with `esc()`; no inline `<style>`.

## Behaviour (user-visible parity with pre-refactor)

- Mode select (Bytes/Value/ASCII/Addr) shows value endian pill only in Value mode; mode change updates the UI and component state only — it does not re-run the search (parity with pre-refactor: changing mode only updated `S.searchMode`).
- Endian pills Auto/LE/BE; clicking updates the active pill and component state only — it does not re-run the search (parity with pre-refactor: changing endianness only updated `S.searchEndianness`).
- Addr mode strips non-hex input and shows `0x` prefix overlay when non-empty.
- Enter runs a fresh search; Enter on an unchanged completed query navigates (Shift+Enter → prev, Enter → next).
- Ctrl+F focuses and selects the search input.
- Run button triggers `onSearch(..., 'button')`; prev/next navigate; clear empties input + `onClear`.
- `setCount(n, m)` renders `m+1 / n` when query non-empty and matches exist, `0 / 0` when a query has no hits, blank when the query is empty.
- `setBusy(true/false)` toggles the spinner (`#search-progress.active`) and `aria-hidden`.
- `setVisible(true/false)` shows/hides the `#search-box` (host switches toggles it when leaving the memory view; SearchBar is unaware of which view is active). Ctrl+F may still focus a hidden input — existing no-op.

## Validation & Error Matrix

| Condition | Behaviour |
|---|---|
| Empty/whitespace query | Engine clears matches, completes immediately; no callback search work. |
| Addr mode non-hex chars | Stripped from input; no unsafe parse. |
| Non-value mode | Endian pill hidden; endianness not part of search key (`n/a`). |
| Mode/endian change | UI + component state only; no `onSearch` emitted (pre-refactor parity). |
| Search while not in memory view | Engine no-ops (host view gate). |
| Mode change while search running | Cancels via engine token; component just emits a fresh `onSearch`. |

## Tests Required

`src/test/webview/components/search-bar.test.ts` (mocha + jsdom): mode labels; endian pill visibility + click re-run; addr overlay + hex strip; Enter run vs completed-query navigate parity; Ctrl+F focus; clear empties + `onClear`; `setCount`/`setBusy`; seed restore; trigger passthrough (`enter-next`/`enter-prev`/`button`); Ctrl+Z does not fire any search callback.

## Anti-patterns

- Engine reading `S.searchMode`/`S.searchEndianness`/DOM input in the run-decision path.
- Component writing `S` or calling engine functions directly (must go through callbacks).
- Undo handler inside the search component.
- Search styles split between `toolbar.css`/`SearchBar.css` (historical; now all in `SearchBar.css`).
- Duplicate `#search-box` markup in the host template.
