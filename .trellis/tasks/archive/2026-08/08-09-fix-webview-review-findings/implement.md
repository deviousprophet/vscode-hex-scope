# Implement â€” fix webview review findings + UI/UX heuristic review

Ordered checklist. Decisions confirmed in `design.md` (D1â€“D7). Validate after each step.

## Phase A â€” UI/UX heuristic review (DONE)
- [x] Rendered/reviewed webview UI/UX per area (memory/record/search/toolbar/edit/context menu/
      sidebar + 4 panels/external change/loading-error). Findings: `ui-ux-review.md` (38: 4S/14M/20L).
- [x] Noted in-task vs follow-up split into prd.md acceptance item 7.

## Phase B â€” regression/sync fixes (B1/B2/B3/C1/C2 + Standards B1 + a11y sweep)
- [x] B3: remove `'integrity'` from cssFiles list in `src/hexEditorSession.ts:779-782`.
- [x] B1 (D1): `ResizeObserver` on `#mem-scroll` (memoryGrid.ts mount) AND record-view scroll
      container (hexViewer.ts record slice) â†’ re-measure containerHeight + re-render slice /
      invalidate record slice signature. Disconnect on teardown.
- [x] C1 + Standards B1 (D4): single `refreshAfterLocalEdit()` helper (dirty count + gated
      `if (S.currentView === 'memory') memRerender()` + inspector + struct + integrity notify);
      applyFill / undoLastEdit call it; refreshAfterIntegrityEdits = helper + toolbar.setEditMode.
- [x] B2 (D2): store executed needle length with match set; `getNeedleLen` reads only it. On query/
      mode divergence from completed search key â†’ clear matches + reset count `0 / 0` (searchEngine.ts,
      searchBar.ts change hooks, memoryGrid.ts). Update component-search-bar.md / search-engine.md.
- [x] C2 (D5): gate single-byte "Copy ASCII" on printable byte (contextMenu.ts:148); update
      component-context-menu.md:49.
- [x] Search chrome (D5): `aria-label="Search"` on `#search-input`, `aria-live="polite"` on
      `#match-count`, re-push count after full render (searchBar.ts / hexViewer.ts setupRenderedUi).
- [x] Lock restore (D5): `data-was-enabled` stores actual prior enabled state; restore exactly on
      unlock (lock.ts:8-32).
- [x] Tests (D6): one per change â€” B1 reslice on resize, B2 needle-from-executed-key + divergence
      clears, C1 no grid re-render in record view, C2 menu gating, H1 paint scope, lock restore.
- [x] Validation: `npm run check-types && npm run lint && npm test`.

## Phase C â€” Standards H1 (paint contract)
- [x] Add `paintStructHighlight(addrs, cls)` + `paintClearStructHighlight(cls)` (root-scoped clear)
      to HexView; rewire host `highlightHexAddress`/`onClearHighlightHex` (hexViewer.ts:141-178) to
      use them; delete the `[data-addr]` document-scrape helper. Update component-hex-view.md +
      component-sidebar-struct-panel.md.
- [x] Validation: `npm run check-types && npm run lint && npm test`.

## Phase D â€” full gate + delivery (D7)
- [x] `npm run compile-tests && npm run lint && npm test`
- [x] Re-run UI/UX review on changed areas; confirm no regressions introduced.
- [x] Fallow scan clean.
- [x] Commit on `fix/webview-review-findings`, push, open PR against protected `main`.
- [x] File M-level UI/UX findings as separate Trellis follow-up tasks; L-level grouped into one.


