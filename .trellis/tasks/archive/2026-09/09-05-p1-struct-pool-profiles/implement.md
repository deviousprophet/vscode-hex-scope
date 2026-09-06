# P1 Implement: Three-tier storage (workspace structs / profile registry / bindings)

Source: `firmware_profile.md` Design decision + P1 section (lines ~33-253);
`prd.md`/`design.md` in this task.

## Ordered checklist

1. **`src/hexScopeStorage.ts` — new store kinds**
   - Add `StructStore` (`.hexscope/structs.json`), `ProfileStore` registry
     (`.hexscope/profiles/<id>.json`), `BindingStore` (`.hexscope/bindings.json`)
     built on `JsonStore`/`writeJson`. `ProfileRecord`/`Binding` types.
   - Remove `firmware_profiles/` traversal: `findProfile`, `createProfile`,
     `createProfileDir`, `profileJsonUri` profile-only paths, `index.json`/
     `integrity.json` access. Keep `JsonStore` core, schemas seeding, watchers.
   - Keep P0 deferred semantics: pool/registry/bindings only written on
     first mutation / explicit profile action; reads in-memory empty.
2. **`src/hexEditorSession.ts` — bind-to-profile plumbing**
   - On open: resolve root, load `bindings.json`; find binding for `relPath`.
     Load bound `ProfileRecord` (or in-memory empty when unbound). `postInit`
     pushes profile name + struct pool + bound profile's overlays.
   - Write handlers (`saveLabels`/`saveStructPins`/`saveEndian`/`saveIntegrityChecks`,
     label ops, integrity CRUD) write into the bound profile
     (`profiles/<id>.json`); struct edits (`saveStructs`) write the workspace
     pool. Unbound file first mutation → creates a profile (name default e.g.
     file basename) + binding (matches P0 "no write on open" + AC "first edit
     creates").
   - `broadcastPerFileData`/`broadcastStructs`/integrity broadcast read from new
     locations. `attachProfileWatcher` watches pool+registry+bindings.
3. **Binding lifecycle** — `onDidRenameFiles` rewrite fileKey, `onDidDeleteFiles`
   remove entries; prune on every bindings write. Register in `activationEvents`/
   constructor once.
4. **Select Profile dropdown (webview)** — toolbar dropdown always rendered;
   "+ New Profile..." inline input; select → `selectProfile` message; provider
   applies (writes binding, refreshes overlays, updates display). Alias the
   Command Palette `hexScope.selectProfile` + status bar to the same path.
   Include `boundFileCount` in pushed state; show shared-profile hint in
   pin/label/check editors when >1.
5. **CRUD commands (`src/extension.ts`)** — `hexScope.newProfile`,
   `hexScope.duplicateProfile`, `hexScope.renameProfile`, `hexScope.deleteProfile`
   (confirm with bound count when 1+); registry API in hexScopeStorage. Register
   in package.json `contributes.commands` (+ title/category).
6. **Migration (`src/hexScopeMigration.ts`)** — one-time on first load: merge
   legacy `structs.json` into pool (dedupe), convert each index+integrity pair
   to ProfileRecord + binding; Memento tariff; leave legacy tree until success.
7. **Schemas + docs** — new `structs.schema.json`, `profile.schema.json`,
   `bindings.schema.json`; retire `integrity`/`index` schemas; update
   `package.json` `contributes.jsonValidation`; update `docs/HEXSCOPE_STORAGE.md`;
   seed copies under `.hexscope/schemas/`.
8. **Tests (`src/test/extension/`)** — binding lifecycle (rename/delete/prune),
   select-profile sharing (2 files → 1 profile), out-of-workspace select, CRUD,
   migration (legacy tree → pool+profiles+bindings, dedupe), dropdown message
   flow, shared-hint.
9. **Validation** — `npm run check-types`, `npm run lint`, `npm test`.
10. **P2 re-check** — confirm no spurious external-change after new storage
   writes; watcher scoping correct.

## Review gates

- No `firmware_profiles`/`index.json`/`integrity.json` reads remain except
  migration.
- Legacy migration idempotent (Memento tariff); no data loss (dedupe retains
  one copy of each distinct struct set).
- All AC in `prd.md` green; existing suite passes.

## Rollback points

- Additive new files → remove `structs.json`/`profiles/`/`bindings.json` and
  revert code restores legacy behavior. Migration leaves legacy tree until
  success marker.

## Context manifests

- `implement.jsonl`/`check.jsonl`: spec/research refs.