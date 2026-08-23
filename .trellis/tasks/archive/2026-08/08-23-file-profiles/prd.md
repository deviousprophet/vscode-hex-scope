# File Profiles for Team-Shared Configuration

## Goal

Make configuration shareable across a development team by storing it in the workspace's `.hexscope/` folder (same convention as `.hexscope/scripts/`), and introduce *File Profiles* — named bundles of file-specific settings (struct pins, endianness, a referenced integrity profile) that a user selects per open firmware document.

Source: GitHub issue #178 ("Working in teams with 'File Profiles'" by gpxricky).

## Background

Today all config lives in VS Code hidden storage, so it never ships with the repo:
- `globalState`: struct library (`hexScope.structs.global.v2`), integrity profile library (`hexScope.integrityProfiles.global.v1`).
- `workspaceState` per document URI: labels, segment name overrides, struct pins, active integrity check set, endianness; legacy `hexScope.structs.<uri>` is migrated away and deleted.

`.hexscope/scripts/` is the established shared-workspace convention. Named memory regions already exist as segment labels + name overrides (issue #189 work), so issue 178's "optional segment names" reduces to re-homing that existing data.

## Terminology

- **global** — user-machine, VS Code `globalState` (hidden, per user).
- **per-file** — within the workspace: `.hexscope/` config keyed to a specific firmware document.
- **workspace** — team-shared `.hexscope/` folder, checked into git.

## Requirements

1. **Workspace config file.** Team-shared config lives in `.hexscope/config.json` (single file, schemaVersion 1), written through on every edit, watched for external changes, self-writes suppressed.
2. **Resolution order.** Workspace wins on id; user-global fills gaps. Applies to struct library and integrity profile library (matched by id).
3. **File Profiles (reference model).** A profile is a light mapping: pins + endianness + referenced integrity profile id. Switching a profile applies its pins, endianness, and the referenced profile's checks. Profiles live in `.hexscope/config.json`.
4. **Per-file workspace state.** Labels and segment name overrides are keyed per firmware document inside `.hexscope/config.json`. Endianness with no active profile also lives there. (Deviates from the issue's "names inside profile" — labels were decided per-file, not profile-bundled.)
5. **Machine-local state.** Active File Profile per document (`hexScope.activeProfile.<uri>` in `workspaceState`) and ad-hoc scratch checks are never shared.
6. **Auto-migration.** First open in a config-less workspace seeds `.hexscope/config.json` from current globals + this document's per-file state. Copy, never move; globals remain fallback.
7. **Backward compatibility.** No `.hexscope` (single-file open) → existing global/per-file behavior unchanged. Deleting `.hexscope/config.json` restores old behavior.
8. **Sidebar panel.** New "File Profiles" sidebar section: list, active indicator, select/apply, create/rename/delete.
9. **Protocol.** Additive webview messages only; existing message shapes preserved.

## Acceptance Criteria

- [x] Opening a firmware file in a config-less workspace writes `.hexscope/config.json` seeded from globals + current doc state, without prompting.
- [x] Struct types and integrity profiles defined in `.hexscope/config.json` are used in place of same-id global entries; global entries with unknown ids still appear (gap-filling).
- [x] Creating/editing a struct type or integrity profile, and label/segment-name edits, write through to `.hexscope/config.json` (git-diffable).
- [x] Applying a File Profile switches pins, endianness, and integrity checks; the choice persists per document across restarts on that machine only.
- [x] Editing `.hexscope/config.json` externally (e.g. git pull) reloads panels without clobbering unsaved document edits.
- [x] New File Profiles panel shows listed shared profiles, active state, and supports select, create, rename, delete with validation errors surfaced.
- [x] All legacy `workspaceState`/`globalState` reads still function when `.hexscope/config.json` is absent.
- [x] `npm run check-types`, `npm run lint`, `npm test` pass; new unit + component tests cover normalize/merge/migration/round-trip and panel states.

## Implementation Notes

- Host session-level behavior (write-through routing, watcher, apply) is exercised through the core model + protocol/message-model + panel suites (`workspaceConfigModel.test.ts`, `webviewMessageModel.test.ts`, `fileProfilesPanel.test.ts`) since no `HexEditorSession` unit harness exists; `npm test` suite passed 971 tests (up from 822 baseline).

## Out of Scope

- Per-item shared/private scope toggles in panels (rejected in brainstorm).
- Snapshot model or per-profile struct-type redefinition (rejected — reference model, one definition per id).
- Segment labels bundled inside File Profiles (decided per-file instead).
- Import/export commands (auto-migration + live files replace the need).
- Storing any personal machine state (active profile, scratch checks) in workspace config.

## Key Decisions

| Decision | Choice |
|---|---|
| Sync model | Live source of truth; write-through, watched |
| Profile contents | References, not snapshots |
| Collision rule | Workspace wins, private fills gaps |
| Picker UX | New sidebar section |
| Default save target | Edits write to their decided home automatically — shared by default once file-backed |
| First-open migration | Auto-migrate into `.hexscope/` |
| Segment labels / name overrides | Per-file within workspace |
| Struct pins | Inside File Profiles |
| Active checks | Derived from profile; scratch hidden per-file |
| Endianness | Inside File Profiles |
| Active profile per doc | Machine-local |

## Risks / Deferred

- Same-id divergent struct defs across teammates resolve silently to workspace — surfaced in PR diff review (accepted).
- Single `config.json` gives coarse git diffs; per-kind file split deferred until config grows.
- Auto-migration writes repo files unprompted (user-chosen trade-off; safe because globals are copied, not moved).