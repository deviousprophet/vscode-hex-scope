# Rename Struct Overlay to Type Overlay

## Goal

Rename the umbrella concept from **"Struct Overlay"** to **"Type Overlay"**
**everywhere it appears in code and docs**. The feature defines *types* —
`kind: 'struct' | 'bitfield' | 'enum'` — and pins *instances* of them onto
addresses, so "Struct" is the wrong word for the whole. This is a **complete
rename**: all source identifiers, file names, directory names, comments, UI
strings, README, specs, issue templates, **and the persisted `.hexscope`
contract** (with a forward data migration).

## Background / evidence

Three competing umbrella words exist today:

| Where | Word |
|---|---|
| README, CHANGELOG, `types.ts` / `structCodec.ts` headers, bug-report template | "Struct Overlay" |
| Sidebar tab (`hexViewer.ts` `{ id: 'struct', label: 'Struct' }`) | "Struct" |
| Panel sections (`structPanel.ts:182–183`) | "Struct Instances", "Struct Types" |
| Persisted contract | `.hexscope/structs.json`, `structPins`, `schemas/structs.schema.json` |
| Core type | `StructDef` — already carries `kind` |

`StructDef` is a *typed definition*, not a struct. The kind words
(**Struct / Bit-field / Enum**) are correct and stay.

Inventory: 50 of 196 `src` files mention `struct`; `StructDef` ×591,
`StructField` ×148, `StructPin` ×85, `structPins` ×179, `structId` ×162.
Plus README / CHANGELOG / 3 specs / 2 issue templates.

## Decisions (explicit — not assumed)

- **D1. Umbrella name is "Type Overlay".** Panel/feature "Type Overlay"; the
  definitions section becomes **Types**; the instances section becomes
  **Instances**; the sidebar tab label becomes **Overlay**. Kind values stay
  `struct` / `bitfield` / `enum`.
- **D2. Full identifier rename — every `Struct*` / `struct*` name that denotes
  the concept.** Exported and local types, functions, classes, variables,
  parameters, and module names. Heads: `StructDef`→`TypeDef`,
  `StructField`→`TypeField`, `StructPin`→`TypeInstance`,
  `StructPointerSource`→`TypePointerSource`, `StructDefKind`→`TypeDefKind`,
  `StructBaseType`→`TypeBaseType`, `StructFieldType`→`TypeFieldType`,
  `StructScalarFieldType`→`TypeScalarFieldType`, `StructPanel`→`OverlayPanel`,
  `structByteSize`→`typeByteSize`, `structToC`→`typeDefToC`,
  `structDefKind`→`typeDefKind`, `structPinsModel`→`overlayInstancesModel`, …
  Full map in `design.md`.
- **D3. Directories and files renamed.** `src/core/struct/` → `src/core/overlay/`;
  `src/webview/components/sidebar/structPanel/` → `.../overlayPanel/`;
  `struct*.ts` → `overlay*.ts`. Specs: `struct-model.md` → `overlay-model.md`,
  `struct-instance-display.md` → `overlay-instance-display.md`,
  `components/component-sidebar-struct-panel.md` →
  `components/component-sidebar-overlay-panel.md`; `index.md` links updated.
- **D4. Docs fully renamed.** README feature copy, all `.trellis/spec/**`
  occurrences, code comments/JSDoc, `.github/ISSUE_TEMPLATE/*.yml` option labels,
  and any task/research docs. **CHANGELOG: only NEW entries use the new name** —
  historical entries are a record of what shipped and are preserved verbatim.
- **D5. DOM ids / CSS class prefixes are NOT renamed.** `#s-struct-pins`,
  `#stab-struct`, `.se-struct-default-*`, `#sa-struct-sel`, and the `si-` / `sm-`
  / `sa-` / `se-` / `sfe-` prefixes stay. They are internal, carry no
  user-visible meaning, are not "code" in the naming sense, and renaming them
  adds a large regression surface for no functional gain. (Can be revisited as a
  separate follow-up.)
- **D6. The persisted contract IS renamed, with a forward migration and a
  back-compat read window** (decided — supersedes the earlier "frozen" stance).
  - **Files**: `.hexscope/structs.json` → `.hexscope/types.json`;
    `schemas/structs.schema.json` → `schemas/types.schema.json` (its `$id`,
    `SCHEMA_FILES`, and `package.json` `contributes.jsonValidation`
    `fileMatch`/`url` follow).
  - **Keys**: `structPins` → `typeInstances`; `structId` → `typeId`;
    `refStructId` → `refTypeId`; `sourceStructId` → `sourceTypeId`;
    `pointerTargetStructId` → `pointerTargetTypeId`.
  - **Version + migration**: `DATA_SCHEMA_VERSION` 1 → 2 with a
    `MIGRATIONS[1]` step that renames the payload keys (identity for
    `bindings.json`, whose shape does not change); plus a **one-shot,
    Memento-marked file migration** that moves `structs.json` → `types.json`
    (precedent: `migrateProfilesDirToArray`).
  - **Back-compat read window**: the payload normalizers keep accepting the old
    keys (`typeInstances ?? structPins ?? pins`, `typeId ?? structId`,
    `refTypeId ?? refStructId`, …) so an un-migrated file still loads; the
    writer emits only the new names.
- **D8. Legacy Memento keys stay.** `hexScope.structs.*`,
  `hexScope.structPins.*`, the `PER_FILE_PINS_PREFIX`, and the migration
  markers are *historical persisted keys already written into editors' global
  state*; renaming them would orphan real data. Exempt, like D5.
- **D7. Pure rename — zero behavior change.** Decode, offsets, sizes, the C
  preview, validation, persistence bytes, and every existing test assertion stay
  semantically identical. Only names and wording change.

## Requirements

- R1. No user-facing "Struct Overlay" / "Struct Types" / "Struct Instances" /
  "Struct" tab label remains; they read Type Overlay / Types / Instances /
  Overlay.
- R2. No `Struct*` or `struct*` identifier denoting the concept remains anywhere
  in `src/` (D5 DOM ids/classes and D6 persisted names excepted).
- R3. Directory and file names match D3; no `core/struct/` or `structPanel/`
  path remains; every import resolves.
- R4. Docs match D4 — README, specs, comments, issue templates; historical
  CHANGELOG entries preserved.
- R5. The persisted contract is renamed (D6) **and migrates forward**: a
  pre-rename workspace (`structs.json` at `schemaVersion: 1` with the old keys)
  still loads, its data is preserved, and it is rewritten as `types.json` at
  `schemaVersion: 2` with the new keys. A workspace already at v2 reloads as a
  no-op (no spurious write). No def, field, instance, label, check, or binding
  is lost.
- R5b. The bundled schema file is renamed and wired (`SCHEMA_FILES`,
  `package.json` `fileMatch`/`url`, `$id`); the `.hexscope/schemas/` copy is
  re-seeded under the new name. `$schema` written into data files points at the
  new schema.
- R5c. Back-compat read aliases are in place for one transition window
  (`typeInstances ?? structPins ?? pins`, `typeId ?? structId`,
  `refTypeId ?? refStructId`, `sourceTypeId ?? sourceStructId`).
- R6. No behavior change (D7): decode, offsets/sizes, C preview, validation, and
  persistence are unchanged; the full suite stays green.
- R7. Renamed specs stay reachable from `.trellis/spec/frontend/index.md` and
  from task manifests; cross-links between specs still resolve.
- R8. No issue reference in artifacts, branch, commits, or comments.

## Constraints

- C1. Pure rename — no feature, API-shape, or behavior change bundled in.
- C2. Do not touch D5's DOM ids/classes or D8's legacy Memento keys.
- C3. Renaming an exported symbol requires updating all its importers in the
  same step; sequence the work so **every intermediate state compiles and the
  suite stays green**.
- C4. Gates: `npm run check-types`, `npm run lint`,
  `npm run compile-tests && npm test`; Fallow GREEN.
- C5. Keep the diff reviewable: compiler-guided renames over blind
  find/replace; keep pure code moves (file/dir renames) separate from wording
  edits; do not combine with unrelated cleanups.

## Acceptance Criteria

- [ ] Tier 1: no "Struct Overlay"/"Struct Types"/"Struct Instances"/"Struct"
      tab label remains in UI strings, README feature copy, or specs.
- [ ] Tier 2: no concept-bearing `Struct*`/`struct*` identifier remains
      (`grep -rn "struct" src` returns only D5/D6 exceptions); dirs/files match
      D3; imports resolve.
- [ ] Docs (D4) updated; historical CHANGELOG entries unchanged; issue
      templates relabelled.
- [ ] Migration proven: a pre-rename `.hexscope` fixture (`structs.json` at
      `schemaVersion: 1`, old keys) loads with every def / field / instance /
      label / check / binding intact, and is rewritten as `types.json` at
      `schemaVersion: 2` with the new keys; a second load is a no-op; the
      back-compat aliases still read an old-format file.
- [ ] Bundled schema renamed and wired; the `.hexscope/schemas/` copy reseeded;
      written `$schema` points at the new schema.
- [ ] `check-types`, `lint`, `compile-tests && npm test` pass; suite count
      unchanged apart from deliberately renamed test titles; Fallow GREEN.
- [ ] Renamed spec files reachable from `index.md` and task manifests.
- [ ] No issue references.

## Out of scope

- DOM ids / CSS class prefix renames (D5) — possible follow-up.
- Legacy Memento keys and migration markers (D8).
- Any decode / offset / C-preview behavior change.
- The `kind` value vocabulary (`struct`/`bitfield`/`enum`) — stays.
- Rewriting the on-disk bytes beyond the D6 renames (no resequencing, no
  reordering, no dropping of unrelated keys).
