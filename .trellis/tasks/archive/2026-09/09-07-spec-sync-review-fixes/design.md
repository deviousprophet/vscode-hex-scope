# Design: spec-sync done + review fixes (D1-D7)

Part A (spec-sync) is already applied to `editing-save-external-change.md`,
`integrity-checks.md`, `hexscope-storage.md`. This design covers the grilled
fixes.

## D1 — Extract `src/webview/profilePicker.ts`

Move out of `hexViewer.ts`, as a stateless host-adjacent module:

- `renderProfileDropdown` + `profileNameFor`, `profileDropdownOptions`,
  `profileSelectTitle`, `profileActionsHtml`, `wireProfileActions`,
  `PROFILE_ACTION_MESSAGES` (typed, D5), `handleProfileAction` (D5),
  `handleProfilesStateMessage` (toast + `lastProfileCurrent`),
  `handleActivateProfilePickerMessage`.
- Exports: `profilePicker.render()` (write `#profile-picker` innerHTML + wire
  select change + actions button), `profilePicker.seed()` (init `lastProfileCurrent`),
  `profilePicker.handleProfilesState(msg)`, `profilePicker.handleActivatePicker(msg)`.
- `hexViewer.ts` keeps: shell injection of `#profile-picker` in `render()`,
  `setupRenderedUi` calling `profilePicker.render()` + `profilePicker.seed()`,
  and the `MESSAGE_HANDLERS` entries delegating to the module.
- Keep every exported/helper function cyclo <=4 (extract `row()` / `isProfileAction`
  as needed). No `S` writes outside the handlers already doing it.

## D2 — Shared `ProfileSummary`

`webviewProtocol.ts`: `export interface ProfileSummary { id: string; name: string }`.
Use in:
- `init.profile.profiles` / `profilesState.profiles` payload types.
- `state.ts` `S.profileState.profiles: ProfileSummary[]`.
- `webviewMessageModel.ts` `WebviewProfileState` → built from `ProfileSummary`
  (replace the private `{ id, name }` repeated field).
Host-only `listProfiles()` return type may reuse `ProfileSummary`.

## D3 — `src/core/fromUnknown.ts`

Runtime-neutral (no vscode import) helpers used by storage + migration:
`plainObject`, `arrayOrEmpty`, `stringField`, `arrayField`, `plainStringRecord`,
`stringOrEmpty`. Move the existing implementations out of `hexScopeStorage.ts`
(`plainObject`, `arrayOrEmpty`, `plainStringRecord`) and `hexScopeMigration.ts`
(`plainRecord`/`isRecordObject`, `stringField`, `arrayField`,
`plainStringRecord`, `normalizeChecks`-adjacent) into the new file; both modules
re-import them. Keep `endianOrDefault` where it lives. No behaviour change.

## D4 — Destructure in profile toast handler

`handleProfilesStateMessage`: `const { profiles, current, boundFileCount } = S.profileState;`
once; use locals. No other change.

## D5 — Typed profile-action map

`export type ProfileAction = 'saveProfile' | 'duplicateProfile' | 'renameProfile' | 'deleteProfile';`
`const PROFILE_ACTION_MESSAGES: Record<ProfileAction, WebviewToProviderMessage>;`
`function isProfileAction(cmd: string): cmd is ProfileAction { return cmd in PROFILE_ACTION_MESSAGES; }`
`handleProfileAction` uses the guard.

## D6 — structPins/pins schema compat

`schemas/profiles.schema.json`: keep `structPins` required; add `"pins"` as an
allowed **deprecated** property (same shape, `"deprecated": true`) so files
carrying the pre-rename key pass strict validation while the normalizer's
`structPins ?? pins` tolerance keeps reading them. Add positive schema test with
a legacy `pins`-key record. No runtime change.

## D7 — Cross-tab delete staleness (verify-only)

`refreshProfileStores` already re-derives `profileId` from `boundProfileId` on
every watcher event and clears `boundProfileCache` when null; since 41315d8 the
watcher is attached for every session, so an external delete of a bound profile
age-outs the sibling `profileId` immediately. Implement step: verify this path
and add a storage-level test for `deleteRegistryProfile` clearing all relevant
bindings (if not already covered); do not add session-harness code. If a real
gap is found, fix it in `refreshProfileStores`, otherwise record verified.

## Guards

- `.trellis/spec/frontend/components/component-toolbar.md` and
  `hexscope-storage.md` updated again (3.3) to reflect the extract + D5/D6 after
  implementation.
- types/lint/fallow-0-0-0/test must stay green.