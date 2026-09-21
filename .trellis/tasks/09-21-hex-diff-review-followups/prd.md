# Hex Diff View — code review follow-ups

## Goal

Fix the Standards and Spec findings from the two-axis review of the `feat/hex-diff` branch
(`git diff main...HEAD`, merge-base `14cd949`, PR #247). This is a backlog: implementation is
deferred until the task is started.

## Background

- Review baseline: `git diff main...HEAD` — 55 files, +4779/−93, 12 commits.
- Standards axis sources: `.trellis/spec/frontend/**` + `AGENTS.md` + `.trellis/workflow.md`,
  plus the Fowler smell baseline.
- Spec axis source: the archived originating task
  `.trellis/tasks/archive/2026-09/09-21-hex-diff/{prd,design}.md` (R1–R32, AC1–AC34).
- The two axes are intentionally reported separately; do not rerank across them.

## Findings — Standards axis

### Hard violations (documented-standard breaches)

- **S1 — `directory-structure.md` Module Ownership tree is stale (L15–52).** The canonical tree
  was not extended for any new runtime owner on this branch: `src/diff/`
  (`compareSelection.ts`, `diffEditorPanel.ts`, `diffParseWorker.ts`, `loadProgress.ts`),
  `src/webview/diff/` (`diffViewer.ts`, `diffModel.ts`, `diffGrid.ts`, `diffSummary.ts`,
  `diffSearch.ts`, `diffMessages.ts`, `diff.css`), `src/core/{diff,diffLabels,wire}.ts`,
  `src/diffProtocol.ts`, `src/webview/search/searchNavigation.ts`. `src/webview/` still lists
  only `memory/ search/ render/ components/`. Citing rule: `index.md` L66.
- **S2 — `directory-structure.md` L58 vs a second protocol union.** L58 says cross-runtime
  messages live only in `src/webviewProtocol.ts`; `src/diffProtocol.ts` now declares its own
  host⇄webview union with its own `diffMessageType`/`diffCopyText` parsers. `editor-lifecycle.md`
  L141 carves it out, so the two specs conflict and only one side was updated — two
  authoritative message-union owners.
- **S3 — `quality-guidelines.md` L20 clone groups.** L20 requires zero clone groups. Confirmed
  duplicate bodies:
  - `diffGrid.matchSetWithSpans` (`src/webview/diff/diffGrid.ts:263`) duplicates
    `memoryGrid.addMatchSpan` (`src/webview/memory/memoryGrid.ts:265`).
  - `diffEditorPanel.fileName` (`src/diff/diffEditorPanel.ts:266`) duplicates
    `compareSelection.selectionName` (`src/diff/compareSelection.ts:10`).

### Judgement calls / baseline smells

- **S4 — Stale docstring.** `src/diff/loadProgress.ts:4` says "read fills the first half, parse
  the second", contradicting `READ_SHARE = 0.05` (`src/diff/diffEditorPanel.ts:17`) and
  `editor-lifecycle.md` L155 ("read fills a small leading slice `0 → 0.05`"). Same defect the
  Spec axis logged as C3.
- **S5 — Shallow boundary validation.** `isDiffInit` (`src/webview/diff/diffMessages.ts:21`)
  only checks presence (`!!value.a && !!value.b && !!value.diff`) then cast-hydrates
  `hydrateDiffSide(message.a)`. `diffProgress` gets a real stage/count check (`hasProgressCounts`,
  `DIFF_PROGRESS_STAGES`) but `diffInit` does not. `type-safety.md` "Boundary Pattern" requires
  normalize-once from `unknown`; a malformed `diffInit` reaches hydration and throws instead of
  being rejected by the dispatcher.
- **S6 — Fabricated field in a typed shape.** `hydrateDiffSide`
  (`src/webview/diff/diffModel.ts:26`) builds a `SerializedParseResult` with `records: []` that no
  diff code reads. A typed contract is populated with a placeholder to satisfy the shape.
- **S7 — Hardcoded color in CSS.** `src/webview/diff/diff.css:2`
  `--diff-split-bg: var(--vscode-editorIndentGuide-activeBackground, #7a7a7a);` bakes a literal
  fallback. `css-guidelines.md` L35: "Never hardcode colors, fonts, or sizes that have a token."
  The diff-change tints (`diff.css:50–52`, `rgba(...)`) are likewise raw (semantically new, so
  arguably unavoidable, but the split's literal fallback has an existing-theme equivalent).
- **S8 — Font-size floor exception.** `.diff-action` / `.diff-action-glyph` are 14px
  (`diff.css:26,28`) vs `css-guidelines.md` L101's 10px type floor. Glyphs are icon-sized and
  `component-diff-view.md` L96 documents the glyph span, so defensible — but the text span is
  10px while the icon is 14px, an unstated exception.
- **S9 — Duplicated row/cell construction.** `toHexRow` / `buildCells` / `dataCell`
  (`src/webview/diff/diffGrid.ts:485–512`) re-derive the hex row/cell model (`byteClass`,
  `cp`/`cd`, printable test) that `memoryGrid` also builds. Could be one shared builder.
- **S10 — `.diff-summary { font-size: 11px }`** (`diff.css:10`) with `.diff-count` badges
  inheriting it — above the documented 10px metadata floor; judgement call.

## Findings — Spec axis

### (a) Spec'd requirements missing or partial

- **A1 — R7 segment-label context is not implemented (missing).** `prd.md:99`. `diffSide()`
  hardcodes `labels: []` (`src/diff/diffEditorPanel.ts:253`); `DiffSide.labels` is carried on the
  wire and copied by `hydrateDiffSide` (`src/webview/diff/diffModel.ts:45`) but nothing renders
  it; `.seg-banner` exists only in the single-file renderer
  (`src/webview/components/hexView/hexViewRender.ts:124`). No AC covers R7, so it escaped
  verification. (Note: `src/core/diffLabels.ts` is *file-name* disambiguation for R16, not the R7
  *segment* labels.)
- **A2 — R21 clearing semantics partial.** `prd.md:113`. Window-reload clearing and
  replace-on-set hold; "clears after a successful compare" does not (see C2).
- **A3 — R30 wording over-claims (minor).** `prd.md:122`. Parsing runs in parallel
  `worker_threads`, but reads stay on the extension host and are only concurrent
  (`Promise.all`; `src/diff/diffEditorPanel.ts:144,152-154`). Matches `design.md:358`; only R30's
  wording over-reaches. Not user-visible.

### (b) Behaviour not asked for (scope creep)

No material creep — nothing from the spec's Out of Scope list. Micro extras only:

- **B1** — Tab-title `↔` separator (`src/diff/diffEditorPanel.ts:257-260`); no requirement names a
  title separator.
- **B2** — Aggregate-mode `"No data records found."` (`src/webview/diff/diffGrid.ts:311-313`);
  R12 only requires `"No differences"` for an identical pair under `Show diff`.
- **B3** — Runtime message guards (`src/webview/diff/diffMessages.ts`); design only declared
  typed unions. Defensive extra.
- **B4** — Dead R7 seam: `DiffSide.labels` + `hydrateDiffSide` label copy (A1) ships unused.

### (c) Spec'd but implemented wrong

- **C1 — Search active-match copy reads the wrong pane.** R32 / AC34 (`prd.md:124,161`): "the
  active match is the mirrored selection (so `Ctrl+C` copies it)". `scrollToActive()` →
  `scrollToDiff({ start, end }, { selection: true })` (`src/webview/diff/diffSearch.ts:179-182`);
  `applySelectionOption` sets only `selection`, never `selectionPane`
  (`src/webview/diff/diffGrid.ts:342-344`) — `selectionPane` keeps the last-clicked/default
  `'a'` (`:57`). `copySelectionText()` uses `sideForPane(selectionPane)` (`:197-200`) and
  `mappedBytes()` skips unmapped addresses (`:207-220`). A hit mapped only in B (an `added` range,
  R4) is selected on both panes but `Ctrl+C` copies A's bytes or nothing. Search-driven selection
  must set `selectionPane` to a pane that maps the match.
- **C2 — The staged compare file is cleared before the compare succeeds.** R21 (`prd.md:113`) /
  `design.md:229`. `runCompare` calls `onSuccess?.()` (`src/extension.ts:195`) before
  `await deps.open` (`:196`), though its own doc says it runs only on a successful open (`:186`).
  `compareToStaged` passes `() => compareSelection.clear()`; a throw from `DiffEditorPanel.open`
  clears the stash even though nothing opened. The extension test covers validation failure only
  (`src/test/extension/extension.test.ts:229-256`), not open failure.
- **C3 — Stale progress contract comment.** `src/diff/loadProgress.ts:1-6` still documents the
  superseded half/half split; R30 + round 8 (`design.md:374-378`) ship `READ_SHARE = 0.05`.
  Behaviour is right; the comment is wrong. Duplicate of S4.
- **C4 — Search navigation silently no-ops inside hidden rows in `Show diff` mode.**
  AC34 (`prd.md:161`) + R12 (`prd.md:104`). `scrollToDiff` bails when the match row is not in the
  filtered set (`src/webview/diff/diffGrid.ts:334-340`); in `Show diff` mode matches on identical
  rows (filtered by `:153-156`) return `-1`, so `scrollToActive` does nothing — no scroll and no
  mirrored selection, failing AC34's "selected on both panes" for that hit. The two-pane union
  search can legitimately find identical bytes, so this is reachable.

## Requirements

- R1 — Resolve each Standards finding S1–S10: update the stale spec (S1, S2), remove the
  duplicated bodies (S3, S9), correct the docstrings/comments (S4/C3), tighten the `diffInit`
  boundary validation (S5), remove or justify the fabricated `records: []` (S6), and fix or
  explicitly waive the CSS/type-floor items with a recorded reason (S7, S8, S10).
- R2 — Resolve each Spec finding: implement or explicitly defer R7 segment-label context (A1),
  fix the premature stash clear so it clears only after a successful open (C2), and fix the
  search-driven selection pane so `Ctrl+C` copies the match's bytes (C1).
- R3 — Make search navigation behave under `Show diff`: a match on a hidden (identical/gap) row
  either reveals/scrolls to it or is skipped predictably, and the active match is selected on both
  panes (C4).
- R4 — Reconcile R30's wording with the shipped read-on-host / parse-in-worker split (A3), and
  either keep or remove the micro scope-creep items with a recorded decision (B1–B4).
- R5 — Each Standards hard violation (S1–S3) must clear the `fallow` gate
  (`npx -y fallow audit --base origin/main --gate all`) with zero clone groups, and the branch
  must keep `npm run check-types`, `npm run lint`, `npm test` green.

## Acceptance Criteria

- [ ] AC1 — `directory-structure.md` lists every new runtime owner from this branch in the
  Module Ownership tree, and no spec still claims `src/webviewProtocol.ts` is the only
  cross-runtime union without noting the `src/diffProtocol.ts` carve-out (S1, S2).
- [ ] AC2 — `fallow audit` reports zero clone groups; `matchSetWithSpans`/`addMatchSpan` and
  `fileName`/`selectionName` share one implementation each (S3, S9).
- [ ] AC3 — `loadProgress.ts` documents the actual `0 → 0.05` read split; no requirement-bearing
  comment describes the superseded half/half split (S4, C3).
- [ ] AC4 — A malformed `diffInit` is rejected by the dispatcher (returns false, no throw), with
  a test; `hydrateDiffSide` no longer fabricates unread `records` (S5, S6).
- [ ] AC5 — Every CSS/type-floor finding (S7, S8, S10) is either fixed against a token/document or
  waived with a written reason in the spec (S7, S8, S10).
- [ ] AC6 — `Ctrl+C` after a search jumps to a match copies the bytes of a pane that maps the
  match address (test covers a match mapped only in B) (C1).
- [ ] AC7 — The staged 1st file survives a failed `DiffEditorPanel.open` and clears only after a
  successful open, with a test for the open-failure path (C2, A2).
- [ ] AC8 — In `Show diff` mode, navigating to a match on a hidden row scrolls and selects it (or
  skips it) predictably, and the active match is selected on both panes (C4).
- [ ] AC9 — R7 segment-label context is implemented or explicitly deferred in the spec with the
  missing-AC gap recorded; R30's wording matches the read-host/parse-worker split (A1, A3).
- [ ] AC10 — Micro scope-creep items B1–B4 are each kept-with-justification or removed with a
  recorded decision.
- [ ] AC11 — `npm run check-types`, `npm run lint`, `npm test` all pass.

## Out of Scope

- Any change to released behavior or versioning.
- New diff features beyond the review findings above.

## Notes

- Findings map 1:1 to the two review reports; keep the Standards and Spec axes separate when
  fixing (a fix can satisfy one axis and regress the other).
- Lightweight tasks can remain PRD-only. For complex tasks, add `design.md` and `implement.md`
  before `task.py start`.
