# Implement — Rename Struct Overlay to Type Overlay

Ordered execution checklist. **Two phases:** **A** = pure rename (no data-shape
change), **B** = persisted contract rename + migration. Compile + full suite
green after **every** step; Fallow at the end. Read `design.md` §3 (rename map),
§4 (exemptions), §5 (persisted contract + migration) before starting. The
exemption list is authoritative.

> Phase A deliberately leaves the five key-bound names (`structPins`,
> `structId`, `refStructId`, `sourceStructId`, `pointerTargetStructId`) alone so
> every on-disk and wire shape stays valid; Phase B renames them **together
> with** the migration. Do not rename them early.

## Phase A — rename (persisted keys untouched)

- [ ] A1. **Tier 1 wording only.** `structPanel.ts`: section labels
      `'Struct Instances'`→`'Instances'`, `'Struct Types'`→`'Types'`;
      `typePanelTitle()` `'Struct Types'`→`'Types'`; the two "…in the Struct
      Instances view" titles → "…in the Instances view". `README.md`: "Struct
      Overlay" → "Type Overlay". **Do not touch** the `kind:'struct'` tile label
      or the field-type optgroup "Struct" (kind vocabulary). No symbol changes.

- [ ] A2. **Core types + core modules.** `src/core/types.ts`: rename the
      `Struct*` types per `design.md` §3.1. Then `git mv src/core/struct
      src/core/overlay` + rename the module files (§3.3), updating internal
      identifiers (§3.2). Update every importer inside `core/`. `TypeDefKind`'s
      union values stay `'struct'|'bitfield'|'enum'`. **Leave `refStructId`
      as-is** (Phase B).

- [ ] A3. **Extension host.** `hexEditorSession.ts`, `hexScopeStorage.ts`,
      `hexScopeMigration.ts`, `hexEditorProvider.ts`, `webviewProtocol.ts`:
      rename concept identifiers/functions (`structDefKind`→`typeDefKind`,
      `structByteSize`→`typeByteSize`, `structPoolJsonUri`→`typePoolJsonUri`,
      `structPoolStore`→`typePoolStore`, …). **Exempt in this phase**:
      `structPins` (the `ProfileRecord` field + payload key), `structId`,
      `refStructId`, `sourceStructId`, `pointerTargetStructId`, the file-name
      literals (`'structs.json'`, `'structs.schema.json'`), `SCHEMA_FILES`,
      `package.json` `fileMatch`/`url`, and the legacy Memento keys/markers
      (§4.2).

- [ ] A4. **Webview.** `git mv .../structPanel .../overlayPanel`; rename files
      (§3.3) and identifiers (`StructPanel`→`OverlayPanel`, `_structs`→`_types`,
      `structPinsModel`→`overlayInstancesModel`, …). DOM ids / CSS classes
      (`#s-struct-pins`, `#stab-struct`, `.se-struct-default-*`,
      `#sa-struct-sel`, `si-/sm-/sa-/se-/sfe-`) **stay** (§4.3). Then
      `hexViewer.ts`, `state.ts`, `appModel.ts`, `webviewMessageModel.ts`,
      `webviewMessageDispatcher.ts`, `memory/memoryGrid.ts`,
      `components/hexView/*`. **Leave `structPins`/`structId`/`refStructId`/
      `sourceStructId` alone** (Phase B).

- [ ] A5. **Tests.** Rename test files (§3.3) and update identifiers/imports;
      assertions stay semantically identical (only names/titles change). Keep
      `kind:'struct'` fixtures and any `structs.json`/`structPins` literals that
      assert persistence.

- [ ] A6. **Docs.** `git mv` the three spec files (§3.3); update their content
      and every cross-reference (`index.md`, `directory-structure.md`,
      `hexscope-storage.md`, `state-management.md`, `css-guidelines.md`,
      `component-guidelines.md`, `type-safety.md`, `component-menu-controller.md`,
      `memory-navigation.md`, `component-sidebar.md`, …).
      `.github/ISSUE_TEMPLATE/*.yml` option labels; README. **`CHANGELOG.md`:
      new entry only** — history untouched. Re-grep every spec for the old
      filenames → zero hits.

## Phase B — persisted contract + migration

- [ ] B0. **Phase-A review leftovers (from `trellis-check`).** Two doc comments
      were *themselves* renamed, making recorded history wrong — restore the
      original names in the "was …" breadcrumbs: `component-sidebar-overlay-panel.md`
      `setSelection` `// was onSelectionChangeForOverlay` → `// was
      onSelectionChangeForStruct`, and `resetViewState` `// was resetViewState`
      → `// was resetStructViewState`. Also make `candidateTypeInstances`'s
      name/comment/impl agree (B1 completes this).

- [ ] B1. **Key renames + `MIGRATIONS[1]`.** Rename the five key-bound names in
      code — `structPins`→`typeInstances`, `structId`→`typeId`,
      `refStructId`→`refTypeId`, `sourceStructId`→`sourceTypeId`,
      `pointerTargetStructId`→`pointerTargetTypeId` — across core, host, wire
      (`webviewProtocol.ts`), webview state, and tests.
      **Match the `StructId` stem case-insensitively** (`design.md` §3.2) or the
      CamelCase family is missed: `_applyStructId`→`_applyTypeId`,
      `_editingPinDraftStructId`→`_editingPinDraftTypeId`,
      `editingPinStructId`→`editingPinTypeId`, `nextApplyStructId`→`nextApplyTypeId`,
      `selectedApplyStructId`→`selectedApplyTypeId`, `deletedStructIds`→`deletedTypeIds`.
      Also rename the `data-*` attributes that mirror the keys (§3.2):
      `data-struct-id`/`dataset.structId`→`data-type-id`/`dataset.typeId`,
      `data-source-struct-id`/`dataset.sourceStructId`→`data-source-type-id`/
      `dataset.sourceTypeId`, and the `create-struct-ptr` menu command id →
      `create-type-ptr`.
      Bump `DATA_SCHEMA_VERSION` 1 → 2 and add the `MIGRATIONS[1]` step that
      rewrites the payload keys (§5.2) — dispatch on **shape**, not key. Add the
      back-compat read aliases (§5.3): `typeInstances ?? structPins ?? pins`,
      `typeId ?? structId`, `refTypeId ?? refStructId`,
      `sourceTypeId ?? sourceStructId`. Writers emit only the new names.

- [ ] B2. **File rename migration.** `STRUCT_POOL_FILE` → `'types.json'`; add
      the Memento-marked one-shot migration in `hexScopeMigration.ts` (marker
      e.g. `hexScope.typesFile.v1`): if `.hexscope/types.json` is absent and
      `.hexscope/structs.json` exists → read → migrate payload → write
      `types.json` → **leave `structs.json` in place** (rollback safety).

- [ ] B3. **Schema + packaging.** `git mv schemas/structs.schema.json
      schemas/types.schema.json`; update its `$id` and its internal
      `definitions` names (`structDef`→`typeDef`, `structField`→`typeField`,
      `structFieldType`→`typeFieldType`, …) **in the same step as** the
      `schemaValidation.test.ts` lookups that read them (it uses bracket access
      to `definitions['structDef']`/`['structFieldType']`) and the drift-guard
      that compares the schema enum against the runtime list. Update
      `SCHEMA_FILES`, `package.json` `contributes.jsonValidation`
      `fileMatch`/`url`, the `$schema` value written into data files, and the
      forward-dated `directory-structure.md` parenthetical. The
      `.hexscope/schemas/` copy is re-seeded under the new name.

- [ ] B4. **Migration tests + storage docs.** Add tests: v1 fixture
      (`structs.json`, `schemaVersion: 1`, old keys) → loads with all defs /
      fields / instances / labels intact → rewritten as `types.json` @
      `schemaVersion: 2` with new keys; second load is a no-op; a file with the
      old keys but no marker still reads via the aliases. Update
      `hexscope-storage.md` (new names, deprecated aliases, the file migration).

- [ ] B5. **Sweep + proof.**
      - `grep -rni "struct" src` → every remaining hit is a `design.md` §4
        exemption (kind vocabulary, legacy Memento keys, DOM ids/classes,
        `structuredClone`). Case-insensitive on purpose — it must also catch any
        leftover `StructId` stem.
      - `grep -rn "Struct Overlay\|Struct Instances\|Struct Types"` → zero hits
        outside CHANGELOG history.
      - `grep -rn "structs\.json\|structPins" src` → only the migration +
        back-compat read paths (and their tests).

- [ ] B6. **Gates + fallow.**
      - `npm run check-types`
      - `npm run lint`
      - `npm run compile-tests && npm test`
      - `node .agents/skills/fallow-fix/scripts/fallow-extract.mjs` → GREEN
      - Report the suite count vs the pre-rename baseline (only test *titles*
        may differ; no test added/removed besides the new migration tests).

## Validation

- `grep -rn "struct" src` returns only §4 exemptions.
- v1 → v2 migration proven; idempotent; aliases read old files.
- Renamed specs reachable from `index.md`; cross-links resolve.
- Suite green; Fallow GREEN.

## Review gates

- After A3: core + extension-host review (key-bound names still untouched).
- After A4: webview review (`OverlayPanel` wiring, DOM ids unchanged).
- After A6: docs review (spec filenames + cross-links + CHANGELOG history).
- After B2: migration review (file move + marker + payload key rename).
- Before finish: full suite + fallow + v1→v2 round-trip.

## Rollback points

- Each step is a self-contained commit set → revert that step.
- The migration only **adds** `types.json` and keeps `structs.json`, so
  reverting Phase B's code re-reads the original file — no data repair.

## Out-of-scope guard

No DOM id / CSS prefix rename (D5); no legacy Memento key rename (D8); no
`kind`-vocabulary change; no decode / offset / C-preview behavior change; no
on-disk bytes rewritten beyond the D6 renames.
