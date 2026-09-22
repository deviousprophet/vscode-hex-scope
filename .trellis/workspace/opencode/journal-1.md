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

---

## Session 2: Hex Diff View — action button labels + search parity

**Date**: 2026-09-21
**Task**: Hex Diff View
**Branch**: `feat/hex-diff`

### Summary

Completed the last two execution phases of the read-only two-file hex diff editor: findings round 9 (action buttons show icon + text) and round 10 (full search parity with the hex view), then added the changelog entry.

### Main Changes

- A10: `actionButton(id, glyph, text, title, active)` renders `aria-hidden` glyph span + visible text span; `.diff-action` is an auto-width `inline-flex` button (`height:26px`, `padding:0 8px`), with `.diff-action-glyph`/`.diff-action-text`.
- A11: new pure `src/webview/search/searchNavigation.ts` (`shouldNavigateCompletedSearch`, `isSearchDiverged`) shared by `searchEngine.ts` and the isolated diff bundle; `diffSearch.ts` gains completed-key repeat-Enter navigation, `onProgressUpdate` streaming (paint + count + one-time first jump), divergence-gated `onQueryChanged`, modulo next/prev wrap, active-match selection, and `refreshDiffSearchCount()`.
- Checker self-fix: in-flight Run on a same-key search now no-ops (hex parity) instead of stepping; refactored `diffSearch.ts` to clear the fallow health gate (0 findings).
- Specs updated: `component-diff-view.md`, `component-search-bar.md`, `editor-lifecycle.md`.

### Git Commits

| Hash | Message |
|------|---------|
| `a7b7ec6` | feat(diff): action button labels and hex-view search parity |
| `55b1f09` | docs(changelog): note the hex diff view under Unreleased |

### Testing

- [OK] npm run check-types, npm run lint, npm test (1065 passing).
- [OK] fallow health/clone/dead-code audit: 0 findings.

### Status

[OK] **Completed**

### Next Steps

- Open a PR from feat/hex-diff; the changelog entry sits under `[Unreleased]` (main == v2.24.0).

---

## Session 3: Fix hash stored-value byte order in integrity panel
<!-- trellis-session: v=2 fp=913341fb133c9dfb -->

**Date**: 2026-09-22
**Task**: Fix hash stored-value byte order in integrity panel
**Branch**: `fix/integrity-hash-endianness`

### Summary

Gated stored-value byte order on isChecksumAlgorithm so MD5/SHA digests compare and write in natural byte order while CRC16/CRC32 keep honoring the LE/BE toggle; hash stored pane no longer shows an endian tag. Updated integrity specs, added targeted hash tests, logged changelog, opened draft PR #248.

### Git Commits

| Hash | Message |
|------|---------|
| `75520de` | fix(integrity): keep hash stored values in natural byte order |
| `f209837` | docs(integrity): scope stored byte order to checksums in specs |
| `9205114` | docs(changelog): log hash byte-order integrity fix |

### Status

[OK] **Completed**

### Next Steps

- Open a PR from fix/integrity-hash-endianness (draft PR #248).

---

## Session 4: Hex diff surface correctness fixes
<!-- trellis-session: v=2 fp=82c170fac3a631b5 -->

**Date**: 2026-09-22
**Task**: Hex diff surface correctness fixes
**Branch**: `feat/hex-diff`

### Summary

Implemented and verified child hex-diff-surface-correctness: shared match-span/hex-cell/file-name helpers (S3,S9); structural diffInit validation + dropped fabricated records (S5,S6); search selection pane, hidden-row navigation, per-pane independent scroll (C1,C4,C5); stash clears only on successful open (C2). Updated component-diff-view/editor-lifecycle/memory-navigation/type-safety specs. Also added C5 finding to parent PRD and created three child tasks under 09-21-hex-diff-review-followups. Gates green: check-types, lint, 1070 tests, fallow audit pass.

### Git Commits

| Hash | Message |
|------|---------|
| `d27f9f0` | refactor(webview): share match-span, hex-cell and file-name helpers (S3, S9) |
| `5f1a61a` | fix(diff): validate diffInit structurally and drop the fabricated records field (S5, S6) |
| `bfdce0f` | fix(diff): copy from the mapping pane, navigate hidden rows, keep both panes populated (C1, C4, C5) |
| `f14a4de` | fix(extension): clear the compare stash only after a successful open (C2) |
| `63a7be9` | docs(spec): capture diff per-pane scroll, boundary validation, stash-clear contracts |
| `18d3521` | docs(task): plan hex-diff review follow-ups as parent + children |

### Status

[OK] **Completed**


## Session 5: Hex diff external-change reload
<!-- trellis-session: v=2 fp=23c6c27eedc2b0fc -->

**Date**: 2026-09-22
**Task**: Hex diff external-change reload
**Branch**: `feat/hex-diff`

### Summary

Implemented and verified child hex-diff-external-change (C6/R8): ExternalChange banners made generic so the isolated diff bundle reuses them; new diffProtocol messages (diffExternalChange/diffExternalChangeError/reloadAccepted/repairAndReload/viewInNormalEditor); DiffEditorPanel watches both compared URIs (200ms debounce, per-side reload, stale-generation guard, repair + view-in-editor); diffGrid.applyReload preserves viewMode + per-pane scroll, resets selection/search; new diffReload.ts + tests. Merged origin/feat/hex-diff (latest main + integrity fix); resolved journal index conflict. Gates post-merge: check-types, lint, 1086 tests, fallow audit 0 issues. R7 label-context child deleted per user decision.

### Git Commits

| Hash | Message |
|------|---------|
| `fc7e68a` | refactor(webview): make ExternalChange banners generic over the incoming payload |
| `c92319a` | feat(diff): reload the diff view on external file changes (C6, R8) |
| `7055939` | docs(spec): capture diff external-change reload contract |
| `16bb03d` | chore(task): plan hex-diff external-change reload and record R7 drop |
| `abc6073` | Merge branch 'feat/hex-diff' of https://github.com/deviousprophet/vscode-hex-scope into feat/hex-diff |

### Status

[OK] **Completed**
