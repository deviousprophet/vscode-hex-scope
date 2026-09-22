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

## Requirements

- Decouple row-HTML rebuild (expensive; keep gated by `sliceKey`) from compressed-wrapper repositioning (cheap; must run every scroll-driven frame).
- Reposition must track the pane's real `scrollTop` and use existing `clampWindowTop` semantics.
- No behavior change in uncompressed mode (native document flow already keeps content aligned).

## Acceptance Criteria

- [ ] On the skip path in `renderScrollSlice()`, both panes' compressed wrappers are repositioned instead of returning early.
- [ ] Uncompressed panes are a no-op (no style writes / no position change).
- [ ] Repositioned `top` clamps within `[0, physicalHeight - sliceHeight]`.
- [ ] Row HTML is not rebuilt when `sliceKey` is unchanged.
- [ ] `npx tsc --noEmit -p .` clean.
- [ ] `npm test` (compile-tests, check-types, lint) clean.

## Notes

- Lightweight task; PRD-only. Single-file change in `src/webview/diff/diffGrid.ts`.
