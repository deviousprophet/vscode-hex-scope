# Move the profile dropdown to its own second toolbar row

## Goal

The firmware profile picker currently sits inline at the right end of the
single toolbar flex row (next to the search box). Move it onto a dedicated
second toolbar line below. The first row keeps the main-branch toolbar layout
exactly (view tabs, separators, ASCII/edit/save group, search bar); the new
second row hosts the profile picker and the shared-profile hint.

## Requirements

- R1: Row 1 stays byte-for-byte the main-branch toolbar (`#toolbar` markup from
  the Toolbar component is untouched; no new children inside it).
- R2: A second full-width row (`#profile-bar`) renders directly below
  `#toolbar`, styled like the toolbar (same background/border, ~31-32px tall),
  containing the existing `#profile-picker` (+ `.profile-shared-hint`).
- R3: The picker keeps its current behavior and id (`#profile-select`) — only
  placement/styling changes; `renderProfileDropdown()` and its message flow are
  unchanged.
- R4: `#toolbar` keeps `overflow-x: auto` for narrow widths; the new row wraps
  or scrolls rather than clipping the picker.
- R5: The drop list / select colors from the previous fix (color-scheme theming,
  search-select-aligned `.profile-select` tokens) are preserved.
- R6: The profile bar is memory-view-only: hidden in Records view (same toggle
  as the search bar via `updateMemoryOnlyControls`).
- R7: A profile **menu** (⋮) in the profile bar lets the user **Save** (flush
  pending edits to the bound profile now), **Save as…** (duplicate the bound
  profile under a new name and bind the current file to the copy), **Rename**
  (inline-host input box, no manual profile.json editing), and **Delete**
  (confirm, bound-file count respecting). Actions meaningful only when a profile
  is bound are disabled otherwise; Command Palette versions keep their behavior.
- R8: Out-of-workspace files honor an explicit **Save** (materializes the
  profile + binding and persists staged in-memory edits) — the only case that
  seeds `.hexscope/` without a prior "New/Select Profile" action.
- R9: The always-visible "Editing shared profile … (used by N files)" hint is
  removed. Shared-profile state surfaces as a tooltip on the profile select
  (`title`) plus a **transient toast** only when the user switches to a shared
  profile (not on open, not repeated).
- R10: **Single-file profile registry.** Replace the `.hexscope/profiles/<id>/
  profile.json` per-directory layout with one `.hexscope/profiles.json` holding
  the whole `ProfileRecord[]` array (one JSON file for all profiles), cleaning
  up the `.hexscope` dir. `bindings.json` + `structs.json` unchanged; `fileKey →
  profileId` binding semantics unchanged.

## Storage contract for R10

- File: `.hexscope/profiles.json` — envelope `{ version: DATA_VERSION, data:
  ProfileRecord[] }` with a `$schema` sibling; array order preserved; ids unique
  (normalize drops duplicates). No per-profile directories.
- Path helpers: `profilesJsonUri(root)`; `nextProfileOrdinal` scans the **array**
  for the lowest unused `profile_<n>`; `createProfileRegistryEntry` pushes an
  empty record into the array; `readProfileRecord(root, id)` scans the array;
  registry writes are read-modify-write on the single file.
- Schema: `schemas/profile.schema.json` → `schemas/profiles.schema.json` (data
  becomes an array with `uniqueItems` on `id`); `contributes.jsonValidation`
  glob updated; `seedSchemaCopies` writes the renamed schema.
- Migration: an existing `.hexscope/profiles/*/profile.json` tree (from the
  per-dir format) merges into `profiles.json` on first load (dedupe ids +
  case-insensitive names), one-time marker in Memento; per-dir tree left in
  place for rollback. No-op when old tree absent.
- No-write-on-open + deferral preserved: `profiles.json` is only written on a
  registry mutation (create/rename/dup/delete implicit from writes or explicit
  Save) or explicit profile action; binding a file to an existing profile writes
  only `bindings.json`. Out-of-workspace non-explicit mutations stay in-memory
  until explicit save.
- `ProfileRecord` shape unchanged; session per-file write handlers now update
  the bound record inside the array instead of the per-dir JsonStore slot.

## Constraints

- Do not alter the Toolbar component (`src/webview/components/toolbar/`) markup;
  only `hexViewer.ts` (row insertion point) and `toolbar.css` (new `.profile-bar`
  rule) may change, plus any layout tweak.
- `#app` is a flex column; the second row adds one fixed-height child above the
  main area, so grid/stats/resizer heights must not break (check `layout.css`).

## Acceptance Criteria

- [ ] `#toolbar` contains no profile-picker markup (profile UI rendered in
      `#profile-bar` below it).
- [ ] `.profile-bar` row renders between toolbar and stats/main area with
      toolbar-matching background/border; picker + shared hint visible.
- [ ] Select/New Profile behavior unchanged; dropdown theming preserved.
- [ ] Records view hides the profile bar; switching back to Memory restores it
      (search-bar parity).
- [ ] Profile menu offers Save / Save as… / Rename / Delete; Save flushes; Save as
      duplicates + rebinds; Rename renames via input box without touching
      `profile.json`; Delete confirms with bound-file count; all disabled when
      unbound.
- [ ] Out-of-workspace explicit Save materializes and persists staged edits.
- [ ] Persistent shared-profile hint gone; shared state = select `title` tooltip
      + one toast on switching to a shared profile (never on open, never repeat).
- [ ] `.hexscope/profiles.json` is the only profile-registry file; no
      `profiles/<id>/profile.json` dirs exist after saving; profiles schema is
      `profiles.schema.json` (array, unique id), jsonValidation glob updated.
- [ ] Existing per-dir registry migrates into `profiles.json` once (dedupe, no
      duplicate ids/names), old tree preserved for rollback.
- [ ] bindings.json + structs.json unchanged; binding/rename/prune/sharng tests
      still pass.
- [ ] Mobile/narrow width: second row does not clip the picker (wraps/scrolls).
- [ ] Existing toolbar/search/profile tests still pass; check-types, lint,
      `npm test`, fallow 0/0/0 green.

## Notes

- Lightweight (PRD-only). Source: user request on
  `feat/firmware-profile-improve` (post-#212 UI refinement).