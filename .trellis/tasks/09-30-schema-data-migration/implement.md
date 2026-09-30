# Implement — Migrate .hexscope data on schema change

Ordered checklist. Run the gates after the wiring step; fallow at the end.

- [ ] 1. In `src/hexScopeStorage.ts`, add `DATA_SCHEMA_VERSION` (current = 1, or
      2 if this ships the first real step) and a `MIGRATIONS` ordered step table
      keyed by from-version; add `withDataEnvelope(payloadKey, payload)` that
      stamps `{ schemaVersion: DATA_SCHEMA_VERSION, <payloadKey>: payload }`.
- [ ] 2. Add the migration runner: read the recorded version (absent = 1), apply
      steps up to current, stamp the current version, and return
      `{ value, changed }`; idempotent when already current.
- [ ] 3. Forward-only: a recorded version **newer** than
      `DATA_SCHEMA_VERSION` maps to the existing `corrupt` outcome (empty
      default + warn-once, file never overwritten) — do not invent a new path.
- [ ] 4. Accept the legacy bare-array `data` form as version 1 (both the array
      and the new object form must read).
- [ ] 5. Declare the new shape in `schemas/structs.schema.json`,
      `schemas/profiles.schema.json`, `schemas/bindings.schema.json`:
      `data` is an object with `schemaVersion` (required, integer) + the payload
      key. Keep the envelope `version` const at 1.
- [ ] 6. Wire the runner ahead of the shape normalizer for all three stores in
      `src/hexEditorSession.ts` (struct pool, registry) and the bindings write
      path; stamp on every write via `withDataEnvelope`.
- [ ] 7. Update `.trellis/spec/frontend/hexscope-storage.md`,
      `.trellis/spec/frontend/state-management.md`, and
      `docs/HEXSCOPE_STORAGE.md`: data-schema version, open-time migration,
      forward-only rule.
- [ ] 8. Tests (`src/test/extension/hexScopeStorage.test.ts` + schema tests):
      - an older-version file migrates on load and writes back once;
      - a current-version file is not rewritten (byte-identical);
      - a newer-than-build file is not modified/downgraded (warn-once, kept);
      - a pre-change file with no `schemaVersion` is treated as v1 and migrates;
      - migration is idempotent (second load is a no-op);
      - `schemaVersion` is written on every new write;
      - drift guard: current version constant ↔ schema `schemaVersion`
        (and the three schemas agree).
- [ ] 9. Gates + fallow:
      - `npm run check-types`
      - `npm run lint`
      - `npm run compile-tests && npm test`
      - `node .agents/skills/fallow-fix/scripts/fallow-extract.mjs` → GREEN

## Validation

- Migration proven end-to-end on the load path (self-heal write), idempotent on
  a second load, and byte-identical for a current file.
- Forward-only proven: a newer file is untouched.
- Legacy array form still loads.
- Commands: `npm run check-types`, `npm run lint`,
  `npm run compile-tests && npm test`; fallow GREEN.

## Review gates

- After step 2: runner review (step ordering, idempotence, `changed` accuracy).
- After step 6: wiring review (all three files covered; no write on unchanged).
- Before finish: full suite + fallow; confirm no envelope `version` bump and no
  data-file write when nothing changed.

## Rollback points

- Steps 1–4 are additive to storage.
- Step 5–6 (schema + wiring) is the behavioral core; revert together to restore
  the pre-migration read path (legacy arrays still readable).

## Out-of-scope guard

No schema `if/then` coupling, no envelope `version` bump, no downgrade path, no
extension build/version changes.
