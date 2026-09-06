# Fix review findings #1–#5 on the firmware-profile branch

## Goal

Remediate the five code-review findings identified on
`feat/firmware-profile-improve` (the issue #212 profile rework). Three are
high-impact (user-facing dropdown state, an un-met spec requirement on struct
deletion, and a silent data-loss migration guard); two are correctness/code
quality (vestigial flag, cross-root global).

## Requirements

- R1 (**#1, high**): A fresh `init` message must hydrate `S.profileState`, so the
  toolbar dropdown shows the bound profile + full profile list on every open and
  reopen — not just after a `profilesState` push.
- R2 (**#2, high**): Struct-type deletion must be safe across the shared
  workspace pool: scan `pins[]` in **every** registry profile; when 1+ pins
  anywhere reference the struct, confirm before deleting (naming pin count +
  number of affected profiles); on confirm, remove the struct from the pool and
  strip the orphaned pins from every affected profile (not just the open one).
- R3 (**#3, high**): The legacy `firmware_profiles/*` migration completion guard
  must not treat the mere existence of `bindings.json` as proof of completion,
  so a pre-existing binding from an unrelated file can never permanently
  disable conversion of a remaining legacy tree (silent data loss).
- R4 (**#4, low**): Remove the vestigial `explicitProfileWrite` flag (or wire it
  properly); the real explicit paths (`newProfile`/`selectProfile`) write
  directly and never depend on it.
- R5 (**#5, low/medium**): The workspace struct-pool fallback cache must be
  per-root, not a module-global, so one root's defs can't leak as another
  root's empty default.

## Constraints

- All fixes land on the existing branch; no storage-format version bump.
- Keep silent external-edit auto-apply and the deferred (no-write-on-open)
  contract intact.
- `npm run check-types`, `npm run lint`, `npm test` and the fallow gate
  (0/0/0) must pass after each fix group.

## Acceptance Criteria

- [ ] #1: `applyInitMessage` assigns `S.profileState = msg.profile`; new/updated
      webview model test covers the `init` path (dropdown hydration), not just
      `profilesState`.
- [ ] #2: deleting a struct type scans all registry profiles; a confirm dialog
      (pin count + affected-profile count) appears when any pin references it;
      on confirm the pool entry and all affected pins are removed across
      profiles; tests cover single-profile and multi-profile cases.
- [ ] #3: migration completion is tracked per legacy entry (e.g. marker per
      converted `firmware_profiles/<n>` dir, or requires each legacy dir to have
      a binding) — a pre-existing `bindings.json` never suppresses conversion of
      an unconverted legacy tree; test proves the previously-broken ordering.
- [ ] #4: `explicitProfileWrite` removed (or genuinely wired); no dead code;
      session-level out-of-workspace explicit-action behavior is covered by a
      test touching the real session wiring where feasible.
- [ ] #5: struct-pool fallback keyed per root (`Map<string, StructDef[]>` or
      equivalent); test shows two roots with independent fallbacks.
- [ ] Spec/docs updated for every behavior that changes (deletion cascade,
      migration guard, pool ownership).
- [ ] check-types, lint, `npm test`, fallow 0/0/0 all green.

## Notes

- Findings source: code review of branch `feat/firmware-profile-improve` vs the
  profile-UX spec (5 findings; 3 high, 2 low).
- Staging: `.trellis/tasks/archive/*` must be excluded from commits (task-tracking
  paths are untracked in this repo); `firmware_profile.md` is never committed.