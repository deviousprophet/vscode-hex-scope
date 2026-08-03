# PRD — Refactor webview UI into self-contained components (SearchBar first)

## Origin
Issue #151 — "Refactor webview UI into self-contained components". Issue defines the target structure and ACs for the whole webview. This task scopes **only the SearchBar component**; hex-view grid and remaining components are separate future tasks.

## Problem
Current search UI is split across three files and two responsibilities:

- `src/webview/search/searchControls.ts` — DOM wiring, reads/writes global state `S.searchMode`/`S.searchEndianness`, calls engine functions.
- `src/webview/search/searchEngine.ts` — search logic, reads `S.searchMode`/`S.searchEndianness` and the DOM `#search-input` value at run time.
- `src/webview/hexViewer.ts:538-546` — search bar HTML embedded in the main template (mode `<option>`s + endian buttons render from `S`).

Search styles are embedded in `src/webview/styles/toolbar.css`.

Result: search UI state (`S.searchMode`/`S.searchEndianness`/query) lives in a global store, read/written by three modules, and markup is split between the entry point and the wiring module. Not a self-contained component.

## Goal
Extract the search bar into a self-contained component at:

```
src/webview/components/SearchBar/SearchBar.ts
src/webview/components/SearchBar/SearchBar.css
```

Component owns its markup (via `toHtml()`), its UI state (mode/endianness/query), its input behaviours, and its styles. Host (webview glue) owns search execution, match data, navigation, and match-count/busy display feed-back.

## Decisions (from planning grills)
- **Component boundary**: component = one independently-styled UI unit; `searchEngine.ts` stays shared host logic (engine is pure logic, not UI).
- **State ownership**: component owns UI state internally (mode/endian/query), seeded from `S` on boot via constructor `seed`; component does NOT write `S`. Host syncs `S.searchMode`/`S.searchEndianness` when running a search (needed by `memoryView.ts` needle-length render).
- **Engine API**: new explicit entry `runSearch(query, mode, endianness, trigger)`; engine stops reading `S.searchMode`/`S.searchEndianness` and the DOM input for its key/start decision. Single source of truth = component.
- **Instance scoping**: global DOM IDs, single instance (current needs). Multi-instance (diff view) deferred — not this issue's AC.
- **Undo split**: Ctrl+Z undo handler moves out of search wiring into host (`hexViewer.ts`); Ctrl+F stays with the component.
- **Markup**: search bar HTML currently in `hexViewer.ts:538-546` moves into `SearchBar.toHtml()`; host injects its output.
- **CSS**: all `.search-*`/`#search-*` rules extracted from `toolbar.css` into `SearchBar.css`. `toolbar.css` keeps only toolbar layout/chrome.
- **CSS loading**: `SearchBar.css` imported from `SearchBar.ts`; esbuild emits `dist/webview.css`; `_getHtml` links both old styles + new bundled css during transition. Other components keep static links until they move.
- **API shape**: branch class pattern — `class SearchBar { constructor(callbacks, seed), toHtml(), mount(), setCount(), setBusy() }`, minus undo. Pure HTML render function for DOM-free testing where feasible.
- **Naming/path**: PascalCase per issue AC (`components/SearchBar/SearchBar.ts`).

## Scope
In:
- New `src/webview/components/SearchBar/SearchBar.ts` + `SearchBar.css`.
- `searchEngine.ts`: new explicit `runSearch(query, mode, endianness, trigger)`; remove `S.searchMode`/`S.searchEndianness`/DOM-read coupling from its search decision; keep `clearSearch`/`nextMatch`/`prevMatch`, `initSearch` host wiring.
- `hexViewer.ts`: remove search bar HTML block; wire `SearchBar` (constructor seed from `S`, callbacks → engine, `setCount`/`setBusy`); keep `S.searchMode`/`S.searchEndianness` sync on run; move Ctrl+Z undo keydown here.
- `toolbar.css`: strip search rules.
- `hexEditorSession.ts` `_getHtml`: add bundled `dist/webview.css` link (keeps existing `styles/*.css` links for not-yet-moved components).
- New test `src/test/webview/ui-components/search-bar.test.ts` (mocha + jsdom, ported from abandoned branch, minus undo-related cases).

Out:
- Hex-view grid and all other components (future tasks).
- Multi-instance/scoped search bar (diff view).
- DOM-based rewrite of the grid renderer.

## Acceptance Criteria
- [x] `src/webview/components/SearchBar/SearchBar.ts` + `SearchBar.css` exist; component owns search markup, UI state, input behaviours, and styles.
- [x] All `.search-*`/`#search-*` styles moved out of `toolbar.css`; `toolbar.css` retains only toolbar chrome.
- [x] `searchEngine.ts` `runSearch(query, mode, endianness, trigger)` takes explicit params; no `S.searchMode`/`S.searchEndianness`/`#search-input` DOM read in its search-decision path.
- [x] `S.searchMode`/`S.searchEndianness` still kept in sync by host (memoryView needle-length + context render unaffected).
- [x] Ctrl+Z undo no longer handled by search code; Ctrl+F still focuses search input.
- [x] Search bar renders identically to before (same DOM ids/classes, same HTML structure), esbuild emits `dist/webview.css`, `_getHtml` links it.
- [x] `npm run lint`, `npm run check-types` pass; jsdom batch 155 passing / 2 pre-existing failures (state-default + record-view, untouched files, fail identically on main). `search-bar.test.ts` (18 tests) covers: mode labels, endian pill, addr mode overlay + hex-stripping, Enter run/navigate parity, Ctrl+F focus, clear, setCount/setBusy, seed, trigger passthrough, mode/endian no-re-run, Ctrl+Z no-callback.
- [x] No functional or visual change to search behaviour in the running extension (mode/endian change does not re-run search — parity with pre-refactor).
