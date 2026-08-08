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


## Session 3: Extract SearchBar into self-contained component (#151)

**Date**: 2026-08-03
**Task**: Extract SearchBar into self-contained component (#151)
**Branch**: `feat/webview-searchbar-component`

### Summary

Planned (grilled decisions: component owns UI state, explicit-param engine, undo to host, CSS via esbuild, hidden-attr, single-instance), implemented SearchBar component src/webview/components/SearchBar/, ran two-axis code review (standards + spec) twice, fallow-fix complexity (all axes 0), fixed CI css-import-hook isolation, split search specs (search-engine/search-bar-component/selection-inspect-copy), restructured parent+child tasks, created PR #152. All gates green: check-types, lint, 541 tests, fallow 0/0/0.

### Git Commits

| Hash | Message |
|------|---------|
| `4d86d6f` | (see git log) |
| `b56da8e` | (see git log) |
| `22ed4c6` | (see git log) |
| `b107096` | (see git log) |
| `3d2cdbb` | (see git log) |
| `4d2a5e3` | (see git log) |
| `09f21ae` | (see git log) |
| `93c3e82` | (see git log) |
| `49f2ba9` | (see git log) |
| `863b2e4` | (see git log) |
| `f82dd68` | (see git log) |

### Status

[OK] **Completed**


## Session 4: Extract HexView grid into self-contained component (#151)

**Date**: 2026-08-04
**Task**: Extract HexView grid into self-contained component (#151)
**Branch**: `feat/webview-searchbar-component`

### Summary

Planned (B presentational component, host builds cells, container-wrapper positioning, showAscii toggle, root-scoped, paintCell/paintSelection/paintMatch seams), implemented HexView component + memoryGrid host controller, fixed 2 bugs (end-of-scroll clamp both views; Edit button hide-while-editing), fallow-fix clean (0/0/0), component spec + template added, changelog Unreleased (ASCII toggle + 2 real fixes), two-axis review PASS, PR #153 open.

### Git Commits

| Hash | Message |
|------|---------|
| `98619b4` | (see git log) |
| `5dac230` | (see git log) |
| `4a8c4cc` | (see git log) |
| `8e416ec` | (see git log) |
| `9ed8ac8` | (see git log) |
| `c831bf4` | (see git log) |
| `36d66f9` | (see git log) |
| `386c240` | (see git log) |
| `effb809` | (see git log) |
| `d671b8e` | (see git log) |
| `965b3f0` | (see git log) |

### Status

[OK] **Completed**


## Session 5: Extract Toolbar into self-contained component (#151)

**Date**: 2026-08-04
**Task**: Extract Toolbar into self-contained component (#151)
**Branch**: `feat/webview-toolbar-component`

### Summary

Planned (scope=#toolbar only, report-only callbacks, host setters setView/setEditMode/setAscii/setDirty, SearchBar slot + setVisible, CSS chrome move, A-lite rerender), implemented Toolbar component + tests, fixed ASCII active lost on record->memory re-entry (review catch), two-axis review PASS, spec added, task archived. PR pending.

### Git Commits

| Hash | Message |
|------|---------|
| `5cf9913` | (see git log) |
| `5b236ec` | (see git log) |

### Status

[OK] **Completed**


## Session 6: Extract RecordView into self-contained component (#151)

**Date**: 2026-08-04
**Task**: Extract RecordView into self-contained component (#151)
**Branch**: `feat/webview-recordview-component`

### Summary

Planned (host-paging scope, render-input + onNeedPage, shared virtualScroll, null placeholder, table chrome + CSS, format in component, A-lite visibility, empty/resize host), implemented RecordView component + host paging via shared virtualScroll + clamp relocation to render/virtualScroll, column layout polish (fixed Addr/Type/Cnt/CHK, hex-view addr style, left checksum), changelog Changed entry, two-axis review PASS (F1 CSS-delta PRD addendum, F2 design format corrected), spec added + ExternalChange spec restored (was post-PR), PR #156 open.

### Git Commits

| Hash | Message |
|------|---------|
| `2698443` | (see git log) |
| `67f971f` | (see git log) |
| `799a3ab` | (see git log) |

### Status

[OK] **Completed**


## Session 7: Finish ExternalChange task + spec cleanup

**Date**: 2026-08-04
**Task**: Finish ExternalChange task + spec cleanup
**Branch**: `feat/webview-recordview-component`

### Summary

ExternalChange PR #155 merged to main; task archived (spec component-external-change.md + index row, code 0684a08 landed earlier). Stripped issue-number mentions from all component specs (Boundary rule wording cleaned).

### Git Commits

| Hash | Message |
|------|---------|
| `1d536b7` | (see git log) |

### Status

[OK] **Completed**


## Session 8: Rework ContextMenu into self-contained component (#151)

**Date**: 2026-08-04
**Task**: Rework ContextMenu into self-contained component (#151)
**Branch**: `feat/webview-context-menu-component`

### Summary

Planned (B rework scope, A direct+submenus layout, system-endian Go address 4B/valid-gate, deferred create-label), implemented ContextMenu component (render+position+dismiss+fill input), host go-address/select actions, review caught dead copy buttons (normalize copy-* in contextCommandResult) + go-address title-tooltip + dead import, two-axis review PASS, spec added, label task deferred+removed, PR #157 open.

### Git Commits

| Hash | Message |
|------|---------|
| `5b46607` | (see git log) |
| `9c73bfd` | (see git log) |
| `015da96` | (see git log) |
| `18d064e` | (see git log) |

### Status

[OK] **Completed**


## Session 9: Sidebar task — verify shell + fix endian-wipe known bug (#151)

**Date**: 2026-08-05
**Task**: Extract Sidebar into self-contained component + known-bug takeover
**Branch**: `feat/webview-sidebar-component`

### Summary

Started sidebar task (`task.py start`), took over known-bug meta from inspector child (endian toggle wipes inspector data), verified committed shell (2aa9217) — lint/check-types/266 webview tests/`npm test` green, gates pass. Closed a CSS gap: shared collapsible-section pattern (`.sb-section`/`.sb-hdr`/`.sb-body` + `::before` triangle + `.collapsed`) split between `Sidebar.css` and `styles/sidebar.css` — deduped into `Sidebar.css`. Fixed known bug via diagnose-bugs loop: `setFileEndian` called shell-rebuild `renderInspector()` instead of data-path `updateInspector()` (wiped `#insp-vals` to placeholder); regression test first (red on live-DOM wipe), one-line fix, green. Also fixed pre-existing cross-file test-state leaks found while verifying the batch: `webview-message-model.test.ts` leaked `S.endian='be'` + `S.lockedDueToExternalChange=true` (added `teardown(resetState)` + endian reset); `struct-ui.test.ts` scalar-endian test now restores `S.endian='le'`; `webview.test.ts` resetState resets `S.endian`. Added `component-sidebar.md` spec + index row. Fallow not installed — skipped.

### Git Commits

| Hash | Message |
|------|---------|
| `58d4847` | refactor(webview): extract Sidebar into self-contained component (#160) — merged to main |

### Status

[OK] **Completed — PR #160 merged (58d4847)**


## Session 10: Fallow split targets

**Date**: 2026-08-05
**Task**: Split high-impact files flagged by fallow
**Branch**: `refactor/fallow-split-targets`

### Summary

Split the three fallow `split_high_impact` targets into focused modules, behavior-preserving (no signature/behavior change): `memoryData.ts` → `memory/integrityHighlight.ts`; `SearchBar.ts` → `searchBarRender.ts` (`searchKeyFor`/`SearchTrigger`/pure helpers, consumers moved); `HexView.ts` (627→333 LOC) → `HexViewRender.ts` (pure DOM-free render + types) + `HexViewPaint.ts` (DOM paint/match utilities). Consumers import from the owning module (no re-export barrels) so class modules' fan-in drops to class consumers. Fallow now 0 issues / 0 findings / 0 dupes / 0 targets. Two-axis review: no code violations; fixed stale module headers + prd/design re-export text. Spec layout blocks (component-hex-view/search-bar .md) deliberately deferred to another branch. PR #161 draft.

### Git Commits

| Hash | Message |
|------|---------|
| `bf81a07` | refactor(webview): split high-impact fallow files |
| `(follow-up)` | docs: reconcile module headers + artifacts |

### Status

[OK] **Completed — PR #161 open (draft), awaiting merge review**


## Session 9: Extract Struct panel into self-contained component

**Date**: 2026-08-06
**Task**: Extract Struct panel into self-contained component
**Branch**: `feat/webview-struct-component`

### Summary

Extracted the Struct sidebar panel into src/webview/components/Struct/ (StructPanel.ts + StructPanel.css + structPinsModel.ts). Host hexViewer.ts rewired: injected readByte accessor, persistence via onStructsChange/onPinsChange/onStateChange callbacks, selection via onSelectRange, hex highlight via onHighlightHex. Deleted sidebar/struct/ and styles/struct.css; removed dead S.activeStructAddr. Added component spec + struct.test.ts; review findings (getByte injection, dead state) fixed. lint/check-types/671 tests green.

### Git Commits

| Hash | Message |
|------|---------|
| `1b2b0f0` | (see git log) |

### Status

[OK] **Completed**


## Session 10: Session 11: Extract Integrity panel into self-contained component

**Date**: 2026-08-08
**Task**: Session 11: Extract Integrity panel into self-contained component
**Branch**: `feat/webview-integrity-component`

### Summary

Extracted the Integrity sidebar panel into src/webview/components/IntegrityPanel/ (IntegrityPanel.ts + IntegrityPanel.css + integrityCheckModel.ts). Host hexViewer.ts rewired: byte reads via injected readByte, shared endian via getEndian, selection via getSelection, auto-fix edits via onStoredValueEdits (stageIntegrityEdits), highlight via onHighlightChange (S.integrityHighlight + rerender.memory), persistence/copy/profile CRUD via callbacks. setIntegrityEditHandler dropped; activateIntegrity lazy-init became setTabActive. Deleted sidebar/integrity/ + styles/integrity.css. Added component spec + integrity.test.ts; model + CSS moved byte-identical. lint/check-types/688 tests green; check agent APPROVED (justified deviation: getEndian pull callback). Branch feat/webview-integrity-component, PR pending.

### Git Commits

| Hash | Message |
|------|---------|
| `532f869` | (see git log) |

### Status

[OK] **Completed**
