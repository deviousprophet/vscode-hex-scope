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


## Session 12: Extract Scripts panel into self-contained component

**Date**: 2026-08-08
**Task**: Extract Scripts panel into self-contained component
**Branch**: `feat/webview-scripts-component`

### Summary

Extracted the Scripts sidebar panel into src/webview/components/Scripts/ (ScriptsPanel.ts + ScriptsPanel.css). Host hexViewer.ts rewired: list request/run/cancel via onRequestList/onRunScript/onCancelScript callbacks, selection via getSelection (currentSelectionRange), generation via getGeneration (S.documentGeneration). setRunStartCallback cross-module seam collapsed into the class. Deleted sidebar/scripts/ + removed 42 .script-* rules from styles/sidebar.css. Added component spec + scripts.test.ts (27 tests). lint/check-types/715 tests green; check agent APPROVED (2 justified deviations: render() also updates count+wires list, appendOutput resolves target from running button). Branch feat/webview-scripts-component, PR #167 draft.

### Git Commits

| Hash | Message |
|------|---------|
| `cb4662c` | refactor(webview): extract Scripts panel into self-contained component |

### Status

[OK] **Completed**


## Session 14: Close webview component refactor

**Date**: 2026-08-08
**Task**: Close webview component refactor
**Branch**: `chore/close-webview-refactor-tasks`

### Summary

-

### Git Commits

| Hash | Message |
|------|---------|
| `6f0a10e` | (see git log) |

### Status

[OK] **Completed**


## Session 13: Fix webview review findings + UI/UX heuristic review (PR #175)

**Date**: 2026-08-10
**Task**: Fix webview review findings + UI/UX heuristic review (PR #175)
**Branch**: `fix/webview-review-findings`

### Summary

Implemented D1-D7 fixes on branch fix/webview-review-findings: ResizeObserver re-slice (B1), executed-search match truth + divergence invalidation incl empty-query/mid-run cancel (B2), dead CSS link removal (B3), refreshAfterLocalEdit helper + view gate (C1), printable-gated Copy ASCII (C2), HexView paintStructHighlight seam (H1), lock prior-state restore, search aria-label/aria-live + count re-push. Ran fallow-fix (2 complexity findings fixed, fallow green) and two-axis code review (3 gaps fixed + tested). Changelog Unreleased updated with real v2.17.1->next deltas only. 721 tests green, types/lint clean. PR #175 open vs main. Filed 7 UI/UX follow-up tasks.

### Git Commits

| Hash | Message |
|------|---------|
| `32cff4d` | (see git log) |
| `80a1378` | (see git log) |
| `3c0c998` | (see git log) |
| `494999f` | (see git log) |
| `111ad7d` | (see git log) |

### Status

[OK] **Completed**


## Session 14: UI/UX follow-up fixes (7 tasks) - PR #176

**Date**: 2026-08-11
**Task**: UI/UX follow-up fixes (7 tasks) - PR #176
**Branch**: `fix/uiux-followups`

### Summary

Implemented all 7 UI/UX follow-up tasks on branch fix/uiux-followups (off main after PR #175 merged): record-view empty state, script run-button gating, Integrity profile delete/apply inline confirms (inlineConfirm exported + message param), paste-overflow toolbar status, toolbar/search responsive shrink+scroll, keyboard/ARIA pass (grid arrow-key selection via walkMappedAddress + tabindex + Menu key, context-menu role=menu/menuitem + focus + arrow/Enter nav, action buttons focusable, icon-only aria-labels), polish batch (integrity status glyph, nibble placeholder, EDITING tooltip, Ctrl+S, staged fill Escape, struct move glyphs, script log auto-scroll, reload spinner visibility, prev/next glyphs). Fixed 8 fallow complexity findings from new code (fallow 0/0/0). Stubbed requestAnimationFrame in webview test harness (jsdom has none; inlineConfirm needed it). Gate: types/lint clean, 732 tests passing. PR #176 (draft) vs main. All 7 tasks archived.

### Git Commits

| Hash | Message |
|------|---------|
| `998ec90` | (see git log) |

### Status

[OK] **Completed**


## Session 15: Fix hex-grid keyboard nav focus

**Date**: 2026-08-15
**Task**: Fix hex-grid keyboard nav focus
**Branch**: `fix/uiux-followups`

### Summary

Clicked-byte selection never focused the hex grid (mousedown preventDefault cancelled native focus), so arrow-key nav was dead until a blank-area click. HexView now focuses #memory-view on cell mousedown/contextmenu; ContextMenu restores focus to the trigger on hide; UA focus outline removed on the grid; PRD AC2 dropped as a deterministic seam (module-load listeners pin first jsdom doc) with rationale recorded; fallow complexity in show/hide split below CRAP threshold. Verified: tsc, eslint, 357 webview tests, fallow green.

### Git Commits

| Hash | Message |
|------|---------|
| `7a1b005` | (see git log) |
| `606537a` | (see git log) |
| `1973c36` | (see git log) |

### Status

[OK] **Completed**


## Session 16: Drag-select multiple address rows in hex view

**Date**: 2026-08-15
**Task**: Drag-select multiple address rows in hex view
**Branch**: `fix/uiux-followups`

### Summary

Added address-gutter drag to select multiple rows: component onAddressRowDrag (dragMode 'row', min/max normalized, mouseup stop), host selectAddressRows selecting mapped span via rowAddressSpan, 3 new gutter-drag tests, spec+changelog updated. tsc/lint/mocha green.

### Git Commits

| Hash | Message |
|------|---------|
| `971776d` | (see git log) |

### Status

[OK] **Completed**


## Session 17: Sidebar panel UI consistency (5 child migration)

**Date**: 2026-08-16
**Task**: Sidebar panel UI consistency (5 child migration)
**Branch**: `feat/ui-consistency`

### Summary

Planned parent+5-child task via grilling (D1 structured primitives, D2 tree, D3 scripts visual-only, D4 one-look-per-role). ui-primitives: .sb-btn{-primary,-secondary,-danger,-add}/.sb-input(-sm)/.sb-select/.sb-card*/.sb-status-dot in components/sidebar/sidebar.css; .compact-tabs->base.css; deleted styles/sidebar.css; added --muted-fg/--info-fg tokens; refreshed css-guidelines/component-sidebar/directory-structure specs. Migrated inspector (.lf-*->primitives, .lf-mode->.compact-tabs), struct (buttons/inputs/cards->primitives, kept borrow rules for integrity), integrity (fully decoupled from struct CSS, check found+fixed si-hdr-row/si-hex-body/sa-form-hdr leaks, deleted structPanel dead rules), scripts (visual-only, .sb-hdr header, sb-status-dot tokens, non-collapsible kept). 753 tests green each step.

### Git Commits

| Hash | Message |
|------|---------|
| `d3007d6` | (see git log) |
| `cbed3fe` | (see git log) |
| `28e28c8` | (see git log) |
| `115e8cc` | (see git log) |
| `8f98a9d` | (see git log) |

### Status

[OK] **Completed**


## Session 18: Sidebar section framework + 4-panel UX rework

**Date**: 2026-08-17
**Task**: Sidebar section framework + 4-panel UX rework
**Branch**: `feat/ui-consistency`

### Summary

Unbiased UX/UI audit of sidebar panels; 7 follow-up tasks logged. Grilled panel-by-panel redesigns (Inspector/Struct/Integrity/Scripts), planned all four, implemented+checked+committed: section shell framework with dock support, merged segments/labels with permanent rows, stacked struct sections with card menus + unified editor, integrity danger badge + profile menu + calc spinner, scripts run history + true disabled + capability gate. 777 tests green.

### Git Commits

| Hash | Message |
|------|---------|
| `dda5000` | (see git log) |
| `d7b77cb` | (see git log) |
| `15004c8` | (see git log) |
| `c933ea0` | (see git log) |

### Status

[OK] **Completed**


## Session 19: Backlog: a11y targets + copy feedback + typography floor

**Date**: 2026-08-17
**Task**: Backlog: a11y targets + copy feedback + typography floor
**Branch**: `feat/ui-consistency`

### Summary

Executed remaining UX audit backlog: full-row 24px disclosure toggle + aria-labelledby regions; copy feedback flashes + endian/width tag on multi-byte interpreter; scripts teardown flake fixed via dispose(); 10px type floor across sidebar + aria-labels on all icon-only controls; legacy .sb-hdr removed. 778 tests green.

### Git Commits

| Hash | Message |
|------|---------|
| `ac09aea` | (see git log) |
| `c79f3ab` | (see git log) |
| `35d60ac` | (see git log) |

### Status

[OK] **Completed**


## Session 20: Code-review fix batch

**Date**: 2026-08-17
**Task**: Code-review fix batch
**Branch**: `feat/ui-consistency`

### Summary

Fixed all 7 two-axis code-review findings on feat/ui-consistency: shared --ok .copied rule, registry-based document click-outside (no listener stacking), single shared popup helper for struct/integrity menus, css-guidelines reconciled to 10px floor, byteLineParts dead field removed, flashCopied race-free, card-menu opacity. 782 tests green.

### Git Commits

| Hash | Message |
|------|---------|
| `883620a` | (see git log) |

### Status

[OK] **Completed**


## Session 21: Sidebar VS Code header model

**Date**: 2026-08-18
**Task**: Sidebar VS Code header model
**Branch**: `feat/ui-consistency`

### Summary

Researched VS Code paneview.ts/viewPane.ts header + collapse animation; grilled design (whole-head toggle, always-visible actions, animate-in-place, no dock); removed bottom dock + zone-split machinery (was 3 failing tests), implemented whole-header role=button toggle with decorative chevron, keyboard nav (Enter/Space/Left/Right/Up/Down), grid 1fr->0fr collapse, plain non-collapsible heads focusable via nav; fixed jsdom activeElement identity test quirk and tabindex-1 nav gap; reconciled component-sidebar + inspector + css-guidelines specs. 784 tests green.

### Git Commits

| Hash | Message |
|------|---------|
| `7d4c219` | (see git log) |

### Status

[OK] **Completed**


## Session 22: Sidebar VS Code-exact header look

**Date**: 2026-08-18
**Task**: Sidebar VS Code-exact header look
**Branch**: `feat/ui-consistency`

### Summary

Grilled (Q1 A / Q2 A) and applied exact VS Code paneview.css header params: fixed 22px row, 11px bold uppercase nowrap-ellipsis title, decorative chevron-down first child (rotated chevron-right collapsed, translateY(1px) open) reading '> Section Name', first-section no top border + +border-top dividers, actions right 8px, non-collapsible title indent, 150ms ease-out collapse + prefers-reduced-motion 0s, body stays in DOM. css-guidelines + component-sidebar specs reconciled. 784 tests green.

### Git Commits

| Hash | Message |
|------|---------|
| `ac71f09` | (see git log) |

### Status

[OK] **Completed**


## Session 23: Sidebar PaneView (resizable collapsible sections)

**Date**: 2026-08-18
**Task**: Sidebar PaneView (resizable collapsible sections)
**Branch**: `feat/ui-consistency`

### Summary

Grilled (Q1-A..Q5-A) and ported VS Code PaneView/SplitView: panels = flex pane-views; each section a resizable pane (22px header + independent scroll); drag sashes between sections (ArrowUp/Down +-10, dblclick 50/50, role=separator); collapse animates flex-basis 150ms and bottom-packs slim headers; expand restores last size / first-time 50/50; sizes persist to localStorage with clamp + invalid-drop; all sections collapsible (non-collapsible variant removed). Check agent fixed expand-order scramble, stale sash aria-label, focusable disabled sash. 796 tests green.

### Git Commits

| Hash | Message |
|------|---------|
| `b93e57a` | (see git log) |

### Status

[OK] **Completed**


## Session 24: PaneView in-place collapse fix

**Date**: 2026-08-18
**Task**: PaneView in-place collapse fix
**Branch**: `feat/ui-consistency`

### Summary

Grill Q1-A: replaced bottom-pack DOM move with VS Code-true in-place collapse — collapsed panes stay in DOM order at 22px, expanded panes fill free space. Removed packCollapsed/restoreOrder, disabled-sash state (aria-disabled/tabindex toggling), dynamic sash relabeling; sashes static between their panes. Fixes first-pane-collapse jump. Specs + tests updated. 796 green.

### Git Commits

| Hash | Message |
|------|---------|
| `37eb2b0` | (see git log) |

### Status

[OK] **Completed**


## Session 25: PaneView even first-expand + drag-lag fix

**Date**: 2026-08-18
**Task**: PaneView even first-expand + drag-lag fix
**Branch**: `feat/ui-consistency`

### Summary

First-time expand (no persisted size) now splits evenly across all expanded panes (siblings' saved sizes not kept) - fixes Labels opening tiny next to a large Inspector. Sash drags disable the flex-basis transition (sb-pane-view.dragging) so panes track the cursor exactly. 2 new tests; spec updated. 798 green.

### Git Commits

| Hash | Message |
|------|---------|
| `cb8312b` | (see git log) |

### Status

[OK] **Completed**


## Session 26: Archive consolidation + PR task map

**Date**: 2026-08-18
**Task**: Archive consolidation + PR task map
**Branch**: `feat/ui-consistency`

### Summary

Archived-task cleanup (grill Q1-B): folded 2 PaneView follow-up dirs into sidebar-paneview/iterations/ and the header exact-look task into sidebar-header-vscode/iterations/; added archive/2026-08/PR-consolidation-note.md mapping the full feat/ui-consistency deliverable trail. 19 archive dirs now; full history preserved in git + journals 18-25.

### Git Commits

| Hash | Message |
|------|---------|
| `2ebace5` | (see git log) |

### Status

[OK] **Completed**


## Session 27: PR192 review fix batch (grilled Q1-Q7)

**Date**: 2026-08-19
**Task**: PR192 review fix batch (grilled Q1-Q7)
**Branch**: `feat/ui-consistency`

### Summary

Fixed all PR192 two-axis review findings per grilling: (Q1) first-time expand keeps user/persisted sibling sizes via a new user flag separating adjusted vs auto-default sizes; allocatePanes reworked (persisted exact, fresh equal, lone pane fills pool); (Q2) sash persists once on release; (Q3) disabled sash state restored next to collapsed panes; (Q4) structPanel mount indent; (Q5) none; (Q6) real disabled attribute on untrusted/ts-blocked script run buttons; (Q7) capability approval resets when a script file changes via mtime fingerprint flowing core->protocol->webview, clear-results keeps approval. 802 tests green.

### Git Commits

| Hash | Message |
|------|---------|
| `2d2eb70` | (see git log) |

### Status

[OK] **Completed**


## Session 28: fallow-clean refactor

**Date**: 2026-08-19
**Task**: fallow-clean refactor
**Branch**: `feat/ui-consistency`

### Summary

Running fallow-fix skill: 3 dead-code exports removed (byteLineParts, mergeForDisplay, openMenuPopup — module-internal); 28 complexity findings refactored below cyclo 4 via extracted boolean helpers and split loop bodies across sidebar.ts, structPanel.ts, scriptsPanel.ts, utils.ts, integrity/inspector panels; 1 dup group eliminated. Robustified the fingerprint test (modify-and-rescan instead of same-ms uniqueness). Fallow fully green (0 issues / 0 findings / 0 dupes, exit 0). 802 tests pass

### Git Commits

| Hash | Message |
|------|---------|
| `2802b22` | (see git log) |

### Status

[OK] **Completed**


## Session 29: PaneView reopen-restore fix + thicker sash

**Date**: 2026-08-19
**Task**: PaneView reopen-restore fix + thicker sash
**Branch**: `feat/ui-consistency`

### Summary

diagnosing-bugs: built throwaway repro harness (compiled SidebarSections), confirmed reopen gave MIN (82) instead of the resized 209. Root cause: layout() re-baselined a user pane's saved to its temporary full-height fill while the sibling collapsed, over-claiming the pool on reopen. Grilled Q1-A (persist wins, untouched=even). TDD: red regression test then fix - user sizes only change via user actions, layout never rebaselines/persists them; lone-pane fill is display-only. Sash thickened 3->6px (SASH_H + CSS + test literals). Persistence semantics: px (not %) in localStorage; grown sibling no longer persisted; oversized keys stay raw (display clamps). 803 tests green, fallow 0.

### Git Commits

| Hash | Message |
|------|---------|
| `84b7ac2` | (see git log) |

### Status

[OK] **Completed**


## Session 30: Host-only expiring copy confirmation + byte-line cleanup

**Date**: 2026-08-19
**Task**: Host-only expiring copy confirmation + byte-line cleanup
**Branch**: `feat/ui-consistency`

### Summary

Grilled + implemented: copy feedback consolidated to the host status-bar notification (expires after 2s) - 'Copied: N bytes' for ranges, copied value for scalars; local flash reduced to green .copied tint (no text swap). Byte-line drops the redundant [N bytes] prefix (address bar carries it), tooltip 'Click to copy N bytes', count flows via data-copy-count. 803 tests green.

### Git Commits

| Hash | Message |
|------|---------|
| `0bd739a` | (see git log) |

### Status

[OK] **Completed**


## Session 31: Webview copy toast component

**Date**: 2026-08-20
**Task**: Webview copy toast component
**Branch**: `feat/ui-consistency`

### Summary

Grilled design (placement near-click + top-center fallback, single channel, custom-text param) and implemented src/webview/components/toast.ts + toast.css: generic showToast(message, x?, y?), required message no default; 'Copied ✓' passed by call sites. 150ms in/1s hold/250ms out, replace-on-rapid, reduced-motion instant, role=status + aria-live, isConnected recreate. Wired ALL webview copy paths: sidebar chips/byte-line/mi-values, integrity value copy, struct field/addr copies, hex-view context-menu copy. Host copyText status-bar notice removed (clipboard write stays). 808 tests, fallow 0. Archived.

### Git Commits

| Hash | Message |
|------|---------|
| `2acc94a` | (see git log) |

### Status

[OK] **Completed**


## Session 32: Byte-line copies full selection

**Date**: 2026-08-21
**Task**: Byte-line copies full selection
**Branch**: `feat/ui-consistency`

### Summary

Grill Q1-A: byte-line click now copies the FULL selection (tooltip 'Click to copy N bytes' made true); display stays compact (first <=8 + ellipsis, never copied). TDD red-first; inspector spec line updated. 808 tests green.

### Git Commits

| Hash | Message |
|------|---------|
| `4785391` | (see git log) |

### Status

[OK] **Completed**


## Session 33: Labels rework: renamable pinned segments + selection-driven form

**Date**: 2026-08-21
**Task**: Labels rework: renamable pinned segments + selection-driven form
**Branch**: `feat/ui-consistency`

### Summary

Issue #189 follow-ups (grilled Q1-Q5): pinned segment rows renamable via existing label form (Name editable, rest read-only), persisted as segmentNames overrides in workspaceState riding saveLabels; custom name displayed, parsed name in tooltip. All label rows show start-end-size (segment style). Label form mirrors hex-view selection focus-aware: last-focused field receives clicks (Range auto-switches to End addr + fills), drag-fill per mode, manual input protected. Check fixed indentation + spec drift, accepted workspaceState-key deviation. 822 tests green.

### Git Commits

| Hash | Message |
|------|---------|
| `2abb188` | (see git log) |

### Status

[OK] **Completed**


## Session 34: fallow-clean labels form

**Date**: 2026-08-21
**Task**: fallow-clean labels form
**Branch**: `feat/ui-consistency`

### Summary

fallow-fix on the labels-rework changes: 5 findings (2 critical, 3 moderate) refactored below cyclo 4 - updateLabelFormSel split into openFormTargets guard + fillRangeFromSelection/fillStartAndRange with endOrEmpty/lengthOrEmpty helpers; labelFormHtml decomposed into per-field builders + formMode; saveLabel warning gate extracted; applySegmentRename override logic in setSegmentNameOverride. Fallow fully green. 822 tests pass.

### Git Commits

| Hash | Message |
|------|---------|
| `bb94ef0` | (see git log) |

### Status

[OK] **Completed**


## Session 35: Label form redesign: End Address default, auto-calc chips, live draft grid preview, inline segment rename

**Date**: 2026-08-21
**Task**: Label form redesign: End Address default, auto-calc chips, live draft grid preview, inline segment rename
**Branch**: `feat/ui-consistency`

### Summary

Redesigned Inspector label form (create/edit): End Address default mode, bidirectional auto-calc chips (fmtB size / end-addr), Title Case labels + monospace hex inputs, swatch buttons with ring + aria-pressed, right-aligned Cancel/Add, Esc/Enter + autofocus, and a live draft-range preview painted into the hex grid via onLabelDraftChange -> S.labelDraft -> HexView.paintLabelDraft. Replaced pinned-segment rename form with an inline name editor (Enter commit / Esc revert / blur commit; blank clears override). Single-line mode switch. 831 tests green.

### Git Commits

| Hash | Message |
|------|---------|
| `383b3b6` | (see git log) |
| `6993c17` | (see git log) |

### Status

[OK] **Completed**


## Session 36: Integrity panel: check names + autofill + profile rework

**Date**: 2026-08-22
**Task**: Integrity panel: check names + autofill + profile rework
**Branch**: `feat/ui-consistency`

### Summary

Optional check name (fallback algorithm label, 40-char cap, persisted via config normalize); add-check autofill selection->full-file->blank plus label-parity live refill (focus-targeted, end-only when end focused, never on keystrokes); integrity header Profile label + Fix all/Add same line, dropdown select + visible Save-as + Update/Rename/Delete menu; auto-apply on select w/ revert-on-cancel confirm; no placeholder, empty hint, preselect-first; sb-btn-add header height parity; sb-tab-panel wrapper flex fix. 840 tests green, trellis-check PASS.

### Git Commits

| Hash | Message |
|------|---------|
| `638e967` | (see git log) |

### Status

[OK] **Completed**


## Session 37: Script hex.write staging: Apply & Save / Discard

**Date**: 2026-08-22
**Task**: Script hex.write staging: Apply & Save / Discard
**Branch**: `feat/ui-consistency`

### Summary

scriptResult carries pendingWrites (addr/value); Scripts panel writes row becomes actionable Apply & Save (stages mapped bytes into S.edits then saveEdits) / Discard (clears stored writes). Legacy count-only payload keeps plain notice. Optional protocol field + callbacks; backward compatible. Root-caused prior write-patch.js no-op: pendingWrites were counted but never applied. 843 tests green.

### Git Commits

| Hash | Message |
|------|---------|
| `05afdfd` | (see git log) |

### Status

[OK] **Completed**


## Session 38: Fast edit save + undo across save

**Date**: 2026-08-22
**Task**: Fast edit save + undo across save
**Branch**: `feat/ui-consistency`

### Summary

saveEdits now spliceEditedLines (regex line scan, owner records only + checksum), skips materialize/reparse, folds into host segments; light savedEdits {generation}; webview folds S.edits locally + clears overlay only, keeps undo/redo/edit mode (Ctrl+Z reverts a save). Legacy parseResult fallback kept. 849 tests green. Specs updated.

### Git Commits

| Hash | Message |
|------|---------|
| `ed9aad3` | (see git log) |

### Status

[OK] **Completed**


## Session 39: Save watcher horizon + positional writes

**Date**: 2026-08-22
**Task**: Save watcher horizon + positional writes
**Branch**: `feat/ui-consistency`

### Summary

1s self-write horizon replaces one-shot suppressReload in onExternalChange (save/repair stamp lastSelfWriteAt) so own writes never surface as external change. buildSplicePlan returns newRaw + byte patches with cumulative offsets; saveEdits writes only edited record ranges via node:fs fd (r+), silent whole-file fallback on non-ASCII/length-change/fs error; parity asserted. 853 tests green. Specs updated.

### Git Commits

| Hash | Message |
|------|---------|
| `9944e56` | (see git log) |

### Status

[OK] **Completed**


## Session 40: Bit-field parent byte selection fix

**Date**: 2026-08-22
**Task**: Bit-field parent byte selection fix
**Branch**: `fix/bitfield-parent-byte-selection`

### Summary

Fixed #179: clicking a bit-field container's parent row selected the sum of children storage bytes (6) instead of one storage unit (2). structGroupByteCount now returns decodedRowByteCount(rows[0]) for non-array bit-units; arrays keep unit*count. Added regression test (fails pre-fix, passes post-fix; full structPanel suite 54 passing). Updated CHANGELOG [Unreleased]/Fixed. Draft PR #195.

### Git Commits

| Hash | Message |
|------|---------|
| `8563b90` | (see git log) |
| `9c43c3f` | (see git log) |

### Status

[OK] **Completed**
