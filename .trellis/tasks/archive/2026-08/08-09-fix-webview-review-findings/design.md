# Design — fix webview review findings

Decisions confirmed in planning (grill, one-by-one). Branch: `fix/webview-review-findings`.
All changes behavior-preserving except the explicitly decided behavior changes (B2, C2) which are
documented in the owning specs.

## D1. B1 — size-change handling (ResizeObserver)
- Replace the lost window-resize behavior with `ResizeObserver` on the memory grid's scroll container
  (`#mem-scroll`) **and** the record view's scroll container. Fires on window resize and any
  container-size change (editor-group drag, future layout tweaks); subsumes the old `window.resize`
  listener (v2.17.1 `memoryView.ts:341`) without needing window-event parity.
- On observe: re-measure container height → update `vscrollState.containerHeight` → re-render the slice
  (memory grid: `syncVirtualScrollMetrics` + `renderMemoryGrid`; record view: invalidate the slice
  signature that lacks `containerHeight`, `hexViewer.ts:243-253`).
- No debounce (virtualized render is cheap). Observer created in host mount; disconnect on teardown.
- Files: `memoryGrid.ts`, `hexViewer.ts` (record slice). Test: resize → slice/scroll extent refresh.

## D2. B2 — search match truth = executed search
- Source of truth for match highlighting is the **completed search key**, not the live input/mode.
- On search completion, store the executed needle length alongside the match set (engine already
  tracks `_lastCompletedSearchKey`, `searchEngine.ts:85`). `getNeedleLen()` (memoryGrid.ts:498-503)
  reads only that — no mixing of current input text with last-executed mode.
- **Divergence invalidation**: when the visible query or mode differs from the executed search
  (`searchKeyFor(mode, q, endianness)` vs completed key), clear `S.matchAddrs`, reset `S.matchIdx`,
  reset count to `0 / 0`. Stale matches never masquerade as current; next/prev no longer walks an old set.
- Behavior change (intentional): control changes no longer repaint existing highlights until re-run.
  Document in `component-search-bar.md` + `search-engine.md`.
- Files: `searchEngine.ts`, `searchBar.ts` (change hooks), `memoryGrid.ts`, `hexViewer.ts`.
- Test: needle width from executed key; mode/query divergence clears matches + count.

## D3. H1 — HexView struct-highlight paint contract
- New HexView methods: `paintStructHighlight(addrs, cls)` and `paintClearStructHighlight(cls)`.
  - `paintStructHighlight`: add `cls` to the rendered cells for each address (root-scoped lookup).
  - `paintClearStructHighlight`: remove `cls` from all cells in the HexView root (class-wide parity
    with current `onClearHighlightHex(cls)` behavior, but no `document`-scoped `querySelectorAll`).
- Host `hexViewer.ts:138-143,173-176` rewired to call the methods instead of `[data-addr]` DOM pokes.
  Deletes `highlightHexAddress` DOM-scraping helper.
- Resolves the spec tension: `component-hex-view.md:131` (host uses paint seams) vs
  `component-sidebar-struct-panel.md` (host applies struct highlight). Update both specs.
- Files: `hexView.ts`, `hexViewer.ts`. Test: add/clear scoped to the grid root.

## D4. C1 + duplicate-refresh — one helper
- Single `refreshAfterLocalEdit()`: set dirty count → `if (S.currentView === 'memory') memRerender()`
  → inspector setSelection → struct render → integrity notifyBytesChanged.
- `applyFill` / `undoLastEdit` call it directly; `refreshAfterIntegrityEdits` = helper +
  `toolbar.setEditMode(...)`. No options object.
- Files: `hexViewer.ts`. Test: no grid re-render while in record view.

## D5. Defaults (parity/cleanup — no tradeoffs)
- **B3**: remove `'integrity'` from `cssFiles` (`hexEditorSession.ts:779-782`).
- **C2**: gate single-byte `Copy ASCII` on printable byte (`formatAsciiByte(value) !== '.'`);
  restore v2.17.1 menu behavior; update `component-context-menu.md:49`.
- **Search chrome**: `aria-label="Search"` on `#search-input`; `aria-live="polite"` on `#match-count`;
  re-push `setCount(S.matchAddrs.length, S.matchIdx)` after full render.
- **Lock restore**: on lock, `data-was-enabled` records each element's actual prior enabled state
  (`String(!el.disabled)`); on unlock restore exactly, don't force-enable (`lock.ts:8-32`).
- Files: `hexEditorSession.ts`, `contextMenu.ts`, `searchBar.ts`, `hexViewer.ts`, `lock.ts`.

## D6. Tests
One focused regression test per behavior change (D1–D5 C2/lock), in existing `src/test/webview/**`
suites. Parity suite (336 tests) must stay green.

## D7. Delivery + follow-ups
- Gate: `npm run check-types && npm run lint && npm test` (+ fallow clean).
- Commit on `fix/webview-review-findings`, push, open PR against protected `main`.
- Follow-ups from `ui-ux-review.md`: M-level findings → separate lightweight Trellis tasks
  (profile-delete confirm, apply-profile warning, scripts second-run disable, record-empty copy,
  lock/panel a11y sweep); L-level grouped into one polish task.
