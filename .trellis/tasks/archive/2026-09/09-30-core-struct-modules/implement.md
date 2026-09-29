# Implement — Move struct modules into src/core/struct/

Pure path move. Run the gates after the import rewrite; run fallow at the end.

- [ ] 1. `git mv` the five files into `src/core/struct/`:
      `structCodec.ts`, `structNormalization.ts`, `structMigration.ts`,
      `structIdentities.ts`, `structBitChildren.ts` (names unchanged).
- [ ] 2. In the moved files, rewrite `'./types'` → `'../types'` (5 sites).
      Leave the four intra-set specifiers as-is.
- [ ] 3. Rewrite the 24 importer specifiers in the table (design.md), host →
      webview → tests, preserving each site's `.js`/no-`.js` convention. Do not
      touch `hexEditorProvider.ts`'s `export { migrateStructDefinitions }` shim.
- [ ] 4. Update specs/docs path references: `directory-structure.md` (tree +
      Deep Module Seams), `struct-model.md`, `struct-instance-display.md`,
      `state-management.md`, `component-sidebar-struct-panel.md`,
      `hexscope-storage.md`, `docs/HEXSCOPE_STORAGE.md`.
- [ ] 5. Gates + fallow:
      - `npm run check-types`
      - `npm run lint`
      - `npm run compile-tests && npm test`
      - `node .agents/skills/fallow-fix/scripts/fallow-extract.mjs` → GREEN
- [ ] 6. Confirm no behaviour change: `git status` shows only the moved files,
      the import-only edits, and the doc updates; no test logic changed; no CSS.

## Validation

- All imports resolve (`check-types` + `compile-tests`).
- The suite passes with no assertion edits; `providerUtils.test.ts` still passes
  through the `hexEditorProvider` re-export.
- Fallow stays GREEN (the move introduces/removes no dead code).
- `git log --follow src/core/struct/structCodec.ts` shows the rename history.

## Review gates

- After step 3: build/type-check gate (imports correct).
- Before finish: full suite + fallow; confirm the spec/`.js`-suffix conventions
  are intact (no accidental normalisation).

## Rollback points

- Single logical change; `git mv` back plus reverting the import/doc edits.

## Out of scope guard

Do not rename files, move tests, split `types.ts`, add a barrel, or change any
behaviour/API.
