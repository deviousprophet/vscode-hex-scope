# DiffView scroll glitch: reposition compressed wrapper on scroll frame

## Goal

Driver pane shows blank space / glitchy native scroll in compressed virtual-scroll mode because the absolutely-positioned rows wrapper's top is only refreshed when the visible row range changes; reposition it on every scroll-driven frame.

## Problem

`src/webview/diff/diffGrid.ts` virtual scrolling switches to **compressed mode** when total content height exceeds `MAX_VIRTUAL_SCROLL_HEIGHT` (16,000,000px). In compressed mode the rows wrapper is absolutely positioned (`top: windowTop`) inside a fixed physical-height container.

`renderScrollSlice()` returns early when `sliceKey` is unchanged:

```ts
if (key === lastRenderKey) { return; }
```

`sliceKey` derives from the visible row range `[start, end)` — not the precise scroll offset. With `BUFFER_SIZE = 10`, the row range holds for most of a scroll gesture, so the wrapper `top` is never updated. The driver pane's native `scrollTop` keeps moving smoothly (compositor-driven), so the rendered rows slide out of view leaving blank space, then snap back when the row range finally shifts.

The follower pane is unaffected: its `scrollTop` is only set by script in the same JS turn that schedules the render, so there is no untracked native motion to fall behind.

## Second cause — CSS scroll anchoring

The wrapper-repositioning fix above (landed as `59c3409`) was correct but insufficient; the glitch persisted.

`.mem-scroll` (`src/webview/components/hexView/hexView.css`) is the real `overflow: auto` scrollable element; `.mem-rows` — the element whose `innerHTML` we replace every render — lives inside it. Browsers ship **scroll anchoring** (on by default) that watches for DOM mutations above the viewport and silently adjusts `scrollTop` to keep the content the user is looking at from visually jumping. Virtual scrolling deliberately mutates `.mem-rows` children every scroll-driven frame, so the browser mistakes our legitimate scroll-position-driven updates for layout shifts and adjusts `scrollTop` on top of the user's native/inertial scrolling and our own `state.scrollTop` bookkeeping / mirrored `setScrollTop`. Two independent things fighting over the same `scrollTop` produced the residual blank flash / jitter.

## Requirements

- Decouple row-HTML rebuild (expensive; keep gated by `sliceKey`) from compressed-wrapper repositioning (cheap; must run every scroll-driven frame).
- Reposition must track the pane's real `scrollTop` and use existing `clampWindowTop` semantics.
- No behavior change in uncompressed mode (native document flow already keeps content aligned).
- Disable CSS scroll anchoring on the scroll container (`.mem-scroll`) since the host owns scroll position; applies to both the diff view and the single-file hex view (shared stylesheet).

## Acceptance Criteria

- [x] On the skip path in `renderScrollSlice()`, both panes' compressed wrappers are repositioned instead of returning early.
- [x] Uncompressed panes are a no-op (no style writes / no position change).
- [x] Repositioned `top` clamps within `[0, physicalHeight - sliceHeight]`.
- [x] Row HTML is not rebuilt when `sliceKey` is unchanged.
- [x] `.mem-scroll` declares `overflow-anchor: none`.
- [x] `npx tsc --noEmit -p .` clean.
- [x] `npm run lint` clean.
- [x] `npm test` (compile-tests, check-types, lint) clean.

## Notes

- Lightweight task; PRD-only. Changes in `src/webview/diff/diffGrid.ts` (done, `59c3409`) and `src/webview/components/hexView/hexView.css`.
