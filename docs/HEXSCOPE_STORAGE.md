# HexScope Storage — three-tier `.hexscope` storage

Workspace-rooted `.hexscope/` tree holding struct definitions workspace-wide,
a named profile registry, and a per-file binding table. The whole tree is
git-tracked — no `.gitignore` seeding, no local/private split. Pins, active
checks, and endian are shared team state by design. No trust gating applies
to `.hexscope/` data.

## Layout

```text
.hexscope/
├── structs.json          # workspace-wide StructDef[] pool (shared by all files)
├── profiles/
│   ├── profile_1/        # named annotation bundle
│   │   └── profile.json  # { id, name, pins, activeChecks, endian, segmentNames, labels }
│   └── ...
├── bindings.json         # [{ fileKey, profileId }] — file's only file-specific artifact
├── schemas/              # seeded copies of the JSON Schemas (editor + agent contract)
└── scripts/              # unchanged (script runner panes)
```

## Files (uniform version envelope `{ version, data, $schema? }`)

| File | `data` schema |
|---|---|
| `structs.json` | `StructDef[]` (workspace pool) |
| `profiles/<id>/profile.json` | `{ id, name, pins, activeChecks, endian, segmentNames, labels }` |
| `bindings.json` | `[{ fileKey, profileId }]`, `fileKey` = workspace-relative posix path |

Current `DATA_VERSION = 1`. On read, a future/unknown `version` is refused:
the file loads the empty default, warns once per file per session, and is
never overwritten (forward protection). Unversioned payloads (a bare array or
object) are accepted as the current version and upgraded on the next write.
Self-heal write-back happens only when the parse is OK **and** the normalized
output differs; empty/missing files load the empty default, not an error.

## Identity and binding

- One document (keyed by workspace-relative path, posix separators) maps to at
  most one profile via `bindings.json` (`fileKey` → `profileId`).
- Profiles are workspace-wide named bundles, not file-owned. Selecting a
  profile via the toolbar dropdown writes a binding entry (immediate apply);
  "No Profile" removes it. Unbound files show "No Profile" and edits create a
  new profile + binding on the first mutation (nothing is written on open).
- Rename/move of a bound file is auto-healed silently:
  `onDidRenameFiles` rewrites matching `fileKey` entries; `onDidDeleteFiles`
  removes matching entries immediately; every `bindings.json` write prunes
  entries whose `fileKey` no longer resolves on disk (CLI mv/rm VS Code never
  saw). A rename VS Code missed simply opens as "No Profile" — re-pick from
  the dropdown (one click).

## Write cadence

Each store slot debounces its writes (~400 ms, one timer per slot); parallel
slots debounce independently and never cancel each other. On panel close the
slots flush. Host writes are self-write-marked so the watcher ignores them.

## External changes (silent auto-apply)

The session watches the struct pool, the profile registry, and the bindings
table. Genuine external edits are re-read, re-normalized, and re-broadcast to
the open webview — no confirmation prompts anywhere:

- bound `profiles/<id>/profile.json` → `perFileDataChange`
  (labels/segmentNames/pins/endian/activeChecks)
- `structs.json` → `structsExternalChange` (webview replaces structs and prunes
  pins whose `structId` vanished)
- profile registry + bindings → profile dropdown refresh (`profilesState`)

If an external edit breaks a profile file (corrupt JSON or unknown version),
the slot loads the empty default and the original file is left untouched.

## Legacy migration (Memento → tree → three-tier)

One-time, per workspace root, on first panel open (before the first
`postInit`):

1. **Memento-era** keys (`globalState`/`workspaceState` structs, labels,
   segmentNames, structPins, integrityChecks, endian, global integrity
   profiles) are read, normalized, seeded into a new registry profile
   (`profiles_<n>`) bound to the open document, then hard-deleted.
2. **Pre-P1 tree era** (`firmware_profiles/<n>/{index,structs,integrity}.json`):
   every `structs.json` is merged into the workspace `structs.json` pool
   (deduped by struct id/name via `structMigration`); every `index.json`
   (+ `integrity.json` template) becomes one registry profile + one binding,
   preserving labels/pins/endian/activeChecks/segmentNames. The legacy tree is
   left in place so a reverted release still finds committed legacy data;
   a Memento marker makes the migration idempotent.

## JSON Schemas (editor + AI-agent contract)

Three JSON Schema files describe the on-disk shapes:

| Schema | File | `data` |
|---|---|---|
| `schemas/structs.schema.json` | `.hexscope/structs.json` | `StructDef[]` |
| `schemas/profile.schema.json` | `.hexscope/profiles/*/profile.json` | `ProfileRecord` |
| `schemas/bindings.schema.json` | `.hexscope/bindings.json` | `Binding[]` |

- **Locations.** The authoritative copy lives in the repo root `schemas/`
  (bundled into the extension). At first profile creation a workspace copy is
  seeded into `.hexscope/schemas/` (`writeIfMissing`, so a committed copy is
  kept; the watcher ignores this directory).
- **Editor binding.** `package.json` → `contributes.jsonValidation` maps
  `.hexscope/structs.json`, `.hexscope/profiles/*/profile.json`, and
  `.hexscope/bindings.json` to the bundled schemas. Single-file opens (no
  workspace) get no editor validation.
- **AI-agent discovery.** Every profile file carries a `$schema` sibling
  pointing at its `.hexscope/schemas/` copy (`"$schema": "../../schemas/<name>.schema.json"`
  for registry files, `"$schema": "schemas/<name>.schema.json"` for the root
  pool/bindings files), so terminal agents can resolve the contract from the
  file itself. The normalizers preserve the sibling through self-heal
  write-back and never touch a `$schema` key inside `data`. Seeded schema
  copies ship with the sibling path intact for installed-extension users.
- **Strictness.** The envelope root tolerates extra keys (`additionalProperties:
  true` — forward compat), `version` is `const 1`, and nested payload objects
  are strict: `additionalProperties: false` plus `required` on all scalar
  objects, with `enum` for `StructFieldType`, `IntegrityAlgorithm`, and
  `endian`. The runtime still normalizes tolerantly (unknown `version` is
  refused, extra/missing fields are normalized); schemas describe the
  contracted shape, they do not gate loading.

## Owner modules

- `src/hexScopeStorage.ts` — all `.hexscope/` I/O (read/write/envelope,
  `JsonStore` slots, registry lookup/creation, watcher). No Memento access;
  normalizers are injected per slot.
- `src/hexScopeMigration.ts` — the one-time legacy transfer (Memento era +
  `firmware_profiles` tree era → three-tier).
- `src/hexEditorSession.ts` — wires the three-tier stores to the open
  document, the binding lifecycle (`onDidRenameFiles`/`onDidDeleteFiles`/
  prune), and broadcasts external changes to the webview.
- `src/core/structMigration.ts` — struct-def migration/deduplication (shared by
  session and migration).
- `src/webviewProtocol.ts` — `endianOrDefault` single shared endian normalizer.
- `src/webview/webviewMessageModel.ts` — silent reducers for
  `structsExternalChange`, `perFileDataChange`, and `profilesState`.