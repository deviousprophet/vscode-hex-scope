# Fix sidebar pane void (allocatePanes must fill the pool)

## Goal

No empty void below the last expanded sidebar section: the section heights must always sum to the pane-view pool. A no-movement sash click must not freeze/persist pane sizes. Previously persisted sizes must keep working.

## Confirmed facts

- `allocatePanes(free, panes)` clamps user-set panes to their saved px, then `claimFreshSizes` absorbs the leftover — but `claimFreshSizes` only touches panes that are **not** user-set (`src/webview/components/sidebar/sidebar.ts:323`).
- When every expanded pane is user-set, the leftover is never assigned, so `sum(alloc) < pool` and a void appears (`src/webview/components/sidebar/sidebar.ts:341`).
- `claimUserSizes` is the only step that honors saved px and it clamps only to leave `MIN_PANE` for the others (`src/webview/components/sidebar/sidebar.ts:308`).
- `shiftPane` uses `a.saved ?? a.px` (not the displayed `a.px`) when applying a drag delta (`src/webview/components/sidebar/sidebar.ts:611`).
- `stopDrag` marks both panes `user = true` and calls `savePair` on every mouseup, including a plain click with no movement (`src/webview/components/sidebar/sidebar.ts:793`).
- Persistence is per-panel/section px in `localStorage` `hexScope.sidebarPanes.<panelId>.<sectionId>`, loaded at construct time when the pane-view height is not yet known (`src/webview/components/sidebar/sidebar.ts:280`).

## Requirements

- `allocatePanes` must always return sizes that sum exactly to the usable pool for the expanded panes.
- When user-set panes under-fill the pool (stale/legacy saved px sum smaller than the current pool), distribute the leftover proportionally so panes keep their relative sizes and grow to fill.
- A sash interaction that did not move must not mark panes user-set or write to storage.
- A drag after a proportional fill must stay continuous (no jump from the displayed size back to the stale saved px).
- Existing behavior preserved: collapse/expand, `MIN_PANE` floor, single-pane fills, malformed/oversized persisted values dropped/clamped, invalid keys removed.

## Acceptance Criteria

- [ ] With both expanded panes user-set and saved px summing below the pool, the rendered `flex-basis` values sum exactly to the pool (no void).
- [ ] The same holds when one of three panes is collapsed and the remaining user-set panes under-fill.
- [ ] Proportional distribution preserves the saved ratio (e.g. 100/100 at pool 294 → 147/147).
- [ ] Dragging the sash immediately after a proportional fill moves the displayed size by the delta with no jump.
- [ ] mousedown + mouseup on a sash with no mousemove writes nothing to `localStorage` and does not mark panes user-set.
- [ ] Legacy px values still restore: a single persisted pane keeps its px when it fits; oversized values still clamp to leave `MIN_PANE`.
- [ ] `npm run check-types`, `npm run lint`, `npm test` pass.

## Out of scope

- Sidebar width resizer, tab model, collapse animation, horizontal overflow, and the sash disabled-state model.
- Any change to collapse/expand persistence semantics (collapse still keeps the last expanded size).

## Key decision

- Keep persistence in px; guarantee the fill invariant in `allocatePanes` instead of changing the storage format. Rationale and equivalence argument in `design.md`.
