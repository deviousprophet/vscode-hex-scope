# Hex diff R7 per-side label context

Parent: `09-21-hex-diff-review-followups`. Deliverable: implement archived R7 — render each file's
existing segment labels as read-only context on its own pane in the diff grid (Phase B). Resolves
finding A1 and makes the `DiffSide.labels` seam (B4) live.

## Goal

Close the R7 requirement gap: the diff view shows A's labels on A and B's labels on B, read-only, using
the existing `.seg-banner` row mechanism. No label editing, no `saveLabels` in the diff editor.

## Confirmed facts

- Archived R7 (`archive/2026-09/09-21-hex-diff/prd.md:99`) and `design.md:107-109`: "`diffInit` already
  carries `labelsA`/`labelsB`. Phase B renders them as read-only `.seg-banner` context per side."
- The wire already carries it: `DiffSide.labels` (`src/diffProtocol.ts:10`); `hydrateDiffSide` copies
  it (`src/webview/diff/diffModel.ts:45`).
- The host never fills it: `diffSide()` hardcodes `labels: []` (`src/diff/diffEditorPanel.ts:253`).
- Nothing renders it: `diffGrid.toHexRow` (`:485-490`) never sets `row.banners`; the `.seg-banner`
  mechanism exists and works (`src/webview/components/hexView/hexViewRender.ts:109,123-128`,
  `hexView.css:177-185`), and `memoryGrid` already builds banners from labels
  (`src/webview/memory/memoryGrid.ts:290-295,339-344`).
- Per-file labels in the single-file editor come from the file's bound **profile** (relPath binding):
  `boundProfileId(root, relPath)` (`src/hexEditorSession.ts:1338`) + `collectProfileRecords(root)`
  (`src/hexScopeStorage.ts:209`).
- Product decision D1 (parent PRD): implement R7; D3: keep B4 (now live).

## Requirements

- R1 — Host sources each side's labels from the file's bound profile and sets `DiffSide.labels`
  instead of `[]`. A file with no bound profile → `[]`. A label-load failure must never fail the
  compare (defensive; return `[]`).
- R2 — Webview renders each pane's labels as read-only `.seg-banner` rows at the label's start row,
  on that pane only: A's labels on A, B's labels on B. Hidden labels (`label.hidden`) are omitted
  (parity with `memoryGrid.buildLabelMap`).
- R3 — No label editing, form, draft preview, or `saveLabels` is added to the diff surface; banners
  are presentational only.
- R4 — `Swap sides` moves each file's banners with its pane (labels travel on `data.a`/`data.b`).
- R5 — Reuse the existing banner render path; do not fork `.seg-banner`.
- R6 — Keep `npm run check-types`, `npm run lint`, `npm test` green and the `fallow` clone gate clean.

## Acceptance Criteria

- [ ] AC1 — A file whose bound profile has labels shows those labels as `.seg-banner` rows on its own
  pane at the label's start row; the other pane shows only its own labels (or none) (R1, R2).
- [ ] AC2 — A label with `hidden: true` is not rendered (R2).
- [ ] AC3 — A file with no bound profile, and a label-resolution failure, both yield no banners and do
  not fail or block the compare (R1).
- [ ] AC4 — The diff editor exposes no label editing/save affordance; no `saveLabels` message is sent
  (R3).
- [ ] AC5 — After `Swap sides`, each file's banners render on its new pane (R4).
- [ ] AC6 — Tests cover: host label sourcing (bound profile / no profile / failure) and webview banner
  rendering per side (R1, R2); `npm run check-types`, `npm run lint`, `npm test` pass (R6).

## Out of Scope

- Label creation/editing, the inspector label form, draft previews, `saveLabels`.
- Segment-label context in any surface other than the diff grid's two panes.
- The R7 segment-label *vs* `diffLabels` file-name disambiguation distinction (R16 is separate and
  already shipped).

## Dependencies

- **Blocked by `hex-diff-surface-correctness`.** Shared modules `src/webview/diff/diffGrid.ts`,
  `src/webview/diff/diffModel.ts`, and `src/diff/diffEditorPanel.ts` are refactored there (S3/S9
  builders, S6 `DiffSideData.parseResult` narrowing, C5 per-pane render). Implement R7 only after that
  child is merged and its review passed, to avoid concurrent edits to those files.
- Reuse whatever shared row/cell or label-map seam the sibling child introduced (`S9`) rather than
  duplicating it.

## Notes

- Complex child — see `design.md` and `implement.md`.
