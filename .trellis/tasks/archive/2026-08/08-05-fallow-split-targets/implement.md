# Implement — Split high-impact fallow files

Task: `.trellis/tasks/08-05-fallow-split-targets`. Behavior-preserving splits; no design re-litigation.

## Preconditions
- Branch `refactor/fallow-split-targets` (base main, PR #160 merged). `npm run check-types` + webview tests green before.

## Checklist

1. **Split `memoryData.ts`**
   - Create `src/webview/memory/integrityHighlight.ts`: move `integrityHighlightClass` + `isStoredIntegrityAddress` + `isIntegrityRangeAddress` + the `IntegrityHighlight` type alias (import `S` from `../state`).
   - Remove those from `memoryData.ts`.
   - Update imports: `memoryGrid.ts` (line ~8) and `webview.test.ts` (line 7) → `../../webview/memory/integrityHighlight`.
2. **Split `SearchBar.ts`**
   - Create `src/webview/components/SearchBar/searchBarRender.ts`: move `MODE_LABELS`, `PLACEHOLDERS`, `searchKeyFor`, `SearchTrigger`, `activeClass`, `modeOptions`.
   - `SearchBar.ts` imports them (no re-export).
   - Move consumers: `searchEngine.ts` + `search-bar.test.ts` import `searchKeyFor`/`SearchTrigger` from `searchBarRender`.
3. **Split `HexView.ts`**
   - Create `src/webview/components/HexView/HexViewRender.ts`: move render types + `BYTES_PER_ROW` + `EMPTY_ROWS_HTML` + `renderHexViewHeader` + `renderHexViewHtml` + row/cell render helpers (`buildRowParts`, `appendSpacer`, `appendHexViewRow`, `renderGapRow`, `renderBanner`, `renderDataRow`, `renderHexCell`, `renderCharCell`, `compositedClasses`, `isMatchAddress`, `isActiveMatchAddress`, `inRange`, `addrHex`).
   - Create `src/webview/components/HexView/HexViewPaint.ts`: move `cellAddress`, `selectedColumns`, `addColumnRange`, `CellAddressIndex`, `buildCellAddressIndex`, `addIndexedCell`, `addCellToMap`, `highlightVisibleMatches`, `highlightMatchRange`, `highlightMatchCells`, `paintMatchesInRoot`, `clearCellPreview`, `columnFor`, `isCopyShortcut`, `isEditableTarget`.
   - `HexView.ts` keeps class + `HexViewCallbacks`; imports from the two sub-modules (no re-export).
   - Move consumers: `memoryGrid.ts`/`hex-view.test.ts`/`hexViewer.ts` import render fns/types from `HexViewRender` and class/callbacks from `HexView`.
4. **Validate**
   - `npm run lint`, `npm run check-types`, `npm run compile-tests`.
   - `npx mocha --ui tdd "out/test/webview/**/*.test.js"` (hex-view, search-bar, webview suites are the parity gate).
   - `npm test` (full).
   - Fallow: `check.total_issues === 0`, `health.findings.length === 0`, `dupes.clone_groups === 0`; confirm the three `split_high_impact` targets are gone.

## Review gates
- `rg "searchKeyFor" src/webview/search src/test/webview/components/search-bar.test.ts` — imports from `searchBarRender`.
- `rg "renderHexViewHtml|renderHexViewHeader|HexViewRenderInput|HexViewRow|HexViewCell|HexViewRange|HexViewBanner" src/webview/memory/memoryGrid.ts src/test/webview/components/hex-view.test.ts src/webview/hexViewer.ts` — imports from `HexViewRender`.
- `rg "integrityHighlightClass" src/webview` — only in `memory/integrityHighlight.ts` + importers.
- Fallow: `total_issues 0`, `findings 0`, `clone_groups 0`, `health.targets` empty.
- No exported signature changed; no suppressions; no fallow config edits.

## Rollback
- One commit per split; `git revert` restores single-file layout + imports.
