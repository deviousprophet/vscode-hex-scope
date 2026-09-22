# DiffView scroll sync: eliminate follower-pane latency

## Goal

The blank-space/glitch bug (`09-22-diffview-scroll-glitch`) is fixed. Remaining
issue: with `Sync scroll` on, the follower pane visibly trails the driver pane
during active scrolling — a perceptible lag, not a correctness bug. Reduce it
as close to imperceptible as a two-container mirror architecture allows, without
giving up independent per-pane scrolling when sync is off.

## Problem

`syncFrom` mirrors the driver pane onto the follower entirely inside the `scroll`
DOM event handler (`applyDriverScroll` → `mirrorToFollower` →
`paneView(follower)?.setScrollTop(top)`), synchronous with the event. The mirror
call itself is not the lag source — it fires immediately once JS learns the driver
moved. The lag comes from *when* JS learns:

- The driver's `scrollTop` is animated by the browser's compositor during
  native/inertial scrolling, updating every compositor frame independent of the
  main thread.
- The main thread only finds out via a `scroll` DOM event, which browsers
  coalesce/throttle — commonly to about one per animation frame, worse under
  main-thread load.
- The follower `setScrollTop` write and `repositionPane`'s `style.top` write both
  trigger layout on top of the per-frame `innerHTML` rebuild, adding to the
  main-thread work that delays the *next* `scroll` event — a feedback loop that
  widens the gap causing the lag.

## Requirements

### A — Poll the driver's scrollTop every frame instead of waiting on `scroll` events only

While the driver is actively being scrolled, run a `requestAnimationFrame` loop
that reads `driverScroll.container.scrollTop` directly each frame and drives the
mirror from that, instead of relying solely on the `scroll` event to signal a new
position. This decouples follower updates from `scroll` event coalescing.

- Start the loop on the first `scroll` event for a driver pane, keep it running
  while `scrollTop` keeps changing frame-to-frame, and stop it once `scrollTop` is
  unchanged for ~2 consecutive frames (scroll settled) — no background polling.
- Reuse the existing coalesced render work (`renderScrollSlice`); do not duplicate
  the row-HTML/reposition logic in the poll.
- No behavior change when `Sync scroll` is off, or for the non-driver pane.

### B — Move the hot-path visual update off layout-triggering properties

Split "visual tracking" (every frame, cheap) from "virtual-row recalculation"
(throttled, expensive):

- Drive the follower's *visual* position with `transform: translateY()` on the
  rows wrapper (`.mem-rows`) for the delta since the last real recalculation,
  instead of writing `scrollTop` every frame. `transform` is compositor-only.
- Apply the same idea to `repositionPane`'s compressed-mode wrapper positioning on
  the driver side (`style.top` is layout-triggering): fold `top` writes into the
  same rAF-batched reconciliation as A so they are not competing with `innerHTML`
  rebuilds within the same tick.
- Reconcile on the existing coalesced render tick (not every frame): recompute the
  true virtual-scroll slice, write the real `scrollTop` + `top`/spacer values, and
  reset the accumulated transform to zero.
- No visible seam at the reconciliation point — the transform-driven position and
  the reconciled real position must agree at that frame.

## Acceptance Criteria

- [ ] Follower pane tracks driver pane with no perceptible lag during fast
      trackpad/wheel scroll, sync on. (Manual verification in the VS Code webview;
      jsdom cannot judge perception.)
- [ ] rAF polling loop starts only while the driver is actively scrolling and stops
      shortly after it settles — no idle background polling.
- [ ] Row-HTML rebuild frequency is unchanged (still gated by `sliceKey`); only the
      visual-tracking path runs every frame.
- [ ] During active scroll, follower mirroring no longer writes layout-triggering
      styles (`scrollTop`, `top`) on every frame — those writes are reconciled at
      the coalesced/settle rate. (Transform-only frames are asserted in jsdom.)
- [ ] Follower real `scrollTop` and zero `transform` are restored when the scroll
      settles, so one-shot scroll operations (`scrollToDiff`, `setSyncScroll(true)`
      re-align, reload anchor restore) are never double-offset by a leftover delta.
- [ ] `Sync scroll` off: follower unaffected, continues rendering its own position
      independently (no regression to the sync-off behavior noted in the diff-view
      component spec).
- [ ] No compounding drift between transform-driven position and the periodic real
      reconciliation (transform is recomputed from live `scrollTop` every frame, not
      accumulated; verified across an extended multi-gesture scroll session).
- [ ] `npx tsc --noEmit -p .` clean.
- [ ] `npm test` (compile-tests, compile, lint, and the vscode-test suite where
      runnable) clean.

## Notes

- Builds on the buffer-overscan fix (`overscanRowCount`, shared in
  `src/webview/render/virtualScroll.ts`, used by `diffGrid.ts` and `memoryGrid.ts`)
  and the compressed-wrapper reposition fix (`repositionPane`) from
  `09-22-diffview-scroll-glitch` — this task is strictly about *latency*, not the
  earlier blank-space correctness bug, which is already resolved.
- A "single shared scroll container for both panes" design (one native scroll
  position driving both, no mirroring) was considered as a zero-latency
  alternative and rejected for this task: it would remove the independent per-pane
  scroll position that `Sync scroll` off relies on (see the diff-view component
  spec's "Rejected alternative: one shared `VirtualScrollState`" note). Worth
  revisiting only if A+B still leave a perceptible lag in practice.
- Touches `src/webview/diff/diffGrid.ts` (`syncFrom`, `applyDriverScroll`,
  `mirrorToFollower`, `repositionPane`, `scheduleRender`, `renderScrollSlice`).
  `src/webview/render/virtualScroll.ts` is only touched if the delta math is
  generalized for reuse; `memoryGrid.ts` porting is explicitly out of scope.
