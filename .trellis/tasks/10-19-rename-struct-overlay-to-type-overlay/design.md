# Design — Rename Struct Overlay to Type Overlay

## 1. Scope / trigger

A cross-cutting rename of the umbrella concept. Trigger: the feature defines
`kind: 'struct' | 'bitfield' | 'enum'` definitions plus their pinned instances, so
"Struct" is wrong for the whole. Pure rename — no behavior, API-shape, or
persisted-contract change (PRD D7 / D6).

Surfaces: **50 `src` files**, **24 `Struct*` identifiers**, **92 `struct*`
identifiers**, 3 spec files + 12 other specs referencing them, README,
2 issue templates. `CHANGELOG.md` history is preserved (new entry only).

## 2. Boundaries

| Layer | Files |
|---|---|
| Core types | `src/core/types.ts` |
| Core modules | `src/core/struct/` (`structCodec`, `structNormalization`, `structBitChildren`, `structIdentities`, `structMigration`) |
| Extension host | `src/hexEditorSession.ts`, `src/hexScopeStorage.ts`, `src/hexScopeMigration.ts`, `src/hexEditorProvider.ts`, `src/webviewProtocol.ts` |
| Webview render | `src/webview/components/sidebar/structPanel/*`, `src/webview/hexViewer.ts`, `state.ts`, `appModel.ts`, `webviewMessageModel.ts`, `webviewMessageDispatcher.ts`, `memory/memoryGrid.ts`, `components/hexView/*` |
| Tests | `src/test/core/{struct,structNormalization,providerUtils}.test.ts`, `src/test/webview/{structPinsModel,webview,webviewMessageModel}.test.ts`, `src/test/webview/components/sidebar/{structPanel/structPanel,sidebar}.test.ts`, `src/test/extension/hexScopeStorage.test.ts`, `src/test/schemas/schemaValidation.test.ts`, helpers `src/test/{shared/structTestHelpers,webview/structStateHelpers}.ts` |
| Docs | README, specs, issue templates |

## 3. Rename map

Rule: rename **every** `Struct*` / `struct*` identifier that denotes the concept;
the exemption list in §4 is authoritative. `grep -rn "struct" src | grep -v <exempt>`
must be empty at the end.

### 3.1 Types (24 `Struct*` → )

| Now | New |
|---|---|
| `StructDef` | `TypeDef` |
| `StructField` | `TypeField` |
| `StructPin` | `TypeInstance` |
| `StructPointerSource` | `TypePointerSource` |
| `StructDefKind` | `TypeDefKind` |
| `StructBaseType` | `TypeBaseType` |
| `StructFieldType` | `TypeFieldType` |
| `StructScalarFieldType` | `TypeScalarFieldType` |
| `StructDefIdentity` | `TypeDefIdentity` |
| `StructDefsNormalization` | `TypeDefsNormalization` |
| `StructPinDraft` | `TypeInstanceDraft` |
| `StructDeletionUsage` | `TypeDeletionUsage` |
| `StructPanel` | `OverlayPanel` |
| `StructCallbacks` | `OverlayCallbacks` |
| `StructRenderCtx` | `OverlayRenderCtx` |
| `StructRenderContext` | `OverlayRenderContext` |
| `StructCEmitState` | `TypeCEmitState` |
| `StructDeclarationParts` | `TypeDeclarationParts` |
| `StructGroupInfo` | `FieldGroupInfo` |
| `StructGroupDeclarationInfo` | `FieldGroupDeclarationInfo` |
| `StructPointerCreateState` | `PointerCreateState` |

(`Struct` ×82 is the bare English word in comments/strings; `Structural` /
`structurally` are English; `structuredClone` is a JS API — none are renamed.)

### 3.2 Functions, models, variables

Head of the map — the rule covers the rest (`structByteSizeWithDefs`,
`structDefById`, `structFieldListChanged`, `structAlignmentWithDefs`,
`structRowsAtAddress`, `structPointerTargetByteSize`, `structApplyAddress`, …):

| Now | New |
|---|---|
| `structByteSize` / `structByteSizeWithDefs` | `typeByteSize` / `typeByteSizeWithDefs` |
| `structToC` | `typeDefToC` |
| `structDefKind` | `typeDefKind` |
| `structDefIdentity` | `typeDefIdentity` |
| `structName` / `structEndian` / `structAllocation` | `typeName` / `typeEndian` / `typeAllocation` |
| `structDef` / `structDefs` / `this._structs` | `typeDef` / `typeDefs` / `this._types` |
| `structPanel(filename/id)` | `overlayPanel` |
| `structPinsModel` (`filename`) | `overlayInstancesModel` |
| `structsNormalizer` / `structsEnvelope` / `structsCopy` | `typesNormalizer` / `typesEnvelope` / `typesCopy` |
| `structOptions` / `structOpts` / `structOptionHtml` | `typeOptions` / `typeOpts` / `typeOptionHtml` |
| `structFieldHeaderHtml` / `structTypeRowHtml` / `structEditorHtml` | `fieldHeaderHtml` / `typeRowHtml` / `typeEditorHtml` |
| `structInstancesBodyHtml` | `instancesBodyHtml` |
| `structPreviewId` / `structPreviewLineParts` | `previewId` / `previewLineParts` |
| `structPointer*` (`HeaderHtml`, `LeafHtml`, `BodyHtml`, `Target*`, `OpenTag`, …) | `pointer*` (drop the `struct` prefix) |
| `structArrayElement*` | `arrayElement*` |
| `structGroupSummary` / `structGroupByteCount` | `fieldGroupSummary` / `fieldGroupByteCount` |

**`StructId`-stem family (Phase B — case-insensitive match).** A naive
`structId`→`typeId` replacement misses the CamelCase stems, which must move
together with the key in B1: `_applyStructId`→`_applyTypeId`,
`_editingPinDraftStructId`→`_editingPinDraftTypeId`,
`editingPinStructId`→`editingPinTypeId`, `nextApplyStructId`→`nextApplyTypeId`,
`selectedApplyStructId`→`selectedApplyTypeId` (`overlayPanel.ts`),
`deletedStructIds`→`deletedTypeIds` (`hexEditorSession.ts`). Match the stem
case-insensitively, not just the lowercase token.

**DOM data attributes (Phase B, B1).** `data-struct-id`/`dataset.structId`,
`data-source-struct-id`/`dataset.sourceStructId`, and the `create-struct-ptr`
menu command id mirror the persisted keys, so they move in B1 to
`data-type-id`/`dataset.typeId`, `data-source-type-id`/`dataset.sourceTypeId`,
`create-type-ptr`. (`data-struct-preview-id`→`data-preview-id` already moved in
Phase A.) Add this to the D5 note: **D5 exempts DOM ids/class prefixes, not
`data-*` attributes**; attributes that mirror a renamed key follow the key.

### 3.3 Files and directories (PRD D3)

```
src/core/struct/                     → src/core/overlay/
    structCodec.ts                   →   overlayCodec.ts
    structNormalization.ts           →   overlayNormalization.ts
    structBitChildren.ts             →   bitChildren.ts
    structIdentities.ts              →   overlayIdentities.ts
    structMigration.ts               →   overlayMigration.ts
src/webview/components/sidebar/structPanel/   → .../sidebar/overlayPanel/
    structPanel.ts                   →   overlayPanel.ts
    structPanel.css                  →   overlayPanel.css
    structPinsModel.ts               →   overlayInstancesModel.ts
    structEditorFields.ts            →   editorFields.ts
    structRowRenderer.ts             →   rowRenderer.ts
    structBinaryView.ts              →   binaryView.ts
    structValueFormat.ts             →   valueFormat.ts
    structCPreview.ts                →   cPreview.ts
src/test/core/struct.test.ts                    → typeDef.test.ts
src/test/core/structNormalization.test.ts       → overlayNormalization.test.ts
src/test/webview/structPinsModel.test.ts        → overlayInstancesModel.test.ts
src/test/webview/components/sidebar/structPanel/structPanel.test.ts → overlayPanel/overlayPanel.test.ts
src/test/shared/structTestHelpers.ts            → typeDefTestHelpers.ts
src/test/webview/structStateHelpers.ts          → overlayStateHelpers.ts
```

### 3.4 UI strings (PRD D1)

| Now | New |
|---|---|
| "Struct Overlay" (README, comments, templates) | "Type Overlay" |
| sidebar tab label "Struct" | "Overlay" |
| section "Struct Instances" | "Instances" |
| section "Struct Types" / `typePanelTitle()` "Struct Types" | "Types" |
| kind tile "Struct" (the `kind:'struct'` tile) | **stays "Struct"** — it names the kind |
| titles "…in the Struct Instances view" | "…in the Instances view" |
| optgroup label "Struct" | stays (kind name) |

### 3.5 Docs

- Rename spec files: `struct-model.md` → `overlay-model.md`,
  `struct-instance-display.md` → `overlay-instance-display.md`,
  `components/component-sidebar-struct-panel.md` →
  `components/component-sidebar-overlay-panel.md`.
- Update every reference in the other specs (`index.md`,
  `directory-structure.md`, `hexscope-storage.md`, `state-management.md`,
  `css-guidelines.md`, `component-guidelines.md`, `type-safety.md`,
  `component-menu-controller.md`, `memory-navigation.md`, …).
- README feature copy + `.github/ISSUE_TEMPLATE/{bug_report,feature_request}.yml`
  option labels.
- `CHANGELOG.md`: **new** entry only; historical entries untouched.

## 4. Exemptions (do NOT rename)

1. **Kind vocabulary** — the string `'struct'` (`kind: 'struct'`, the kind tile,
   the field-type optgroup), and comparisons against it.
2. **Legacy Memento keys (PRD D8)** — `hexScope.structs.*`,
   `hexScope.structPins.*`, `PER_FILE_PINS_PREFIX`, and the migration markers
   (`hexScope.migration.v3`, `hexScope.profilesArray.v1`). These were already
   written into editors' global state by shipped builds; renaming them orphans
   real data.
3. **DOM ids / CSS class prefixes (PRD D5)** — `#s-struct-pins`, `#s-struct`,
   `#stab-struct`, `.se-struct-default-*`, `.struct-field-row`, `#sa-struct-sel`,
   `si-`/`sm-`/`sa-`/`se-`/`sfe-`. This exempts **ids and class prefixes only**:
   `data-*` attributes that mirror a renamed key follow the key (§3.2, B1).
4. **English / platform** — `structural`, `structurally`, `structuredClone`.
5. **CHANGELOG history.**

## 5. Persisted contract rename + migration

### 5.1 What changes on disk

| Surface | Now | New |
|---|---|---|
| Pool file | `.hexscope/structs.json` | `.hexscope/types.json` |
| Pool schema | `schemas/structs.schema.json` (+ `$id`) | `schemas/types.schema.json` |
| `SCHEMA_FILES` entry | `{ file: 'structs.json', schema: 'structs.schema.json' }` | `{ file: 'types.json', schema: 'types.schema.json' }` |
| `package.json` `contributes.jsonValidation` | `fileMatch: .hexscope/structs.json`, `url: ./schemas/structs.schema.json` | `types.json` / `types.schema.json` |
| Profile key | `structPins` | `typeInstances` |
| Instance → def ref | `structId` | `typeId` |
| Field / bit-child ref | `refStructId` | `refTypeId` |
| Pointer source ref | `sourceStructId` | `sourceTypeId` |
| Runtime decode ref | `pointerTargetStructId` | `pointerTargetTypeId` |
| `$schema` written into files | `schemas/structs.schema.json` | `schemas/types.schema.json` |
| `DATA_SCHEMA_VERSION` | `1` | `2` |
| Schema `definitions` names | `structDef`, `structField`, `structFieldType`, `bitFieldChild`, `enumEntry` | `typeDef`, `typeField`, `typeFieldType`, … — B3, **together with** the `schemaValidation.test.ts` lookups (they read `definitions['structFieldType']` etc. and the drift guard reads the schema) |

Note: `profiles.schema.json`'s `showHiddenFields` *description* string was already
updated in Phase A; the `structs.schema.json` internals were deliberately left for
B3 so the file and the drift-guard test move in one step.

### 5.2 Migration (two mechanisms)

1. **Payload key rename — `MIGRATIONS[1]`.** `DATA_SCHEMA_VERSION` 1 → 2 and
   add one entry to the shared `MIGRATIONS` table (`hexScopeStorage.ts`) that
   renames the keys in the payload it is given (`defs` → rewrite each def's
   field/bit-child `refStructId`→`refTypeId`; `records` → rewrite
   `structPins`→`typeInstances` and each pin's `structId`→`typeId` and each
   `pointerSources[].sourceStructId`→`sourceTypeId`; `bindings` → identity).
   The runner is payload-agnostic, so the step must dispatch on shape, not key.
   Keys are *renamed* (delete old, set new) so the output is canonical.
2. **File rename — one-shot, Memento-marked.** `.hexscope/structs.json` →
   `.hexscope/types.json` is a file move, not a payload change. Follow the
   `migrateProfilesDirToArray` precedent: a marker in `globalState`
   (e.g. `hexScope.typesFile.v1`), run once per root — if `types.json` is
   absent and `structs.json` exists, read → migrate payload → write `types.json`
   → leave `structs.json` in place for rollback (do not delete in the same
   change). Runs from `hexScopeMigration.ts` alongside the existing tree
   migrations.

### 5.3 Back-compat read window

The payload normalizers keep accepting the old keys so an un-migrated (or
marker-skipped) file still loads: `candidateStructPins` becomes
`candidate.typeInstances ?? candidate.structPins ?? candidate.pins`, and the pin
/ field / pointer normalizers read `typeId ?? structId`,
`refTypeId ?? refStructId`, `sourceTypeId ?? sourceStructId`. **Writers emit only
the new names.** Keep the aliases for one release; note them as deprecated in
`hexscope-storage.md`.

### 5.4 Wire + webview state

`structPins` is also the wire-message field (`webviewProtocol.ts`) and the
webview state field (`state.ts`, `appModel.ts`, `webviewMessageModel.ts`,
`hexViewer.ts`) — these are not on disk, but they mirror the key, so they are
renamed to `typeInstances` in the same sweep (PRD D2). No protocol version
exists, so host and webview move together.

## 6. Compatibility & rollback

- **On-disk**: forward-only and lossless. A v1 workspace migrates on open; a v2
  workspace is untouched by this build's readers (existing `newer` path).
  Verification: v1 fixture → loads → rewritten as `types.json` @ v2 with all
  data intact; second load is a no-op.
- **Compiler**: renaming an exported symbol requires all importers updated in
  the same step; §7 sequences the work so every committed state compiles.
- **Rollback**: revert the commit set. The migration *adds* `types.json` and
  leaves `structs.json`, so reverting the code re-reads the original file with
  no data repair needed. (This is why the file migration must not delete the old
  file.)

## 7. Sequencing (compile-safe)

Two phases. **Phase A** is a pure rename (no data-shape change). **Phase B** is
the persisted contract + migration. Each step gates and commits on its own.

### Phase A — rename (persisted keys untouched)

1. **Tier 1 wording only** (UI strings, README) — no symbol changes. Green.
2. **Core types + core modules**: `core/types.ts` type renames, then
   `core/struct/*` → `core/overlay/*` with internal identifiers. Update all
   importers in `core/`. Green.
3. **Extension host** (`hexEditorSession`, `hexScopeStorage`,
   `hexScopeMigration`, `hexEditorProvider`, `webviewProtocol`): rename concept
   identifiers and functions. **Do not yet rename the five key-bound names**
   (`structPins`, `structId`, `refStructId`, `sourceStructId`,
   `pointerTargetStructId`) — Phase B owns those; leaving them keeps every
   on-disk and wire shape valid in between. Green.
4. **Webview**: `structPanel/` → `overlayPanel/` + identifiers, then
   `hexViewer.ts`, `state.ts`, `appModel.ts`, `webviewMessageModel.ts`,
   `memory/memoryGrid.ts`. Same key-bound exclusion. Green.
5. **Tests**: rename files + identifiers; assertions semantically identical.
6. **Docs**: spec files renamed + cross-links; README; issue templates;
   CHANGELOG new entry. Green.

### Phase B — persisted contract + migration

7. **Key renames + `MIGRATIONS[1]`.** Rename the five key-bound names in code
   (`structPins`→`typeInstances`, `structId`→`typeId`, `refStructId`→
   `refTypeId`, `sourceStructId`→`sourceTypeId`, `pointerTargetStructId`→
   `pointerTargetTypeId`) across core, extension host, wire, webview state, and
   tests. Bump `DATA_SCHEMA_VERSION` 1 → 2 and add the `MIGRATIONS[1]` step
   (§5.2). Add the back-compat read aliases (§5.3). Green.
8. **File rename migration.** `STRUCT_POOL_FILE` → `types.json`; add the
   Memento-marked one-shot migration that moves `structs.json` → `types.json`
   (§5.2), leaving the old file in place. Green.
9. **Schema + packaging.** Rename `schemas/structs.schema.json` →
   `schemas/types.schema.json` (+ `$id`), update `SCHEMA_FILES`, `package.json`
   `fileMatch`/`url`, and the `$schema` value written into files. Green.
10. **Migration tests + storage docs.** v1-fixture → load → rewrite-as-v2 proof;
    idempotence (second load no-op); back-compat alias reads; update
    `hexscope-storage.md` (new names + deprecated aliases).

Gate after **every** step (`check-types` + `lint` + full suite), not just at the
end — this is a large mechanical diff plus a migration, and a mid-sequence
failure must be attributable.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Migration loses or double-applies data | Idempotence test (second load is a no-op); forward-only `newer` path; marker in `globalState`; keys are renamed, not copied, so the output is canonical |
| An existing workspace shows an empty pool after upgrade | File-rename migration runs on open (§5.2) **and** the read aliases accept the old file/keys; v1-fixture test |
| Renaming the key-bound names without the migration → unreadable old files | Phase gating: Phase A deliberately leaves them; Phase B renames + migrates in one step |
| Host/webview key mismatch during the transition | `structPins` is also the wire + state field; rename it in the same step (no protocol version exists) |
| `structuredClone` / `structural` / `structurally` mangled | Explicit exemption (§4.4); review the diff for these tokens |
| Legacy Memento keys renamed → orphaned editor state | Explicit exemption (§4.2) |
| Renaming an exported symbol without all importers → broken build | Compiler-guided rename per step; `check-types` after each step |
| Reviewing a very large mechanical diff | Phase A/B split + per-step commits; pure file moves kept separate from wording |
| Spec cross-links broken by renamed spec files | Re-grep `index.md` + all specs for the old filenames after renaming |
