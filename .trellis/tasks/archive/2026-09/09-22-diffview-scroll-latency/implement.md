# Implementation Plan — DiffView scroll sync latency

Status: planning. Do not start until the review gate passes (`task.py start`).

## Preconditions

- Read `prd.md` + `design.md`.
- Read specs in `implement.jsonl` (component-diff-view is the owning spec).
- Confirm `npx tsc --noEmit -p .` and `npm test` are green on the starting commit
  (baseline) before editing.

## Ordered checklist

1. **Baseline** — `npx tsc --noEmit -p .`; `npm test`. Record any pre-existing failures.
2. **Test seam** — in `src/test/webview/diffViewer.test.ts`, add a controllable rAF
   controller (capture callbacks, run one frame, restore in `afterEach`) and a
   `runScrollFrame()` helper; extend `flushDiffRender` usage. Keep the existing
   `clearAnimationFrameStubs` path for the coalescing test.
3. **Part A — poll loop** (`diffGrid.ts`):
   - Add poll state + `startScrollPoll`, `pollFrame`, `stopScrollPoll`,
     `finalizeFollower`.
   - `applyDriverScroll`: start the poll; keep `scheduleRender()` but guard it with
     `if (scrollPollHandle !== null) return;`.
   - `resetDiffGrid`, `setDiffData`, `setSyncScroll(false)`, `flushDiffRender`:
     stop the poll and clear transforms.
   - Tests: poll starts on a driver scroll event; changing `scrollTop` with **no**
     further scroll event updates the follower on the next frame; unchanged for 2
     frames stops the loop (no pending frame / handle null); sync-off does not poll.
4. **Part B — follower transform + reconcile** (`diffGrid.ts`):
   - Split `mirrorToFollower` into horizontal mirror (`mirrorFollowerLeft`) and the
     vertical `applyFollowerVisual` / `reconcileFollower` pair.
   - Wire `renderScrollSlice`: key changed → `reconcileFollower` then `drawSlice`;
     key unchanged → `repositionPane(a)` + `applyFollowerVisual(b)`.
   - `finalizeFollower` on settle + `setSyncScroll(true)` / resets.
   - Tests: sub-row delta frame applies `translateY(-delta)` and leaves follower
     `scrollTop` untouched; slice-change frame writes real `scrollTop`, redraws, and
     clears transform; settle clears transform + reconciles real `scrollTop`;
     multi-gesture drift check (transform empty, `scrollTop === driver.scrollTop`);
     one-shot `scrollToDiff` still writes real `scrollTop` with no leftover delta.
5. **Part B — `repositionPane` write guard** (`diffGrid.ts`): memoize last written
   `top` per pane, skip the DOM write when unchanged. Extend the compressed-frame
   test to assert the wrapper `top` tracks `scrollTop` and the no-op frame does not
   rewrite it.
6. **Update existing tests** that assert the old follower-`scrollTop`-per-event
   contract (`vertical and horizontal scroll stay synced`): assert real `scrollTop`
   after `flushDiffRender`/settle and assert the transform during an active frame.
7. **Full gate** — `npx tsc --noEmit -p .`; `npm run lint`; `npm test`; then
   `npx -y fallow --format json --quiet --explain` and
   `npx -y fallow audit --base origin/main --gate all --format json --quiet --explain`
   (fix findings via the `/fallow-fix` skill).
8. **Manual verification** (webview, cannot be automated): open a large diff pair,
   sync on, fast trackpad/wheel scroll → follower tracks without perceptible lag;
   stop scrolling → follower settles exactly on the driver position; toggle sync off
   → panes independent; long multi-gesture scroll → no drift; resize while scrolled.
9. **Spec update** — `component-diff-view.md` "Scroll stability" + "Scroll sync"
   bullets: document the rAF poll, the transform-tracking/reconcile split, the
   settle-invariant, and the intentional change to the follower vertical mirror
   contract. Update the Tests Required list. Update the Validation & Error Matrix
   scroll rows if wording changes.
10. **Finish** — `task.py finish` after the spec is updated; do not commit `dist/`.

## Validation commands

```
npx tsc --noEmit -p .
npm run lint
npm test
npx -y fallow --format json --quiet --explain
npx -y fallow audit --base origin/main --gate all --format json --quiet --explain
```

`npm test` runs `compile-tests` + `compile` + `lint` via `pretest`; the vscode-test
suite needs a display — if it cannot launch here, run the mocha/jsdom webview +
core suites and record that the vscode-test portion was not run.

## Review gates

- **Gate 1 (this planning gate)**: user approves `prd.md` + `design.md` +
  `implement.md` + jsonl manifests before `task.py start`.
- **Gate 2 (after step 4)**: review the transform/reconcile split before touching
  `repositionPane` — if the transform approach reads as risky, fall back to the
  documented per-frame `setScrollTop` reconcile branch (keep A).
- **Gate 3 (pre-commit)**: full gate green + spec update + manual webview check.

## Rollback points

- After step 3 (A only): a complete, shippable latency improvement; revert step 4+ to
  stop here.
- After step 4: revert the `applyFollowerVisual` call site to a real
  `setScrollTop` on the reconcile path in `renderScrollSlice` — local change, no
  other module affected.
- `git diff` is confined to `src/webview/diff/diffGrid.ts`,
  `src/test/webview/diffViewer.test.ts`, and `component-diff-view.md`.
