# Implement: review fixes D1-D7 (spec-sync already applied)

Source: prd.md (grill decisions) + design.md in this task.

## Ordered checklist

### D1 — extract `src/webview/profilePicker.ts`
1. Create the module; move the listed profile-picker functions/logic from
   `hexViewer.ts`. Keep cyclo <=4 per function. Verify imports (esc, showToast,
   menuController, postProviderMessage, S, WebviewMessageByType).
2. `hexViewer.ts`: delete moved code; keep `#profile-picker` shell injection,
   `setupRenderedUi` → `profilePicker.render()` + `profilePicker.seed()`,
   `MESSAGE_HANDLERS` entries → `profilePicker.handleProfilesState` /
   `profilePicker.handleActivatePicker`; remove now-unused imports.
3. Greps after: no `renderProfileDropdown|lastProfileCurrent|PROFILE_ACTION_MESSAGES`
   remaining in hexViewer (module owns them); no orphan exports.

### D2 — shared `ProfileSummary`
4. `webviewProtocol.ts`: add + use `ProfileSummary` in init/profile and
   profilesState payloads.
5. `state.ts` profileState.profiles → `ProfileSummary[]`.
6. `webviewMessageModel.ts` `WebviewProfileState` built from `ProfileSummary`.
7. Host `listProfiles` return type reuse where clean.

### D3 — `src/core/fromUnknown.ts`
8. New runtime-neutral file; move `plainObject`/`arrayOrEmpty`/`plainStringRecord`
   (storage) + migration's `plainRecord`/`isRecordObject`/
   `stringField`/`arrayField`/`stringOrEmpty` shapes in, unified; re-import in
   `hexScopeStorage.ts` + `hexScopeMigration.ts`. Keep storage/migration local
   behaviour identical; delete the now-duplicated locals.
9. Grep: `function plainObject`/`arrayOrEmpty` defined in exactly one place.

### D4 — destructure toast handler
10. `handleProfilesStateMessage` (now in profilePicker.ts): destructure once.

### D5 — typed map
11. `ProfileAction` type + `Record<ProfileAction, ...>` + `isProfileAction` guard.

### D6 — schema compat
12. `schemas/profiles.schema.json`: add deprecated `pins` property (structPin
    ref); keep `structPins` required.
13. `src/test/schemas/schemaValidation.test.ts`: add a positive fixture using
    the legacy `pins` key (must pass); existing strict negatives still pass.

### D7 — cross-tab staleness verify-only
14. Read `refreshProfileStores` + `deleteRegistryProfile`; add an extension test
    that `deleteRegistryProfile` clears all bindings to the deleted profile
    (if not already covered); report verification. Only fix if a gap is found.

### Specs (3.3)
15. Update `.trellis/spec/frontend/components/component-toolbar.md` (picker now a
    module) + `hexscope-storage.md` (deprecated `pins` key, typed actions) +
    `state-management.md` (ProfileSummary) to match.

## Validation
- `npm run check-types`, `npm run lint`
- `npx fallow` (node-parse): 0/0/0
- `npm test`

## Review gates
- All D1-D6 implemented; D7 verified (test or documented gap).
- Greps: moved symbols absent from hexViewer; single fromUnknown; no new exports
  unused; schema drift-guard updated.
- Part A spec-sync (already applied) not regressed.

## Rollback points
- Each D independent; single-commit revert; schema change is additive
  (deprecated property) so old validators unaffected.

## Context manifests
- `implement.jsonl`/`check.jsonl`: hexscope-storage, component-toolbar,
  state-management, struct-model, integrity-checks.