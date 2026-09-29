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


## Session 9: Share the parse worker with the hex editor
<!-- trellis-session: v=2 fp=11eaa4b3602b2b3e -->

**Date**: 2026-09-22
**Task**: Share the parse worker with the hex editor
**Branch**: `feat/shared-parse-worker`

### Summary

One parse worker (src/parse/parseWorker.ts) now dispatches diffParse | hexParse; hex initial load + external change parse off the extension-host thread via a shared runParseJob client, with cloneable serialize/hydrate of CompactParseResult. Loading-card CSS deduped onto base.css and the label formatter moved to webview utils (no UI in core). Decoupled core struct tests from webview state. All gates green: 1127 tests, fallow clean.

### Git Commits

| Hash | Message |
|------|---------|
| `3de465b` | feat(parse): share the parse worker with the hex editor |
| `7c8a188` | refactor(webview): dedupe the loading-card label and CSS |
| `f742b99` | test: decouple core struct tests from webview state |
| `930b6db` | docs(spec): document the shared parse worker and loading-card layout |

### Status

[OK] **Completed**


## Session 10: Fix spurious external-change banner on hex file copy
<!-- trellis-session: v=2 fp=fd27d3ce3b72ef6d -->

**Date**: 2026-09-22
**Task**: Fix spurious external-change banner on hex file copy
**Branch**: `fix/copy-external-change`

### Summary

Copied hex files auto-opened with a spurious external-change banner: the per-document FileSystemWatcher's onDidCreate fired for the newly created copy. Added src/core/documentExternalChange.ts (createExternalChangeGate: drop events before initial load, within the 1s self-write horizon, or when content is unchanged), wired it into HexEditorSession.onExternalChange + onProfileChanged, and added src/test/core/documentExternalChange.test.ts. Red->green loop shown; check-types/lint/npm test (1131) pass; fallow GREEN. Updated editing-save-external-change.md + directory-structure.md.

### Git Commits

| Hash | Message |
|------|---------|
| `0d6414e` | fix(editor): suppress spurious external-change banner on file copy |

### Status

[OK] **Completed**


## Session 11: Reusable bit-field types
<!-- trellis-session: v=2 fp=8f99cce91611427f -->

**Date**: 2026-09-27
**Task**: Reusable bit-field types
**Branch**: `feat/struct-overlay-types`

### Summary

Added a kind discriminator (struct/bitfield/enum) to the struct pool: bitfield defs own baseType + children, fields reference via type:'bitfield' + refStructId, and a single materialize seam rewrites refs to inline containers at the decode/size/C entry points so output stays byte-identical. Inlined rendering, pin-safe delete with orphan stripping, bit-field authoring form + kind badge + picker.

### Main Changes

- StructDef gains kind/baseType/bitFields; StructFieldType widens with 'bitfield'; schema + normalizer + validator updated.
- materializeBitFieldRefs seam applied at decodeStruct/structByteSize/structToC/resolveStructFieldByPath; validation runs on the authored form.
- Instance view inlines referenced children with no extra level; field picker Bit-field group; bit-field form (base width + child rows) + kind badge; pin-safe delete strips orphan refs.

### Git Commits

| Hash | Message |
|------|---------|
| `eacf2cd` | feat(struct): reusable bit-field types |
| `f7930c4` | docs(spec): document reusable bit-field types and the materialize seam |
| `2135ea2` | docs(task): plan the struct overlay type children |

### Testing

- [OK] npm run check-types, npm run lint, npm run compile-tests && npm test -> 1166 passing, 0 failing.

### Status

[OK] **Completed**

### Next Steps

- Implement child 09-27-enum-types.


## Session 12: Enum support for fields and bit values
<!-- trellis-session: v=2 fp=20d74e7b6126cf1a -->

**Date**: 2026-09-27
**Task**: Enum support for fields and bit values
**Branch**: `feat/struct-overlay-types`

### Summary

Added kind:'enum' defs (baseType + name/value entries) to the struct pool; scalar fields reference via type:'enum' + refStructId, bit-field children via refStructId. Decode is presentation-only (additive enumLabel; bytes/offset/endianness/allocation unchanged vs an integer of the base width) and one shared formatter renders NAME (0xNN) with numeric fallback for scalar rows and enum-ref bit children.

### Main Changes

- types.ts + schema: StructFieldType 'enum', EnumEntry, StructDef.entries, BitFieldChild.refStructId, STRUCT_FIELD_TYPES drift guard.
- structCodec: enum sizing via the materialize seam, validateEnumDefShape/validateEnumReference, presentation-only decode with enumLabel, matchEnumEntry/formatEnumLabel/enumHexDigits/enumValueBound, enum C preview; structNormalization sanitizes entries + dangling refs identity-preservingly.
- structPanel: enum badge + form (base width + entry rows with range validation), enum field picker, per-bit-child enum picker; pin-safe delete strips scalar enum fields and clears bit-child refs.

### Git Commits

| Hash | Message |
|------|---------|
| `ed9ace9` | feat(struct): enum labels for fields and bit values |
| `673c557` | docs(spec): document enum types and label formatting |

### Testing

- [OK] npm run check-types, npm run lint, npm run compile-tests && npm test -> 1201 passing, 0 failing.

### Status

[OK] **Completed**

### Next Steps

- Implement remaining children: 09-27-hidden-struct-fields, 09-27-type-kind-creation.


## Session 13: Type-kind creation and pure-struct trim
<!-- trellis-session: v=2 fp=08037aab73b016ed -->

**Date**: 2026-09-28
**Task**: Type-kind creation and pure-struct trim
**Branch**: `feat/struct-overlay-types`

### Summary

One New Type chooser with three kinds (struct/bit-field/enum) replacing the standalone bitfield/enum actions; the pure-struct editor drops all inline bit-field authoring (bit toggle, child rows, Bits/Alloc columns, per-field and struct-level Alloc) keeping Endian; legacy inline bit-field containers migrate to standalone reusable types on load via migrateInlineBitFields, pool-wide deduped, idempotent, byte-identical on decode.

### Main Changes

- structCodec.ts: exported migrateInlineBitFields (signature dedupe incl. child enum refs, lowest-unused migrated_bitfield_<n> ids, unique names, override passthrough, bitFields/bitFieldsCollapsed cleared, idempotent).
- structNormalization.ts: runs migration after identity dedupe and ORs changed into the self-heal flag. structPanel.ts/.css: _choosingKind three-tile picker, editorHtml kind dispatch, removed #sm-add-bitfield-btn/#sm-add-enum-btn, trimmed the pure-struct grid to 7 columns and deleted dead bit-child/alloc helpers.
- Specs: struct-model (migration contract), component-sidebar-struct-panel (chooser + trim + common mistakes), state-management (normalization wiring).

### Git Commits

| Hash | Message |
|------|---------|
| `238b70c` | feat(struct): unify type creation and trim the pure-struct editor |
| `d65cf5f` | docs(spec): document the kind chooser, pure-struct trim, and inline-bitfield migration |

### Testing

- [OK] npm run check-types, npm run lint, npm run compile-tests && npm test -> 1210 passing, 0 failing; check caught + fixed a migration signature that dropped child enum refs (data loss).

### Status

[OK] **Completed**

### Next Steps

- Implement the remaining child 09-27-hidden-struct-fields, then the parent struct-overlay-types integration review.


## Session 14: Hide struct fields in the instance view
<!-- trellis-session: v=2 fp=211318045704c2d5 -->

**Date**: 2026-09-28
**Task**: Hide struct fields in the instance view
**Branch**: `feat/struct-overlay-types`

### Summary

Added StructField.hidden (persisted, editor Hide checkbox, false omitted) plus a per-profile showHiddenFields toggle in the Struct Instances header. Hidden fields are filtered at the decode-to-render seam by resolving the declared field by path (leaf/composite/nested/array/bit-unit), so containers drop their subtree; decode, offsets, and the C preview are unchanged.

### Main Changes

- types.ts + structs.schema.json: hidden?: boolean; normalizeOptionalFieldFlags preserves true and drops explicit false (identity-preserving, no spurious self-heal).
- profiles.schema.json + ProfileRecord.showHiddenFields (default false) threaded through showHiddenFieldsOrDefault, init/perFileDataChange, S, appModel/webviewMessageModel, saveShowHiddenFields + host handler, panel setter, and a showHiddenFieldsChanged invalidation effect.
- structPanel editor Hide checkbox (grid 7->8 columns); global Show hidden toggle re-renders instances without reloading an open editor draft. Specs/docs updated: struct-model, struct-instance-display, type-safety, hexscope-storage, state-management, component-sidebar-struct-panel, docs/HEXSCOPE_STORAGE.md.

### Git Commits

| Hash | Message |
|------|---------|
| `22c67e5` | feat(struct): hide fields in the instance view |
| `63ec80a` | docs(spec): document hidden fields and the show-hidden toggle |

### Testing

- [OK] npm run check-types, npm run lint, npm run compile-tests && npm test -> 1228 passing, 0 failing.

### Status

[OK] **Completed**

### Next Steps

- Parent 09-27-struct-overlay-types integration review (all 4 children archived), then finish-work on the parent.


## Session 15: Struct overlay review follow-ups
<!-- trellis-session: v=2 fp=29eb5cdcfe9a420c -->

**Date**: 2026-09-29
**Task**: Struct overlay review follow-ups
**Branch**: `feat/struct-overlay-types`

### Summary

Resolved the two-axis code-review findings on feat/struct-overlay-types: single-sourced the unsigned-width predicate and byte-endian fold (core exports, panel clones deleted), one isPointerBlocked predicate, hardened materialize against pointer containers, shared 10px badge primitive, in-place show-hidden toggle (no innerHTML rebuild), restored per-field Alloc authoring on bit-field-reference rows, and a host-side deletion confirm that counts referencing fields.

### Main Changes

- structCodec.ts/types.ts: exported isUnsignedScalarType + bytesToBigUint, added STRUCT_BASE_TYPES + countStructFieldRefs, materialize drops isPointer, documented the migrated-id scan.
- structPanel.ts/.css: shared helpers consumed, isPointerBlocked, in-place instances refresh, bit-field-ref Alloc authoring (9-col grid); hexEditorSession.ts saveShowHiddenFields normalizes via showHiddenFieldsOrDefault and threads the referencing-field count into the delete modal.
- Tests: shared-helper contracts, alloc round-trip/swap, nested-struct deletion, R18 composition (hidden + bit-field-ref + enum), R19 non-vacuous parity golden (instance view hash + C literal), R20 host/seam chain, STRUCT_BASE_TYPES schema parity. Specs updated: struct-model, struct-instance-display, component-sidebar-struct-panel, css-guidelines, state-management, type-safety.

### Git Commits

| Hash | Message |
|------|---------|
| `c182fae` | fix(struct): resolve the struct-overlay review findings |
| `6bbf988` | docs(spec): document the review rulings and corrected contracts |
| `331d05a` | docs(task): plan the review follow-ups and defer the panel split |

### Testing

- [OK] npm run check-types, npm run lint, npm run compile-tests all exit 0; npm test 1238 passing, 1 failing - the failing copyText clipboard test reproduces on the stashed baseline (headless Electron clipboard), pre-existing/environmental.

### Status

[OK] **Completed**

### Next Steps

- Parent struct-overlay-types final integration review; deferred child 09-29-struct-panel-module-split remains open.


## Session 16: Struct overlay types — parent integration review and close
<!-- trellis-session: v=2 fp=d37f281eec9a4cb6 -->

**Date**: 2026-09-29
**Task**: Struct overlay types — parent integration review and close
**Branch**: `feat/struct-overlay-types`

### Summary

Final integration review of the struct-overlay parent: all four feature children plus the review follow-ups are archived, the parent acceptance criteria are met (struct-only load, legacy inline migration byte-identity, one creation entry point/three kinds, unused-feature parity, feature composition, no issue refs, struct-termed naming), and the parent is archived. The only red test is the pre-existing environmental clipboard test. The deferred structPanel module split is tracked separately and no longer a parent child.

### Main Changes

- Follow-ups commit c182fae resolved the review findings; parity/composition/seam tests close the cross-child acceptance criteria.
- Parent PRD acceptance criteria ticked and child map updated; parent archived to archive/2026-09.

### Git Commits

(No commits - planning session)

### Testing

- [OK] npm run check-types, npm run lint, npm run compile-tests exit 0; npm test 1238 passing / 1 pre-existing environmental clipboard failure.

### Status

[OK] **Completed**

### Next Steps

- Optionally implement 09-29-struct-panel-module-split, then open the PR from feat/struct-overlay-types.


## Session 17: Split structPanel into renderer and editor modules
<!-- trellis-session: v=2 fp=dcd2745912209dce -->

**Date**: 2026-09-29
**Task**: Split structPanel into renderer and editor modules
**Branch**: `feat/struct-overlay-types`

### Summary

Behaviour-preserving extraction of five clusters from structPanel.ts (5712 -> 2846 lines) into sibling modules: structCPreview, structBinaryView, structEditorFields, structValueFormat, structRowRenderer. StructPanel stays the orchestrator; public API/StructCallbacks unchanged; hexViewer.ts, structPanel.test.ts, structPinsModel.ts and the single structPanel.css untouched.

### Main Changes

- Pure clusters take explicit args; wide clusters share one narrow StructRenderCtx built per wrapper call (endian/alloc/showHidden/defaultValType snapshotted per call; structs/fieldValTypes/expansion sets live references).
- Extraction order: C preview -> binary view -> editor fields -> value format -> row renderer (value format -> binary view; row renderer -> both; no runtime import cycle). Specs updated: directory-structure ownership tree + component-sidebar-struct-panel layout, StructPanel.ts casing corrected to structPanel.ts.

### Git Commits

| Hash | Message |
|------|---------|
| `53c339c` | refactor(webview): split structPanel into renderer and editor modules |
| `bb1df87` | docs(spec): list the extracted structPanel modules |
| `5de9da6` | docs(task): plan the structPanel module split |

### Testing

- [OK] npm run check-types, npm run lint, npm run compile-tests exit 0; npm test 1239 passing / 0 failing. Checker AST parity proof: 266 extracted function pairs order-identical, 0 reorder flags; no test assertion touched.

### Status

[OK] **Completed**

### Next Steps

- Branch feat/struct-overlay-types is feature-complete (parent + all children archived); open the PR.


## Session 18: Move struct modules into src/core/struct/
<!-- trellis-session: v=2 fp=79a234aa2d651937 -->

**Date**: 2026-09-30
**Task**: Move struct modules into src/core/struct/
**Branch**: `feat/struct-overlay-types`

### Summary

Pure path move: relocated the five core struct modules (structCodec, structNormalization, structMigration, structIdentities, structBitChildren) into src/core/struct/ with git mv, updated every importer and the spec/doc path references. No behaviour change.

### Main Changes

- 5 files moved (names unchanged, renames detected); 5 './types' -> '../types' rewrites; 4 intra-set specifiers unchanged; 22 importer specifiers rewritten preserving each site's .js/no-.js convention; hexEditorProvider re-export shim intact.
- Docs: directory-structure tree + Deep Module Seams, struct-model, struct-instance-display, state-management, component-sidebar-struct-panel, hexscope-storage, docs/HEXSCOPE_STORAGE.md.

### Git Commits

| Hash | Message |
|------|---------|
| `a9f2bcd` | refactor(core): move struct modules into src/core/struct/ |
| `7ad2bda` | docs(spec): update struct module paths for src/core/struct/ |
| `93fa7d5` | docs(task): plan the core/struct module move |

### Testing

- [OK] npm run check-types, npm run lint, npm run compile-tests exit 0; npm test 1239 passing / 0 failing; fallow GREEN (dead-code 0 / complexity 0 / duplication 0).

### Status

[OK] **Completed**

### Next Steps

- Push feat/struct-overlay-types to update PR #255.
