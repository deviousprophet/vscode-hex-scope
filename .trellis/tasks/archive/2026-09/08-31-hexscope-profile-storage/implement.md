# Implement — per-file `.hexscope` firmware profiles

Context order: jsonl -> prd.md -> design.md.

Validation: `npm run compile` (check-types + lint + esbuild), `npm run test` (vscode-test). Gate greps listed under Gates.

## Checklist

1. **[host adapter]** `src/hexScopeStorage.ts` (new; `src/core/` must not import `vscode`)
   - `DATA_VERSION`, `withEnvelope`, `unwrapEnvelope` (unknown version → null).
   - `readJson`/`writeJson` via `vscode.workspace.fs`; corrupt vs missing vs unknown-version distinction (unknown version joins corrupt path).
   - `JsonStore<T>`: cache, 400ms per-slot debounce, load/mutate/flush/dispose, self-heal only parse-ok+changed, corrupt → empty + warn-once + never overwrite.
   - `resolveHexScopeRoot`, `perFileRelativePath` (posix), `profileDir` (ordinal `profiles_N` = lowest unused integer), `findProfile(root, relPath)` scan + `createProfile`.
   - Watcher for the session's profile dir (three files), self-write horizon, debounced reload → onReload callback. No gitignore seeding anywhere.
2. **[session]** `src/hexEditorSession.ts` — replace the 30 Memento reads with the three stores
   - open flow: root + relPath → find/create profile → build `indexStore`/`structsStore`/`integrityStore` → `postInit` reads slots → dispatch existing `init`.
   - `updateStore(store, update)` helper; convert `saveLabels`, `saveStructs`, `saveStructPins`, `saveIntegrityChecks`, `saveEndian`, `saveIntegrityProfiles`, `updateLabelVisibility`, `reorderLabel` to mutation-only. Index-slot ops stay serialized via the per-file promise chain.
   - `relPath` seeded on first-open creation.
   - Dispose: flush all slots, dispose watcher. Remove all Memento key constants.
3. **[protocol]** `src/webviewProtocol.ts`
   - `endianOrDefault` single shared normalizer (remove the two duplicated copies: session slot normalizer + webview model).
   - Messages: `structsExternalChange`, `perFileDataChange` (silent; no reload dialog).
4. **[webview]** `webviewMessageModel.ts` — reducers for `structsExternalChange` (replace `S.structs`, prune pins with vanished `structId`) and `perFileDataChange` (labels/segmentNames/pins/endian/activeChecks slices); reuse existing `integrityProtiles` broadcast. No confirm/prompt wiring. `hexViewer.ts`/`webviewMessageDispatcher.ts` route the two new messages.
5. **[migration]** `src/hexScopeMigration.ts` — `migrateLegacyData(root, uri, context)`: read v2/v1/per-file structs + integrity profiles + per-file labels/names/pins/checks/endian, normalize, seed the open profile (writeIfMissing), hard-delete all touched keys incl. legacy variants (always). In-memory once-guard per root. Call before first `postInit`.
6. **[docs]** `docs/HEXSCOPE_STORAGE.md` — document new layout (`firmware_profiles/<id>/{index,structs,integrity}.json`, relPath lookup, ordinal naming + manual rename re-link, entire `.hexscope/` git-tracked, no gitignore seeding).
7. **[spec]** `.trellis/spec/frontend/state-management.md` + `directory-structure.md` — Persistence Scope section: workspace-wide → per-profile layout; fix stale owner line (`structMigration` belongs in `src/core/structMigration.ts`, not `HexEditorSession`).
8. **[tests]**
   - `src/test/extension/hexScopeStorage.test.ts` — read/missing/corrupt/unknown-version envelope, self-heal-only-on-changed, debounce/flush/dispose, slot independence, ordinal profile create/lookup, rename-survival (relPath match wins), no gitignore seeding, migration pipeline (fake context doubles) → seeds + deletes every key.
   - Webview: reducer tests for `structsExternalChange` + `perFileDataChange`; `endianOrDefault` single home.
   - Watcher-conflict test mirroring hex-file external-change pattern (external edit auto-applies; self-write does not re-trigger).
9. **[schemas]** `schemas/{index,structs,integrity}.schema.json` (repo, bundled + `jsonValidation` registration), `$schema` sibling injected/preserved in `hexScopeStorage`, `.hexscope/schemas/` seeded at first profile creation, docs `HEXSCOPE_STORAGE.md` schema section.
10. **[schema tests]** `ajv` devDependency (test-only; do not add to `dependencies`) + `src/test/schemas/schemaValidation.test.ts`: validate representative fixtures against the three schemas (strict pass, negative cases: wrong type/enum/bad version), plus a drift-guard asserting each schema's `version` const equals `DATA_VERSION`.

## Gates

- After step 2: `npm run check-types` green.
- After step 4: `npm run lint` green.
- After step 8: full `npm run compile` + `npm run test` green.
- After step 10: `npx fallow` 4-axis green + full `npm run test` green.
- Grep gate: no `globalState`/`workspaceState` reads in session storage paths (`hexEditorSession.ts`, migrate module only reads for deletion).
- Grep gate: no `.gitignore` seeding / `local/` references in `src/`.

## Rollback points

- Steps 1–4 are additive behind the session; revert commits → behavior identical minus persistence (Memento is only touched in step 5, keeping migration last for an auditable blast radius).
- Migration idempotent + writeIfMissing-guarded -> re-runnable; roll back to `main` + old Memento intact if migration never ran on a given root.