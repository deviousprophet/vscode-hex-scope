# PRD — Fix webview review findings + UI/UX heuristic review

## Origin
- Two-axis review (Standards + Spec/regression) of the v2.17.1..HEAD webview component refactor (issue #151).
  Full review notes: `.trellis/tasks/archive/2026-08/08-09-review-webview-refactor-v2.17.1/review-notes.md`.
- User-corrected scope: UI/UX review is a **heuristic review** (not an automated accessibility scan).

## Acceptance criteria — code findings to fix
1. **Regression B1** — restore size-change handling via **ResizeObserver** on the memory-grid scroll
   container (`#mem-scroll`) AND the record-view scroll container (subsumes the lost v2.17.1
   window-resize listener, memoryView.ts:341). On resize: re-measure container height, refresh
   `vscrollState.containerHeight`, re-render the slice / invalidate the record slice signature
   (hexViewer.ts:243-253). Add a regression test.
2. **Sync B2** — search-match truth = **executed search** (decision D2): store the completed needle
   length with the match set; `getNeedleLen` (memoryGrid.ts:498-503) reads only that. When the visible
   query or mode diverges from the executed search, clear matches + reset count `0 / 0`. Update
   component-search-bar.md / search-engine.md (intentional behavior change).
3. **CSS B3** — remove dead `'integrity'` entry in `src/hexEditorSession.ts:781` cssFiles list.
4. **Refactor C1** — `memRerender()` only when `S.currentView === 'memory'`
   (applyFill / undoLastEdit / refreshAfterIntegrityEdits; hexViewer.ts:483,1161,1171,1182).
5. **Standards B1** — one shared `refreshAfterLocalEdit()` helper; applyFill / undoLastEdit /
   refreshAfterIntegrityEdits (helper + setEditMode) call it instead of inlined duplicates.
6. **Standards H1** — HexView gains `paintStructHighlight(addrs, cls)` + `paintClearStructHighlight(cls)`
   (root-scoped); host `highlightHexAddress`/`onClearHighlightHex` (hexViewer.ts:141-178) rewired to it.
   Update component-hex-view.md + component-sidebar-struct-panel.md.

## Acceptance criteria — UI/UX heuristic review
7. Heuristic review done — full findings in `ui-ux-review.md` (38 total: 4S / 14M / 20L).
   Four are the same regressions as items 1,2,4 (+ C2 context-menu ASCII gating, added below).
   Fix in-task (small, with the code work):
   - C2: gate single-byte "Copy ASCII" on printable byte (contextMenu.ts:148; old code hid
     non-printables; update component-context-menu.md:49).
   - Search chrome: `aria-label` on `#search-input`, `aria-live="polite"` on `#match-count`,
     and re-push `setCount(S.matchAddrs.length, S.matchIdx)` after full re-render
     (searchBar.ts:42-62).
   - Lock restore: `lock.ts:21-32` must restore each element's prior `disabled` state, not
     force-enable everything.
   Remaining M/L findings (profile-delete confirm, scripts second-run disable, record empty copy,
   toolbar overflow, context-menu/hex-grid keyboard, etc.) are filed as follow-ups.
8. **Delivery** — after the gate passes (`check-types`/`lint`/`test` + fallow): commit on
   `fix/webview-review-findings`, push, open PR against protected `main`.
   M-level UI/UX findings → separate lightweight Trellis follow-up tasks; L-level → one grouped task.
9. **Design** — confirmed decisions recorded in `design.md` (D1–D7). Review before `task.py start`.

## Constraints
- Behavior-preserving: no functional/visual change beyond the fixes above.
- `npm run check-types`, `npm run lint`, `npm test` (336 webview tests) must stay green.
- Update owning specs (.trellis/spec/frontend/components/*.md) where contracts change (B2, H1).
- No pushes to remote; no commits unless asked.
