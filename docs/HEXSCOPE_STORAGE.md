# HexScope Storage — three-tier `.hexscope` storage

Workspace-rooted `.hexscope/` tree holding type definitions workspace-wide,
a single-file profile registry, and a per-file binding table. The whole tree is
git-tracked — no `.gitignore` seeding, no local/private split. Pins, active
checks, endian, bit-field allocation, the show-hidden-fields view toggle, and
raw-binary base addresses are shared team state by design. No trust gating applies
to `.hexscope/` data.

## Layout

```text
.hexscope/
├── types.json            # workspace-wide TypeDef[] pool (shared by all files)
├── profiles.json         # whole profile registry: { schemaVersion, records: [{ id, name, typeInstances, activeChecks, endian, bitAllocation, showHiddenFields, segmentNames, labels, baseAddress? }] }
├── bindings.json         # { schemaVersion, bindings: [{ fileKey, profileId }] } — file's only file-specific artifact
├── schemas/              # generated copies of the JSON Schemas (editor + agent contract),
│                         # content-diff refreshed on every .hexscope data write; retired
│                         # *.schema.json copies are pruned
└── scripts/              # unchanged (script runner panes)
```

## Files (uniform version envelope `{ version, data: { schemaVersion, <payload> }, $schema? }`)

| File | `data` payload |
|---|---|
| `types.json` | `{ schemaVersion, defs: TypeDef[] }` (workspace pool) |
| `profiles.json` | `{ schemaVersion, records: ProfileRecord[] }` — every profile in one array (order preserved, ids unique) |
| `bindings.json` | `{ schemaVersion, bindings: [{ fileKey, profileId }] }`, `fileKey` = workspace-relative posix path |

Current `DATA_VERSION = 1` (storage envelope) and the current data shape is
`DATA_SCHEMA_VERSION = 2`. On read, a future/unknown envelope `version`
is refused: the file loads the empty default, warns once per file per session,
and is never overwritten (forward protection). Unversioned payloads (a bare
array or object) are accepted as the current storage version.

The `data` payload itself carries a **data-schema version** (`schemaVersion`).
A file written before this change (legacy bare-array `data`, or an object with
no `schemaVersion`) is read as version 1 and **migrated forward on open**: the
migration runner upgrades the payload to the current shape and the one
`changed`-driven self-heal write-back re-stamps `{ schemaVersion, <payload> }`.
A file already at the current version is never rewritten (byte-identical). A
file whose `schemaVersion` is **newer** than the running extension is **not
downgraded** — it loads the empty default, warns once, and is left untouched
until a matching build is installed (forward-only). Every read-modify-write
path (registry upsert/rename/delete, binding rewrite, legacy per-dir merge)
also declines to write a newer file, so a future-shaped file is never
overwritten. Self-heal write-back happens
only when the parse is OK **and** the normalized output differs; empty/missing
files load the empty default, not an error. Registry reads drop malformed
records and deduplicate by id + case-insensitive name (`normalizeProfilesRegistry`).

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
- Shared-profile state surfaces as a tooltip on the profile select
  ("NAME · shared by N files") plus a one-time toast when you switch to a
  shared profile.
- Raw `.bin` files store their memory-map base address on the bound profile
  (`baseAddress`, optional; absent for text-oriented profiles). Opening an
  unbound `.bin` creates a profile + binding so the chosen value has an owner;
  a stored value (explicit `0` included) is reused silently on every later
  open while it still fits the file. The **Base** stat /
  **Set Raw Binary Base Address** action patches `baseAddress` on the bound
  profile (profile + binding when unbound) and
  re-anchors the open grid without rewriting the file. Files sharing a profile
  share one base address (duplicate the profile for a different map).
  Compare/diff base prompts are comparison-only and never write `.hexscope`.
  The value applies when a document opens or through the explicit change
  action; switching profiles does not re-anchor a live buffer.

## Write cadence

Each store slot debounces its writes (~400 ms, one timer per slot); parallel
slots debounce independently and never cancel each other. `profiles.json`
writes are read-modify-write on the whole array; every `.hexscope` **data**
write content-diff refreshes `.hexscope/schemas/` (a copy is rewritten only
when missing or different from the bundled schema, so an extension update
re-syncs an existing workspace on its next write; the data files are never
touched by the refresh, and a refresh failure never fails the write). The same
refresh prunes retired `*.schema.json` copies the current build no longer ships
(e.g. the pre-rename `structs.schema.json`); only plain files directly inside
`.hexscope/schemas/` are considered, so non-schema files, subdirectories, and
other directories are never touched. On panel
close the slots flush. Host writes are
self-write-marked so the watcher ignores them. Out-of-workspace files stage
their edits in-memory until an explicit Save/profile action — a bare open or
non-explicit edit never seeds a `.hexscope/` sibling.

Every write stamps the current data-schema version through the shared
`withDataEnvelope` helper, so a payload is always `{ schemaVersion, <payload> }`.

## Data migration on open (forward-only)

Each payload records a data-schema version. On open the migration runner applies
the ordered `MIGRATIONS` steps from the recorded version (missing = 1) up to the
current `DATA_SCHEMA_VERSION`, then the store's normalizer runs on the migrated
payload. If anything changed, the existing self-heal writes the file back once —
there is no separate migration write path. A file already at the current version
is byte-identical and never rewritten; migration is idempotent (a second open is
a no-op). A file newer than the build is not touched at all (empty default +
warn-once) and survives until a matching build is installed.

### v2 — Type Overlay key rename

`DATA_SCHEMA_VERSION` 2 renames the persisted contract:

| Before (v1) | After (v2) |
|---|---|
| `.hexscope/structs.json` | `.hexscope/types.json` |
| `schemas/structs.schema.json` | `schemas/types.schema.json` |
| profile key `structPins` | `typeInstances` |
| instance → def ref `structId` | `typeId` |
| field / bit-child ref `refStructId` | `refTypeId` |
| pointer-source ref `sourceStructId` | `sourceTypeId` |

Two mechanisms:

1. **Payload key rename** — `MIGRATIONS[1]` rewrites the keys of a recorded v1
   payload. The runner is payload-agnostic, so the step **dispatches on shape**
   (`defs` → def/field/bit-child refs; `records` → `structPins` / `structId` /
   `sourceStructId`; `bindings` → identity). Keys are *renamed* (old deleted, new
   set), so the written output is canonical.
2. **File move** — a one-shot, Memento-marked (`hexScope.typesFile.v1`) transfer
   that runs on first open: if `.hexscope/types.json` is absent and
   `.hexscope/structs.json` exists, it is read, migrated forward, and written as
   `types.json`; the new file is then read back and the legacy file is
   **hard-deleted only when that verification yields a non-empty array `defs`
   payload**. A corrupt or newer-than-build `types.json` (or a non-array, empty,
   or absent `defs` payload) preserves the legacy file — it may be the only good
   copy. A pre-existing valid `types.json` also licenses deleting a lingering
   legacy file on the same one-shot pass. The rollback trade-off is explicit: a
   downgrade to a pre-rename build finds no pool. The non-empty requirement has
   its own accepted trade-off: a genuinely emptied pool keeps its legacy file —
   the safe side of the decision.

**Back-compat read window (retired).** The general readers accept only the new
keys. The v1 payload runner (`MIGRATIONS[1]`) still renames a recorded v1
payload, and the one-time legacy migrations alias their own inputs explicitly
(`src/core/overlay/overlayAliases.ts`) before normalizing — so a legacy
`firmware_profiles/<n>/structs.json`, per-dir `profiles/<id>/profile.json`, or
Memento-era instance array still loads losslessly. A current-version file
carrying only the old keys is no longer aliased. Writers emit only the new
names.

## External changes (silent auto-apply)

The session watches the type pool, the profile registry, and the bindings
table. Genuine external edits are re-read, re-normalized, and re-broadcast to
the open webview — no confirmation prompts anywhere:

- bound `profiles.json` record → `perFileDataChange`
  (labels/segmentNames/pins/endian/bitAllocation/showHiddenFields/activeChecks)
- `types.json` → `typesExternalChange` (webview replaces types and prunes
  instances whose `typeId` vanished)
- profile registry + bindings → profile dropdown refresh (`profilesState`)

If an external edit breaks a profile file (corrupt JSON, unknown envelope
version, or a data-schema version newer than the build), the slot loads the
empty default and the original file is left untouched.

## Profile actions

The profile bar's ⋮ menu offers **Save** (flush pending edits to the bound
profile now — the one way an out-of-workspace file materializes without a
prior profile action), **Save as…** (duplicate the bound profile under a new
name and bind the current file to the copy), **Rename** (inline host input),
and **Delete** (confirms with the bound-file count). Actions other than the
button itself are disabled when no profile is bound.

## Legacy migration (Memento → tree → three-tier)

One-time, per workspace root, on first panel open (before the first
`postInit`):

1. **Per-dir registry era** (`profiles/<id>/profile.json`): every profile is
   merged into the single `profiles.json` array (dedupe ids + case-insensitive
   names), one-time Memento marker, dir tree left in place for rollback.
2. **Pre-rename pool file** (`.hexscope/structs.json`): read, migrated forward to
   the current data shape, and re-seeded as `.hexscope/types.json`; the legacy
   file is then hard-deleted once `types.json` reads back with a **non-empty**
   array `defs` payload (one-time Memento marker `hexScope.typesFile.v1`). A
   missing/corrupt/newer `types.json`, or an empty/absent/non-array `defs`,
   preserves the legacy file; a failed delete is logged and non-fatal and is
   retried on the next open, while verification outcomes stay one-shot. A
   genuinely emptied pool therefore keeps its legacy file — the safe side of the
   decision.
3. **Memento-era** legacy key families (`globalState`/`workspaceState`
   `hexScope.structs.*`, labels, segmentNames, structPins, integrityChecks,
   endian, global integrity profiles) are read, normalized, seeded into a new
   registry profile (`profiles_<n>`) bound to the open document, then
   hard-deleted.
4. **Pre-P1 tree era** (`firmware_profiles/<n>/{index,structs,integrity}.json`):
   every `structs.json` is merged into the workspace type pool
   (deduped by type id/name via `src/core/overlay/overlayMigration.ts`); every `index.json`
   (+ `integrity.json` template) becomes one registry profile + one binding,
   preserving labels/typeInstances/endian/activeChecks/segmentNames. The legacy trees are
   left in place so a reverted release still finds committed legacy data;
   Memento markers + per-dir `.converted` markers make the migration idempotent.

## JSON Schemas (editor + AI-agent contract)

Three JSON Schema files describe the on-disk shapes:

| Schema | File | `data` |
|---|---|---|
| `schemas/types.schema.json` | `.hexscope/types.json` | `{ schemaVersion, defs: TypeDef[] }` |
| `schemas/profiles.schema.json` | `.hexscope/profiles.json` | `{ schemaVersion, records: ProfileRecord[] }` (array, `uniqueItems`; ids unique at runtime) |
| `schemas/bindings.schema.json` | `.hexscope/bindings.json` | `{ schemaVersion, bindings: Binding[] }` |

- **Locations.** The authoritative copy lives in the repo root `schemas/`
  (bundled into the extension). On every `.hexscope` data write the workspace
  copies in `.hexscope/schemas/` are content-diff refreshed to the bundled
  schemas (rewritten only when missing or different; a bare open writes
  nothing; the watcher ignores this directory). Retired `*.schema.json` copies
  (e.g. `structs.schema.json`) are pruned by the same refresh; non-schema files
  and subdirectories survive. Writing a schema copy never re-triggers the
  refresh — only top-level data files do.
- **Editor binding.** `package.json` → `contributes.jsonValidation` maps
  `.hexscope/types.json`, `.hexscope/profiles.json`, and
  `.hexscope/bindings.json` to the bundled schemas. Single-file opens (no
  workspace) get no editor validation.
- **AI-agent discovery.** Every storage file carries a `$schema` sibling
  pointing at its `.hexscope/schemas/` copy (`"$schema": "schemas/<name>.schema.json"`),
  so terminal agents can resolve the contract from the file itself. The
  normalizers preserve the sibling through self-heal write-back and never
  touch a `$schema` key inside `data`. Seeded schema copies ship with the
  sibling path intact for installed-extension users.
- **Strictness.** The envelope root tolerates extra keys (`additionalProperties:
  true` — forward compat), `version` is `const 1`, and nested payload objects
  are strict: `additionalProperties: false` plus `required` on all scalar
  objects, with `enum` for `TypeFieldType`, `IntegrityAlgorithm`, and
  `endian`. `data` requires `schemaVersion` (integer ≥ 1) plus the file's payload
  key; the version is not a `const` so an older file still validates for
  authoring while the runtime migrates it forward. The runtime still normalizes
  tolerantly (unknown `version` is refused, a newer `schemaVersion` maps to the
  corrupt path, extra/missing fields are normalized); schemas describe the
  contracted shape, they do not gate loading.

## Owner modules

- `src/hexScopeStorage.ts` — all `.hexscope/` I/O (read/write/envelope,
  `JsonStore` slots, registry-array lookup/upsert/delete, profile creation +
  binding helpers, watcher, the `DATA_SCHEMA_VERSION` constant + `MIGRATIONS`
  table + migration runner and `withDataEnvelope` stamping). No Memento access;
  normalizers are injected per slot.
- `src/binBaseAddress.ts` — reads/persists a raw image's profile base address,
  opens silently from a stored value, prompts with inline validation on first
  open (and for the explicit change action), and resolves a compare-only value
  without writing `.hexscope`.
- `src/hexScopeMigration.ts` — the one-time legacy transfers (pre-rename pool
  file move + per-dir registry merge + Memento era + `firmware_profiles` tree era
  → three-tier).
- `src/hexEditorSession.ts` — wires the three-tier stores to the open
  document, `withBoundProfile` per-file mutations, the binding lifecycle
  (`onDidRenameFiles`/`onDidDeleteFiles`/prune), the profile-action handlers
  (save/duplicate/rename/delete), and broadcasts external changes to the
  webview.
- `src/core/overlay/overlayMigration.ts` — type-def migration/deduplication (shared by
  session and migration).
- `src/core/overlay/overlayAliases.ts` — migration-only pre-rename key aliases
  (applied explicitly to the one-time legacy inputs; the general readers are
  alias-free).
- `src/webviewProtocol.ts` — `endianOrDefault` single shared endian normalizer.
- `src/webview/webviewMessageModel.ts` — silent reducers for
  `typesExternalChange`, `perFileDataChange`, and `profilesState`.