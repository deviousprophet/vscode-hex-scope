# Implementation Plan

1. In `src/webview/components/sidebar/sidebar.ts`, add a final fill step to `allocatePanes(free, panes)`: after `claimUserSizes` + `claimFreshSizes`, if the sum is below `pool`, scale every allocated entry proportionally and give the rounding remainder to the last entry so the sum is exact.
2. Change `shiftPane` to compute the dragged pane's new size from the displayed `a.px` instead of `a.saved ?? a.px`.
3. Change `stopDrag` to track a `moved` flag (set when `onMove` sees a non-zero delta) and only mark both panes user-set + `savePair` when moved.
4. Add tests to `src/test/webview/components/sidebar.test.ts`:
   - both panes user-set under-fill → `basis(first) + basis(second)` equals the pool, ratio preserved (e.g. 100/100 at 294 → 147/147).
   - three panes, one collapsed, remaining user panes under-fill → expanded panes fill the pool.
   - drag immediately after a proportional fill → displayed size moves by delta, no jump.
   - mousedown + mouseup with no mousemove → no `localStorage` write, panes still behave as fresh.
5. Update `component-sidebar.md`: `allocatePanes` always fills the pool; list all user-set panes can scale proportionally; a no-move sash click does not persist.
6. Run `npm run check-types`, `npm run lint`, `npm test`.

## Risk checks

- Verify `sum(out) === pool` for: two user panes under-fill, one user + one fresh, all fresh, single expanded pane, oversized clamp, one-of-three collapsed.
- Verify `sizes persist to localStorage on resize and restore across mounts` still writes `187` / `107`.
- Verify collapse/expand still restores the last expanded px and does not persist layout-time growth.
- Verify no `localStorage` write happens during `layout()` (only on user actions).
- Verify the drag test's exact numbers still hold with `a.px` as the delta base.
