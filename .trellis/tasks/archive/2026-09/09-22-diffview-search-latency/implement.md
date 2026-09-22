# Implementation Plan — DiffView search latency

Status: planning. Do not start until the review gate passes (`task.py start`).

## Preconditions

- Read `prd.md` + `design.md`.
- Read specs in `implement.jsonl` (`component-diff-view`, `component-hex-view`,
  `component-guidelines`, `quality-guidelines`).
- Baseline must be the committed tree at `8c7d9bf` (DiffView extraction + show-diff
  separator) with a clean tracked working tree. Re-read `diffGrid.setSearchMatches`,
  `diffSearch` and `components/diffView/diffView.ts` before editing — the extraction
  landed after `design.md` was written, so confirm the call sites still match.
- Record `npx tsc --noEmit -p .`, `npm run lint`, `npm test` green and the
  `diffViewer.test.ts` pass count on the baseline.

## Ordered checklist

1. **Baseline** — run the three gates; record test counts.
2. **`DiffView.paintMatch`** (`components/diffView/diffView.ts`) — add
   `paintMatch(matchAddrs, index, length)` delegating to both panes'
   `HexView.paintMatch`. Test in `src/test/webview/components/diffView.test.ts`:
   both panes paint `.match`/`.amatch` for visible cells; `null`/empty clears.
3. **Incremental streamed paint** (`diff/diffGrid.ts`) — `setSearchMatches` keeps
   updating `matchSet`/`activeMatch` (needed by the next redraw) but replaces
   `renderDiffGrid()` with `diffView.paintMatch(...)`. No row rebuild per batch.
   Tests (`diffViewer.test.ts`): a `setSearchMatches` batch writes **zero** rows
   `innerHTML` (probe) yet paints match classes on both panes; a subsequent scroll /
   `setViewMode` redraw still paints matches from the declarative `matchSet`.
4. **Single-render jump** (`diff/diffSearch.ts`) — keep one `setSearchMatches` per
   action (`onProgress` first-jump, `onComplete`, `stepMatch`/`applyMatches`) then
   `scrollToActive()`; remove any now-redundant full repaint step so a jump is
   exactly one render, at the destination. Tests: `stepMatch`/`onComplete` issue one
   `setSearchMatches` and one jump; the destination rows carry the active match and
   selection; highlights are correct after the jump.
5. **Programmatic-scroll guard** (`diff/diffGrid.ts`) — a one-shot
   `suppressNextDriverScroll` keyed on `(pane, scrollTop)`, set by `scrollPaneToRow`
   (per pane), `restoreAnchor`, `alignFollowerToDriver`, consumed by
   `applyDriverScroll` (skip `startScrollPoll`/`scheduleRender` for that event),
   cleared on mismatch and in `resetDiffGrid`/`setDiffData`/`setSyncScroll`. Test:
   after `scrollToDiff` no extra poll/frame is scheduled; a genuine later user
   scroll still polls (guard is one-shot).
6. **Full gate** — `npx tsc --noEmit -p .`; `npm run lint`; `npm test`; then
   `npx -y fallow --format json --quiet --explain` and
   `npx -y fallow audit --base origin/main --gate all --format json --quiet --explain`
   (fix via `/fallow-fix`; never suppress). Confirm the `diffViewer.test.ts` count
   matches baseline except for the deliberate new tests.
7. **Manual visual check** (webview, not automatable): run a search over a large
   pair; streamed batches stay responsive; `Next`/`Prev`/Enter lands on the match
   without a visible double-paint; counts and selection correct.
8. **Spec update** — `component-diff-view.md`: the Search rule (streamed batches
   repaint incrementally via `DiffView.paintMatch`, not a full redraw) and the
   scroll/programmatic-jump note; its Tests Required list; the Validation & Error
   Matrix rows for streamed search and search jump. `component-hex-view.md` only if
   its `paintMatch`/diff-reuse note changes.
9. **Finish** — `task.py finish`; leave the commit decision to the user.

## Validation commands

```
npx tsc --noEmit -p .
npm run lint
npm test
npx -y fallow --format json --quiet --explain
npx -y fallow audit --base origin/main --gate all --format json --quiet --explain
```

If the vscode-test host cannot launch, run the jsdom/mocha suites for
`out/test/webview/diffViewer.test.js` and `out/test/webview/components/diffView.test.js`
and state that the vscode-test portion was not run.

## Review gates

- **Gate 1 (this planning gate)**: approve `prd.md` + `design.md` + `implement.md`
  + jsonl manifests before `task.py start`.
- **Gate 2 (after step 3)**: confirm the incremental-paint change keeps redraw
  correctness before the jump/guard work (steps 4–5).
- **Gate 3 (pre-commit)**: full gate green + spec update + manual webview check.

## Rollback points

- After step 3: revert `setSearchMatches` to `renderDiffGrid()`; `DiffView.paintMatch`
  is additive and can stay unused.
- After steps 4–5: revert the `diffSearch` call order and the guard independently;
  each is local to one module.
- `git diff` should touch: `src/webview/components/diffView/diffView.ts`,
  `src/webview/diff/diffGrid.ts`, `src/webview/diff/diffSearch.ts`,
  `src/test/webview/components/diffView.test.ts`,
  `src/test/webview/diffViewer.test.ts`,
  `.trellis/spec/frontend/components/component-diff-view.md`.
