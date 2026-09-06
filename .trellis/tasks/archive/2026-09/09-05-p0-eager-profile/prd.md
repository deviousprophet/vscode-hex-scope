# P0: Stop eager profile creation (#1, #6)

## Goal

Merging a HEX/SREC file must never write to disk. A firmware profile (and any
binding) is created/written only when the user first mutates per-file state
(labels, pins, struct instances, integrity checks, endian) or explicitly invokes
a profile action. Out-of-workspace files get no `.hexscope/` seed at all unless
the user explicitly saves.

Child of task `09-05-firmware-profile-rework` (parent owns source issue #212 and
cross-child acceptance). P1 restructures identity into a profile registry +
bindings; P0 is the narrowly-scoped first fix and must not depend on P1's
storage shape.

## Requirements

- R1: Opening a file (in or out of workspace) and closing it with no edits and no
  explicit profile action leaves zero new files/directories on disk.
- R2: A profile/binding is created only on first actual write of per-file state
  or on an explicit "New Profile"/"Select Profile" action — never on a bare open.
- R3: Read paths (`postInit`, `loadCurrentIndex`, `loadIntegrityProfiles`, and
  the `onExternalChange` handlers that call `loadCurrentIndex`) use in-memory
  empty defaults when no profile/binding exists; they never call `createProfile`.
- R4: For files with no workspace folder, no `.hexscope/` is seeded even on write;
  per-file state stays in-memory for the session unless the user explicitly saves.
- R5: Existing genuine-external-edit silent auto-apply behavior is preserved
  (no new confirmation prompts for legitimate external file changes).

## Constraints

- Keep backward compatible with committed `.hexscope/firmware_profiles/*` trees.
- No fingerprinting/content-hash matching (optional P3, out of scope).
- P0 must not redesign storage identity (P1's job) — defer only the creation
  trigger, not the layout.

## Acceptance Criteria

- [ ] Opening any HEX/SREC file (in or out of workspace) then closing with no
      edits / no profile action creates zero new files or directories.
- [ ] First edit of any kind, or explicit "New Profile"/"Select Profile", is what
      creates a profile/binding on disk.
- [ ] No `createProfile()` call remains on any read-only path in `hexEditorSession.ts`.
- [ ] Out-of-workspace file opened and closed creates no sibling `.hexscope/`.
- [ ] New/updated tests under `src/test/` cover: open+close-without-edits leaves no
      profile/binding on disk; first edit does create it; out-of-workspace never seeds.
- [ ] Regression: existing test suite passes (`npm test`/extension test per repo).

## Notes

- Source issue: GitHub #212 (maintainer `deviousprophet`, labels bug+enhancement).
- Design/implement in `design.md` / `implement.md`.
