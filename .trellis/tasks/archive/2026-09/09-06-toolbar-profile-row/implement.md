# Implement: toolbar profile row + menu + single-file profile registry

Source: prd.md / design.md in this task. The tree already carries the R1–R6
toolbar-row + memory-visibility work and fallow-complexity refactors
(UNCOMMITTED). This plan covers the REMAINING work R7–R10 and the final
verification/commit. Do NOT redo the already-done R1–R6 changes.

## State

- Already implemented + uncommitted (leave as-is): `#profile-bar` second row
  (hexViewer.render), memory-only toggle (`updateMemoryOnlyControls`),
  `.profile-bar` CSS, lock-dim in layout.css, `profileStateValue` extraction
  (webviewMessageModel), `legacyIndexFor`/`markConverted`
  (hexScopeMigration), `applyStructDeletion` split +
  `revertDeclinedStructDeletion` (hexEditorSession). Spec
  `component-toolbar.md` partially updated (second row).

## Ordered checklist

### R7 — Profile menu (Save / Save as… / Rename / Delete)
1. `webviewProtocol.ts` WebviewToProviderMessage: add `saveProfile`,
   `duplicateProfile`, `renameProfile`, `deleteProfile` (no payloads).
2. `hexViewer.ts`:
   - `renderProfileDropdown`: after the select, add `⋮` button
     `#profile-actions-btn` + attached popover (`menuController`; the hex grid
     uses it already) with items Save / Save as… / Rename / Delete — each
     `disabled` when `S.profileState.current === null`.
   - `wireProfileActions()` posts the corresponding message and closes the menu.
   - Reuse `menuController.attach(...)` + `show(0,0,{el,anchor,focusFirst})`
     (mirror the integrity ⋮ pattern that was removed).
3. `hexEditorSession.ts` handlers (inside `enqueuePerFileOp` where they mutate)
   — see design.md §A for exact bodies. Extend `askProfileName(initial: string)`
   to seed the input-box `value`; `newProfile` keeps passing `''`.
   - `saveProfile`: `forceMaterializeOnSave = true` → `if (!profileId)
     await materializePending()` → flush `registryStore`/pool/bindings →
     broadcast → `finally { forceMaterializeOnSave = false }`.
   - `duplicateProfile` (Save as…): read bound record; `askProfileName(\`${
     src.name} Copy\`)`; one op → create record, copy fields, rebind current
     file, swap `profileId` + current record; broadcasts.
   - `renameProfile`: `askProfileName(currentName)` → rename record; broadcasts.
   - `deleteProfile`: `bindingsUsing` count → `confirmDeleteBoundProfile`;
     delete record; clear binding for relPath; `profileId = null`; broadcasts.

### R8 — out-of-workspace explicit Save
- Add `let forceMaterializeOnSave = false;` beside `materializePending`; guard
  becomes `if (!hasWorkspaceFolder && !forceMaterializeOnSave) { return null; }`.
  Only `saveProfile` toggles it (wrapped, restored in `finally`).

### R9 — shared-hint rework
- Remove `.profile-shared-hint` span + `sharedProfileHintHtml`; drop its CSS
  (`toolbar.css` `.profile-shared-hint`).
- `renderProfileDropdown`: set select `title` = `${boundName}${boundFileCount > 1
  ? \` · shared by ${boundFileCount} files\` : ''}`.
- `handleProfilesStateMessage`: after model apply, if
  `cur !== lastProfileCurrent && cur !== null && S.profileState.boundFileCount > 1`
  → `showToast(\`Shared profile "${name}" used by N files\`)`; then
  `lastProfileCurrent = cur`. Seed `lastProfileCurrent = S.profileState.current`
  in `setupRenderedUi` right after `renderProfileDropdown()` (open never toasts).

### D/R10 — single `.hexscope/profiles.json`
Follow design.md §D precisely:
- `hexScopeStorage.ts`: add `profilesJsonUri`, `normalizeProfilesRegistry`,
  array-based `readProfileRecord`/`writeProfileRecord`/`removeProfileRecord`/
  `renameProfileRecord`/`collectProfileRecords`/`nextProfileOrdinal`/
  `migrateLegacyProfileDirs` (one-time merge of `profiles/*/profile.json` into
  `profiles.json`, marker, dir tree left for rollback). DELETE dir-based
  helpers (`hexScopeProfilesRegistryDir`, `profileRegistryJsonUri`,
  `resolveProfileDir`, `createProfileRegistryEntry`, dir variants, `fixProfileId`).
  `SCHEMA_FILES`: `profile.schema.json` → `profiles.schema.json`.
- `hexScopeMigration.ts`: all registry writes use the array helpers
  (`seedOpenDocFromMemento`, `ensureProfileLegacy`, `migrateIntegrityTemplates`,
  `migrateLegacyProfileDirs` invocation in `ensureMigrationComplete`).
- `hexEditorSession.ts`: drop the per-file `profileStore: JsonStore<ProfileRecord>`
  slot; add root `registryStore: JsonStore<ProfileRecord[]>` and
  `readBoundProfile()`; per-file writers route through `withBoundProfile(patch)`
  (materialize when unbound; out-of-workspace non-explicit keeps in-memory cache;
  explicit Save flushes). Rework `writeProfileCopy`, `writeProfileName`,
  `deleteRegistryProfile`, `stripDeletedStructPins`, `createProfileFromName`,
  `listProfileRecords`, `readRegistryProfile` to array form. `postInit` reads the
  bound record from the array.
- Schemas/globs: rename `schemas/profile.schema.json` →
  `schemas/profiles.schema.json` (data = array, item = old profile shape,
  `uniqueItems` on id); update `package.json` `contributes.jsonValidation` glob
  (`.hexscope/profiles.json` → `profiles.schema.json`; drop per-dir glob).
- Specs (3.3): update hexscope-storage.md (single-file registry + migration),
  component-toolbar.md (menu + hint rework), state-management.md (new messages +
  registry ownership).

### Tests
- `hexScopeStorage.test.ts`: rework registry/dir suites → array semantics; add
  `normalizeProfilesRegistry` (dedupe id/name, order), array upsert/remove/
  rename/ordinal, `migrateLegacyProfileDirs` (merge + marker + rollback tree),
  schema drift guard → `profiles.schema.json` fixture. Keep binding/struct/
  deferred/struct-deletion semantics passing.
- Greps: `profileRegistryJsonUri`, `hexScopeProfilesRegistryDir`,
  `resolveProfileDir`, `sharedProfileHintHtml`, `\\.profile-shared-hint`,
  `profiles/<id>` → 0 hits in src (legacy migration markers aside).

## Validation
- `npm run check-types`, `npm run lint`
- `npx fallow` (parse via node from stdin): **0/0/0** (the tree must stay at 0 —
  the 4 earlier complexity regressions were fixed; do not reintroduce).
- `npm test`

## Review gates
- R7/R8/R9/D ACs in prd.md green; R1–R6 untouched.
- Greps above clean.
- `.trellis/tasks/**` + `firmware_profile.md` never staged.

## Rollback points
- `profiles.json` additive; old `profiles/*` dir tree preserved by migration
  until success; single-commit revert recovers everything.