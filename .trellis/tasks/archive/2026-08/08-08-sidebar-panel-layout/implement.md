# Implement — Sidebar panel layout restructure + fallow splits

Task: `.trellis/tasks/08-08-sidebar-panel-layout`. Pure structural refactor; zero behavior change. Three workstreams per design.md.

## Preconditions
- Branch `refactor/sidebar-panel-layout` (off updated `main`). lint/check-types/webview tests green before.
- Read specs: `component-sidebar.md`, `component-template.md`, `component-sidebar-integrity-panel.md`, `directory-structure.md`, `css-guidelines.md`, `quality-guidelines.md`.

## Checklist

### Workstream A — SidebarTab relocation
1. Add `export type SidebarTab = 'inspector' | 'struct' | 'integrity' | 'scripts';` to `components/Sidebar/Sidebar.ts`.
2. `Sidebar.ts`: drop its `import type { SidebarTab } from '../../sidebar/sidebarTypes'` (now local).
3. `state.ts`: `import type { SidebarTab } from '../components/Sidebar/Sidebar';`
4. `hexViewer.ts`: `import type { SidebarTab } from './components/Sidebar/Sidebar';`
5. Delete `src/webview/sidebar/sidebarTypes.ts`; confirm `src/webview/sidebar/` empty.

### Workstream B — Panel relocation + Inspector rename
6. `git mv` panels into `components/Sidebar/<Panel>/`:
   - `Inspector/` → `Sidebar/InspectorPanel/` (files `Inspector.ts`→`InspectorPanel.ts`, `Inspector.css`→`InspectorPanel.css`; `InspectorLabels.ts` moves as-is)
   - `Struct/` → `Sidebar/StructPanel/`
   - `Integrity/` → `Sidebar/IntegrityPanel/`
   - `Scripts/` → `Sidebar/ScriptsPanel/`
7. Rename class `Inspector` → `InspectorPanel` in `InspectorPanel.ts` (+ header comment); host `hexViewer.ts`: `new InspectorPanel(...)`, instance var `inspector` → `inspectorPanel`, all `inspector.` call sites.
8. Update import paths in `hexViewer.ts` + all tests (`webview.test.ts`, `integrity-check-model.test.ts`, `struct-ui.test.ts`, `struct-pins-model.test.ts`, `components/{inspector,struct,integrity,scripts}.test.ts`). Inspector tests: `new InspectorPanel(...)`, `let inspector: InspectorPanel`. Relative `.css`/`*.ts` imports inside moved files travel with them (verify none use `../` escaping the old dir).
8b. `git mv` the 4 panel test suites into `src/test/webview/components/Sidebar/<Panel>/<panel>.test.ts`; update their `../../webview` → `../../../webview` relative import depth to the new panel paths. Non-panel component tests + model/parity suites stay put (imports only).

### Workstream C — fallow split_high_impact fixes
9. **`IntegrityPanel.ts`** → extract per design.md: `integrityResultRender.ts` (pure markup), `integrityCalculation.ts` (scheduling/async, `readByte`+`endian`+`onResult` injected), `integrityProfiles.ts` (library logic), `integrityHighlight.ts`. Class keeps shell render, form wiring/validation, fix-all, auto-fix, highlight wiring, public API. Move as module-level fns taking state params; class delegates.
10. **`InspectorPanel.ts`** → extract per design.md: `inspectorRender.ts` (DOM-free markup), `inspectorLabelForm.ts` (form validation/state machine). Reuse/extend existing `InspectorLabels.ts` where the helper fits.
11. Re-run `npx fallow --format json --quiet` after each extraction; iterate until `refactoring_targets: []` AND `total_issues 0`, `findings 0`, `clone_groups 0`.

### Workstream D — repo-wide camelCase filenames (NEW)
11b. Rename EVERY source + test file under `src/` with a hyphen or uppercase-first letter to lowercase-first camelCase, per prd.md §D table (core `struct-codec.ts`→`structCodec.ts`, `byte-tools/`→`byteTools/`, `stats-bar.css`→`statsBar.css`, all hyphenated `src/test/**` files, all 11 component dirs + files, test mirror). Use `git mv`. Repoint every importer + spec-doc content reference. Confirm `git ls-files src | grep -E '\/[A-Z]|-'` → empty (minus legit matches in `src/test/shared/`, verify each).

### Workstream E — struct test combine
11c. Merge `struct.test.ts` (13 contract tests) into the deep-render `struct-ui.test.ts` harness → single `structPanel.test.ts`. Dedupe the 3 overlaps (pointer follow/create, endian scalar render, bit-layout toggle) keeping the stronger assertion. Harness = deep-render; contract callback-report assertions folded in on the same harness.

### Docs
12. Update `.trellis/spec/frontend/{directory-structure.md, css-guidelines.md, hook-guidelines.md, index.md}` + `components/component-sidebar-integrity-panel.md` Layout section for new paths + any new `*Render.ts`/`integrity*.ts` modules. `sidebar/sidebarTypes` references gone. Doc filenames unchanged.

### Validate
13. `npm run lint`, `npm run check-types`, `npm run compile-tests`.
14. `npx mocha --ui tdd "out/test/webview/**/*.test.js"` (all panel suites + webview parity).
15. `npm test` (full).
16. Fallow: `total_issues 0`, `findings 0`, `clone_groups 0`, `refactoring_targets []`.

## Review gates
- `Select-String "sidebarTypes|components/Inspector/|components/Struct/|components/Integrity/|components/Scripts/|components/SearchBar/|components/HexView/|components/Toolbar/|components/ContextMenu/|components/RecordView/|components/ExternalChange/|new Inspector\(" src` — no stale refs (Inspector only as `InspectorPanel`/instance name).
- `git ls-files src | grep -E '\/[A-Z]|-'` — empty (verify each `src/test/shared` match is a legit fixture, not a missed rename).
- `src/webview/sidebar/` gone; `SidebarTab` imported from `sidebar/sidebar.ts` only.
- Fallow `refactoring_targets` empty.
- No `fallow-ignore` comments, no `.fallowrc` changes.
- Behavior parity: all webview tests pass with only import/symbol edits.
- Struct combine: no lost assertions (union of old struct.test.ts + struct-ui.test.ts minus deduped overlaps).

## Rollback
- One commit per workstream; `git revert` restores paths + names.
