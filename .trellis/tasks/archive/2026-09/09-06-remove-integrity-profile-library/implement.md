# Implement: strip the Integrity-panel profile library

Source: `prd.md`/`design.md` in this task. Follow the design's file-by-file
checklist. Validation gates at the end.

## Ordered checklist

1. **Webview panel** (`src/webview/components/sidebar/integrityPanel/`)
   - `integrityPanel.ts`: remove profile fields/methods/markup + CRUD callbacks;
     add local `persistChecks`.
   - Delete `integrityProfiles.ts`; fix imports (keep `integrityCheckModel.ts`
     import of `integrityCheckSetFromStates` for `persistChecks`).
   - Confirm `menuController` still used elsewhere before leaving its import.
2. **Protocol** (`src/webviewProtocol.ts`): drop 4 CRUD messages + `integrityProfiles`;
   `init` gains `activeChecks: IntegrityCheckSet`.
3. **Model/effects**: `webviewMessageModel.ts` `applyInitMessage` → return
   `activeChecks: msg.activeChecks`; delete `applyIntegrityProfilesMessage`.
   `hexViewer.ts`: drop CRUD callbacks + `integrityProfiles` handler + effect.
4. **Host** (`src/hexEditorSession.ts`): `postInit` init payload → `activeChecks`;
   delete the 4 handlers + save/load/broadcast/send/registryAs/sync helpers;
   prune unused imports; keep `saveIntegrityChecks` + registry CRUD.
5. **Specs** — `.trellis/spec/frontend/integrity-checks.md` and
   `.trellis/spec/frontend/hexscope-storage.md`: remove the panel profile-library /
   "re-backed by the registry" wording; `integrity-checks.md` → checks live in
   the bound file profile `activeChecks`.
6. **Tests** — adjust `integrityPanel.test.ts` (drop library tests, adapt
   mount/checks), `webviewMessageModel.test.ts` (init `activeChecks`, handler
   map), `webview.test.ts` (drop CRUD callbacks). Verify migration tests still
   expect legacy templates → registry profiles.
7. **Validation** — `npm run check-types`, `npm run lint`,
   `npx fallow --format json` (0/0/0), `npm test`.

## Review gates

- Grep: no `createIntegrityProfile|updateIntegrityProfile|renameIntegrityProfile|
  deleteIntegrityProfile|registryAsIntegrityProfiles|syncRegistryToIntegrityProfiles|
  broadcastIntegrityProfiles|loadIntegrityProfiles` outside removed context.
- Grep: no `.integrity-profile-` markup or `profileLibraryHtml`/`wireProfileControls`
  references.
- Fallow: `total_issues` 0, `findings` 0, `clone_groups` 0.
- AC in `prd.md` all green.

## Rollback points

- Single commit revert restores the library. No on-disk format change.

## Context manifests

- `implement.jsonl`/`check.jsonl`: spec refs (integrity-checks.md,
  hexscope-storage.md, state-management.md).