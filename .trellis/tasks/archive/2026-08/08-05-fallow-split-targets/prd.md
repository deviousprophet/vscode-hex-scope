# PRD — Split high-impact files flagged by fallow

## Origin
Fallow `health.targets` (category `split_high_impact`) surfaced three files whose change blast radius is amplified by high fan-in / complexity density. These are informational structural suggestions (not findings; never block green), addressed here as a behavior-preserving refactor.

## Problem
- `src/webview/memory/memoryData.ts` (37 LOC, 11 dependents) mixes the memory-adapter concern with the integrity-highlight paint concern.
- `src/webview/components/SearchBar/SearchBar.ts` (260 LOC, 3 dependents) keeps pure render/state-model helpers inside the interaction class module.
- `src/webview/components/HexView/HexView.ts` (627 LOC, 3 dependents) keeps the pure DOM-free render layer inside the interaction class module.

## Goal
Split each into two cohesive modules. Public exported surface must stay available (re-export from the original module where importers depend on it), so no caller changes behavior. Zero functional or visual change.

## Scope

### 1. memoryData
- `src/webview/memory/memoryData.ts` keeps the memory adapter: `getByte`, `buildMemRows`, `initFlatBytes`.
- New `src/webview/memory/integrityHighlight.ts` owns `integrityHighlightClass` + its helpers (`isStoredIntegrityAddress`, `isIntegrityRangeAddress`).
- Importers of `integrityHighlightClass` (`memoryGrid.ts`, `webview.test.ts`) switch to the new module.

### 2. SearchBar
- `src/webview/components/SearchBar/SearchBar.ts` keeps the `SearchBar` class + `SearchBarCallbacks` + `SearchBarSeedOptions`.
- New `src/webview/components/SearchBar/searchBarRender.ts` owns the pure helpers: `MODE_LABELS`, `PLACEHOLDERS`, `searchKeyFor`, `SearchTrigger`, `activeClass`, `modeOptions`.
- No re-export barrel: `searchEngine.ts` / `search-bar.test.ts` import `searchKeyFor`/`SearchTrigger` from `searchBarRender` (keeps `SearchBar.ts` fan-in to its class consumers).

### 3. HexView
- `src/webview/components/HexView/HexView.ts` keeps the `HexView` class + `HexViewCallbacks` + interaction helpers.
- New `src/webview/components/HexView/HexViewRender.ts` owns the pure DOM-free render layer: `BYTES_PER_ROW`, `EMPTY_ROWS_HTML`, types (`HexViewCell`, `HexViewBanner`, `HexViewRow`, `HexViewRange`, `HexViewRenderInput`), `renderHexViewHeader`, `renderHexViewHtml`, and row/cell render helpers.
- New `src/webview/components/HexView/HexViewPaint.ts` owns the DOM paint/match utilities (`cellAddress`, `selectedColumns`, `buildCellAddressIndex`, `highlightVisibleMatches`, `highlightMatchRange`, `highlightMatchCells`, `paintMatchesInRoot`, `clearCellPreview`, `columnFor`, `isCopyShortcut`, `isEditableTarget`, plus index helpers).
- No re-export barrel: `memoryGrid.ts` / `hex-view.test.ts` import render fns + types from `HexViewRender` and only the class/callbacks from `HexView`; `hexViewer.ts` pulls `HexViewRange` from `HexViewRender`.

Out of scope: changing any exported signature, moving interaction helpers, altering behavior, or updating `component-search-bar.md` / `component-hex-view.md` specs (contracts are unchanged; spec refresh deferred to another branch if ever needed).

## Acceptance Criteria
- [ ] Three new module files exist; original modules keep their full public exports (via re-export where needed).
- [ ] `integrityHighlightClass` importers point at `memory/integrityHighlight`.
- [ ] Zero behavior change: `npm run lint`, `npm run check-types`, webview test batch, `npm test` all pass unchanged.
- [ ] Fallow: `check.total_issues === 0`, `health.findings.length === 0`, `dupes.clone_groups === 0`, and all three `split_high_impact` targets cleared.
- [ ] No suppressions, no fallow config changes.
