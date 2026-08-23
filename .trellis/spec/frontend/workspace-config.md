# Team-Shared Configuration (`.hexscope/config.json`) Code-Spec

## Scenario: Share struct types, integrity profiles, File Profiles, labels across a team

### 1. Scope / Trigger

Applies to `src/core/workspaceConfigModel.ts` (pure normalize/merge/seed), `src/workspaceConfigStore.ts` (host FS adapter), and the `HexEditorSession` orchestration (load, auto-migration, write-through, FS-watcher reload, File Profile message handlers) plus the webview protocol/model/panel wiring. Source of the taxonomy: issue #178.

### 2. Storage Taxonomy

| Item | Home |
|---|---|
| Struct type library | `.hexscope/config.json` → `structs`; user-global falls back per id/name gap |
| Integrity profile library | `.hexscope/config.json` → `integrityProfiles`; user-global falls back |
| File Profiles (pins+endian+integrity ref) | `.hexscope/config.json` → `profiles` |
| Labels + segment name overrides + no-profile endian | `.hexscope/config.json` → `files[<workspace-relative path>]` |
| Active File Profile per doc | `workspaceState` (`hexScope.activeProfile.<uri>`) — machine local |
| Ad-hoc scratch checks outside a profile | `workspaceState` — machine local |
| Legacy per-file keys | kept as fallback when no `.hexscope` exists; files outside a folder use pure legacy |

### 3. Contracts

- **Live source of truth.** The session reads `.hexscope/config.json` at open, writes it through on every mutation (single atomic JSON replace, 2-space), and watches it for external changes; self-writes are suppressed by the shared 1 s self-write horizon (same pattern as the document watcher in `editing-save-external-change.md`).
- **First-open auto-migration.** When the file is absent, the session seeds it from current `globalState` (structs + integrity profiles) and persists it; globals are copied, never moved, so deleting the file restores prior behavior (safe rollback).
- **Resolution order:** workspace wins on id, user-global fills gaps. Structs dedupe by exact id/name; integrity profiles dedupe name case-insensitively (mirroring profile CRUD). `merged = mergeStruct/IntegrityLibraries(config.<x>, globals)`.
- **File Profile (reference model).** A profile is `{ id, name, pins, endian, integrityProfileId }`. Applying it posts `fileProfileApplied` (`structPins` + `endian` + `activeChecks` derived from the referenced integrity profile; empty set when the ref is missing). Applying never perturbs document edits (no `init`/reparse).
- **Write-through routing** (session message handlers):
  - `saveStructs` / integrity-profile CRUD → workspace config when file-backed, else globalState.
  - `saveLabels` / `updateLabelVisibility` / `reorderLabel` / `saveEndian` (no active profile) → `files[relPath]` when file-backed, else legacy keys.
  - `saveStructPins` / `saveEndian` while an active profile exists → write into that profile.
  - `saveIntegrityChecks` while a profile is active → no-op (derived from the profile); otherwise legacy scratch key.
- **External config reload** (`workspaceConfigReloaded`): re-read + re-merge, drop a stale active profile, clear the active profile if the applied pins/endian/checks are affected, and re-apply resolved labels/structs/profiles/pins/endian/checks/form — without full render or document reload.

### 4. Validation & Error Matrix

| Condition | Behaviour |
|---|---|
| `.hexscope/config.json` missing | Auto-migrate from globals (first open) |
| Config file malformed JSON | Treated as absent → auto-migrate (normalize drops malformed entries element-wise) |
| Duplicate profile name (case-insensitive) | create/rename rejected; `fileProfiles` error broadcast |
| Stale active profile after external edit | Cleared to `None`; applied state falls back to per-file/legacy |
| Files in no folder | Pure legacy path (no `.hexscope`) |
| External change while document dirty | Untouched — config reload never touches `S.edits` |

### 5. Tests Required

- `src/test/core/workspaceConfigModel.test.ts`: normalize defaults/garbage, malformed-entry drop, `normalizeFileProfile` pin/endian defaults, merge priority + gap fill (structs exact, integrity case-insensitive), seed shape.
- `src/test/webview/webviewMessageModel.test.ts`: `init` carries `fileProfiles`/`activeFileProfileId`; `fileProfileApplied` applies pins/endian + reports applied state; `workspaceConfigReloaded` applies merged session state.
- `src/test/webview/components/sidebar/fileProfilesPanel/fileProfilesPanel.test.ts`: empty/list/active render, select + none, save-as validation + create, rename, delete confirm, error render.

### 6. Wrong vs Correct

#### Wrong

```typescript
// per-mutation full re-parse/reset of the session
reloadDocument(); // loses dirty edits on a config change
```

#### Correct

Persistence mutation → `workspaceConfig` update → `persistWorkspaceConfig()`; external change → `workspaceConfigReloaded` (scoped re-apply); no document reload.