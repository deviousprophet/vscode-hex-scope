# Journal - deviousprophet (Part 1)

> AI development session journal
> Started: 2026-07-30

---



## Session 1: Bootstrap guidelines + finish-work

**Date**: 2026-07-30
**Task**: Bootstrap guidelines + finish-work
**Branch**: `main`

### Summary

Filled frontend spec files with real codebase patterns. Archived bootstrap task. Ready for new work.

### Git Commits

| Hash | Message |
|------|---------|
| `b9ced7d` | (see git log) |
| `b0a8e58` | (see git log) |

### Status

[OK] **Completed**


## Session 2: Fix gap copy zero + webview test suite nesting repair

**Date**: 2026-08-01
**Task**: Fix gap copy zero + webview test suite nesting repair
**Branch**: `fix/gap-copy-zero`

### Summary

Fixed issue #142: selectedBytes() now skips unmapped gap addresses instead of zero-filling, so context-menu Copy/Analyze no longer emits 0x00 for gaps. Added 7 gap-filtering tests (selectedBytes, copyCommandResult, contextCommandResult incl. an-xor analyze). Deepened specs (search-inspect-copy, editing-save-external-change, scripting, type-safety). PR #146 created. Repaired test-suite nesting bug + indentation via node-based EOL-safe edits after PowerShell corruption.

### Git Commits

| Hash | Message |
|------|---------|
| `dc02597` | (see git log) |

### Status

[OK] **Completed**

## Session 3: Hex diff view — bug fixes, gap completion, UI polish

**Date**: 2026-08-01
**Task**: `08-01-hex-diff-view` (in_progress)
**Branch**: `feat/hex-diff-view`

### Summary

Deep review (Spec axis, earlier cancelled) surfaced real defects + missing feature gaps that the first implementation pass claimed but didn't deliver. Fixed via TDD (red → green, clean `npm run clean` in pretest).

- **Confirmed bugs fixed**: Compare Selected missing from explorer menu + `Uri[]` array unhandled (fell into a file dialog); diff tab title = opaque base64 pair key (key moved to URI query, path = both filenames); bare `Alt+↓/↑` mis-bound to staging commands (showed "Alt+Down" menu hint) → staging now `Ctrl+Alt`, diff-nav is webview-local `Alt+ArrowDown/Up`.
- **Critical rendering bug**: `computeDiff` emits one `DiffRow` per address but the renderer drew each as a full 16-cell visual row — one byte repeated 16× per visual row. Fixed with `groupVisualRows` (16-byte visual rows) + `visualRowIndexForAddress`; regression-tested against real `computeDiff` output.
- **Gaps completed**: per-cell search match highlight + search mode/endianness; per-panel parse-error state (`aError`/`bError`); label rail (both files' `SegmentLabel`s, side-tagged); per-panel click-drag selection + copy (hex/c-array/ascii).
- **UI per user request**: 00..0F column header (sticky), dual address gutters per panel, centered grid, visible 2px gutter between panels, changed highlight red (added green, removed magenta).
- **Layout fix**: `#diff-scroll` measured via `clientHeight` (fixed `innerHeight - 90` + flex double-sized, clipped toolbar).
- Cleaned design tags (D17/…) out of code comments per user instruction.

### Git Commits

| Hash | Message |
|------|---------|
| `384afbf` | fix(diff): complete diff-view gaps, fix rendering + UX defects |

### Status

[WIP] Task in_progress. Docs persisted (prd D26–D29, design §2.5, new `frontend/diff-view.md` spec). Remaining: visual verification of the new layout in a live VS Code run; possible further polish; then phase 3.4 commit + 3.5 wrap-up.


## Session 3: Hex diff view complete: lazy-window model, reusable components, review cleanup

**Date**: 2026-08-01
**Task**: Hex diff view complete: lazy-window model, reusable components, review cleanup
**Branch**: `feat/hex-diff-view`

### Summary

Completed the hexScope.hexDiff custom editor. Locked 8MB large-file design (grill Q1-Q10): lazy per-window cells over binary WireParseResult segments + light DiffMeta, sequential staged load with diffProgress, cancellable parse (abort+restart on external change), loading card (initial-load only), streaming union search with first-jump, Enter-nav parity. Extracted reusable HexViewComponent + SearchBarComponent (endian pill, mode labels, copy-as-intent onCopy). Removed address-range label rail (user). Review-driven cleanups: dead needsLeadingRow, .be hover guard, prev-wrap, shared binary search, parse stage labels, decodePairKey validation, memory.ts SegmentSource widening (no as never). 584 tests green.

### Git Commits

| Hash | Message |
|------|---------|
| `768e285` | (see git log) |
| `9e8ce5d` | (see git log) |
| `b51bd29` | (see git log) |
| `ea1c94c` | (see git log) |
| `026c090` | (see git log) |
| `a1ff249` | (see git log) |
| `7961483` | (see git log) |
| `b3168f0` | (see git log) |
| `a692e48` | (see git log) |

### Status

[OK] **Completed**


## Session 4: Reuse SearchBarComponent in single hex view

**Date**: 2026-08-02
**Task**: Reuse SearchBarComponent in single hex view
**Branch**: `feat/reuse-ui-components-single-view`

### Summary

Planned (grill Q1-Q12) and implemented the single hex view adopting the shared SearchBarComponent: optional seed options + onSearch trigger arg, hexViewer host with S-mirroring adapter, Ctrl+Z undo re-homed to host keydown, searchEngine glue injects setCount/setBusy with single-owner searchKeyFor, all search-bar CSS consolidated into searchBarComponent.css, searchControls.ts deleted, component tests moved to src/test/webview/ui-components/. Restructured into parent task 08-02-reuse-ui-components-single-view with children (searchbar done; hex-view pending brainstorm) on branch feat/reuse-ui-components-single-view. Parity ground truth v2.17.1. Verified: compile, lint, 587 tests, fallow 0/0/0. Two-axis code review found 5 smells (key/trigger duplication, DOM boundary leak, state mismatch, minor); all fixed.

### Git Commits

| Hash | Message |
|------|---------|
| `9990409` | (see git log) |

### Status

[OK] **Completed**
