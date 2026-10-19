# Remove migrated legacy artifacts

## Goal

Clean up after the Type Overlay v2 migration. Today the migration is **additive**:
`.hexscope/structs.json` is re-seeded into `types.json` and left behind
indefinitely, and the seeded schema folder keeps retired copies such as
`.hexscope/schemas/structs.schema.json`. Both are inert but confusing (a live
duplicate of the pool, and a schema that no longer matches the runtime).

**Decided: hard delete.** Remove the legacy pool file once the new one is
verified usable, and prune retired schema copies.

## Background / current state

- `moveLegacyTypePoolFile` (`hexScopeMigration.ts:141`): if `types.json` is
  missing it reads `structs.json`, migrates the payload, writes `types.json` —
  and never deletes the source. The comment states it is deliberate ("revert of
  this release still finds its data").
- `seedSchemaCopies` (`hexScopeStorage.ts:509`) iterates only the **current**
  `SCHEMA_FILES` (`profiles`, `types`, `bindings`) and writes each when missing
  or differing. It **never prunes** files that fell out of the list, so
  `schemas/structs.schema.json` is orphaned forever.
- Consequence observed by the user: both `structs.json` and
  `schemas/structs.schema.json` still sit in `.hexscope/` after migrating.

## Decisions (explicit)

- **D1. Hard delete the legacy pool file** after a *verified* migration — not
  archive, not rename. Accepts that a downgrade to a pre-rename build will find
  no pool; the user chose this over keeping an inert duplicate.
- **D2. Verify before delete — and require a non-empty pool.** A deletion is
  allowed only when `types.json` reads back as `ok` **and** yields a
  **non-empty** `defs` array. If `types.json` is missing, corrupt, newer than
  this build, or has an empty/absent `defs`, the legacy file is left untouched
  (it may be the only good copy). Trade-off accepted: a pool that was genuinely
  emptied keeps its legacy file forever — the safe side of the decision.
- **D3. Delete on the one-shot pass even when `types.json` already existed.**
  The user's workspace has both files; the migration currently returns early
  when `types.json` exists, so the legacy file would linger forever. On the
  marked one-shot pass: if `types.json` is valid and `structs.json` still
  exists, delete the legacy file.
- **D4. Prune retired schema copies.** `seedSchemaCopies` deletes
  `*.schema.json` entries in `.hexscope/schemas/` that are not in the current
  `SCHEMA_FILES`. It never deletes non-schema files and never touches any other
  directory.
- **D5. Non-fatal.** A failed delete/prune must not fail opening the workspace;
  log and continue. The Memento marker still makes the pass one-shot.
- **D6. No data-shape change.** No `schemaVersion`, `MIGRATIONS`, schema content,
  or key changes.

## Requirements

- R1. After a successful migration, `.hexscope/structs.json` is deleted once
  `types.json` is verified readable (valid envelope + **non-empty** `defs`
  array).
- R2. The legacy file is **not** deleted when `types.json` is missing, corrupt,
  newer than the build, or carries an empty/absent `defs`.
- R3. If `types.json` is already valid and the legacy file still exists, the
  one-shot pass deletes it (covers workspaces migrated before this change).
- R4. Deletion is idempotent and non-fatal (errors are logged; open continues).
- R5. `seedSchemaCopies` prunes retired `*.schema.json` copies not in
  `SCHEMA_FILES` (e.g. `structs.schema.json`), keeps `profiles` / `types` /
  `bindings`, and no-ops when the schema dir is absent or unreadable.
- R6. Pruning never deletes a non-`*.schema.json` file in that directory and
  never recurses elsewhere.
- R7. The storage spec is updated: the old "Bad: deleting `structs.json`"
  guidance flips to verified-then-delete + prune, with the rollback trade-off
  stated.
- R8. Tests cover the safe-delete matrix and the schema prune.
- R9. No issue reference in artifacts, code, or comments.

## Constraints

- C1. **Verify-before-delete** (D2) is mandatory; a delete on an unverified
  `types.json` is a data-loss bug.
- C2. Delete scope is exactly `.hexscope/structs.json` and
  `.hexscope/schemas/*.schema.json` not in `SCHEMA_FILES`. Never recursive,
  never another directory, never `firmware_profiles/` (its tree keeps its
  rollback copies and `.converted` markers).
- C3. Non-fatal (D5).
- C4. Gates: `npm run check-types`, `npm run lint`,
  `npm run compile-tests && npm test`; Fallow GREEN.

## Acceptance Criteria

- [ ] A v1 workspace (`structs.json` + valid migration) ends with `types.json`
  present and `structs.json` **gone**.
- [ ] A workspace with both files already (valid `types.json`) loses
  `structs.json` on the one-shot pass, with `types.json` untouched.
- [ ] A corrupt/missing/unreadable `types.json` **preserves** `structs.json`
  (no data loss).
- [ ] A valid `types.json` with an **empty** `defs` array **preserves**
  `structs.json` (hardening: an empty pool never licences a delete).
- [ ] A failed delete is non-fatal: the workspace still opens; the failure is
  logged.
- [ ] `.hexscope/schemas/structs.schema.json` is removed; `profiles` / `types` /
  `bindings` schema copies remain; a stray non-schema file (e.g. `notes.txt`) is
  untouched.
- [ ] Running the pass twice is a no-op (idempotent).
- [ ] No `schemaVersion` / `MIGRATIONS` / schema-content change.
- [ ] Spec updated; `check-types`, `lint`, suite pass; Fallow GREEN.
- [ ] No issue references.

## Out of scope

- Recovering data already deleted (irreversible by design).
- Deleting `firmware_profiles/<n>/` legacy trees (they keep rollback copies).
- Any change to `MIGRATIONS`, `DATA_SCHEMA_VERSION`, or the schema contents.
