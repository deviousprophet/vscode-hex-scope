# PRD — Storage Rework: All Persistence to `.hexscope/`

Source spec: user-approved design doc (full spec in request). All decisions below are decided; do not re-litigate without flagging the tradeoff to a human.

## Goal

Move every piece of Hex Scope persisted state out of VS Code `globalState`/`workspaceState` (Memento APIs) onto disk under `.hexscope/` in the workspace, so struct definitions, labels, and integrity profiles can be committed to git and shared across a team.

## Data map (replacement)

| Data | Current API/key | New home |
|---|---|---|
| `StructDef[]` | `globalState` `hexScope.structs.global.v2` (+ legacy `v1`, per-file legacy keys) | `.hexscope/structs.json` |
| `IntegrityProfile[]` | `globalState` `hexScope.integrityProfiles.global.v1` | `.hexscope/integrity.json` |
| `SegmentLabel[]` | `workspaceState` `hexScope.labels.<uri>` | `.hexscope/data/<rel-path>.json` |
| Segment names | `workspaceState` `hexScope.segmentNames.<uri>` | `.hexscope/data/<rel-path>.json` (same file) |
| `StructPin[]` | `workspaceState` `hexScope.structPins.<uri>` | `.hexscope/local/<rel-path>.json` |
| `IntegrityCheckSet` | `workspaceState` `hexScope.integrityChecks.<uri>.v1` | `.hexscope/local/<rel-path>.json` (same file) |
| Endian | `workspaceState` `hexScope.endian.<uri>.v1` | `.hexscope/local/<rel-path>.json` (same file) |
| Scripts | filesystem (unchanged) | `.hexscope/scripts/*` |

Out of scope (do not touch): webview `localStorage`, `editor.tokenColorCustomizations` in `package.json`.

## Structural rules

- **File identity** = hex/srec path relative to resolved workspace root (same root logic as scripts: `getWorkspaceFolder(document.uri)` → else `path.dirname(document.uri.fsPath)`), mirrored under `data/`/`local/`, with `.json` appended to full original filename (`firmware/boot.hex` → `firmware/boot.hex.json`).
- **One blob per type/file**, not per-item.
- **JSON only** on disk. `fieldsToText`/`parseStructText`/`structToC` stay UI export conveniences.
- **No global/cross-workspace scope.** Never read/write `globalState` after migration runs.
- `.hexscope/local/` gitignored: seed `.hexscope/.gitignore` containing `local/` once on first `.hexscope/` write. Don't re-add if user removed it.
- **No trust gating** for `.hexscope/` data.

## Schemas (reuse types `src/core/types.ts`, `src/core/integrity.ts`)

- `structs.json` = `StructDef[]`, normalize with existing `normalizeStructDefsValue` + `migrateStructDefinitions` + `mergeLegacyStructDefs` path; self-heal write-back if normalized differs.
- `integrity.json` = `IntegrityProfile[]`, normalize with `normalizeIntegrityProfiles`.
- `data/<rel>.json` = `{ labels: SegmentLabel[], segmentNames: Record<string,string> }`.
- `local/<rel>.json` = `{ pins: StructPin[], activeChecks: IntegrityCheckSet, endian: 'le'|'be' }`. `endian` default `'le'` if absent/invalid.
- Missing files = empty/default, not errors.

## Write cadence

Debounce per file slot (~300–500ms, reuse `reloadTimer` shape). Flush pending write on dispose. Parallel slots debounce independently.

## External-change handling

Watch `.hexscope/` paths (2 global + this session's per-file data/local). Self-write horizon ignored (`markSelfWrite`, reuse `SELF_WRITE_HORIZON_MS`). Genuine external change → debounce → re-read + re-normalize → push to webview. Conflict semantics per grilling: **prompt for shared git-tracked `structs.json`/`integrity.json`** (follow `externalChange`/`pendingExternalReload`/`reloadAccepted` shape with new message types); **auto-apply** `data/`+`local/` (session-local). External change to structs/integrity refreshes **all open panels**.

Decisions from grilling (locked):
- Q3 corrupt JSON: treat as empty, **skip self-heal write-back on parse failure**, warn once per file per session.
- Q6 migration: run at **first panel open** per workspace root (needs document.uri).

## Migration (one-time, first panel open)

1. Read old keys from `globalState` (structs v2 + legacy v1 + per-file) and `workspaceState` (per-file labels/names/pins/checks/endian for files under this workspace).
2. Normalize with existing functions.
3. Write to new `.hexscope/` files.
4. **Hard-delete** all old keys (`update(key, undefined)`), all legacy variants. Real deletion.
5. Guard: skip if new files already exist; still delete leftover old keys defensively.
6. No user prompt.

## Working-dir fallback

No workspace folder → `.hexscope/` next to the opened file. No confirmation prompt. Multi-root: `getWorkspaceFolder` resolves per file.

## Acceptance criteria

- All data listed above persists to the four file shapes under `.hexscope/`, round-trips, and survives extension reload with no Memento reads.
- Zero `globalState`/`workspaceState` references remain in the storage paths after migration runs; migration test proves keys deleted.
- `.hexscope/local/` ignored via seeded `.gitignore`; seeding happens exactly once.
- External edits to any `.hexscope/` file reload data (structs/integrity: prompt; data/local: auto-apply). Self-writes do not self-trigger.
- Debounced writes flush on panel dispose; parallel slots don't cancel each other.
- Corrupt JSON → empty + warning, original file untouched.
- Existing normalization/dedup helpers reused, not duplicated.
- `npm run compile` / `npm run lint` / tests green.