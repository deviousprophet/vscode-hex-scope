# Implement — Refresh stale .hexscope/schemas copies

Run the gates after the hook lands; run fallow at the end.

- [ ] 1. In `src/hexScopeStorage.ts`, add
      `hexScopeRootFromDataUri(uri): string | null` — returns the root when the
      uri is a top-level `.hexscope` data file (`profiles.json` /
      `structs.json` / `bindings.json` directly under a `.hexscope/` dir), else
      `null`. Reuse the existing file-name constants.
- [ ] 2. Rewrite `seedSchemaCopies(root)` to content-diff each `SCHEMA_FILES`
      entry (parsed `readJson` vs `bundledSchema`, compared as
      `JSON.stringify(value, null, 2)`), write only when missing/differing, and
      **return the names it wrote** (`string[]`, empty when all current).
- [ ] 3. Hook it into `writeJson` after the data-file write: when
      `hexScopeRootFromDataUri(uri) !== null`, call the refresher best-effort
      (`try/catch`, swallowed) so a refresh failure never fails the data write.
      Add a comment stating the recursion invariant (schema copies are not data
      files → the guard returns `null` for them).
- [ ] 4. Remove the now-redundant
      `if (read.status === 'missing') { await seedSchemaCopies(root); }` in
      `writeProfileRecord` (the sink now seeds on the same write).
- [ ] 5. Update `.trellis/spec/frontend/hexscope-storage.md` (seeding is now a
      content-diff refresh on data writes, not write-once) and
      `docs/HEXSCOPE_STORAGE.md`.
- [ ] 6. Tests in `src/test/extension/hexScopeStorage.test.ts`:
      - a workspace whose `.hexscope/schemas/structs.schema.json` is stale (or
        absent) is refreshed to the bundled content by a data write
        (`writeProfileRecord`/`JsonStore.flush`);
      - `seedSchemaCopies` returns `[]` when the copies already match the
        bundled schemas, and the names written when stale;
      - a bare open creates/updates no files (extend the existing no-write
        assertions);
      - the data files' bytes are unchanged by the refresh;
      - no recursion (a refresh does not loop).
- [ ] 7. Gates + fallow:
      - `npm run check-types`
      - `npm run lint`
      - `npm run compile-tests && npm test`
      - `node .agents/skills/fallow-fix/scripts/fallow-extract.mjs` → GREEN

## Validation

- Existing-workspace refresh proven end-to-end (stale → current on one data
  write).
- `seedSchemaCopies` return value distinguishes current (empty) from stale.
- Bare open still writes nothing; data files byte-identical.
- Commands: `npm run check-types`, `npm run lint`,
  `npm run compile-tests && npm test`; fallow GREEN.

## Review gates

- After step 3: sink-hook review — recursion guard, order (refresh after write),
  best-effort failure handling.
- Before finish: full suite + fallow; confirm the data files are untouched by
  the refresh and the no-write-on-open contract still holds.

## Rollback points

- Steps 1–2 are additive (the refresher gains a return value).
- Step 3 is the only behavioral hook; revert it alone to restore write-once.
- Steps 4–6 are cleanup/tests/docs.

## Out-of-scope guard

Do not add schema `if/then` coupling, bump a data-schema version, or re-seed on
a bare open.
