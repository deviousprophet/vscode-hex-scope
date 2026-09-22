# DiffView search: reduce jump and scan latency

## Goal

Reduce `DiffView` search latency — both the scan (time to first/complete
results) and the jump-to-match (time from a `Next`/`Prev`/Enter to the
destination painting). The single-file hex view is the reference: same
`SearchEngine`, one file, one pane.

## Problem

Diff search stacks several "both sides" multipliers on the one main thread. The
three costs are independent, but all scale with the second file:

1. **Scan does ~2x the work.** `runDiffSearch` (`diffSearch.ts:95`) concatenates
   both sides' segments into a single `engine.search({ segments })` call —
   `[...sides.a.parseResult.segments, ...sides.b.parseResult.segments]`. The
   single-file hex view feeds one file's `S.parseResult.segments`. Same chunked
   main-thread scanner (`setTimeout`-driven, not a worker), ~2x the bytes.

2. **Every streamed progress batch paints both panes.** `onProgress` →
   `paintMatches()` → `setSearchMatches()` → `renderDiffGrid()` rebuilds the full
   `innerHTML` of *both* panes (and runs `diffKindAt()` per byte on top of the
   byte lookup). This fires per batch, not once at the end. The single-file view
   paints one pane.

3. **A jump renders at the stale position, then renders again, then renders a
   third time from the scroll event.** Verified current flow per
   `stepMatch`/`onComplete`/`onProgress`:
   - `paintMatches()` → `setSearchMatches()` → `renderDiffGrid()` — a full
     double-pane render **at the old scroll position**, immediately before the
     jump scrolls away from it (wasted).
   - `scrollToActive()` → `scrollToDiff()` → `scrollToRow()` sets both panes'
     native `scrollTop` and then calls `renderDiffGrid()` **synchronously** at the
     new position (this part is *not* deferred — the observed flow already renders
     here, unlike a pure "set position, wait for rAF" path).
   - The programmatic `scrollTop` write then fires an async native `scroll` event →
     `syncFrom` → `scheduleRender()` → a **third**, deferred rAF render
     (`renderScrollSlice`), redundant with the synchronous one.
   - Correction to the original analysis: the destination is not left to the rAF
     round-trip alone; the redundant work is the *stale-position* render plus the
     *extra deferred* render, not a missing synchronous render.

4. **The scan and the renders compete for the same thread.** The chunked search's
   `setTimeout` continuations and the ~2x-cost render work interleave on one main
   thread; heavier/longer renders delay the next chunk, stretching total scan time
   (same feedback shape as the scroll-latency task).

## Requirements

1. **No stale-position paint before a jump.** When a search action both paints new
   matches and jumps to one (step, completed search, first streamed batch), the
   pane must not be fully re-rendered at the old scroll position and then again at
   the destination. One render, at the destination.
2. **No redundant deferred render after a programmatic scroll.** A
   search-driven `setScrollTop` (already followed by a synchronous render) must not
   also trigger a second full re-slice via the native `scroll` event / rAF.
3. **Bounded per-batch paint.** Streamed progress batches must not each trigger a
   full double-pane `innerHTML` rebuild. Either paint matches incrementally, or
   coalesce batch paints to at most one per animation frame; row-HTML rebuilds stay
   `sliceKey`-gated (do not regress the existing scroll-stability contract).
4. **Scan does not contend with rendering.** Total scanned bytes are inherently ~2x
   (two files); the requirement is that the scan's progress emission and the
   per-batch render no longer serialize on the same thread in a way that stretches
   wall-clock time. (Off-main-thread scanning is a candidate, not mandated; the
   design step decides.)
5. **Zero behavior change.** Match addresses (union/dedupe), count text, active
   match, `Enter`/`Shift+Enter` navigation, modulo wrap, repeat-Enter on an
   unchanged completed query, repeat-Enter while running, Run-click no-op on an
   in-flight search, streamed first jump, `isSearchDiverged` match dropping, the
   selection pane (`paneForAddress`), `sync scroll` on/off, and the
   `showAscii:false` hex-only rendering all stay identical.

## Acceptance Criteria

- [ ] A jump (`Next`/`Prev`/Enter/streamed first match) produces exactly one
      synchronous render per affected pane, at the destination — no render at the
      pre-jump scroll position (assert via an `innerHTML` write probe on both panes).
- [ ] After a search jump, no additional render is scheduled by the programmatic
      `scroll` event (assert the coalesced frame count / pending-handle state).
- [ ] N streamed progress batches cause at most one full double-pane row rebuild
      per animation frame (probe), with match highlighting still complete and the
      count still correct at `onComplete`.
- [ ] Search results, count, active-match index, navigation (next/prev/wrap/repeat
      Enter), and selection pane are byte-for-byte identical to current behavior
      (existing `diffViewer.test.ts` search suite passes unchanged except where a
      test asserts the old redundant-render flow).
- [ ] `Sync scroll` on/off behavior is unchanged (interacts with the
      `diffview-scroll-latency` task — see Notes).
- [ ] `npx tsc --noEmit -p .` clean.
- [ ] `npm test` (compile-tests, compile, lint, and the vscode-test suite where
      runnable) clean.

## Notes

- Shares the "both panes redraw per frame" cost with
  `09-22-diffview-scroll-latency`; the two tasks touch the same render path
  (`renderDiffGrid` / `renderScrollSlice` / `setScrollTop`) and should land in a
  defined order. Record the intended order in whichever starts second (likely this
  task after the latency task, since the latency task changes the programmatic
  `setScrollTop`/reconcile path) and re-baseline against it.
- `SearchEngine` itself (`src/core/search.ts`) is shared and unchanged by
  `diffview-scroll-latency`; any change to its chunking/worker behavior is this
  task's design decision.
- No persistence, protocol, or data-format change expected ⇒ no migration.
