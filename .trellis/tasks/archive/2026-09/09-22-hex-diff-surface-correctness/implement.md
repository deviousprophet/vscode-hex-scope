# Implement — Hex diff surface correctness fixes

Ordered checklist. One commit per numbered group; each group must leave `npm run check-types`,
`npm run lint`, `npm test` green. Rollback point = the group's commit.

## 0. Baseline

- [ ] `npm run check-types`; `npm run lint`; `npm test`.
- [ ] `npx -y fallow audit --base origin/main --gate all` — record the current clone groups (S3/S9).

## 1. S3 — clone groups

- [ ] Add `src/webview/render/matchSpans.ts` (`addMatchSpan`); use it in
  `memoryGrid.buildVisibleMatchSet` and `diffGrid.matchSetWithSpans`; delete both local bodies.
- [ ] Add `src/core/pathName.ts` (`fileName`); alias `compareSelection.selectionName`;
  import in `diffEditorPanel`, delete local `fileName` (`:266`) and fix `labelInput`.
- [ ] Verify: `fallow audit` no longer reports those two groups; `diffViewer`/`memory`/`extension`
  tests green.

## 2. S9 — shared row/cell builder

- [ ] Add `src/webview/render/hexCells.ts` (`buildHexCells`, shared `EMPTY_CELL`).
- [ ] Refactor `memoryGrid.buildRowCells`/`dataCell` and `diffGrid.buildCells`/`dataCell` onto it,
  preserving dirty/integrity/edit-placeholder + diff classes.
- [ ] Add/keep parity assertions (cell text/classes/empty cell) before deleting the local builders.
- [ ] Verify: `fallow` clone gate clean; memory + diff render tests green.

## 3. S5 — `diffInit` validation

- [ ] Add `isDiffSide`/`isDiffModel`; rewrite `isDiffInit` (`src/webview/diff/diffMessages.ts`).
- [ ] Test: malformed `diffInit` → `dispatchDiffMessage` returns `false`, no throw, no handler.

## 4. S6 — drop fabricated `records`

- [ ] Add `SegmentSource`; widen `buildSegmentIndex`/`getByteAt` (`src/core/memory.ts`).
- [ ] `DiffSideData.parseResult` → `Omit<SerializedParseResult,'records'>`; build it without `records`
  in `hydrateDiffSide` (`src/webview/diff/diffModel.ts`).
- [ ] Verify: `getSideByte` resolves; type-check + render tests green.

## 5. C1 — search selection pane

- [ ] Add `paneForAddress`; set `selectionPane` in `applySelectionOption` (`diffGrid.ts`).
- [ ] Test: match mapped only in B → `copySelectionText` returns B's bytes.

## 6. C2 — stash clear on success only

- [ ] Move `onSuccess?.()` after `await deps.open(...)` in `runCompare` (`src/extension.ts`).
- [ ] Test: open throws → stash survives; open resolves → stash cleared.

## 7. C4 — `Show diff` navigation

- [ ] Reorder `scrollToDiff`: apply selection + pane first; scroll only when `rowIndex >= 0`.
- [ ] Test: match on a hidden row in `Show diff` selects on both panes, no scroll.

## 8. C5 — independent scroll

- [ ] Split `vscroll` into per-pane states + `scrollContainerA/B`; `currentSlice(pane)`; per-pane
  `drawSlice`; `sliceKey` covers both panes.
- [ ] `syncFrom` updates the driver; mirror follower only when sync on; `setSyncScroll(true)` re-aligns.
- [ ] `scrollToRow` sets one pane when off, both when on.
- [ ] Test: sync off + scroll A → B still renders B's rows (assert content); sync on still mirrors.

## 9. Final check

- [ ] `python ./.trellis/scripts/task.py` current is this child; run `trellis-check`.
- [ ] `npm run check-types`; `npm run lint`; `npm test`;
  `npx -y fallow audit --base origin/main --gate all`.
- [ ] Confirm every acceptance criterion AC1–AC9 and cite finding IDs in the commit message.

## Risky files / rollback

- `src/webview/diff/diffGrid.ts` (C5 render refactor) — highest risk; isolated in group 8.
- `src/webview/render/hexCells.ts` extraction (S9) — parity-test before deleting local builders.
- `src/core/memory.ts` signature widening (S6) — structural type, no runtime change.

## Follow-up checks before start

- Confirm `hex-diff-r7-label-context` has not started (shared `diffGrid.ts`/`diffModel.ts`/
  `diffEditorPanel.ts`); it depends on this child landing first.
- Curate `implement.jsonl` / `check.jsonl` (see the task's manifests) before dispatch.
