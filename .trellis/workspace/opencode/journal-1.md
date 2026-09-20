# Journal - opencode (Part 1)

> AI development session journal
> Started: 2026-09-20

---



## Session 1: Fix sidebar pane void: allocatePanes fills the pool
<!-- trellis-session: v=2 fp=48426c14d520a249 -->

**Date**: 2026-09-20
**Task**: Fix sidebar pane void: allocatePanes fills the pool
**Branch**: `fix/sidebar-pane-void`

### Summary

Fixed the empty void below the last expanded sidebar pane caused by px-based saved sizes that never rescale.

### Main Changes

- allocatePanes gains fillPool: user-set panes that under-fill the pool scale proportionally so sum == pool (no void).
- shiftPane applies the drag delta to the displayed px instead of stale saved px, so a drag after proportional fill does not jump.
- A sash click with no movement no longer marks panes user-set or persists sizes.
- Added 5 sidebar pane-view tests and updated component-sidebar spec.

### Git Commits

| Hash | Message |
|------|---------|
| `0c55d04` | fix(sidebar): fill pane pool so saved sizes cannot leave a void |

### Testing

- [OK] npm run check-types, npm run lint, npm test (983 passing).

### Status

[OK] **Completed**

### Next Steps

- Open a PR from fix/sidebar-pane-void.
