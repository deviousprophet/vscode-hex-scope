# Design

## Boundary

All changes stay inside `SidebarSections` in `src/webview/components/sidebar/sidebar.ts` (plus its tests and the component spec). No panel, host, CSS, or storage-key change.

## Root cause

`allocatePanes` has no final normalization: it claims user sizes, then only `claimFreshSizes` can absorb the remainder, and that step skips user-set panes. Two user-set panes therefore freeze the sum at their saved px, leaving the rest of the pool unassigned (the void). The same failure occurs when a collapsed sibling is excluded from the pane list but the remaining user-set panes' px no longer cover the now-larger pool.

## Invariant

`allocatePanes` must satisfy `sum(out.values()) === pool` for the expanded panes, always.

Plan:

1. `claimUserSizes` assigns each user pane a desired size clamped to leave `MIN_PANE` for the others (unchanged logic, but read the desired size as described below).
2. `claimFreshSizes` splits whatever remains across non-user panes (unchanged).
3. **New final step**: if any pool space is still unassigned, scale every allocated pane up proportionally so the sum equals the pool exactly; the last entry absorbs the rounding remainder. This only fires in the all-user under-fill case (when fresh panes exist, step 2 already consumed the remainder).

Proportional (not last-pane-absorbs) is chosen so the panes keep their relative sizes after a window/panel resize.

## Drag continuity

Because the allocation can now exceed a pane's stored `saved` px, `shiftPane` must base the delta on the **displayed** size (`a.px`), not `a.saved ?? a.px`. After the first delta, `a.saved + b.saved === a.px + b.px`, so the layout is stable and later deltas cannot drift. Without this, the first mousemove of a drag following a proportional fill would snap the pane from its displayed px back to the stale saved px.

## No-op sash click

`stopDrag` currently always marks both panes user-set and persists. Track whether `onMove` ever saw a non-zero delta; only then mark user-set and `savePair`. A plain click changes nothing, so nothing should be written and no pane should become user-set.

## Storage format decision

The task originally also considered migrating storage from px to ratios (`saved / combined`). Given the normalization step above, ratio storage is behaviorally equivalent and therefore not implemented:

- After any user resize, `a.saved + b.saved === combined === a.px + b.px`, so `saved` values are a fixed proxy for the ratio.
- On a later pool change, the normalization scales `saved` proportionally; ratio = savedA/savedB is unchanged by layout (layout never rewrites a user pane's `saved`).
- When a proportional fill would distort `saved` (MIN_PANE clamp on shrink), the stored `saved` values are untouched, so growing back restores the original ratio.

Explicit ratio storage would add a storage-format migration (legacy px vs ratio discrimination, first-layout resolution when the pool is still unknown at construct time) for no behavioral gain. It is recorded as a possible follow-up only if a future feature needs the ratio independent of px.

## Compatibility

- Existing px keys load and render exactly as before when they fit; oversized values still clamp; malformed/≤0 values are still dropped.
- No storage key or format change, so no migration.
- Collapse keeps the last expanded size (layout still never rewrites a user pane's `saved`).

## Constraints

- Keep `MIN_PANE` floor and the `n === 1` fill-fast-path.
- Keep layout side-effect free: no storage writes, no `saved` rewrites for user panes.
- Allocation must stay deterministic so jsdom tests can assert exact numbers.

## Rollback

Revert the `sidebar.ts` edit. No stored data changes, so rollback is safe.
