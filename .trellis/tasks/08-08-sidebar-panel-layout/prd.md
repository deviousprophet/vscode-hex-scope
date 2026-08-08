# Restructure sidebar panels + repo-wide camelCase filenames

## Goal

Final cleanup for the `08-03-webview-component-refactor` parent. Pure structural refactor; zero behavior change. Five workstreams:
(1) fold `SidebarTab` into `src/webview/components/Sidebar/Sidebar.ts` + delete the empty `sidebar/` dir;
(2) move all four sidebar child panels under `components/Sidebar/` with `*Panel/` naming, class `Inspector`→`InspectorPanel`, host var `inspector`→`inspectorPanel`;
(3) split the two fallow `split_high_impact` files (`IntegrityPanel.ts`, `InspectorPanel.ts`) so `refactoring_targets` is empty;
(4) **enforce a repo-wide camelCase filename rule** — every source + test file under `src/` with a hyphen or uppercase-first letter is renamed to lowercase-first camelCase;
(5) after the branch merges, archive `08-08-webview-integrity-review-smells` + `08-03-webview-component-refactor`.

## Requirements

### A. SidebarTab relocation
1. `export type SidebarTab = 'inspector' | 'struct' | 'integrity' | 'scripts'` moves to `components/Sidebar/Sidebar.ts`; delete `src/webview/sidebar/sidebarTypes.ts`; `src/webview/sidebar/` becomes empty. Importers: `Sidebar.ts` local; `state.ts` + `hexViewer.ts` import from `components/Sidebar/Sidebar`.

### B. Panel relocation + Inspector rename (already in working tree)
2. Panels under `components/Sidebar/<Panel>/`:
   - `Sidebar/InspectorPanel/InspectorPanel.ts` + `InspectorLabels.ts` + `InspectorPanel.css` — class `Inspector`→`InspectorPanel`, file `InspectorPanel.ts`, host var `inspectorPanel`
   - `Sidebar/StructPanel/StructPanel.ts` + `structPinsModel.ts` + `StructPanel.css`
   - `Sidebar/IntegrityPanel/IntegrityPanel.ts` + `integrityCheckModel.ts` + `IntegrityPanel.css`
   - `Sidebar/ScriptsPanel/ScriptsPanel.ts` + `ScriptsPanel.css`
3. All importers re-pointed (hexViewer.ts + tests). No barrels.
3b. Panel test suites relocated to `src/test/webview/components/Sidebar/<Panel>/<panel>.test.ts` (inspector/struct/integrity/scripts). Non-panel component tests + model/parity suites stay in place (imports updated).

### C. Fallow split_high_impact fixes (already in working tree)
4. `IntegrityPanel.ts` → sibling modules `integrityResultRender.ts`, `integrityCalculation.ts`, `integrityProfiles.ts`, `integrityHighlight.ts`. `InspectorPanel.ts` → `inspectorRender.ts`, `inspectorLabelForm.ts`. Class delegates; no suppressions/config edits. Target: `refactoring_targets: []` + 0/0/0.

### D. Repo-wide camelCase filename rule (NEW — applies to ALL of `src/`)
5. Every source + test file under `src/` whose name contains a hyphen or starts with an uppercase letter is renamed to lowercase-first camelCase. Full rename table:
   - **Core**: `src/core/struct-codec.ts`→`structCodec.ts`; `src/core/byte-tools/` dir→`byteTools/` (files inside already camelCase)
   - **Styles**: `src/webview/styles/stats-bar.css`→`statsBar.css`
   - **Tests — benchmarks**: `large-file-benchmark.ts`→`largeFileBenchmark.ts`, `memory-release-benchmark.ts`→`memoryReleaseBenchmark.ts`, `run-benchmark.ts`→`runBenchmark.ts`
   - **Tests — core**: `disposable-store.test.ts`→`disposableStore.test.ts`, `parse-performance.test.ts`→`parsePerformance.test.ts`, `search-performance.test.ts`→`searchPerformance.test.ts`, `provider-utils.test.ts`→`providerUtils.test.ts`, `scripting-runner.test.ts`→`scriptingRunner.test.ts`, `parser/{compact-parser,ihex-parser,ihex-samples,srec-parser,srec-samples}.test.ts`→camelCase, `test/core/byte-tools/crc.test.ts`→`byteTools/crc.test.ts`
   - **Tests — shared**: `parser-fixtures.ts`→`parserFixtures.ts`, `struct-test-helpers.ts`→`structTestHelpers.ts`
   - **Tests — webview**: `css-import-hook.ts`→`cssImportHook.ts`, `integrity-check-model.test.ts`→`integrityCheckModel.test.ts`, `record-page-cache.test.ts`→`recordPageCache.test.ts`, `search-engine.test.ts`→`searchEngine.test.ts`, `struct-pins-model.test.ts`→`structPinsModel.test.ts`, `webview-message-model.test.ts`→`webviewMessageModel.test.ts`
   - **Tests — webview/components**: `context-menu`→`contextMenu`, `external-change`→`externalChange`, `hex-view`→`hexView`, `record-view`→`recordView`, `search-bar`→`searchBar` (all `.test.ts`)
   - **Component dirs/files** (all 11 dirs): `ContextMenu/`→`contextMenu/`, `ExternalChange/`→`externalChange/`, `HexView/`→`hexView/`, `RecordView/`→`recordView/`, `SearchBar/`→`searchBar/`, `Toolbar/`→`toolbar/`, `Sidebar/`→`sidebar/`, and panel dirs `InspectorPanel/`→`inspectorPanel/`, `StructPanel/`→`structPanel/`, `IntegrityPanel/`→`integrityPanel/`, `ScriptsPanel/`→`scriptsPanel/`; every `.ts`/`.css` inside → camelCase (e.g. `InspectorLabels.ts`→`inspectorLabels.ts`, `HexViewRender.ts`→`hexViewRender.ts`, `Sidebar.css`→`sidebar.css`)
   - **Test component suites** → mirror: `sidebar/inspectorPanel/inspectorPanel.test.ts`, `sidebar/structPanel/structPanel.test.ts`, `sidebar/integrityPanel/integrityPanel.test.ts`, `sidebar/scriptsPanel/scriptsPanel.test.ts` (panel suites named `*Panel.test.ts` matching their component files), `contextMenu.test.ts`, `hexView.test.ts`, `searchBar.test.ts`, `externalChange.test.ts`, `recordView.test.ts`, `toolbar.test.ts`, `sidebar.test.ts`
   - Already-camelCase files are unchanged; `src/webview/styles/{base,layout,sidebar}.css`, `src/webview/{hexViewer,state,...}.ts`, `src/core/**` single-word files unchanged.
6. **Struct combine**: merge `struct.test.ts` (13 contract tests) into the `struct-ui.test.ts` deep-render harness → single `structPanel.test.ts` at `src/test/webview/components/sidebar/structPanel/structPanel.test.ts`. Dedupe the 3 overlapping areas (pointer follow/create, endian scalar render, bit-layout toggle) keeping the stronger assertion per overlap. Harness = deep-render (global `S` + `getByte`); contract callback-report assertions folded in on the same harness.
6b. **UI-only component tests**: move the non-UI logic blocks out of component test files into their owning modules' webview-level test files:
   - `context-menu.test.ts`'s `host mapping: copy-hex/ascii/c-array map to existing contextCommandResult formats` → new `src/test/webview/contextCommands.test.ts` (tests `contextCommandResult`/`copyCommandResult` from `webview/contextCommands`). Component test keeps only ContextMenu UI assertions.
   - `hex-view.test.ts`'s `clampWindowTop` assertions → new `src/test/webview/virtualScroll.test.ts` (tests `render/virtualScroll`). Component test keeps only HexView UI assertions.
   - `external-change.test.ts`'s `lock disables interactive elements...` + `lock ignores missing app root` → new `src/test/webview/lock.test.ts` (tests `updateExternalChangeLockState` from `webview/lock`). Component test keeps only ExternalChange UI assertions.
   - Result: every `src/test/webview/components/**/*.test.ts` contains UI/DOM/interaction/callback assertions only; non-component logic tests live at `src/test/webview/<module>.test.ts` (matching `search-engine.test.ts`/`webview-message-model.test.ts` placement).

### E. Docs content (filenames UNCHANGED)
7. Doc **content** updated to reflect all renames: `.trellis/spec/frontend/` `directory-structure.md`, `css-guidelines.md`, `hook-guidelines.md`, `index.md`, `components/component-*.md` Layout sections; any `src/` path + component-name references. Doc filenames stay kebab (camelCase rule applies to `src/` code only).

### F. Archiving (after merge, not part of the code diff)
8. Archive `08-08-webview-integrity-review-smells` then `08-03-webview-component-refactor` after this branch merges.

## Acceptance Criteria

- [ ] `src/webview/sidebar/` deleted; `SidebarTab` exported from `components/Sidebar/Sidebar` (→ `sidebar/sidebar.ts` after D); `hexViewer.ts` + `state.ts` import it from there.
- [ ] No hyphenated or uppercase-first filename remains under `src/` (source or test). `git ls-files src | grep -E '/[A-Z]|-|-'` → empty.
- [ ] Panel dirs under `sidebar/<panelName>/`; `InspectorPanel` class + `inspectorPanel` host var; pure-model files moved with their panels.
- [ ] Zero stale imports of old component paths (`components/{Inspector,Struct,Integrity,Scripts,SearchBar,HexView,...}/` uppercase forms) or `sidebar/sidebarTypes` anywhere in `src/`.
- [ ] Struct combined into single `structPanel.test.ts` (deep-render harness, overlaps deduped, no lost coverage — union of old assertions minus duplicates).
- [ ] Every `src/test/webview/components/**/*.test.ts` is UI-only (mount/DOM/interaction/callbacks); non-UI logic tests live at `src/test/webview/<module>.test.ts` (`contextCommands.test.ts`, `virtualScroll.test.ts`, `lock.test.ts` created).
- [ ] No behavior change: all tests pass with path/symbol-only edits.
- [ ] `npm run lint`, `npm run check-types`, `npm run compile-tests`, webview mocha suite, `npm test` all green. Fallow `total_issues 0`, `findings 0`, `clone_groups 0`, `refactoring_targets []`.
- [ ] Doc content updated (filenames unchanged).

## Notes

- Out of scope: no logic moves; class/export/type renames limited to `Inspector`→`InspectorPanel` + the host var; `.trellis/spec`, `.agents/`, `.github/` doc *filenames* unchanged; `.agents/`/`.github/` skill files + `README/CHANGELOG/AGENTS` untouched.
- Task archiving is Phase 3.5 after merge.
