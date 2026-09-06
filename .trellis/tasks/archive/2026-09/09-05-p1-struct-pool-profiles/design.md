# P1 Design: Three-tier storage (workspace structs / profile registry / bindings)

## Current state (after P0)

`src/hexScopeStorage.ts` stores per-file `firmware_profiles/<ordinal>/` dirs with
`index.json` (relPath-keyed, holds labels/pins/activeChecks/endian/segmentNames),
`structs.json`, `integrity.json` (IntegrityProfile template registry).
`src/hexEditorSession.ts` resolves per-file stores via `findProfile(root, relPath)`
and lazily `createProfile`s on first write (P0).

## Target layout

| Data | File |
|---|---|
| `StructDef[]` | `.hexscope/structs.json` (workspace pool) |
| profile `pins` | `.hexscope/profiles/<id>.json` → `pins` |
| profile `activeChecks` | same → `activeChecks` |
| profile `endian` | same → `endian` |
| profile `segmentNames` | same → `segmentNames` |
| profile `labels` | same → `labels` |
| binding table | `.hexscope/bindings.json` `[{ fileKey, profileId }]` |
| scripts | `.hexscope/scripts/` (unchanged) |
| schemas | `.hexscope/schemas/` (unchanged) |

`integrity.json` template registry removed — checks live only in profile
`activeChecks`. This eliminates the distinction between per-file check sets and
named check templates.

## Data model

- `ProfileRecord = { id, name, pins: StructPin[], activeChecks: IntegrityCheckSet,
  endian: 'le'|'be', segmentNames: Record<string,string>, labels: SegmentLabel[] }`
- `Binding = { fileKey: string /* workspace-relative posix */, profileId: string }`
- `StructDef` unchanged; referenced by profile pins by `id` from the shared pool.

## Modules

- **`src/hexScopeStorage.ts`** — new `StructStore` (pool), `ProfileStore`
  (registry), `BindingStore` (table) on the existing `JsonStore`/`writeJson`
  machinery. `findProfile`/`createProfile`/`firmware_profiles`/`index.json`/
  `integrity.json` access removed. Binding prune logic + `onDidRenameFiles`/
  `onDidDeleteFiles` handlers live here (or a small `bindingLifecycle` helper).
- **`src/hexEditorSession.ts`** — session reads the profile bound to its file,
  falls back to in-memory empty profile when unbound; write handlers write into
  the bound profile; resolves the pool + registry + binding once per root.
  Deferred semantics from P0 preserved: nothing written on open.
- **`src/hexScopeMigration.ts`** — two-phase: (a) merge all
  `firmware_profiles/<n>/structs.json` into workspace `structs.json` (dedupe via
  structMigration); (b) each `index.json`+`integrity.json` → one `ProfileRecord`
  + one binding `{ fileKey: relPath, profileId }`. Runs once on first load.
  Keep Memento one-time tariff pattern.
- **Webview**: toolbar gets an always-rendered profile dropdown. New message
  pair: provider pushes `{ type: 'profilesState', profiles: names[], current }`;
  webview sends `selectProfile(n)`, `newProfile(name)`. CRUD via Command Palette
  commands in `src/extension.ts` using registry API. Shared-profile hint:
  provider includes `boundFileCount` in the profiles state; editor panels show a
  hint line when > 1.

## Binding lifecycle

- `onDidRenameFiles`: iterate `bindings.json`, rewrite `fileKey` for renamed
  paths (workspace-relative old→new). Silent.
- `onDidDeleteFiles`: remove entries whose fileKey deleted.
- Every `bindings.json` write (add/update from selection): prune entries whose
  file no longer exists on disk (catch CLI mv/rm that VS Code never saw).
- Unwatched rename → no match on open → dropdown shows "No Profile"; re-pick
  rewrites binding under new path. No data recreated (profile + pool untouched).

## Selection UI

Toolbar dropdown:
- Display = bound profile name or "No Profile".
- List = flat profile names; footer divider + "+ New Profile...".
- Select any name → immediate apply (write binding, refresh overlays, update
  display). One code path for apply; Command Palette `hexScope.selectProfile`
  + any status-bar affordance focus the same control.

## Migration

Entry condition: `.hexscope/firmware_profiles/` exists and no
`.hexscope/bindings.json` yet. After migrate, leave old tree in place? Prefer
delete to avoid confusion — but git-tracked team format: converting in place is
destination; keep old dirs during first-run, remove after success (write marker
in Memento so a crash mid-migration retries, not duplicates).

## Tradeoffs / compatibility

- Workspace-scoped struct pool means the open file's structs now visible
  workspace-wide — intended (#3).
- `relPath` binding is the only file-keyed artifact; rename auto-heal + prune
  keep it fresh without fingerprints (P3 layered later).
- Backward compatible: migration reconstructs profiles+bindings byte-identical
  behavior (pins/checks/endian/labels) from legacy trees.
- Rollout: feature-flag nothing; migration is cheap, one-shot, and existing UI
  (dropdown) covers legacy users after migration.

## Rollback

- Keep `firmware_profiles/*` intact until migration confirmed → a reverted
  release still finds legacy trees. New `structs.json`/`profiles/`/`bindings.json`
  created by migration are additive (root-level, not nested under old tree), so
  removing the new files restores prior behavior.