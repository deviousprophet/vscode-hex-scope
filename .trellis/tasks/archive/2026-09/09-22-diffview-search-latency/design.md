# Design — DiffView search latency

## Scope & boundary

Owner: `src/webview/diff/diffSearch.ts` (search glue) and `src/webview/diff/diffGrid.ts`
(host paint/jump), plus one method on `components/diffView/diffView.ts`. No new module,
no `SearchEngine` change, no worker.

## Verified current flow (basis)

`diffSearch.runDiffSearch` scans `[...a.segments, ...b.segments]` in one
`engine.search` call (inherent ~2x bytes). Then:

- `onProgress(matches)` → `dedupeSorted` → `paintMatches()` → `setSearchMatches(addrs, index, span)`.
- `setSearchMatches` (`diffGrid.ts:396`) rebuilds `matchSet` (O(addrs·span)) and calls
  **`renderDiffGrid()`** — a full `innerHTML` rebuild of **both** panes (each cell also
  running `diffKindAt`), per streamed batch.
- `onComplete` → `paintMatches()` again, then `scrollToActive()`.
- `stepMatch` → `applyMatches()` → `paintMatches()` then `scrollToActive()`.
- `scrollToActive` → `scrollToDiff` → `applySelectionOption` (incremental
  `paintSelection`) + `scrollToRow` → `scrollPaneToRow('a')` + `('b')` (real
  `setScrollTop`) then **`renderDiffGrid()`** at the new position.
- The programmatic `setScrollTop` then fires a `scroll` event → `syncFrom` →
  `startScrollPoll` → another (coalesced) render pass.

So one jump costs: one full double-pane rebuild **at the old position** (wasted),
one full double-pane rebuild at the destination, and one extra poll pass.

`memoryGrid`'s equivalent is cheaper on every axis: streamed batches repaint via
`hexView.paintMatch(...)` (incremental `.match`/`.amatch` class toggle over visible
cells, **no `innerHTML`** — `paintMatchesInRoot` clears then repaints), and
`scrollTo` sets the position and renders the one grid synchronously.

## Requirements → design

### R1 — streamed batches must not rebuild rows (incremental paint)

Mirror `memoryGrid`: add `DiffView.paintMatch(matchAddrs, index, length)` delegating
to both panes' `HexView.paintMatch` (which calls `paintMatchesInRoot`: clears
`.match`/`.amatch` on visible cells, then repaints). `diffGrid.setSearchMatches`
becomes: update `matchSet`/`activeMatch` state, then `diffView.paintMatch(...)` —
**no `renderDiffGrid`**. The declarative `matchSet`/`activeMatch` in `buildInput` still
handles any later slice redraw, exactly as `memoryGrid.buildHexViewInput` does.

- Row-HTML rebuild frequency on search drops from once-per-batch to zero (only real
  scroll/view-mode/reload redraws rebuild rows).
- `matchSet` construction still O(addrs·span) per batch; kept (state is needed for
  the next redraw) but no longer paired with a redraw.

### R2 — a jump renders once, at the destination

Split "update match state" from "paint", and order the jump so it scrolls first:

- `diffSearch.applyMatches`/`onComplete`/`onProgress` call `setSearchMatches`
  (state + incremental paint) **once**, then `scrollToActive()`; `scrollToRow`
  already renders synchronously at the new position. No full paint-then-jump double
  render — the pre-jump "paint" is now incremental class toggles, not an `innerHTML`
  rebuild.
- `onProgress`'s first-jump path (`jumpToFirstStreamedMatch`) uses the same order.

### R3 — no redundant deferred render after a programmatic scroll

`scrollToRow` performs a synchronous `renderDiffGrid`; the subsequent native `scroll`
event from `setScrollTop` would start a poll and render again. Add a one-shot
programmatic-scroll guard in `diffGrid.ts`: `scrollToRow` (and `restoreAnchor`/
`alignFollowerToDriver`) set a `suppressNextDriverScroll` flag carrying the pane +
expected `scrollTop`; `applyDriverScroll` consumes it (position already correct and
rendered) and skips `startScrollPoll` / `scheduleRender` for that event. The guard
clears on consumption, on the next user-initiated scroll, and in `resetDiffGrid`/
`setDiffData`. Net: a jump is exactly one render.

### R4 — batch paint cost does not contend with the scan

R1 makes the per-batch paint O(visible cells) instead of O(rows·cellHTML); the
chunked scanner's `setTimeout` continuations are no longer starved by two
double-pane rebuilds per throttle tick. No `SearchEngine` change. A worker is the
only way to remove the inherent 2x scan cost from the main thread and is explicitly
out of scope (recorded as the next lever if R1–R3 are insufficient).

### R5 — behavior identical

Address union/dedupe, count, active index, `Enter`/`Shift+Enter`, modulo wrap,
repeat-Enter semantics, streamed first jump, `isSearchDiverged` drop, selection pane
(`paneForAddress`), sync on/off, and `showAscii:false` are unchanged. The only
observable difference is that highlights repaint incrementally (same classes), and
there is no intermediate full redraw during a jump.

## Contract changes

```typescript
// components/diffView/diffView.ts — add
paintMatch(matchAddrs: readonly number[], index: number, length: number): void;  // both panes

// diff/diffGrid.ts — setSearchMatches semantics
// before: state update + renderDiffGrid()
// after:  state update + diffView.paintMatch(...)   (no row rebuild)
```

## Host changes

- `diffGrid.setSearchMatches`: replace `renderDiffGrid()` with `paintMatchOnBothPanes`.
- `diffGrid`: add the programmatic-scroll guard state + consumption in
  `applyDriverScroll`; set it in `scrollPaneToRow` (per pane), `restoreAnchor`,
  `alignFollowerToDriver`.
- `diffSearch`: ensure a single `setSearchMatches` + `scrollToActive` per action
  (no separate full repaint step); the module already has the right shape once
  `setSearchMatches` is cheap — keep the call order but drop any now-redundant
  repaint.
- `DiffView.paintMatch` added; `HexView.paintMatch` is unchanged.

## Risks / tradeoffs

- **Incremental-paint correctness on redraw**: a redraw after a batch uses the
  declarative `matchSet`, so hidden/gap rows stay correct; only the visible-cell
  incremental path is added. Covered by an assertion that a redraw after a batch
  still paints matches.
- **Programmatic-scroll guard**: an imprecise guard could swallow a genuine user
  scroll event that races the same frame (one dropped poll tick). Mitigate by keying
  the guard on the exact `(pane, scrollTop)` written and clearing it on any mismatch;
  the poll restarts on the next real event, so worst case is one frame.
- **`paintMatchesInRoot` clears/re-adds classes on every batch** (O(visible)); this is
  the accepted hex parity cost and is far below an `innerHTML` rebuild.
- **Perceptual gain** cannot be unit-tested; tests pin the *mechanism* (no
  `innerHTML` write per batch, one render per jump, no poll after a programmatic
  scroll).

## Rollback

Revert `setSearchMatches` to `renderDiffGrid()` and drop the guard: behavior returns
to the current baseline. Component `paintMatch` delegation is additive and can stay.

## Out of scope

- `SearchEngine` chunking/worker changes (`src/core/search.ts`).
- Removing the inherent 2x scan of two files.
- Any change to `diffSummary`, `diffMessages`, `diffExternalChange`, `hexView/`,
  `memoryGrid.ts`, or the sync/scroll-latency behavior.

## Sequencing

Baseline is the committed tree after `3f60400` (DiffView extraction). The extraction
moved only markup/controller/CSS; the search path is unchanged by it, so no
re-baseline beyond a fresh `diffViewer.test.ts` count is needed.
