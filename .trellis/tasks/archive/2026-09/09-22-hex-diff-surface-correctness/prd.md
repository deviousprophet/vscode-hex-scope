# Hex diff surface correctness fixes

Parent: `09-21-hex-diff-review-followups`. Deliverable: fix the diff-surface code findings of the
`feat/hex-diff` review — de-duplicate the clone groups, tighten the `diffInit` boundary, remove the
fabricated parse field, and fix the four user-visible interaction defects (search pane copy, premature
stash clear, `Show diff` search navigation, independent-scroll blanking).

## Goal

Make the diff surface correct and duplication-free without changing any behavior the review accepted.
Every fix cites its finding ID and keeps the two review axes separate.

## Confirmed facts (file:line anchors)

- S3 — clone groups: `diffGrid.matchSetWithSpans` (`src/webview/diff/diffGrid.ts:263`) duplicates
  `memoryGrid.addMatchSpan` (`src/webview/memory/memoryGrid.ts:265`); `diffEditorPanel.fileName`
  (`src/diff/diffEditorPanel.ts:266`) duplicates `compareSelection.selectionName`
  (`src/diff/compareSelection.ts:10`).
- S9 — duplicated row/cell construction: `toHexRow`/`buildCells`/`dataCell`
  (`src/webview/diff/diffGrid.ts:485-512`) re-derive the hex cell model that
  `memoryGrid.buildRowCells`/`dataCell` (`src/webview/memory/memoryGrid.ts:299-324`) also builds.
- S5 — `isDiffInit` (`src/webview/diff/diffMessages.ts:21-28`) checks only presence
  (`!!value.a && !!value.b && !!value.diff`), then cast-hydrates; malformed `diffInit` throws in
  `hydrateDiffSide` instead of being rejected by `dispatchDiffMessage`.
- S6 — `hydrateDiffSide` (`src/webview/diff/diffModel.ts:26-38`) fabricates `records: []` in a
  `SerializedParseResult`; no diff code reads it. `getByteAt`/`buildSegmentIndex`
  (`src/core/memory.ts:11,45`) only consume `segments`.
- C1 — search selection never sets `selectionPane`: `applySelectionOption`
  (`src/webview/diff/diffGrid.ts:342-344`) sets `selection` only; `copySelectionText` uses
  `sideForPane(selectionPane)` (`:199`) and `mappedBytes` skips unmapped addresses (`:207-214`). A hit
  mapped only in B (an `added` range, R4) selects both panes but `Ctrl+C` copies A's bytes or nothing.
- C2 — `runCompare` calls `onSuccess?.()` before `await deps.open` (`src/extension.ts:195-196`),
  contradicting its own doc (`:186`); `compareToStaged` passes `() => compareSelection.clear()`, so a
  throw from `DiffEditorPanel.open` clears the stash even though nothing opened.
- C4 — `scrollToDiff` bails when the match row is not in `visibleRows`
  (`src/webview/diff/diffGrid.ts:334-340`); in `Show diff` mode matches on identical/gap rows
  (filtered at `:153-156`) return `-1`, so `scrollToActive` neither scrolls nor selects, failing AC34.
- C5 — one shared `vscroll` state + one render slice: `drawSlice` (`:321-332`) writes both panes from a
  single `currentSlice()` window and a single `windowTop` derived from pane A's scroll container
  (`scrollContainerA`, `:589-591`). `syncFrom` (`:397-407`) sets the shared `vscroll.scrollTop` from
  whichever pane scrolled but mirrors the follower's physical `scrollTop` only when `syncScroll` is on
  (`:403`). With sync off, scrolling B re-renders both panes for B's window while A's physical
  `scrollTop` stays put → A shows spacer/empty space (blank/black). Existing test
  (`src/test/webview/diffViewer.test.ts:328-341`) asserts only `scrollTop`, never follower content.

## Requirements

- R1 — Remove the S3 clone groups so `fallow` reports zero clone groups: one implementation of the
  match-span set builder and one of the file-name helper, shared by both call sites.
- R2 — Remove the S9 duplication: one shared hex row/cell builder used by `memoryGrid` and
  `diffGrid`, preserving memory-only decorations (dirty/integrity/edit-placeholder) and diff-only
  classes.
- R3 — Tighten the `diffInit` boundary: a malformed `diffInit` is rejected by `dispatchDiffMessage`
  (returns `false`, runs no handler, throws nothing); validate both `DiffSide` shapes structurally and
  a `DiffModel` shape, mirroring the `diffProgress` stage/count validation style. Add a test.
- R4 — Remove the fabricated `records: []` (S6): narrow the diff side's parse type and widen the
  `core/memory.ts` helpers to the structural `{ segments }` source so no placeholder is needed. No
  behavior change.
- R5 — Search-driven selection must set `selectionPane` to a pane that maps the match address, so
  `Ctrl+C` copies bytes (C1). Test covers a match mapped only in B.
- R6 — The staged 1st file clears only after a successful `DiffEditorPanel.open`; a failed open keeps
  the stash (C2, archived A2). Test the open-failure path.
- R7 — `scrollToDiff` applies the mirrored selection and a mapping `selectionPane` even when the match
  row is hidden in `Show diff` mode; scrolling is skipped predictably for a hidden row (C4). Test.
- R8 — `Sync scroll` off renders each pane at its own scroll position (C5): both panes stay populated;
  `Sync scroll` on still mirrors. Test asserts follower content, not just `scrollTop`.
- R9 — Keep `npm run check-types`, `npm run lint`, `npm test` green and `fallow audit` clone-clean.

## Acceptance Criteria

- [ ] AC1 — `npx -y fallow audit --base origin/main --gate all` reports zero clone groups;
  `matchSetWithSpans`/`addMatchSpan` and `fileName`/`selectionName` each resolve to one implementation
  (R1, S3).
- [ ] AC2 — One shared hex row/cell builder backs both grids; memory decorations and diff classes are
  unchanged (R2, S9); memoryGrid and diffGrid tests stay green.
- [ ] AC3 — A malformed `diffInit` returns `false` from `dispatchDiffMessage` with no throw and no
  handler call, with a test (R3, S5).
- [ ] AC4 — `hydrateDiffSide` no longer fabricates `records`; `getSideByte`/`buildSegmentIndex` still
  resolve bytes; type-checks pass (R4, S6).
- [ ] AC5 — `Ctrl+C` after a search jump copies a pane's bytes for the match address; test covers a
  match mapped only in B (R5, C1).
- [ ] AC6 — A failed `DiffEditorPanel.open` keeps the staged 1st file; a successful open clears it;
  test covers the failure path (R6, C2).
- [ ] AC7 — In `Show diff` mode, a match on a hidden row sets the mirrored selection with a mapping
  `selectionPane` and skips scrolling predictably (R7, C4).
- [ ] AC8 — With `Sync scroll` off, scrolling one pane leaves the other populated with its own rows;
  a test asserts follower content (R8, C5).
- [ ] AC9 — `npm run check-types`, `npm run lint`, `npm test` all pass (R9).

## Out of Scope

- Documentation/spec reconciliation and B1–B4 decision records — `hex-diff-spec-doc-reconcile`.
- R7 per-side label context — `hex-diff-r7-label-context`.
- R24's active-pane flicker contract beyond what C5's per-pane render fixes.

## Dependencies

- None to start. Files this child owns: `src/webview/diff/diffGrid.ts`, `diffModel.ts`,
  `diffMessages.ts`, `diffSearch.ts`, `src/webview/memory/memoryGrid.ts`, `src/diff/compareSelection.ts`,
  `src/diff/diffEditorPanel.ts`, `src/extension.ts`, `src/core/memory.ts`, plus tests.
- The sibling `hex-diff-r7-label-context` must land **after** this child's `diffGrid.ts`/`diffModel.ts`/
  `diffEditorPanel.ts` changes (shared modules; avoid concurrent edits).
- No `design.md`/`implement.md` behavior is re-opened by a later child without re-review.

## Notes

- Findings covered: S3, S5, S6, S9, C1, C2, C4, C5. Complex child — see `design.md` and `implement.md`.
