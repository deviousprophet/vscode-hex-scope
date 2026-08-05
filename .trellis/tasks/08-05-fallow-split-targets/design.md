# Design — Split high-impact fallow files

Behavior-preserving module splits. All three moves are physical relocation of existing code; exported symbols keep the same names and semantics. No `S`/state changes, no DOM changes, no markup changes.

## 1. memoryData split

```
src/webview/memory/memoryData.ts      getByte, buildMemRows, initFlatBytes  (adapter)
src/webview/memory/integrityHighlight.ts  integrityHighlightClass + isStoredIntegrityAddress + isIntegrityRangeAddress
```

- `integrityHighlight.ts` imports `S` from `../state` (as `memoryData.ts` does today).
- `memoryGrid.ts` + `webview.test.ts` change their `integrityHighlightClass` import to `memory/integrityHighlight`.
- `memoryData.ts` no longer needs the `IntegrityHighlight` type alias / helper functions.

## 2. SearchBar split

```
src/webview/components/SearchBar/SearchBar.ts         class SearchBar (+ SearchBarCallbacks, SearchBarSeedOptions)
src/webview/components/SearchBar/searchBarRender.ts   MODE_LABELS, PLACEHOLDERS, searchKeyFor, SearchTrigger, activeClass, modeOptions
```

- `SearchBar.ts` imports the helpers from `searchBarRender`; no re-exports.
- Consumers import from the module that owns the symbol: `searchEngine.ts` and `search-bar.test.ts` import `searchKeyFor`/`SearchTrigger` from `searchBarRender`; only the class comes from `SearchBar`. This keeps `SearchBar.ts` fan-in to its class consumers (blast-radius goal).

## 3. HexView split

```
src/webview/components/HexView/HexView.ts            class HexView + HexViewCallbacks + interaction helpers
src/webview/components/HexView/HexViewRender.ts      types + pure render (DOM-free)
src/webview/components/HexView/HexViewPaint.ts       DOM paint/match utilities (cellAddress, selectedColumns, match paint, copy/column helpers)
```

- `HexViewRender.ts` owns: `BYTES_PER_ROW`, `EMPTY_ROWS_HTML`, `HexViewCell`, `HexViewBanner`, `HexViewRow`, `HexViewRange`, `HexViewRenderInput`, `renderHexViewHeader`, `renderHexViewHtml`, `buildRowParts`, `appendSpacer`, `appendHexViewRow`, `renderGapRow`, `renderBanner`, `renderDataRow`, `renderHexCell`, `renderCharCell`, `compositedClasses`, `isMatchAddress`, `isActiveMatchAddress`, `inRange`, `addrHex`.
- `HexViewPaint.ts` owns: `cellAddress`, `selectedColumns`, `addColumnRange`, `CellAddressIndex`, `buildCellAddressIndex`, `addIndexedCell`, `addCellToMap`, `highlightVisibleMatches`, `highlightMatchRange`, `highlightMatchCells`, `paintMatchesInRoot`, `clearCellPreview`, `columnFor`, `isCopyShortcut`, `isEditableTarget`.
- `HexView.ts` keeps the class + `HexViewCallbacks`; it imports `BYTES_PER_ROW`, `addrHex`, `HexViewRange` and the paint helpers, with no re-exports.
- Consumers import from the owning module: `memoryGrid.ts` + `hex-view.test.ts` pull render fns/types from `HexViewRender` and only the class/callbacks from `HexView`; `hexViewer.ts` pulls `HexViewRange` from `HexViewRender`. `HexView.ts` fan-in drops to its class consumers.

## Contract guarantees

- Every exported symbol keeps its name, signature, and semantics; only the import path changes (no re-export barrels left, so no unused-re-export dead code).
- The class modules (`HexView.ts` / `SearchBar.ts`) drop LOC and fan-in to their class consumers; render/paint/pure helpers live in focused modules.
- Pure modules (`HexViewRender.ts`, `HexViewPaint.ts`, `searchBarRender.ts`) are DOM-free or DOM-scoped utilities unchanged from their pre-move bodies.

## Tests

Existing coverage is the parity gate; import paths change to the owning module, assertions stay identical:
- `src/test/webview/components/hex-view.test.ts` — class/callbacks from `HexView`, render fns/types from `HexViewRender`; assertions unchanged.
- `src/test/webview/components/search-bar.test.ts` — class from `SearchBar`, `searchKeyFor` from `searchBarRender`; assertions unchanged.
- `src/test/webview/webview.test.ts` — `integrityHighlightClass` from `memory/integrityHighlight`; assertions unchanged.
- No new behavior; no new tests required beyond running the full suite.

## Rollback

One commit per split (or one combined); `git revert` restores the single-file layout and any changed imports.
