# Migrate .hexscope data on schema change

## Goal

When the bundled schema changes, an existing workspace should **upgrade its
`.hexscope` data** to the new shape when it is opened — not just refresh the
generated `schemas/` copies. Introduce a **data-schema version** so a shape
change is detectable, migrate the data forward on load, and never downgrade a
file that is newer than the running extension.

## Context / findings

- The load path already self-heals: `JsonStore.applyOk` writes when the
  normalizer reports `changed` (`hexScopeStorage.ts:527`), so a migration that
  reports `changed` is written back **on open** — no new write path is needed.
- The envelope `version` is a **storage** version (`DATA_VERSION = 1`);
  `unwrapEnvelope` refuses any other value as `corrupt` ("forward protection"),
  so bumping it would make older builds reject the file. The data-schema
  version must therefore be **separate from, and inside, `data`**.
- The struct pool normalizer (`hexEditorSession.ts:587`) already migrates
  def-level shape (`migrateStructDefinitions` + `normalizeStructDefsValue`).

## Requirements

- R1. Each `.hexscope` data file records an explicit **data-schema version**
  inside `data` (field name `schemaVersion`), distinct from the envelope
  `version`. It is written on every write and read back on load.
- R2. A **migration runner** upgrades a file from its recorded `schemaVersion`
  to the current one, applying ordered per-step migrations
  (`1 -> 2 -> ...`). It is idempotent: a file already at the current version is
  returned unchanged.
- R3. The runner is wired into the normalizer chain for all three data files
  (struct pool, profile registry, bindings) so migration happens **on load** and
  the existing `changed`-driven self-heal writes it once.
- R4. **Forward-only**: a file whose `schemaVersion` is **newer** than the
  current build is left untouched (no downgrade, no data loss) and the store
  falls back to the documented safe behavior (empty default + warn-once),
  reusing the existing unknown-version path rather than a new mechanism.
- R5. A file with **no** `schemaVersion` (written before this change) is treated
  as version 1 and migrated.
- R6. The `.hexscope/schemas/*.schema.json` **copies** are refreshed from the
  bundled schema (already implemented in `090cf02`) — consistent with the data
  migration; no regression to that behavior.
- R7. The current `schemaVersion` and the migration steps are **one source of
  truth** shared by the three files (a single constant + ordered step table),
  drift-guarded.
- R8. Docs/spec updated: `.trellis/spec/frontend/hexscope-storage.md` and
  `docs/HEXSCOPE_STORAGE.md` describe the data-schema version, the forward-only
  rule, and open-time migration.
- R9. No behavior change for a file already at the current version (no write,
  byte-identical). Gates green; fallow GREEN.

## Constraints

- C1. No issue reference in artifacts, branch, commits, or comments.
- C2. Do not bump the envelope `version`; do not change the three-tier layout.
- C3. Older extension builds must still read a migrated file (additive keys
  only; unknown keys tolerated by `additionalProperties: true` at the envelope
  root and by the runtime normalizers).
- C4. Never write data files on a bare open **unless** the normalizer reports
  `changed` (migration) — the existing self-heal contract.
- C5. Gates: `npm run check-types`, `npm run lint`,
  `npm run compile-tests && npm test`. Fallow GREEN.

## Out of scope

- Adding `if/then` cross-field coupling to the schemas (separate finding).
- Downgrading a newer file.
- Shipping/versioning the extension build (delivery, not code).

## Acceptance Criteria

- [ ] A data file at an older `schemaVersion` is migrated to the current shape
      on load and written back once.
- [ ] A file already at the current version is not rewritten (byte-identical).
- [ ] A file **newer** than the build is not modified or downgraded.
- [ ] A pre-change file with no `schemaVersion` is treated as version 1 and
      migrates.
- [ ] Migration is idempotent (second load is a no-op).
- [ ] `schemaVersion` is written on every new data write.
- [ ] The three files share one current-version constant + step table, with a
      drift-guard test.
- [ ] Specs/docs describe the data-schema version and forward-only rule.
- [ ] Gates green; fallow GREEN; no test assertion weakened.
