# Design — Sidebar panel restructure + repo-wide camelCase + fallow splits

Final cleanup for `08-03`. Workstreams, all behavior-preserving: (A) fold `SidebarTab` into `sidebar/sidebar.ts` + delete `sidebar/`; (B) move the 4 sidebar panels under `components/Sidebar/<Panel>/` with `*Panel` naming + Inspector rename; (C) split the two fallow `split_high_impact` targets so `refactoring_targets` is empty; (D) repo-wide camelCase filename rule for every source + test file under `src/`; (E) struct test combine into one `structPanel.test.ts`; (F) doc content updates.

## D. Repo-wide camelCase filename rule

Applied to **all of `src/`** (source + test), no exceptions: every file/dir whose name has a hyphen or uppercase-first letter → lowercase-first camelCase. Full table in prd.md §D. Renames use `git mv`; all import paths + spec-doc content references re-pointed. Target state: `git ls-files src | grep -E '\/[A-Z]|-'` is empty (excluding `src/test/shared` fixture files that legitimately match, verify). The 4 panel dirs under `Sidebar/` become `sidebar/<panelName>/`.

**Test mirror**: `src/test/webview/components/` mirrors source nesting — `sidebar/<panelName>/<panelName>.test.ts` + flat `contextMenu.test.ts`, `hexView.test.ts`, etc.

## E. Struct test combine

`struct-ui.test.ts` (deep-render harness, global `S` + `getByte`) absorbs `struct.test.ts` (contract matrix). Overlap dedupe — 3 areas: pointer follow/create, endian scalar render, bit-layout toggle — keep the stronger assertion. Result: single `src/test/webview/components/sidebar/structPanel/structPanel.test.ts`. Harness stays deep-render; contract callback-report tests re-assert through the same harness (the panel already exposes `onXChange` callbacks via `S`-sync).

## F. Docs

Content only: `.trellis/spec/frontend/*.md` + `components/component-*.md` Layout/path rows updated for all renames. Filenames unchanged.

---

(Workstreams A/B/C unchanged — see below.)

## A. SidebarTab relocation

`src/webview/sidebar/sidebarTypes.ts` (3 lines, `export type SidebarTab = 'inspector' | 'struct' | 'integrity' | 'scripts'`) is deleted. The type is declared in `components/Sidebar/Sidebar.ts` and exported. Importers:
- `Sidebar.ts`: local (drop the `import type`).
- `state.ts`: `import type { SidebarTab } from '../components/Sidebar/Sidebar';`
- `hexViewer.ts`: `import type { SidebarTab } from './components/Sidebar/Sidebar';`

`src/webview/sidebar/` becomes empty → directory removed (git tracks files, so empty dir disappears automatically).

## B. Panel relocation + Inspector rename

Target layout under `src/webview/components/Sidebar/`:

```text
Sidebar/
    Sidebar.ts + Sidebar.css                    (shell; now exports SidebarTab)
    InspectorPanel/
        InspectorPanel.ts + InspectorLabels.ts + InspectorPanel.css
    StructPanel/
        StructPanel.ts + structPinsModel.ts + StructPanel.css
    IntegrityPanel/
        IntegrityPanel.ts + integrityCheckModel.ts + IntegrityPanel.css
    ScriptsPanel/
        ScriptsPanel.ts + ScriptsPanel.css
```

- Pure helper files move with their panel: `InspectorLabels.ts`, `structPinsModel.ts`, `integrityCheckModel.ts`.
- Renames: `Inspector.ts` → `InspectorPanel.ts`, class `Inspector` → `InspectorPanel`, host instance var `inspector` → `inspectorPanel`. All other class/export names unchanged (`StructPanel`, `IntegrityPanel`, `ScriptsPanel`).
- Importers to update (path + symbol edits, no barrels): `hexViewer.ts`, `webview.test.ts`, `integrity-check-model.test.ts`, `struct-ui.test.ts`, `struct-pins-model.test.ts`, `components/{inspector,struct,integrity,scripts}.test.ts`, plus any `.css` imports inside the moved `.ts` files (relative, so they move together untouched).
- Spec docs: `directory-structure.md`, `css-guidelines.md` (file table rows), `hook-guidelines.md`, `index.md` components table, and the `component-sidebar-integrity-panel.md` Layout section.

## C. Fallow split_high_impact fixes

Goal per fallow-fix skill: refactor source so `npx fallow --format json --quiet` reports `refactoring_targets: []` — no suppression comments, no config edits. Precedent (Session 10): pure DOM-free render helpers move to `*Render.ts` sibling modules; DOM/listener wiring stays in the class. Target files:

### C1. `IntegrityPanel.ts` (1178 LOC, density 0.32, fan-in 3)

Extract focused sibling modules under `Sidebar/IntegrityPanel/`. Natural seams from the method inventory:

- **`integrityResultRender.ts`** — pure markup for result/card bodies: `resultBodyHtml`, `emptyResultBodyHtml`, `pendingResultBodyHtml`, `pendingStoredResultHtml`, `calculatedResultBodyHtml`, `calculatedDisplay`, `storedResultHtml`, `singleComparisonClass`, `checkCardHtml`*, `checkCardClass`*, `checkCardBodyHtml`*, `autoFixToggleHtml`*, `checkStatusLabel`*, `completedCheckStatus`*, `checkStatusClass`*, `hasComparableStoredValue`* (the `*` ones take the check/state and return strings — DOM-free; pure). Must be module-level functions taking the needed state as params (no class member access).
- **`integrityCalculation.ts`** — scheduling/async: `scheduleIntegrityCalculation`, `cancelPendingCalculation`, `clearCheckResult`, `prepareIntegrityRequest`, `isUnconfiguredCheck`, `parseStoredField`, `integrityOutputByteLength`, `preparedByteCount`, `overlapByteCount`, `calculateAndRender`, `applyCurrentError`, `applyCalculatedResultIfCurrent`. These need `readByte` (already injected via `this.cb`) + `endian()` — pass `readByte` + `endian` + `onResultUpdate` callback (the component passes `updateCheckCard`).
- **`integrityProfiles.ts`** — profile library logic: `wireProfileControls`, `wireProfileNameForm`, `updateProfileButtonState`, `activeConfigs`, `persistChecks`, `applySelectedProfile`, `saveProfileAs`, `updateSelectedProfile`, `renameSelectedProfile`, `openProfileNameForm`, `closeProfileNameForm`, `submitProfileName`, `submitValidProfileName`, `createNamedProfile`, `renameProfileTo`, `isDistinctProfileName`, `selectedProfile`, `deleteSelectedProfile`, `profileNameExists`, `setProfileError`, `refreshProfileLibrary`, `profileLibraryHtml`, `profileNameFormHtml`, `profileNameValue`, `profileNameAction`.
- **`integrityHighlight.ts`** — `syncHighlight`, `highlightForCheck`, `addStoredHighlight`, `highlightStatus`, `clearHighlightedCheck`, `clearHighlight`, `storedValueUpdate`, `formatByteCount`.
- Remaining in `IntegrityPanel.ts`: shell render, form wiring/validation, fix-all, auto-fix, highlight sync wiring, and the public API.

Each module exports the moved functions (module-level fns taking state/callbacks); the class calls `integrityXxx.xxx(this, ...)` or imports the module and delegates. **Iterate**: after each extraction re-run fallow; stop when density drops under 0.3 AND fan-in under 3 (i.e. target gone). If the file remains a target, extract more.

### C2. `InspectorPanel.ts` (884 LOC, density 0.31, fan-in 3)

- **`inspectorRender.ts`** — DOM-free markup: `renderInspectorShell`* markup strings, `inspectorSelectionLength`*, `renderBits`/`renderBitsMulti`* (pure HTML generation), `multiInline*` HTML, `labelItemsHtml`*, `labelSwatchesHtml`*, `labelAddrHex`*, `defaultLabelStart`*, `defaultLabelRange`*, `nextLabelName`*. (Check each: any that only build strings → move; ones touching DOM stay.)
- **`inspectorLabelForm.ts`** — label form validation/state machine (the biggest pure-ish block): `parseLabelLength`, `labelRangeWarning`, `readLabelDraft`, `labelStartAddress`, `readLabelName`, `applyLabel`, `saveLabel`, `showLabelError`, `renderLabelForm`*, `wireLabelForm`*, `updateLabelFormSel`*, `fillLabelRangeValue`*, `switchLabelRangeMode`*, `updateLabelRangeValue`*, `showEndAddressRange`*, `showLengthRange`*.
- Keep in `InspectorPanel.ts`: selection paint, bit hover, segments, label list wiring, shell assembly.

`InspectorLabels.ts` already exists (pure helpers) — extend it if a moved helper fits its domain; otherwise new modules per above.

## Iteration rule (fallow-fix)

After both splits: `npx fallow --format json --quiet` must show `refactoring_targets: []` (plus the standing 0/0/0). If a target persists, keep extracting until gone. `--explain` for metric definitions if needed.

## Rollback

One commit per workstream (or one combined commit); `git revert` restores the pre-move paths + class names.
