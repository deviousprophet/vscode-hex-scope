# Move struct modules into src/core/struct/

## Goal

Reorganise the core struct modules into a `src/core/struct/` subfolder so the
struct concern has one home, mirroring the existing `core/byteTools/` nesting
precedent. Pure move: no behaviour change. This resolves the current situation
where five `struct*` files sit loose among unrelated top-level core modules.

## Requirements

- R1. Move these five files from `src/core/` to `src/core/struct/`, keeping
  their names:
  `structCodec.ts`, `structNormalization.ts`, `structMigration.ts`,
  `structIdentities.ts`, `structBitChildren.ts`.
- R2. Rewrite every importer to the new path. The 24 specifiers are:
  `structCodec` (14 statements across 9 external files + 1 internal),
  `structNormalization` (4), `structMigration` (4), `structBitChildren` (2);
  `structIdentities` has no external importers.
- R3. Preserve each importing site's existing suffix convention exactly —
  webview files use `…/struct/structCodec.js`, host/extension/test files use
  `…/struct/structCodec` (no extension). Do not "normalise" the existing
  `.js`/no-`.js` inconsistency.
- R4. Inside the moved files, rewrite the `'./types'` imports to `'../types'`
  (5 occurrences). The four intra-set specifiers (`'./structCodec'`,
  `'./structBitChildren'`, `'./structIdentities'`) stay textually unchanged
  (same folder).
- R5. Leave `src/core/types.ts` in place (core-wide, shared beyond structs).
  Leave all tests in place; update only their import specifiers. Add no
  `index.ts` barrel.
- R6. Update `src/hexEditorProvider.ts`'s import of `structMigration` and keep
  its `export { migrateStructDefinitions }` shim (consumed by
  `src/test/core/providerUtils.test.ts`).
- R7. Update every path reference in specs/docs from `src/core/struct*.ts` to
  `src/core/struct/struct*.ts`: `directory-structure.md` (tree + Deep Module
  Seams), `struct-model.md`, `struct-instance-display.md`, `state-management.md`,
  `component-sidebar-struct-panel.md`, `hexscope-storage.md`, and
  `docs/HEXSCOPE_STORAGE.md`.
- R8. No behaviour change; no new barrel; no path alias; fallow stays GREEN and
  the gates stay green.

## Constraints

- C1. No issue reference in artifacts, branch, commits, or comments.
- C2. Struct naming stays as-is; directory/file names change only by the move.
- C3. Use `git mv` so history follows the files.
- C4. Imports stay relative (the repo has no path alias).
- C5. Gates: `npm run check-types`, `npm run lint`,
  `npm run compile-tests && npm test` green (the sole pre-existing flaky
  clipboard test excepted). Fallow: `dead-code 0 | complexity 0 | duplication 0`.

## Out of scope

- Renaming the files (e.g. dropping the `struct` prefix).
- Moving tests into `src/test/core/struct/`.
- Splitting struct types out of `src/core/types.ts`.
- Adding a barrel/entry point.
- Any behaviour or API change.

## Acceptance Criteria

- [ ] The five files exist under `src/core/struct/` with unchanged names and
      `git mv` history.
- [ ] All importers resolve; the `.js`/no-`.js` conventions are preserved.
- [ ] The `hexEditorProvider` re-export still works (`providerUtils.test.ts`
      passes).
- [ ] Specs/docs list the new paths (13 spec lines + 2 doc lines).
- [ ] Gates green; fallow GREEN; the suite passes with no assertion changes.
- [ ] No issue references; no behaviour change.
