# Spec-sync to codebase + review-fix decisions (grilled)

## Goal

Two parts, in order:

- **Part A — Spec-sync:** update `.trellis/spec/frontend/*` wherever it has drifted from the current codebase (the `origin/main...HEAD` profile-rework branch) so the docs describe real behaviour.
- **Part B — Review-fix decisions:** for the two-axis review findings (Standards axis primarily), decide the fixes through one-question-at-a-time grilling with the user, then implement/verify/commit them.

## Requirements

- R1 (Part A): The frontend specs are accurate against the current code — no stale watcher-eligibility, no stale per-dir `profiles/<id>/profile.json` locations, no stale `pins` vs `structPins`, no retired-layout claims.
- R2 (Part B): Each Standards-axis review finding is either fixed, explicitly declined by the user, or parked with a reason — every decision comes from one question at a time asked to the user.
- R3: Fixes land as code with tests where the repo's quality contract requires; `npm run check-types`, `npm run lint`, fallow 0/0/0, `npm test` stay green.
- R4: No changes to behaviour the user didn't approve during the grill.

## Standards-axis findings to grill (from the review)

1. **Shotgun Surgery — `hexViewer.ts`**: ~+150 lines of profile-picker logic + module bindings in one file (sanctioned owner per `component-toolbar.md`) → decide whether to keep or extract.
2. **Duplicated Code — profile-state shape ×3**: `{ id, name }[]` redefined in `state.ts`, `webviewProtocol.ts`, `webviewMessageModel.ts` → decide on a shared type.
3. **Primitive Obsession — `hexScopeMigration.ts`**: ~60 lines of hand-rolled from-unknown normalizers duplicating `hexScopeStorage.ts` patterns → decide on a shared runtime-neutral helper.
4. **Message Chains — `handleProfilesStateMessage`**: repeated `S.profileState.profiles` reads → cosmetic destructure.
5. **Speculative Generality — `PROFILE_ACTION_MESSAGES` map**: typed-bridge for the menu controller's string `cmd` → decide keep or change.

## Spec-axis findings (record decisions too)

- `structPins` rename: normalizer tolerates old `pins` but `profiles.schema.json` is strict → decide whether to keep strict schema, accept `pins`, or drop the tolerance.
- Cross-tab deletion staleness (sibling session keeps stale `profileId` until next mutation).
- Missing per-file/workspace struct-scoping setting (issue #212 idea, branch went workspace-only).
- No regression guard for the out-of-workspace external-change false-positive.

## Constraints

- Part A is mechanical spec accuracy; no code changes in Part A.
- Part B implementation only after grill decisions are recorded here.
- `.trellis/tasks/**` + any spec-only inputs stay out of commits unless approved; `firmware_profile.md` is never committed.

## Acceptance Criteria

- [ ] Frontend specs contain no statements contradicted by the current code.
- [ ] Every review finding above has a recorded decision (fix / declined / parked) from a grill question.
- [ ] Approved fixes implemented with types/lint/fallow/test green.
- [ ] Specs updated again (3.3) to reflect any fix that changes documented behaviour.

## Grill decisions (user-approved, one question at a time)

1. Q1 Shotgun Surgery — extract `webview/profilePicker.ts` (dropdown render + ⋮ menu + toast state); hexViewer keeps thin wiring.
2. Q2 Duplicated shape — add shared `ProfileSummary { id; name }` in `webviewProtocol.ts`; reuse in state.ts, unions, and the webview model.
3. Q3 Primitive Obsession — extract runtime-neutral `src/core/fromUnknown.ts` (plain/array/string field pickers) shared by storage, session, migration.
4. Q4 Message Chains — destructure `S.profileState` once in the profilesState toast handler.
5. Q5 `PROFILE_ACTION_MESSAGES` — keep, but type as `Record<ProfileAction, WebviewToProviderMessage>` + `isProfileAction(cmd)` guard (menu controller hands strings).
6. Q6 Spec-axis — fix **cross-tab delete staleness** (immediate `profileId` age-out on external delete) and **structPins/pins schema-compat** (`profiles.schema.json` accepts the legacy `pins` key as deprecated, matching `structPins ?? pins` normalization). Deferred: struct-scoping setting, out-of-workspace regression guard.

## Notes

- Review basis: `git diff origin/main...HEAD` (24 commits), fidelity > brevity.
- Grill rule: exactly one question at a time; re-ask only if the answer changed the decision set.