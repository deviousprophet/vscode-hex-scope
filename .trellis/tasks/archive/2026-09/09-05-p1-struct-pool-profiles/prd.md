# P1: Workspace struct pool + profile registry + bindings (#3, #4, #5)

## Goal

Restructure firmware-profile storage into three tiers so struct definitions are
workspace-wide and a profile is a reusable, named annotation bundle that any
number of files can point at via an explicit user-selected binding. This solves
#3 (share structs across variants), #4 (reuse a profile on an out-of-workspace
file), and #5 (apply an existing profile to another file) by construction, and
turns #2's rename into an auto-healed binding.

Child of `09-05-firmware-profile-rework`. Depends on P0 (deferred creation) —
P0's lazy materialization mechanics are folded into this storage shape.

## Requirements

- R1 **Three-tier storage**:
  - Workspace `.hexscope/structs.json` — single flat `StructDef[]` pool.
  - Profile registry `.hexscope/profiles/<id>.json` — each `{ id, name, pins,
    activeChecks, endian, segmentNames, labels }`, no path, not file-owned.
  - Binding table `.hexscope/bindings.json` — `[{ fileKey, profileId }]`;
    `fileKey` is workspace-relative posix path; the only file-specific artifact.
- R2 The standalone `IntegrityProfile[]` template registry (`integrity.json`)
  is removed; checks live only as `activeChecks` inside each profile.
- R3 **Profile selection UI**: toolbar dropdown, always rendered, shows bound
  profile name or "No Profile"; flat list of names; pinned "+ New Profile..."
  footer entry with inline input; selecting applies immediately (writes binding,
  refreshes overlays); single code path implementing `hexScope.selectProfile`.
  Command Palette + status bar are thin aliases that trigger the same control.
- R4 **CRUD commands**:
  - `hexScope.newProfile` — create registry entry, bind nothing (works with no
    file open).
  - `hexScope.duplicateProfile` — quick-pick source, prompt name, deep-copy
    pins/checks/endian/segmentNames/labels into a new registry entry (struct refs
    carry over; pool not duplicated); touches no bindings.
  - `hexScope.renameProfile` — quick-pick + new name; registry only.
  - `hexScope.deleteProfile` — quick-pick; confirm naming bound-file count if
    1+ bound; on confirm remove registry entry and clear/null its binding
    entries (files revert to "No Profile"); struct pool untouched.
- R5 **Binding lifecycle**:
  - `onDidRenameFiles` → rewrite matching `fileKey` to new relPath (silent).
  - `onDidDeleteFiles` → remove matching entry immediately.
  - Opportunistic prune on every `bindings.json` write: drop entries whose
    `fileKey` no longer resolves to a file on disk.
  - Rename VS Code didn't see → file opens as "No Profile"; user re-picks from
    dropdown (one click).
- R6 **Shared-profile edit hint**: when the bound profile is used by >1 file,
  surface an inline hint in pin/label/check/endian editors ("Editing shared
  profile 'X' (used by N files)").
- R7 **Struct editing** writes to workspace `structs.json` pool directly, not
  owned by the open file.
- R8 **Migration** (mandatory, backward compat): on first load after upgrade,
  merge every existing `firmware_profiles/<n>/structs.json` into the workspace
  `structs.json` pool (dedupe identical struct sets; reuse
  `src/core/structMigration.ts` dedup), and convert each `index.json` +
  `integrity.json` pair into one registry profile + a binding for its original
  file. Existing `hexScopeMigration.ts` Memento pattern used as template.
- R9 **Schemas + docs** update: new `structs.schema.json`,
  `profile.schema.json`, `bindings.schema.json`; retire `integrity.schema.json`
  and `index.schema.json`; update `contributes.jsonValidation` globs and
  `docs/HEXSCOPE_STORAGE.md`.
- R10 Select Profile works on files outside any open workspace.

## Constraints

- Backward compatible with committed `.hexscope/firmware_profiles/*` trees —
  migration is mandatory, not optional (git-tracked team-shared format).
- Preserve silent auto-apply for genuine external edits (no new prompts except
  the opt-in dropdown).
- `hexScope.renameProfile`/`deleteProfile`/`duplicateProfile` stay Command
  Palette; dropdown's only job is switching (+ New Profile inline).
- No fingerprinting required (optional P3, out of scope).

## Acceptance Criteria

- [ ] Two+ files can bind to the same profile via Select Profile; pins/checks/
      endian/labels/segmentNames stored exactly once; struct types shared from
      one workspace pool.
- [ ] Rename/move inside VS Code auto-heals the binding (`onDidRenameFiles`);
      VS Code-missed rename falls back to a one-click dropdown reselect with no
      data recreated.
- [ ] Deleting a bound file removes its binding (`onDidDeleteFiles`); stale
      entries pruned next `bindings.json` write.
- [ ] Select Profile works out-of-workspace.
- [ ] Full profile CRUD (create blank/duplicate, rename, delete with bound-file
      confirmation), independent of any open file.
- [ ] Shared-profile editor hint shown when >1 file bound.
- [ ] Migration converts existing `firmware_profiles/*` trees without data loss
      (deduped structs merge; profiles+bindings created).
- [ ] Schemas `structs/profile/bindings` + `contributes.jsonValidation` +
      `docs/HEXSCOPE_STORAGE.md` updated; `integrity`/`index` schemas retired.
- [ ] Tests under `src/test/` cover each AC.

## Notes

- Source: issue #212; full design decision in parent task `firmware_profile.md`
  (Design decision + P1 sections).
- Design/implement in `design.md`/`implement.md`.