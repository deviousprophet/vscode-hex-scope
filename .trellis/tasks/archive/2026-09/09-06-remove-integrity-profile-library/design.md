# Design: strip the Integrity-panel profile library

## Current state

`IntegrityPanel` (`src/webview/components/sidebar/integrityPanel/integrityPanel.ts`)
owns checks AND a profile library rendered by `profileLibraryHtml` /
`wireProfileControls` / `refreshProfileLibrary` from `integrityProfiles.ts`
(select + Save as… + ⋮ Update/Rename/Delete + inline name form). The library is
registry-backed: webview posts `create/update/rename/deleteIntegrityProfile`;
host (`hexEditorSession.ts`) syncs the profile registry through
`syncRegistryToIntegrityProfiles` / `registryAsIntegrityProfiles` /
`upsertRegistryProfile` / `deleteRegistryProfile` and broadcasts via
`broadcastIntegrityProfiles`. `init` carries `integrityProfiles: { profiles,
activeChecks }`; webview `integrityProfiles` applier feeds `setProfiles`.

## Target state

One profile system (file profiles). The panel shows only checks.

### Webview
- `integrityPanel.ts`:
  - Drop `profiles`/`selectedProfileId`/`profileError`/`profileNameMode` fields,
    `setProfiles`/`preselectFirstProfile`/`clearMissingSelectedProfile`/
    `refreshProfilesIfRendered`/`integrityInitPayload`/`integrityProfileValues`/
    `restoreChecks`/`refreshProfileLibrary`, the `Profile` label + `Profile` row,
    and the `width=Profile/Callbacks onCreate/Update/Rename/DeleteProfile`.
  - Add local `persistChecks(this)` (moved from `integrityProfiles.ts`, using
    `integrityCheckSetFromStates` + `cb.onPersistChecks`).
  - `init` checks arrive via a new/renamed applier target → `setChecks`.
- Delete `integrityProfiles.ts` entirely; remove its imports from
  `integrityPanel.ts` (keep `integrityCheckModel.ts`, `integrityHighlight.ts`,
  `menuController` — menu still used by other components, verify).
- `hexViewer.ts`: remove the four CRUD callbacks from the integrity callbacks
  block, the `integrityProfiles` message handler, and the
  `applyIntegrityProfileUpdate` effect.

### Protocol (`src/webviewProtocol.ts`)
- WebviewToProviderMessage: delete `createIntegrityProfile`,
  `updateIntegrityProfile`, `renameIntegrityProfile`, `deleteIntegrityProfile`.
- ProviderToWebviewMessage: delete `integrityProfiles`. `init` replaces
  `integrityProfiles: { profiles, activeChecks }` with `activeChecks:
  IntegrityCheckSet`.

### Model/effects (`webviewMessageModel.ts`, `hexViewer.ts`)
- `applyInitMessage`: return `activeChecks: msg.activeChecks` (reusing
  `applyActiveChecksUpdate` → `integrityPanel.setChecks`).
- Delete `applyIntegrityProfilesMessage` + the `integrityProfiles` applier entry
  + handler + effect. Update `noOpHandlers`/handler maps in tests.

### Host (`hexEditorSession.ts`)
- `postInit`: build `activeChecks: indexData.activeChecks` (drop the
  `registryAsIntegrityProfiles`/integrityProfiles wrapper).
- Delete handlers `createIntegrityProfile`/`updateIntegrityProfile`/
  `renameIntegrityProfile`/`deleteIntegrityProfile` and helpers
  `saveIntegrityProfiles`/`loadIntegrityProfiles`/`broadcastIntegrityProfiles`/
  `sendIntegrityProfileError`/`registryAsIntegrityProfiles`/
  `syncRegistryToIntegrityProfiles`, plus now-unused imports (`normalizeIntegrityProfiles`,
  `IntegrityProfile`, `renameIntegrityProfiles`, `sameProfileName` if unused
  elsewhere).
- Keep: `saveIntegrityChecks` (→ bound profile), registry CRUD used by the
  toolbar/commands, migration template handling (unchanged).

### Tests
- `src/test/webview/components/sidebar/integrityPanel/integrityPanel.test.ts`:
  remove profile-library tests (~select render, apply-confirm, CRUD, save-as,
  profile menu); keep/a虽 adjust mount + checks tests to the new render (no
  `Profile` row).
- `webviewMessageModel.test.ts`: init payload `activeChecks`; drop
  `integrityProfiles` applier expectation if present; remove handler stub.
- `webview.test.ts`: drop CRUD callbacks.
- `src/test/extension/hexScopeStorage.test.ts` migration tests: unchanged
  (verify profiles still migrate to registry).

## Tradeoffs

- `init` protocol shape changes (`integrityProfiles` → `activeChecks`): webview
  and host ship together in the VSIX, so no compatibility shim needed.
- Removing the integrity-profile *library* keeps the toolbar file-profile
  dropdown + `hexScope.*Profile` commands as the single CRUD surface; three-tier
  registry + bindings untouched.

## Rollout / rollback

- Single commit; revert restores the library. No migration concerns (no on-disk
  format change; `activeChecks` location in profile.json unchanged).