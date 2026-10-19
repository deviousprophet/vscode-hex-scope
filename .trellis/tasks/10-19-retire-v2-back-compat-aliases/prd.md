# Retire the v2 back-compat read aliases

## Goal

Retire the Type Overlay v2 **back-compat read aliases** from the *general* read
paths so no new code can start depending on the pre-rename keys, while keeping a
**dedicated alias pass on the one-time legacy migration inputs** so a pre-rename
workspace still migrates losslessly.

The rename shipped (v2) with a documented one-release window: the payload
normalizers tolerated `typeInstances ?? structPins ?? pins`, `typeId ?? structId`,
`refTypeId ?? refStructId`, `sourceTypeId ?? sourceStructId`. This task closes
that window deliberately (the documented end state), without regressing the
legacy migrations that share the same normalizers.

## Background / current state

`src/core/overlay/overlayAliases.ts` is applied in **two general readers**:

- `normalizeTypeDefsValue` (`overlayNormalization.ts`) — first pass
  `aliasLegacyTypeDefs`.
- `candidateTypeInstances` (`hexScopeStorage.ts`) — `typeInstances ?? structPins
  ?? pins` plus per-instance / pointer-source aliasing.

Those same normalizers are also reached by the **legacy one-time migrations**:

- pre-rename `firmware_profiles/<n>/structs.json` (carries `refStructId`)
- per-dir `profiles/<id>/profile.json` and Memento-era pin arrays (carry
  `structPins` / `structId`)
- `readStructPool` / `mergeIntoPool` / `legacySourceDefs` in `hexScopeMigration.ts`

So a blunt delete would make those inputs lose the ref renames — exactly the
data-loss class the v2 check phase already caught once. Hence option B.

## Decisions (explicit)

- **D1. General readers stop aliasing.** `normalizeTypeDefsValue` and
  `candidateTypeInstances` accept only the canonical v2 keys. A v2 file that
  carries *only* legacy keys no longer populates defs/instances. This is the
  intended, documented end of the window.
- **D2. Legacy migration inputs alias explicitly.** The migration layer calls
  `overlayAliases` itself, immediately before normalization, for every legacy
  source (tree `structs.json`, per-dir `profile.json`, Memento-era arrays). The
  one-time migrations stay lossless.
- **D3. `overlayAliases.ts` becomes migration-internal.** It may be imported by
  the migration layer and by its own tests, and by nothing on the general read
  path. Keep the module (its functions are still needed); consider renaming it
  to signal intent only if it reads clearly — not required.
- **D4. Versioned v1 payloads still migrate via the runner.** `MIGRATIONS[1]`
  and `DATA_SCHEMA_VERSION = 2` are unchanged: a `schemaVersion: 1` (or bare
  array) file is renamed by the runner and never touches the aliases.
- **D5. No schema change.** `profiles.schema.json` keeps its deprecated
  `structPins` / `pins` properties (they describe the v1 on-disk shape that the
  runner migrates). Removing them is a separate authoring-contract question, out
  of scope.

## Requirements

- R1. `normalizeTypeDefsValue` no longer calls the alias pass.
- R2. `candidateTypeInstances` reads only `typeInstances` and does no
  per-instance / pointer-source key aliasing; writers still emit only v2 names.
- R3. Every legacy one-time migration input (tree `structs.json`, per-dir
  `profile.json`, Memento-era arrays) is aliased **explicitly** in the migration
  layer before normalization, and remains lossless (defs, fields, bit-children,
  enum refs, instances, pointer sources).
- R4. `overlayAliases` is imported only by the migration layer and its tests —
  not by the general normalizers.
- R5. Tests reflect the narrowed contract: the existing alias tests are
  retargeted to the **legacy migration path**, and a **negative** test proves a
  v2 payload carrying only legacy keys is no longer aliased by the general
  reader. No assertion is weakened; the behavior change is asserted explicitly.
- R6. `hexscope-storage.md` (and any other spec naming the window) is narrowed:
  aliases are migration-internal now, not a general read path; the one-release
  note becomes "retired".
- R7. No behavior change for canonical v2 files; no persisted-shape change; no
  schema change; no `MIGRATIONS` change.

## Constraints

- C1. Do not change `DATA_SCHEMA_VERSION`, `MIGRATIONS[1]`, the file-migration
  marker, or the schema — those are already shipped.
- C2. Do not regress legacy migration. The v1 round-trip and the legacy-tree /
  Memento fixtures must still pass (lossless, canonical, idempotent).
- C3. Gates: `npm run check-types`, `npm run lint`,
  `npm run compile-tests && npm test` (expect **1288 passing / 0 failing**,
  plus/minus the retargeted alias tests), and the repo Fallow gate
  `node .agents/skills/fallow-fix/scripts/fallow-extract.mjs` → GREEN.

## Acceptance Criteria

- [ ] `grep` shows no `structPins` / `structId` / `refStructId` /
  `sourceStructId` tolerance in `overlayNormalization.ts` or
  `hexScopeStorage.ts`'s general profile path.
- [ ] `overlayAliases` is imported only by `hexScopeMigration.ts` (+ tests).
- [ ] A versioned v1 fixture and a bare-array v1 fixture still migrate forward
  with every def/field/bit-child/enum-ref/instance/pointer-source intact
  (idempotent second load).
- [ ] A legacy `firmware_profiles/<n>/structs.json` and a per-dir `profile.json`
  / Memento-era array still migrate losslessly through the explicit alias pass.
- [ ] A new negative test: a v2 payload carrying only legacy keys yields **no**
  defs/instances through the general reader (the documented retirement).
- [ ] Spec narrowed; no issue references.
- [ ] `check-types`, `lint`, `compile-tests && npm test` pass; Fallow GREEN.

## Out of scope

- Removing the deprecated schema properties (`profiles.schema.json`).
- Changing `MIGRATIONS`, `DATA_SCHEMA_VERSION`, or the `structs.json` →
  `types.json` file migration.
- The dead-CSS-rule cleanup and the cross-panel `.oi-expanded` borrow noted by
  the previous task's check phase.
