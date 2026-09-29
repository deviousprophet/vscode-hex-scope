# Refresh stale .hexscope/schemas copies

## Goal

A workspace that already has a `.hexscope/` folder keeps whatever schema copies
were seeded the first time it was materialized, so after an extension update
that changes the bundled schemas (this branch added `kind`/`baseType`/
`bitFields`/`entries`/`hidden`/`showHiddenFields`) the generated
`.hexscope/schemas/*.schema.json` copies stay stale forever. Make the copies
self-refresh to the bundled schema on the next write.

## Root cause

`seedSchemaCopies` writes each bundled schema with `writeIfMissing`, and is
called only `if (read.status === 'missing')` on the first `profiles.json`
write. Existing workspaces never satisfy that again, and nothing compares the
on-disk copy to the bundled schema.

## Requirements

- R1. On any `.hexscope` **data** write, refresh the generated
  `.hexscope/schemas/*.schema.json` copies to the bundled schema so an existing
  workspace picks up schema changes.
- R2. Refresh is **content-diff**: a copy is (re)written only when it is missing
  or its parsed content differs from the bundled schema (canonical
  `JSON.stringify(..., null, 2)` comparison). A current copy is not rewritten.
- R3. The refresh runs only on the existing write path — a bare open still
  writes nothing (the documented no-write-on-open contract).
- R4. Only the `schemas/` copies are written; `structs.json`, `profiles.json`,
  and `bindings.json` are never modified by the refresh.
- R5. No recursion: writing a schema copy must not re-trigger the refresh.
- R6. A refresh failure must not fail or corrupt the data write (the copies are
  tooling-only); it is best-effort.
- R7. `seedSchemaCopies` becomes the content-diffing refresher and returns the
  names it actually (re)wrote, for tests/observability (empty when all current).
- R8. Update `.trellis/spec/frontend/hexscope-storage.md` and
  `docs/HEXSCOPE_STORAGE.md` (seeding is no longer write-once).
- R9. No on-disk data-format change; gates green; fallow GREEN.

## Constraints

- C1. No issue reference in artifacts, branch, commits, or comments.
- C2. Struct naming intact; no rename of `structs.json`/schema files.
- C3. Keep the three-tier envelope and `$schema` sibling behavior unchanged.
- C4. Do not touch the runtime schema-coupling question (that is a separate
  finding); this task is only about copy freshness.
- C5. Gates: `npm run check-types`, `npm run lint`,
  `npm run compile-tests && npm test`. Fallow: `dead-code 0 | complexity 0 |
  duplication 0`.

## Out of scope

- Adding cross-field coupling (`if/then`) to the schemas.
- A data-schema `version` bump.
- Re-seeding on a bare open / activation.

## Acceptance Criteria

- [ ] An existing workspace whose `.hexscope/schemas/<name>.schema.json` is
      stale is refreshed to the bundled content by the next `.hexscope` data
      write.
- [ ] When the copies already match, a data write does not rewrite them
      (`seedSchemaCopies` returns an empty list).
- [ ] A bare open creates/updates no files.
- [ ] The data files are byte-unchanged by the refresh.
- [ ] `hexscope-storage.md` + `docs/HEXSCOPE_STORAGE.md` describe the
      content-diff refresh.
- [ ] Gates green; fallow GREEN; no test assertion weakened.
