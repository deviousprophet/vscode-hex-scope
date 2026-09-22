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


## Session 6: Hex diff spec/doc reconciliation
<!-- trellis-session: v=2 fp=04f8b6d853ce24ab -->

**Date**: 2026-09-22
**Task**: Hex diff spec/doc reconciliation
**Branch**: `feat/hex-diff`

### Summary

Implemented and verified child hex-diff-spec-doc-reconcile: updated directory-structure.md Module Ownership tree with every new runtime owner (diff/, webview/diff/, core diff modules, shared matchSpans/hexCells/pathName); recorded the src/diffProtocol.ts carve-out alongside webviewProtocol.ts (state-management/type-safety too); corrected the loadProgress.ts read/parse comment to 0->0.05 read split (host/concurrent) vs worker parse; reconciled R30 wording (reads host-side, parse parallel); fixed S7 diff.css splitter fallback to var(--border); waived S8/S10 in a new css-guidelines.md Exception Log; recorded B1-B4 keep decisions + R7 dropped in component-diff-view.md. Doc/CSS/comment-only, no runtime change. Gates: check-types/lint/1086 tests/fallow pass. All three review-follow-up children now archived.

### Git Commits

| Hash | Message |
|------|---------|
| `5820f89` | docs(diff): correct the loadProgress read/parse comment (S4, C3) |
| `35d3a51` | style(diff): fall back the splitter color to the border token (S7) |
| `13d4235` | docs(spec): reconcile hex-diff ownership, R30 wording, B1-B4 decisions (S1, S2, A3) |
| `d776390` | chore(task): record hex-diff spec/doc reconciliation |

### Status

[OK] **Completed**


## Session 7: DiffView scroll glitch: wrapper reposition, scroll anchoring, viewport overscan
<!-- trellis-session: v=2 fp=1de6a80fe4510c64 -->

**Date**: 2026-09-22
**Task**: DiffView scroll glitch: wrapper reposition, scroll anchoring, viewport overscan
**Branch**: `feat/hex-diff`

### Summary

Fixed the blank/jittery active-scroll pane in the hex diff view across three compounding causes. 1) renderScrollSlice skip path now repositions the compressed rows wrapper every frame (repositionPane) so the slice tracks native scrollTop, without rebuilding row HTML. 2) Disabled browser scroll anchoring on .mem-scroll (overflow-anchor: none) since the host owns scroll position and virtualization's per-frame DOM rewrites were being treated as layout shifts. 3) Made overscan viewport-scaled: overscanRowCount (shared in render/virtualScroll.ts) floors at 10 rows and grows to one full viewport per side; applied to the diff panes and the memory grid (at mount and, newly, on resize). Renamed VIRTUAL_SCROLL_CONFIG.bufferSize to minBufferSize. Added regression tests for wrapper repositioning and overscan; shared-helper unit test. tsc, lint, and npm test (1089 passing) all clean.

### Git Commits

| Hash | Message |
|------|---------|
| `59c3409` | fix(diff): reposition compressed rows wrapper on every scroll frame |
| `5b13255` | fix(diff): disable scroll anchoring on the hex scroll container |
| `ed75695` | refactor(vscroll): share viewport-scaled overscan across grid hosts |

### Status

[OK] **Completed**


## Session 8: DiffView search latency: incremental paint + single-render jump
<!-- trellis-session: v=2 fp=2d4613bff881f7a9 -->

**Date**: 2026-09-22
**Task**: DiffView search latency: incremental paint + single-render jump
**Branch**: `feat/hex-diff`

### Summary

Cut DiffView search latency: streamed batches repaint matches incrementally via a new DiffView.paintMatch (no double-pane innerHTML rebuild), a jump is one setSearchMatches + one scrollToActive, and a one-shot programmatic-scroll guard suppresses the redundant poll render. Gates green (tsc, lint, npm test 1117, fallow 0, audit pass); diffSearch.ts untouched (R2 already held). Also in this session: DiffView component extraction (3f60400) and the Show diff separator line (8c7d9bf).

### Git Commits

| Hash | Message |
|------|---------|
| `68d6090` | perf(diff): incremental match paint and single-render search jump |

### Status

[OK] **Completed**
