# Hex diff spec/doc reconciliation

Parent: `09-21-hex-diff-review-followups`. Deliverable: resolve the documentation/spec-only review
findings of the `feat/hex-diff` two-axis review. No runtime behavior change (source edits are limited
to comments/docstrings and CSS styling values).

## Goal

Make the repo's specs and requirement-bearing comments match what shipped on `feat/hex-diff`, so the
next review does not re-flag stale docs. This child owns the Standards findings whose fix is a doc or
decision-record update, plus the CSS/type-floor findings' fix-or-waive decision.

## Confirmed facts

- `directory-structure.md` Module Ownership tree (L15–52) was not extended for any new runtime owner
  on this branch; L58 still claims `src/webviewProtocol.ts` is the only cross-runtime union, while
  `src/diffProtocol.ts` declares its own.
- `src/diff/loadProgress.ts:1-6` still documents a half/half read/parse split; shipped split is
  `READ_SHARE = 0.05` (`src/diff/diffEditorPanel.ts:17`, `0 → 0.05`).
- `src/webview/diff/diff.css:2` bakes a literal fallback `#7a7a7a`; `.diff-action`/`.diff-action-glyph`
  are 14px, `.diff-action-text` 10px, `.diff-summary` 11px.
- Decisions D1–D3 in the parent PRD resolve the product questions (R7 **dropped**; B1–B4 kept).

## Requirements

- R1 — Update `.trellis/spec/frontend/directory-structure.md`: add every new runtime owner from this
  branch to the Module Ownership tree — `src/diff/` (`compareSelection.ts`, `diffEditorPanel.ts`,
  `diffParseWorker.ts`, `loadProgress.ts`), `src/webview/diff/` (`diffViewer.ts`, `diffModel.ts`,
  `diffGrid.ts`, `diffSummary.ts`, `diffSearch.ts`, `diffMessages.ts`, `diff.css`),
  `src/core/{diff,diffLabels,wire}.ts`, `src/diffProtocol.ts`, `src/webview/search/searchNavigation.ts`
  — and extend the `src/webview/` listing beyond `memory/ search/ render/ components/`. Also add the
  three shared modules extracted by the sibling `hex-diff-surface-correctness` child:
  `src/webview/render/matchSpans.ts`, `src/webview/render/hexCells.ts`, `src/core/pathName.ts`.
- R2 — Reconcile the two specs' protocol-union ownership: `directory-structure.md` L58 must note the
  `src/diffProtocol.ts` carve-out that `editor-lifecycle.md` L141 already records (single authoritative
  statement, no conflict).
- R3 — Correct the `loadProgress.ts` header comment to the actual `0 → 0.05` leading read slice and
  the read-on-host / parse-in-worker split (S4, C3).
- R4 — Reconcile R30's wording with the shipped split: reads stay on the extension host and are only
  concurrent; parsing runs in parallel `worker_threads` (A3). Update the owning spec
  (`editor-lifecycle.md` / `component-diff-view.md`) so no wording over-claims parallel reads.
- R5 — Resolve the CSS/type-floor findings against a token/document or waive with a written reason:
  - S7 — replace the `#7a7a7a` literal fallback in `diff.css:2` with an existing theme token, or waive
    with reason.
  - S8 — record the `.diff-action` 14px glyph vs 10px text type-floor exception (or fix).
  - S10 — record the `.diff-summary` 11px metadata size vs the 10px floor (or fix).
  Record the outcome in `css-guidelines.md` (exception log) and/or `component-diff-view.md`.
- R6 — Record the D3 decision (B1–B4 kept with justification) in `component-diff-view.md`, including
  B1 `↔` tab separator, B2 aggregate `"No data records found."`, B3 runtime message guards (now backed
  by the S5 boundary tightening in the sibling child), B4 `DiffSide.labels` (retained seam; R7 dropped
  per parent D1). Note in the spec that R7 segment-label context is deliberately not implemented on this
  branch.
- R7 — Where this child touches behavior specs affected by the sibling children (C5 independent
  scroll), add only pointers; the behavior contracts are owned by those children.

## Acceptance Criteria

- [ ] AC1 — `directory-structure.md` lists every new runtime owner from R1 and no spec still claims
  `src/webviewProtocol.ts` is the only cross-runtime union without the `src/diffProtocol.ts` carve-out
  (S1, S2).
- [ ] AC2 — `src/diff/loadProgress.ts` documents the actual `0 → 0.05` read split; no
  requirement-bearing comment describes the superseded half/half split (S4, C3).
- [ ] AC3 — No spec wording claims reads run in parallel workers; R30's split reads-host /
  parses-workers and matches `design.md` (A3).
- [ ] AC4 — Each of S7, S8, S10 is either fixed against a token/document or waived with a written
  reason (S7, S8, S10).
- [ ] AC5 — D3 (B1–B4 kept, with justification) is recorded in the diff-view spec.
- [ ] AC6 — `npm run check-types`, `npm run lint`, `npm test` pass (no behavior change expected).

## Out of Scope

- Source behavior changes, the C1–C6 code fixes, and the S3/S5/S6/S9 code refactors — owned by the
  sibling children. (R7 label context is dropped from this branch — see parent D1.)
- `.trellis/spec/frontend/**` content beyond the findings above.

## Dependencies

- None. This child may run in parallel with `hex-diff-surface-correctness`.
- Its spec text for C5 (independent scroll) must not describe behavior before that child lands; use
  forward-pointers, or re-verify after it merges.

## Notes

- Findings map to the Standards axis (S1, S2, S4, S7, S8, S10) and the Spec-axis wording items
  (A3, B1–B4) in the parent PRD.
- Lightweight child: `prd.md` only. No `design.md`/`implement.md` required.
