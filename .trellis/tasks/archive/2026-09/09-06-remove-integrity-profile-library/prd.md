# Remove Integrity-panel profile library (file profiles supersede it)

## Goal

The three-tier file-profile system (parent rework `09-05-firmware-profile-rework`,
issue #212) makes the Integrity panel's own profile library redundant: integrity
checks now live as `activeChecks` inside the file's bound profile
(`.hexscope/profiles/<id>/profile.json`), selected via the toolbar **Select
Profile** dropdown. Remove the panel's separate select / Save as… / Update /
Rename / Delete profile surface and its host+protocol glue, so there is exactly
one profile system. Update the Trellis specs that still describe the retired
library.

## Requirements

- R1: The Integrity panel shows only the active checks of the bound file profile
  plus the Add/Fix-all check actions — no profile selector, no Save as…, no
  ⋮ Update/Rename/Delete menu, no inline name form.
- R2: `activeChecks` still persist into the bound file profile via the existing
  `saveIntegrityChecks` path (unchanged); genuine external profile edits still
  auto-apply silently.
- R3: Remove the now-dead webview→host messages (`createIntegrityProfile`,
  `updateIntegrityProfile`, `renameIntegrityProfile`, `deleteIntegrityProfile`)
  and the host `integrityProfiles` broadcast glue, without breaking init flow
  (activeChecks must still reach the panel on open).
- R4: Delete the webview integrity profile-library module
  (`integrityProfiles.ts`); move its shared `persistChecks` helper into
  `integrityPanel.ts` (used by check add/edit/delete/auto-fix flows).
- R5: Update Trellis specs to match: `.trellis/spec/frontend/integrity-checks.md`
  and `.trellis/spec/frontend/hexscope-storage.md` (drop the "Integrity panel is
  re-backed by the registry" wording / template-registry references).
- R6: Registry + toolbar dropdown + `hexScope.*Profile` CRUD commands are
  untouched (they are the file-profile system that replaces the panel library).

## Constraints

- No behavior change to check add/edit/delete/auto-fix/persistence.
- No leftover dead exports (fallow gate: `total_issues` 0, `findings` 0,
  `clone_groups` 0).
- Existing legacy integrity-template data remains migrated into registry
  profiles (unchanged migration) — only the panel's library UI/glue is removed.

## Acceptance Criteria

- [ ] Integrity panel render contains no profile select/Save/⋮-menu/name-form
      markup or wiring; `integrityBodyHtml` has no `Profile` row.
- [ ] Opening a file with configured checks still shows them (`init` activeChecks
      → panel), and adding/editing a check still persists through
      `saveIntegrityChecks` into the bound profile.
- [ ] `integrityProfiles.ts` deleted; `persistChecks` moved into
      `integrityPanel.ts`; no dangling imports.
- [ ] Protocol unions no longer contain the four integrity-profile CRUD
      messages nor the `integrityProfiles` provider message; init carries
      `activeChecks` directly.
- [ ] Host no longer exports/uses `registryAsIntegrityProfiles` /
      `syncRegistryToIntegrityProfiles` / save-load-broadcast integrity-profile
      helper dead code (grep clean; fallow clean).
- [ ] Specs updated (`integrity-checks.md`, `hexscope-storage.md`).
- [ ] Tests updated/removed to match; `npm run check-types`, `npm run lint`,
      `npm test`, and the fallow gate all pass.

## Notes

- Source: user request on branch `feat/firmware-profile-improve` (post-#212
  cleanup). Prior "pins hex" idea explicitly retracted — address values stay
  decimal; out of scope.
- Design/implement in `design.md` / `implement.md`.