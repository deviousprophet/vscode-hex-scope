# Design: profile-bar menu + single-file profile registry + shared-hint rework

## D. Single-file profile registry (R10)

### Target storage
```text
.hexscope/profiles.json   { version, data: ProfileRecord[], $schema? }   # one array, all profiles
.hexscope/structs.json    unchanged
.hexscope/bindings.json   unchanged
.hexscope/schemas/profiles.schema.json   (renamed from profile.schema.json; data = array, uniqueItems id)
```

### `src/hexScopeStorage.ts`
- Add `profilesJsonUri(root)`; export `ProfileRecord[]`-aware registry helpers:
  - `normalizeProfilesRegistry(raw): NormalizedValue<ProfileRecord[]>` — plain
    object/envelope unwrap (readJson does it), array-or-[], drop malformed
    records, dedupe by `id`, drop case-insensitive duplicate `name`s, preserve
    order.
  - `readProfileRecord(root, id, fallbackName?): Promise<ProfileRecord | null>`
    — scan the array (rename from the dir-based version).
  - `writeProfileRecord(root, rec)` — upsert one record into the array
    (read-modify-write, envelope + prune-through).
  - `removeProfileRecord(root, id)` / `renameProfileRecord(root, id, name)` /
    `collectProfileRecords(root)` implemented over the array.
  - `nextProfileOrdinal(root)` — lowest unused `profile_<n>` among array ids.
  - `migrateLegacyProfileDirs(root)` — one-time merge of
    `.hexscope/profiles/*/profile.json` dirs into `profiles.json` (dedupe), then
    mark migrated; leave the dir tree for rollback (mirror the firmware_profiles
    `.converted`-marker pattern applied to the profiles dir as a whole or per
    dir).
- REMOVE dir-based machinery: `hexScopeProfilesRegistryDir`,
  `profileRegistryJsonUri`, `resolveProfileDir`, `createProfileRegistryEntry`
  (dir mkdir path), `collectProfileRecords`/`readRegistryRecordFromDir`
  dir variants, `fixProfileId`. `seedSchemaCopies` seeds `profiles.schema.json`.
- `SCHEMA_FILES` list swaps `profile.schema.json` → `profiles.schema.json`.

### `src/hexScopeMigration.ts`
- `ensureProfileLegacy`-family + `seedOpenDocFromMemento` +
  `migrateIntegrityTemplates` writes → use array helpers
  (`writeProfileRecord`/`removeProfileRecord`); the tree-era `integrity.json`
  template → unbound-profile creation pushes into the array.

### `src/hexEditorSession.ts`
- Replace the single-file `profileStore: JsonStore<ProfileRecord>` slot with a
  registry-array model:
  - `registryStore: JsonStore<ProfileRecord[]>` (uri `profilesJsonUri(root)`,
    normalizer `normalizeProfilesRegistry`, empty `[]`, self-write + reload
    wiring like the pool/bindings slots). Deferred/no-write-on-open: reads return
    `[]`; writes happen only on mutation (registry create/upsert) or explicit
    Save — matching bindings/structs behavior.
  - Bound-record reads: `readBoundProfile()` =
    `profileId ? readProfileRecord(root, profileId) : emptyProfileRecord('','')`
    (in-memory default record for unbound).
  - `buildProfileStores` becomes `setCurrentProfile(id | null)` + `openStores`
    returns the registry pool/bindings; per-file mutation handlers
    (`saveEndian`, `saveLabels`, `saveStructPins`, `saveIntegrityChecks`, label
    ops) go through `withBoundProfile(patch)`:
    ```
    withBoundProfile(patch) →
      materializePending() if unbound (create+bind; null when out-of-workspace non-explicit)
      rec = readProfileRecord(root, profileId) (or empty fallback)
      next = patch(rec)
      if profileId != null → writeProfileRecord(root, next)        // disk
      else → keep next in a session in-memory bound cache            // stays in-memory
    ```
    The in-memory cache (unbound / out-of-workspace non-explicit) is flushed by
    explicit Save (see R8 `forceMaterializeOnSave` → `materializePending` +
    `writeProfileRecord`).
  - Registry-writer helpers reworked to array form: `writeProfileCopy`,
    `writeProfileName`, `deleteRegistryProfile`, `stripDeletedStructPins`,
    `createProfileFromName` (push empty record), `readRegistryProfile`,
    `listProfileRecords`, `bindingsUsing`, `askProfileName`.
  - `materializePending` guard stays `if (!hasWorkspaceFolder &&
    !forceMaterializeOnSave) return null` (R8).
- `postInit` reads the bound record the same way (activeChecks/labels/pins).

### Schemas/globs
- `schemas/profile.schema.json` → `schemas/profiles.schema.json`: data becomes
  an array; each item = the old profile schema; add `uniqueItems: true` on item
  `id` (and keep strict nested shapes). Retire `profile.schema.json`.
- `package.json` `contributes.jsonValidation`: replace the
  `profiles/<id>/profile.json` glob with `.hexscope/profiles.json`.

### Tests
- Rework registry tests (`hexScopeStorage.test.ts`) from dir-based to array-based
  (ordinal uniqueness over array, read-by-scan, write-upsert, delete);
  migration tests gain dir→single-file merge; schema drift guard → profiles array
  schema. Keep binding/struct/check/deferred/struct-deletion suites' semantics
  (update constructors/URIs).
- Greps: `profileRegistryJsonUri`, `hexScopeProfilesRegistryDir`,
  `resolveProfileDir`, `profiles/<id>` gone from source; `profiles.json` present.

## E. Rollout / rollback

- Single commit (with the toolbar row + menu + hint changes). Migration leaves the
  old `profiles/*` dir tree untouched until the one-time merge succeeds, so a
  rollback of the code still finds per-dir data; `profiles.json` is additive.
- No `PROFILE` envelope version bump (same `DATA_VERSION`).

---

## A. Profile menu (⋮) in the profile bar

Follows the second-row toolbar work (R1–R6 already implemented + uncommitted).

## A. Profile menu (⋮) in the profile bar

### Webview (`src/webview/hexViewer.ts`)
- `renderProfileDropdown()` adds, after the select, a `⋮` button
  (`#profile-actions-btn`, `.sb-btn sb-btn-secondary`) + attached popover
  (reuse `menuController` — already used for the hex grid menu). Items:
  **Save**, **Save as…**, **Rename**, **Delete**. Items (other than the button
  itself) are `disabled` when `S.profileState.current === null`.
- Menu wiring mirrors the hex menu pattern (`menuController.attach(host)`,
  `menuController.show(0,0,{el, anchor, focusFirst})`, click→
  `postProviderMessage`, close).
- Rendered via a pure helper `profileActionsHtml(current)` + `wireProfileActions`
  (idempotent within `renderProfileDropdown`).
- Not shown per CRUD workflow: rename uses the select's existing `title`.

### Host (`src/hexEditorSession.ts`) — new WebviewToProviderMessage handlers
New message types in `webviewProtocol.ts` (WebviewToProviderMessage):
`saveProfile` · `duplicateProfile` · `renameProfile` · `deleteProfile`.

Each handler runs inside `enqueuePerFileOp` where it mutates:

1. **`saveProfile`** — explicit flush:
   ```ts
   forceMaterializeOnSave = true;
   try {
     if (!profileId) { await materializePending(); }
     await profileStore?.flush();
     await structPoolStore?.flush();
     broadcastPerFileData();
     void broadcastProfilesState();
   } finally { forceMaterializeOnSave = false; }
   ```
   `materializePending`'s guard becomes
   `if (!hasWorkspaceFolder && !forceMaterializeOnSave) { return null; }`
   — reintroducing the flag **only as the genuine out-of-workspace explicit-Save
   path** (this is the "wire it properly" answer to review finding #4 once Save
   exists; flag was vestigial for new/select which still bypass it).

2. **`duplicateProfile`** (Save as…): read current bound `ProfileRecord`
   (`profileId`), `askProfileName(\`${src.name} Copy\`)` for the new name, then——
   in one op——`createProfileFromName` + `writeProfileCopy` + `bindFile(relPath →
   new id)` + `profileId = id; buildProfileStores(id); profileStore.load(true)`;
   broadcast both. (Save-as keeps the current file bound to the copy.)
   Extend `askProfileName` to accept an initial `value` (used as the input
   default) — `newProfile` keeps passing `''`.

3. **`renameProfile`** — read bound `ProfileRecord`, `askProfileName(rec?.name
   ?? '')`, `writeProfileName(root, profileId, rec, profileId, newName)`;
   broadcasts.

4. **`deleteProfile`** — count bindings (`bindingsUsing`); if 0 → delete
   immediately, else `confirmDeleteBoundProfile`; on confirm
   `deleteRegistryProfile(root, profileId)`, `profileId = null;
   buildProfileStores(null)`; if the current file's binding pointed at it,
   `unbindFile`. Broadcasts.

Reused module helpers (already tested): `createProfileFromName`, `askProfileName`,
`writeProfileCopy`, `writeProfileName`, `deleteRegistryProfile`,
`confirmDeleteBoundProfile`, `bindingsUsing`, `materializePending`.

## B. Shared-profile hint rework (R9)

- Remove the persistent `.profile-shared-hint` span + `sharedProfileHintHtml`.
- `renderProfileDropdown`: set the select `title` attribute to the bound profile
  name; when `boundFileCount > 1` append `" · shared by N files"`.
- Transient toast: module flag `let lastProfileCurrent: string | null = null;`
  In `handleProfilesStateMessage` (after the model apply):
  ```
  const cur = S.profileState.current;
  if (cur !== lastProfileCurrent && cur !== null && S.profileState.boundFileCount > 1) {
      showToast(`Shared profile "${name}" used by ${S.profileState.boundFileCount} files`);
  }
  lastProfileCurrent = cur;
  ```
  `setupRenderedUi` seeds `lastProfileCurrent = S.profileState.current` right
  after `renderProfileDropdown()` so opening never toasts; only a later user
  switch to a shared profile does. Clear `lastProfileCurrent` when a profile is
  deleted/unbound via host push (profilesState current null → assignment handles
  it).

## C. Tests / validation

- Extension-host (`hexScopeStorage.test.ts`): helper-level coverage already
  exists for write/dup/delete/bind. Add where feasible: `askProfileName` initial
  value; profile-name rename round-trip helper; Save-as rebind helper
  (composition-level via existing helpers).
- Webview: no hexViewer-shell unit harness (repo precedent — search-box/sidebar
  toggles likewise untested); keep `renderProfileDropdown` markup assertions
  light or none beyond current parity tests.
- Gates: `npm run check-types`, `npm run lint`, `npx fallow` 0/0/0, `npm test`.
- Greps: `profile-shared-hint`/`sharedProfileHintHtml` gone from source + CSS.

## Rollout

- Single commit with the R1–R6 toolbar work. No storage-format change
  (`forceMaterializeOnSave` is session-scoped only).