# Design — DiffView scroll sync latency

## Scope & boundary

- Owner: `src/webview/diff/diffGrid.ts` (scroll-sync hot path). No new module.
- `HexView` stays presentational; the diff host never writes cell DOM. The transform
  is applied to the host-owned rows wrapper (`#diff-rows-a` / `#diff-rows-b`,
  `.mem-rows`), which the diff host already styles through `applyVirtualScrollLayout`
  / `repositionPane` — same ownership as the existing `style.top` write.
- `src/webview/render/virtualScroll.ts` is **not** modified: the delta math is a
  two-line expression local to the host. `memoryGrid.ts` single-pane porting is out
  of scope (no follower; PRD note).
- No new runtime dependency, no config, no abstraction. Single-file change plus
  test updates plus one spec update.

Not split into parent/child: A and B are one coupled hot-path change; neither is
independently shippable/verifiable in the real webview.

## Current flow (baseline)

`scroll` event → `syncFrom` → `applyDriverScroll`:
1. `driverScroll.state.scrollTop = physicalToLogicalScroll(top)`
2. `mirrorToFollower`: `follower.state.scrollTop = logicalTop`; **`follower.container.scrollTop = top`** (layout write); `setScrollLeft` (layout write + header)
3. `scheduleRender()` → rAF → `renderScrollSlice`: recompute both slices; if `sliceKey` changed → `drawSlice` (innerHTML both panes); else → `repositionPane` both (compressed `top` writes).

Follower only moves when a coalesced `scroll` event fires; the `setScrollTop` write
forces layout each event.

## Target flow

Two clocks:
- **Every frame while scrolling** (rAF poll, part A): read the driver's live native
  `scrollTop`, advance both panes' logical state, render (reused `renderScrollSlice`),
  and track the follower visually with a compositor-only `transform` (part B).
- **Reconcile** (when `sliceKey` changes, or on settle): write the follower's real
  `container.scrollTop`, rebuild the slice, clear the transform.

### New module state (`diffGrid.ts`)

```
let scrollPollHandle: number | null = null;
let pollDriver: DiffPane | null = null;
let lastPolledTop = 0;
let stableFrames = 0;
const SETTLE_FRAMES = 2;
```

### Part A — rAF poll

`syncFrom` / `applyDriverScroll` changes:
- On a driver `scroll` event, after updating states, call `startScrollPoll(driver)`.
- `startScrollPoll`: no-op if a poll is already alive for the same driver; else set
  `pollDriver = driver`, `lastPolledTop = container.scrollTop`, `stableFrames = 0`,
  `scrollPollHandle = requestFrame(pollFrame)`.
- `pollFrame`:
  1. `const physicalTop = paneScroll(driver).container.scrollTop` (live native read —
     this is the decoupling: no dependence on the coalesced `scroll` event).
  2. settle bookkeeping: same value for `SETTLE_FRAMES` consecutive frames → jump to 5.
  3. `driver.state.scrollTop = physicalToLogicalScroll(physicalTop)`; `lastDriver = driver`.
  4. if `syncScroll`: `follower.state.scrollTop = logicalTop` (state only, no write).
  5. `renderScrollSlice()` (reused; no extra rAF — the poll frame *is* the frame).
  6. reschedule `scrollPollHandle = requestFrame(pollFrame)`.
  7. on settle: `finalizeFollower(driver, physicalTop)` then `stopScrollPoll()`.
- `scheduleRender()` gains a guard: `if (scrollPollHandle !== null) return;` — the
  poll owns rendering while active, so an event does not queue a second frame. When
  no rAF is available the poll falls back to `setTimeout(16)` through the existing
  `requestFrame`, so in jsdom the render stays deferred and `flushDiffRender` (which
  now also stops the poll) stays the deterministic test seam.
- `stopScrollPoll()`: cancel the pending frame (`cancelFrame`), null the handle and
  `pollDriver`. Called from `resetDiffGrid`, `setDiffData`, `setSyncScroll(false)`,
  and `flushDiffRender`.

Poll lifecycle: starts only on a scroll event for a driver pane, stops ≤2 frames
after `scrollTop` stops changing → no idle background polling.

### Part B — transform tracking + reconciliation

`mirrorToFollower` is split:
- `mirrorFollowerLeft(driver, left)`: horizontal only (`setScrollLeft`), unchanged,
  still driven by the scroll event (header alignment depends on it). Vertical is no
  longer written here.
- Follower vertical:

  `applyFollowerVisual(driver, physicalTop)` — the per-frame visual step:
  ```
  delta = physicalTop - followerScroll.container.scrollTop
  rows.style.transform = delta === 0 ? '' : `translateY(${-delta}px)`
  ```
  Recomputed from **live** `container.scrollTop` every frame — never accumulated, so
  by construction it cannot drift or compound (satisfies the no-drift AC).

  `reconcileFollower(driver, physicalTop)` — the real step (only when the slice
  changes, or on settle):
  ```
  followerScroll.container.scrollTop = physicalTop   // real write, bounded to slice-change/settle rate
  followerScroll.state.scrollTop = logicalTop
  rows.style.transform = ''
  ```
  Ordering matters: reconcile **before** `drawPane(b)` so the compressed-mode
  `windowTop` math reads the real `container.scrollTop`, then clear the transform in
  the same tick. Because the transform already showed `physicalTop` visually, and the
  real write + clear shows the identical position, the frame has no seam.

- `renderScrollSlice` reconciliation policy (keyed on `sliceKey`, unchanged gate):
  - key changed → `reconcileFollower` before `drawSlice`.
  - key unchanged → `repositionPane(a)` (driver only) + `applyFollowerVisual(b)`.
  This keeps row-HTML rebuild frequency exactly as today (still `sliceKey`-gated);
  only `applyFollowerVisual` runs every frame.

- `finalizeFollower(driver, physicalTop)`: on settle, if the follower's real
  `scrollTop` differs, `reconcileFollower` (writes real top, clears transform). Invariant
  restored outside active scroll: **transform always empty, follower `scrollTop` real**,
  so one-shot operations (`scrollToDiff`, `alignFollowerToDriver`,
  `restoreAnchor`) are never double-offset.
- `setSyncScroll(false)`: `stopScrollPoll()` + clear both panes' transforms; the
  follower keeps its last real `scrollTop` and own slice (sync-off behavior unchanged).
- `setSyncScroll(true)`, `setDiffData`, `resetDiffGrid`, `applyReload`: clear
  transforms + stop poll as part of their existing reset work.

### Part B — driver `repositionPane`

`repositionPane` already runs only inside the coalesced `renderScrollSlice` tick, so
its `style.top` write is already at the coalesced rate, not per scroll event. The
only change: memoize the last written `top` per pane and skip the DOM write when
unchanged (avoids a redundant layout write on the many no-op frames). Converting the
wrapper to `transform`-based positioning is **not** done: it would require changing
`renderHexViewHtml`'s absolute wrapper markup for no measured benefit, and the
two-clock model above already removes the event-driven layout storm. Recorded as an
explicit rejected-but-revisitable alternative.

### Interaction detail — re-entrancy and follower `scroll` events

`reconcileFollower` writes the follower's real `scrollTop`, which fires a `scroll`
event on the follower (async). That event re-enters `syncFrom(follower)`. The mirror
is idempotent (the driver is already at that position) and the poll will simply be
(re)started for whichever pane reports. No guard change is required; the existing
`syncingScroll` guard covers the synchronous `applyDriverScroll` path.

## Proof obligations (why no seam / no drift)

- **No seam**: at a reconcile frame, before the write the element is at native
  `scrollTop = F0` with `translateY(F0 - D)`; after, native `= D` with
  `translateY(0)`. Both paint content offset `D`. Identical ⇒ no visible jump.
- **No drift**: the transform is `-(D - live F0)` recomputed each frame; it is never
  integrated, so error cannot accumulate. Any residual difference is re-based at the
  next reconcile.
- **Slice coverage**: while the transform is non-zero, `sliceKey` was unchanged
  between `F0` and `D`, so the rendered slice is identical for both offsets and the
  overscan buffer (`overscanRowCount`) already covers the sub-row delta.

## Tradeoffs / risks

- **Scrollbar thumb**: with the transform approach the follower's native scrollbar
  thumb does not move between reconciles, then snaps. Accepted (reconciles at each row
  boundary and on settle); the alternative (per-frame `scrollTop`) is the layout write
  we are removing. A shared-container design would avoid it but is rejected by PRD.
- **Compressed mode**: the transform on `.mem-rows` moves the whole fixed-physical box;
  the absolute inner wrapper is not re-based between reconciles, so there is a small
  linear-vs-nonlinear mapping error bounded by one reconciled physical delta (sub-row,
  typically <1px). Accepted; reconciliation is frequent there because logical scroll outruns physical.
- **Synchronous rAF stubs in tests**: a self-rescheduling poll against a synchronous
  `requestAnimationFrame` stub must still terminate — the `SETTLE_FRAMES` cap guarantees
  it (unchanged `scrollTop` ⇒ stop after 2 frames). Tests will use a controllable
  capturing rAF to step frames explicitly.
- **Perceptual AC** cannot be unit-tested (jsdom has no compositor). Automated tests
  pin the mechanism (poll starts/stops, transform-only frames, reconcile-on-slice-change,
  no-drift, sync-off unaffected); the "no perceptible lag" AC is a manual check in the
  VS Code webview.

## Staging / rollback

- Stage A then B (see `implement.md`), each independently green. If B proves visually
  worse in the real webview, reverting the transform branch back to a per-frame
  `setScrollTop` on the reconcile path (keeping A) is a local change to
  `applyFollowerVisual`/`renderScrollSlice`.
- No persistence, protocol, or data-format change ⇒ no migration, no rollback state.

## Out of scope

- Porting the transform-tracking to `memoryGrid.ts`.
- Shared scroll container (PRD-rejected).
- Any change to `computeByteDiff`, row model, selection, search, or the single-file shell.
