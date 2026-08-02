# Design: Reuse SearchBarComponent in single hex view

Task: `08-02-reuse-searchbar-single-view` · Branch: `feat/reuse-ui-components-single-view` · Base: `main`

## 1. Architecture

The component is a UI control surface; each view is a **host** wiring it to its own search logic.

```text
SearchBarComponent (shared, ui-components/search-bar/)
    ▲                        ▲
    │ callbacks              │ callbacks
    │ (onSearch/onPrev/      │ (onSearch/onPrev/
    │  onNext/onClear)       │  onNext/onClear)
    │                        │
single-view host            diff host
hexViewer.ts +              hexDiffViewer.ts
webview/search/searchEngine.ts
```

- Component owns: input, mode select, endian pill, addr overlay, Enter/Ctrl+F/buttons, `setCount`/`setBusy`, seed options. No host data.
- Host owns: run search, stream/highlight, navigate, selection, scroll, inspector. Same component, two hosts.

## 2. Changes

### 2.1 `SearchBarComponent` (component, additive)
- Add optional seed: `constructor(cb, seed?: { mode?: SearchMode; endianness?: SearchEndianness; query?: string })`. Applied in `toHtml()`/state. Defaults unchanged (`bytes`/`le`/`''`). Diff passes nothing.
- `onSearch` gains an **optional 4th `trigger` arg** (`'button' | 'enter-next' | 'enter-prev'`): `runSearch()`/mode-change/endian-change/applyEndian pass `'button'`; `handleSearchEnter` passes `'enter-next'`/`'enter-prev'` (shift). Additive — diff host ignores it; single-view adapter forwards it to glue for running-search navigation.
- Spec update: `frontend/search-bar-component.md` — document the seed option (§2 API) + the trigger arg.

### 2.2 Single-view host
- `hexViewer.ts`: replace the hand-rolled `#search-box` markup (in the view template) with `${searchBar.toHtml()}`; construct `new SearchBarComponent(cb, { mode: S.searchMode, endianness: S.searchEndianness, query: '' })` and `mount()`.
- New thin adapter (in hexViewer or a small module): 
  - `onSearch: (query, mode, endianness, trigger?) => { S.searchMode = mode; S.searchEndianness = endianness; runSearch(trigger ?? 'button'); }`
  - `onPrev: () => prevMatch()`, `onNext: () => nextMatch()`, `onClear: () => clearSearch()`.
- `searchControls.ts`: **delete** (its listeners/UI sync are all component behaviors now).
- Undo shortcut: add a host-level `keydown` listener in `hexViewer.ts` (`ctrl/meta + z` while `S.editMode` → `undoLastEdit`). Replaces the `isUndoShortcut` path that dies with `searchControls.ts`.

### 2.3 `searchEngine.ts` glue (host logic, mostly unchanged)
- Remove/replace DOM-write helpers targeting component-owned elements:
  - `updMC()` (`#match-count`) → `searchBar.setCount(S.matchAddrs.length, S.matchIdx)`.
  - `setSearchBusy()` (`#search-progress`) → `searchBar.setBusy(bool)`.
- **Injection:** `searchEngine.ts` must not import the host-owned component instance. Add the same injection `initSearch` already uses: `initSearchUi(ui: { setCount; setBusy })` called by hexViewer in `setupRenderedUi`; `updMC`/`setSearchBusy` become `_ui?.setCount(...)` / `_ui?.setBusy(...)` — all internal call sites unchanged.
- **Strip only the completed-nav machinery** (component owns Enter-on-completed via `shouldNavigate`/`onNext`/`onPrev`): remove `handleCompletedSearchNavigation` and `_lastCompletedSearchKey`. **Keep** `SearchTrigger`, the `trigger` param on `runSearch`/`handleSearchNavigation`/`handleRunningSearch`, and `navigateBySearchTrigger` — single-view parity: `handleRunningSearch` same-key branch navigates on `'enter-next'`/`'enter-prev'`, no-ops on `'button'`.
- Keep: `runSearch`, streaming `onProgressUpdate`/`onComplete`, first-jump, `nextMatch`/`prevMatch`, `clearSearch`, `selectCurrentMatch`/`goToMatch`/`_switchToMemory`, `makeSearchKey`.
- `searchEngine.ts` reads `S.searchMode`/`S.searchEndianness` — unchanged (adapter mirrors them).

### 2.4 CSS (component owns all search-bar styles)
- Move into `searchBarComponent.css`: `#search-box`, `#search-mode`, `.search-addr-wrap`, `.search-addr-prefix`, `#search-input` (+ `search-addr-mode`/`::placeholder`/`:focus`), `#btn-prev`/`#btn-next`/`#btn-clear-search`, `#match-count`, `.search-progress` (+ `active`/`@keyframes hs-search-spin`). Update the file header comment.
- Remove from `base.css` the moved rules; keep shared non-search chrome only (`.view-tabs`, `.view-tabs button`, `.tb-sep`, `.nav-btn` — diff's own prev/next/swap use `.nav-btn`).
- Delete the leftover search dups in `toolbar.css` (`.search-endian-toggle`, `.search-endian-toggle button`, `.search-btn`, and the stale comment).
- Single view `hexEditorSession.ts` `_getHtml` cssFiles: append `src/webview/ui-components/search-bar/searchBarComponent.css` after base.css — the existing list maps styles/ names only, so use the relative-path link approach (like `hexDiffSession.ts`).
- Diff view (`hexDiffSession.ts`) already loads it — unchanged, except comment updates.
- Grid match-highlight rules (`.search-row`, memory-view.css / hexViewComponent.css) are result rendering, not the control — stay host-side.

## 3. State Ownership

- Component: `this.mode`, `this.endianness`, `this.query`.
- `S`: `searchMode`/`searchEndianness` mirrors (written by adapter from `onSearch` args). `memoryView.needleLenForMode` and `searchEngine.makeSearchKey` keep reading `S`.
- `#search-input` value: component's `toHtml()` keeps the ID — `memoryView.ts:626` read unaffected.

## 4. Behavior Parity Checklist (must stay)

Parity ground truth = **v2.17.1 single-view search** (`src/webview/search/` + hexViewer template — unchanged since last release; the diff host is new and incomplete, so it is NOT the reference for behavior). Component behavior was authored for the diff; verify each item against the release single view.

- Enter runs fresh; Enter on unchanged completed query navigates next (Shift = prev). ✓ component handles.
- Enter on a **running** search navigates next/prev (single-view parity via `trigger` on `onSearch` → glue running-nav). ✓
- 🔍 run, ▲/▼ navigate, ✕ clear. ✓
- Ctrl+F focus+select. ✓ component.
- Mode change re-runs; endian pill only in value mode; addr `0x` overlay + hex-only input + maxlength 8. ✓ (behavior change: mode/endian change now re-runs search — matches diff, accepted)
- Streaming: `onProgressUpdate` → live highlights + first-jump; `onComplete` → busy off + select+scroll. Host glue unchanged (DOM writes via setCount/setBusy).
- Searching from record view switches to memory (`_switchToMemory`). Host glue.
- Ctrl+Z undo re-homed to host keydown (`S.editMode` guard). ✓
- Minor accepted diff: spaces-only query shows `0 / 0` (component `setCount` reads raw `this.query`).

## 5. Tests

- `webview/search-bar-component.test.ts` — kept; add a case for the seed option (seeded mode/endianness reflected in `toHtml`) and one for the `onSearch` trigger arg (`'enter-next'`/`'enter-prev'`/`'button'` passed through on Enter/run).
- No existing single-view webview test touches search DOM — nothing to migrate.
- `core/search.test.ts`, `core/search-performance.test.ts` — unchanged.
- Run: `npm run compile`, `npm run lint`, `npm test`, `npx fallow`.

## 6. Wrong vs Correct

Wrong: component writes `S` directly (couples UI to single-view state); `searchControls.ts` kept alongside the component (two sources of truth); single view loses `'auto'` endian default; `#match-count`/`#search-progress` written by both glue and component; Ctrl+Z undo lost when `searchControls.ts` dies; search-bar styles split across base.css/toolbar.css/component css.
Correct: component stays stateless w.r.t. host (seed + callbacks only); adapter mirrors `S`; `searchControls.ts` deleted; seed preserves `auto`; count/spinner owned solely by component (`setCount`/`setBusy`); undo re-homed to host keydown; all search-bar CSS lives in `searchBarComponent.css`.
