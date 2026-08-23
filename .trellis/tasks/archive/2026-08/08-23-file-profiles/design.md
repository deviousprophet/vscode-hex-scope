# Design — File Profiles for Team-Shared Configuration

## Current persistence
All config lives in hidden per-user storage (hexEditorSession.ts):
- `globalState`: struct library (`hexScope.structs.global.v2`), integrity profile library (`hexScope.integrityProfiles.global.v1`).
- `workspaceState` per document URI: labels, segmentNames, structPins, integrityChecks, endian; legacy structs are migrated away then deleted.

Target: `globalState` → personal fallback only; team content moves to `.hexscope/config.json` (in git).

## Storage layout
Single shared file `.hexscope/config.json`, atomically read/replaced:

```ts
interface WorkspaceConfig {
  schemaVersion: 1;
  structs: StructDef[];
  integrityProfiles: IntegrityProfile[];
  profiles: FileProfile[];
  files: Record<string, FileScopeConfig>;   // key: workspace-relative firmware path
}
interface FileProfile {                     // reference model (DECIDED)
  id: string;
  name: string;
  pins: StructPin[];                        // instances (item 4)
  endian: 'le' | 'be';                      // item 7
  integrityProfileId: string | null;        // → item 6 library
}
interface FileScopeConfig {                 // per-file within workspace (item 1,2,7)
  labels: SegmentLabel[];
  segmentNames: Record<string, string>;
  endian: 'le' | 'be';
}
```

Machine-local (stay in `workspaceState`, never shared):
- active profile per doc: `hexScope.activeProfile.<uri>` (item 8)
- ad-hoc scratch integrity checks not yet in a profile (item 5)

## Load / resolution order
At session `postInit` (hexEditorSession.ts:516) resolve in this priority:
1. Read `.hexscope/config.json` (missing → run auto-migration, then read).
2. **Workspace wins, private fills gaps** (DECIDED): merged structs = workspace.structs then global entries whose id is absent; same for integrityProfiles (match by id).
3. Per-doc `files[relPath]` supplies labels + segmentNames + no-profile endian.
4. Active profile (machine-local) supplies pins, endian, referenced integrity profile checks. No active profile → fall back to legacy `workspaceState` pins/endian (backward compat).

## Auto-migration (DECIDED)
On first open in a workspace whose `.hexscope/config.json` is absent: create it seeded from current `globalState` (structs, integrity profiles) + this document's `workspaceState` (labels, segmentNames, endian) for its relPath. Copy, never move — globals stay as fallback. File watcher self-write horizon (hexEditorSession.ts:564) suppresses the migration's own change event.

## Write-through
Every mutation handler currently writing a global/per-file key is redirected to update the relevant section of `.hexscope/config.json` (read-modify-write, single atomic write). Handlers:
- `saveStructs` → config.structs
- create/update/rename/delete integrity profile → config.integrityProfiles
- `saveLabels`, `updateLabelVisibility`, `reorderLabel`, `saveEndian` (no-profile) → config.files[relPath]
- File Profile ops (create/delete/apply) → config.profiles; apply posts existing webview messages (pins, endian, integrityProfiles+checks)
- `saveStructPins`, `saveIntegrityChecks`, `saveEndian` while a profile is active → derived/no-op or machine-local scratch, never config.

## External-change reload
`vscode.workspace.createFileSystemWatcher` on `.hexscope/config.json`; debounce, skip self-writes. On external change: reload, re-merge, repost affected panels (labels, profiles, pins, checks, endian) via existing `init`-style messages.

## Compatibility & rollback
- Old per-URI `workspaceState` keys remain read as fallback forever → deleting `.hexscope/config.json` restores old behavior; globals were never moved. Rollback is safe.
- Legacy `hexScope.structs.<uri>` migration already drops the key; keep as-is (item 9).
- No VS Code settings introduced (none exist today).

## Trade-offs
- One `config.json` → single watcher + single atomic replace; coarse git diffs. Split-per-kind deferred until config grows (YAGNI).
- Auto-migration writes into the repo without confirmation (user chose this over manual publish).
- Files outside any workspace folder (single-file open) keep the pure legacy path (no `.hexscope`).
- Existing `activeChecks` UX: profile switch overwrites checks; scratch additions persist only machine-locally.

## Risks / deferred
- Two structs with same id but different defs across teammates → workspace wins silently; diffs are visible in PR review. Acceptable.
- Watcher + write-through race (sawtooth) → mitigated by self-write horizon + single-writer model.
- Integrity profile name vs id matching across libraries → match by id; UI dedupes by name case-insensitively (existing `sameProfileName`).