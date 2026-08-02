# Reuse SearchBarComponent in single hex view

## Goal

Adopt the reusable `SearchBarComponent` (built for the diff view) as the single-file hex editor's search bar, replacing the hand-rolled `#search-box` markup + `searchControls.ts` glue. The component is the UI control surface; the single view acts as a **host** wiring it to the existing core `SearchEngine` and the existing `searchEngine.ts` orchestration glue — exactly how the diff view hosts the same component.

## Background / Confirmed Facts

- `SearchBarComponent` (`src/webview/ui-components/search-bar/`) already emits byte-identical search-box HTML to the single view's hand-rolled markup: `#search-box`, `#search-endian-toggle` (segmented Auto/LE/BE pill), `#search-mode`, `.search-addr-wrap`/`#search-addr-prefix`, `#search-input`, `#btn-search`, `#btn-prev`, `#btn-next`, `#btn-clear-search`, `#search-progress`, `#match-count`. IDs match, so `memoryView.ts:626` (reads `#search-input` value) keeps working.
- The single view's search has two layers:
  1. `core/search.ts` `SearchEngine` — pure chunked scanner, **already shared** with the diff view. Unchanged.
  2. `webview/search/searchEngine.ts` — single-view orchestration glue (`runSearch`, streaming `onProgressUpdate`, first-jump, `nextMatch`/`prevMatch`, `clearSearch`, `selectCurrentMatch` → `S.selStart/S.selEnd` + sidebar inspector, `goToMatch` → `_switchToMemory`). Coupled to `S` + `memoryView` + sidebar; **not reusable** and stays host-side.
- `searchControls.ts` is imported only by `hexViewer.ts` — deleting it is clean (no other consumers; `setSearchEndian` internal).
- `S.searchMode`/`S.searchEndianness` are read by `memoryView.ts` (`needleLenForMode`) and `searchEngine.ts` (`makeSearchKey`) — must keep working.
- No existing single-view webview test touches search DOM; `webview/search-bar-component.test.ts` (6 tests) covers the component.
- **Ground truth:** `src/webview/search/` (searchEngine.ts/searchControls.ts) and the single-view search template are unchanged since v2.17.1 (last release). The diff host + component are new (commit 523f44e); the diff host is incomplete and must NOT be the behavior reference — parity is against the v2.17.1 single-view search.

## Requirements

- R1. The single view's search bar is rendered by `SearchBarComponent.toHtml()`; the hand-rolled `#search-box` markup in `hexViewer.ts` is removed.
- R2. `searchControls.ts` is deleted. Its wiring is replaced by a thin adapter: component `onSearch(query, mode, endianness, trigger?)` → `runSearch(trigger ?? 'button')`, `onPrev` → `prevMatch()`, `onNext` → `nextMatch()`, `onClear` → `clearSearch()`. The optional `trigger` (`'button' | 'enter-next' | 'enter-prev'`) is the component's UI-gesture signal so the host keeps the single view's running-search navigation (diff host ignores it).
- R3. `searchEngine.ts` orchestration glue stays (run/navigate, streaming, first-jump, selection + scroll, switch-to-memory). Its DOM-write helpers that target component-owned elements are removed/replaced: `updMC` (`#match-count`) → `searchBar.setCount(...)`; `setSearchBusy` (`#search-progress`) → `searchBar.setBusy(...)`.
- R4. State ownership: the component owns `mode`/`endianness`/`query` internally. The adapter mirrors them into `S.searchMode`/`S.searchEndianness` from `onSearch` callback args so `memoryView`/`searchEngine` consumers keep reading `S` unchanged.
- R5. Component gains an **optional seed API**: `new SearchBarComponent(cb, { mode, endianness, query }?)`. The diff view passes nothing (unchanged, defaults `bytes`/`le`); the single view seeds from `S` on boot — preserving the single view's `searchEndianness = 'auto'` default (component default is `'le'`).
- R6. **Component owns ALL search-bar CSS.** `searchBarComponent.css` is the single source for every search-bar control style. Move out of `base.css` into the component css: `#search-box`, `#search-mode`, `.search-addr-wrap`, `.search-addr-prefix`, `#search-input` (+ `search-addr-mode`/`::placeholder`/`:focus`), `#btn-prev`/`#btn-next`/`#btn-clear-search`, `#match-count`, `.search-progress` (+ `active`/`@keyframes hs-search-spin`). Keep in `base.css` only shared non-search chrome: `.view-tabs`, `.tb-sep`, `.nav-btn` (diff uses `.nav-btn` for its own prev/next/swap). Delete the leftover search dups in `toolbar.css` (`.search-endian-toggle`, `.search-endian-toggle button`, `.search-btn`, lines 80-105). Both hosts load `searchBarComponent.css`: diff already does, single view adds it (needs the relative-path link style, not the styles/ dir mapping). Grid match-highlight rules (`.search-row`) are result rendering, not the control — stay host-side.
- R7. Behavior parity preserved: Enter runs / navigates completed queries (component handles), Enter on a **running** search navigates next/prev (single-view parity — the `trigger` gesture keeps this), Shift+Enter prev, Ctrl+F focus, mode select, endian pill shown in value mode, `0x` addr prefix overlay, per-mode placeholders, `N / M` count, busy spinner, 🔍/▲/▼/✕ buttons, addr maxlength 8.
- R8. Ctrl+Z undo shortcut preserved. `searchControls.ts` owns it today (`isUndoShortcut`, guarded `S.editMode`); re-home to a host-level keydown in `hexViewer.ts` calling `undoLastEdit`.

## Acceptance Criteria

- [ ] AC1. Single hex view's search bar renders from `SearchBarComponent` (same DOM IDs, same look) with all behaviors functional (search, navigate, clear, count, spinner, endian, mode, addr prefix, Ctrl+F).
- [ ] AC2. `searchControls.ts` deleted; Ctrl+Z undo re-homed to a `hexViewer.ts` host keydown (still guarded by `S.editMode`); no dangling imports. `npm run compile` clean.
- [ ] AC3. Search results identical to before: streaming highlights + first-jump to match #1, Enter-on-completed navigates next/prev (Shift = prev), match selection sets `S.selStart/S.selEnd` + inspector refresh, searching from record view switches to memory view.
- [ ] AC4. `S.searchMode`/`S.searchEndianness` stay correct (seeded from `S` on boot, mirrored from component callbacks) — `needleLenForMode`/`makeSearchKey` unaffected.
- [ ] AC5. `SearchBarComponent` default behavior unchanged for the diff view (no seed passed, defaults `bytes`/`le`).
- [ ] AC6. Full test suite green (`npm test`); `search-bar-component.test.ts` kept (plus seed-case); core search tests unchanged; fallow clean.
- [ ] AC7. Search bar renders/styling identical between single and diff view, driven solely by `searchBarComponent.css` (single source; base.css/toolbar.css carry no search-bar rules).

## Out of Scope

- HexViewComponent reuse in the single-view memory grid (interaction layer or full grid rebuild) — **sibling child task** `08-02-reuse-hexview-single-view`, planned separately under parent `08-02-reuse-ui-components-single-view`.
- Any change to `core/search.ts` or the diff view.

## Decisions (grill, 2026-08-01)

| Q | Decision |
|---|---|
| Q1 | Scope **A** (search bar only); B/C later |
| Q2 | **Swap control surface only**; component = UI, host = logic; delete `searchControls.ts` |
| Q3 | Adapter mirrors `S.searchMode`/`S.searchEndianness`; component gains seed API |
| Q4 | Orchestration glue stays in `searchEngine.ts`; count/spinner DOM writes → component `setCount`/`setBusy` |
| Q5 | Seed API = **optional constructor options** |
| Q6 | Component default (`bytes`/`le`) unchanged for diff; single view seeds `auto` |
| Q7 | Ctrl+Z undo re-homed to **host keydown in `hexViewer.ts`** (`undoLastEdit`, guarded `S.editMode`) — was `searchControls.ts` |
| Q8 | **Mode/endian change auto re-runs** the search — accepted behavior change (matches diff semantics; old single view was UI-only toggle) |
| Q9 | **Strip only the completed-nav machinery** (`handleCompletedSearchNavigation`, `_lastCompletedSearchKey`) — component owns Enter-on-completed. **Keep** `SearchTrigger` + `runSearch(trigger)` + running-nav (`navigateBySearchTrigger`) for single-view Enter-mid-stream parity |
| Q10 | **Component owns all search-bar CSS** (`searchBarComponent.css`); base.css keeps only shared chrome (`.view-tabs`/`.tb-sep`/`.nav-btn`); toolbar.css search dups deleted |
| Q11 | Spaces-only query shows `0 / 0` (component `setCount` uses raw query) vs old blank — accepted minor cosmetic diff |
| Q12 | **Enter-during-streaming navigates** (single-view parity preserved): `onSearch` gains optional 4th `trigger` arg; diff ignores it; button-mid-stream stays no-op |
