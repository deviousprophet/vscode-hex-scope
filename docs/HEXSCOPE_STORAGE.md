# HexScope Storage — per-file `.hexscope` firmware profiles

Every hex/srec document owns exactly one profile directory under
`.hexscope/firmware_profiles/<id>/` inside the document's workspace root
(workspace folder of the document, else its directory for single-file opens;
multi-root resolves per file). The whole `.hexscope/` tree is git-tracked —
there is no `.gitignore` seeding and no local/private split. Pins, active
checks, and endian are shared team state by design. No trust gating applies to
`.hexscope/` data.

## Layout

```text
.hexscope/
├── firmware_profiles/
│   ├── profiles_1/          # one dir per firmware document
│   │   ├── index.json       # relPath + labels/names/pins/checks/endian
│   │   ├── structs.json     # StructDef[]
│   │   └── integrity.json   # IntegrityProfile[]
│   └── ...
├── schemas/                 # seeded copies of the JSON Schemas (editor + agent contract)
└── scripts/                 # unchanged (script runner panes)
```

## Files (uniform version envelope `{ version, data, $schema? }`)

| File | `data` schema |
|---|---|
| `index.json` | `{ relPath, labels: SegmentLabel[], segmentNames: Record<string,string>, pins: StructPin[], activeChecks: IntegrityCheckSet, endian: 'le'\|'be' }` |
| `structs.json` | `StructDef[]` |
| `integrity.json` | `IntegrityProfile[]` |

Current `DATA_VERSION = 1`. On read, a future/unknown `version` is refused:
the file loads the empty default, warns once per file per session, and is
never overwritten (forward protection). Unversioned payloads (a bare array or
object) are accepted as the current version and upgraded on the next write.
Self-heal write-back happens only when the parse is OK **and** the normalized
output differs; empty/missing files load the empty default, not an error.

## Lookup and identity

- One document (keyed by workspace-relative path, posix separators) owns
  exactly one profile dir. `relPath` in `index.json` is the source of truth;
  the directory name is cosmetic.
- First open of a document creates a new ordinal-named dir (`profiles_1`,
  `profiles_2`, … — lowest unused integer) with a seeded `index.json.relPath`.
- Reopening resolves the same dir via the `relPath` scan. Renaming the folder
  freely never breaks lookup.
- Firmware file rename/location change: no rename machinery. The profile is
  orphaned; re-link manually by editing `relPath` in `index.json` (and/or
  renaming the folder).

## Write cadence

Each store slot debounces its writes (~400 ms, one timer per slot); parallel
slots debounce independently and never cancel each other. On panel close the
slots flush. Host writes are self-write-marked so the watcher ignores them.

## External changes (silent auto-apply)

The session watches the three profile files plus the appearance of profile
dirs. Genuine external edits are re-read, re-normalized, and re-broadcast to
the open webview — no confirmation prompts anywhere:

- `index.json` → `perFileDataChange` (labels/segmentNames/pins/endian/activeChecks)
- `structs.json` → `structsExternalChange` (webview replaces structs and prunes
  pins whose `structId` vanished)
- `integrity.json` → the existing `integrityProfiles` broadcast

If an external edit breaks a profile file (corrupt JSON or unknown version),
the slot loads the empty default and the original file is left untouched.

## Legacy Memento migration

One-time, per workspace root, on first panel open (before the first
`postInit`): the old `globalState`/`workspaceState` keys (global structs
v2 + legacy v1 + per-file structs, global integrity profiles, and per-file
labels/segmentNames/structPins/integrityChecks/endian under the root) are
read, normalized with the shared helpers, seeded into the open document's
profile slots with `writeIfMissing` (existing committed files are kept), then
every touched key — including legacy variants — is hard-deleted
(`update(key, undefined)`). Defensive deletion always runs; reruns are no-ops.

## JSON Schemas (editor + AI-agent contract)

Three JSON Schema files describe the on-disk shapes:

| Schema | File | `data` |
|---|---|---|
| `schemas/index.schema.json` | `firmware_profiles/*/index.json` | `IndexFileData` |
| `schemas/structs.schema.json` | `firmware_profiles/*/structs.json` | `StructDef[]` |
| `schemas/integrity.schema.json` | `firmware_profiles/*/integrity.json` | `IntegrityProfile[]` |

- **Locations.** The authoritative copy lives in the repo root `schemas/`
  (bundled into the extension). At first profile creation a workspace copy is
  seeded into `.hexscope/schemas/` (`writeIfMissing`, so a committed copy is
  kept; the watcher ignores this directory).
- **Editor binding.** `package.json` → `contributes.jsonValidation` maps the
  workspace-relative globs `.hexscope/firmware_profiles/*/{index,structs,integrity}.json`
  to the bundled schemas. Single-file opens (no workspace) get no editor
  validation.
- **AI-agent discovery.** Every profile file carries a `$schema` sibling
  pointing at its `.hexscope/schemas/` copy (`"$schema": "../../schemas/<name>.schema.json"`),
  so terminal agents can resolve the contract from the file itself. The
  normalizers preserve the sibling through self-heal write-back and never
  touch a `$schema` key inside `data`. Seeded schema copies ship with the
  sibling path intact for installed-extension users.
- **Strictness.** The envelope root tolerates extra keys (`additionalProperties:
  true` — forward compat), `version` is `const 1`, and nested payload objects
  are strict: `additionalProperties: false` plus `required` on all scalar
  objects, with `enum` for `StructFieldType`, `IntegrityAlgorithm`, and
  `endian`. The runtime still normalizes tolerantly (unknown `version` is
  refused, extra/missing fields are normalized); schemas describe the
  contracted shape, they do not gate loading.

## Owner modules

- `src/hexScopeStorage.ts` — all `.hexscope/` I/O (read/write/envelope,
  `JsonStore` slots, profile lookup/creation, watcher). No Memento access;
  normalizers are injected per slot.
- `src/hexScopeMigration.ts` — the one-time legacy Memento transfer.
- `src/hexEditorSession.ts` — wires the three slots to the open document and
  broadcasts external changes to the webview.
- `src/core/structMigration.ts` — struct-def migration/deduplication (shared by
  session and migration).
- `src/webviewProtocol.ts` — `endianOrDefault` single shared endian normalizer.
- `src/webview/webviewMessageModel.ts` — silent reducers for
  `structsExternalChange` and `perFileDataChange`.