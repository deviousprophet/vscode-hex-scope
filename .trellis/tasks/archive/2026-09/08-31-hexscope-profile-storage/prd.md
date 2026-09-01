# Storage: per-file `.hexscope` firmware profiles

## Goal

Replace all Hex Scope VSCode Memento persistence (`globalState`/`workspaceState`) with per-firmware profile directories under `.hexscope/firmware_profiles/<id>/`, so every hex/srec document exposes its own committed, git-tracked structs/integrity/labels state that a team can share. This is a fresh implementation branched from `main` (previous `feat/hexscope-fs-storage` layout is superseded and discarded).

## Data map (replacement)

| Data | Current API/key | New home |
|---|---|---|
| `StructDef[]` | `globalState` `hexScope.structs.global.v2` (+ legacy v1, per-file keys) | `<profile>/structs.json` |
| `IntegrityProfile[]` | `globalState` `hexScope.integrityProfiles.global.v1` | `<profile>/integrity.json` |
| `SegmentLabel[]` | `workspaceState` `hexScope.labels.<uri>` | `<profile>/index.json` `.labels` |
| Segment name overrides | `workspaceState` `hexScope.segmentNames.<uri>` | `<profile>/index.json` `.segmentNames` |
| `StructPin[]` | `workspaceState` `hexScope.structPins.<uri>` | `<profile>/index.json` `.pins` |
| `IntegrityCheckSet` | `workspaceState` `hexScope.integrityChecks.<uri>.v1` | `<profile>/index.json` `.activeChecks` |
| Endian | `workspaceState` `hexScope.endian.<uri>.v1` | `<profile>/index.json` `.endian` |
| Scripts | filesystem (unchanged) | `.hexscope/scripts/*` |

## Scope/identity rules (locked decisions)

- **Strict per-file scope.** No workspace-wide default structs/integrity. `firmware_profiles/` is the only container. One hex/srec document (keyed by workspace-relative path) owns exactly one profile dir.
- A profile dir is created on first open of its document (lookup miss). `relPath` in `index.json` is the source of truth for lookup; the directory name is cosmetic.
- **Default dir naming is ordinal** (`profiles_1`, `profiles_2`, …); users may rename the folder freely — renaming never breaks lookup, because lookup matches `relPath`.
- Firmware rename/location change: **no rename machinery**. Profile is orphaned; user re-links by editing `relPath` in `index.json` (and/or renaming the folder). Documented, manual.
- **Entire `.hexscope/` is git-tracked.** No `.gitignore`-seeding mechanism, no local/private split. `pins`, `activeChecks`, `endian` are shared team state (locked).
- Root resolution matches scripts: workspace folder of the document, else `path.dirname(document.fsPath)` (single-file open fallback). Multi-root resolves per file.
- **No trust gating** for `.hexscope/` data.

## File shapes (uniform version envelope `{ version, data }`)

| File | `data` schema |
|---|---|
| `index.json` | `{ relPath, labels: SegmentLabel[], segmentNames: Record<string,string>, pins: StructPin[], activeChecks: IntegrityCheckSet, endian: 'le'\|'be' }` |
| `structs.json` | `StructDef[]` |
| `integrity.json` | `IntegrityProfile[]` |

- Current `DATA_VERSION = 1`. A future/unknown version on read is **refused** (treated like corrupt JSON: empty default, warn once per file per session, original file untouched/never overwritten).
- Self-heal write-back only when parse is OK **and** normalized output differs. Empty/missing files load the empty default, not an error.
- Normalization reuses existing helpers (`migrateStructDefinitions`, `normalizeStructDefsValue`, `normalizeIntegrityProfiles`, `normalizeIntegrityCheckSet`, …); no duplicated logic.

## Write cadence

Per-slot debounce (~400 ms, one timer per store slot) with flush-on-dispose. Parallel profile slots debounce independently; a slot never cancels another.

## External change (watcher)

- Watch the three files of the session's profile dir, plus (design decision, see design.md) a lightweight scan when a new profile dir appears.
- **Silent auto-apply**: genuine external edits re-read + re-normalize and re-broadcast to the webview. No confirmation prompts anywhere (mid-edit struct protection intentionally dropped — per-file scope keeps blast radius small).
- Self-writes are ignored (self-write timestamp horizon). Debounced reload callback drives the webview broadcast.

## Migration (one-time, first panel open per root)

1. Trigger: first panel open for a workspace root; runs before the session's first `postInit` reads.
2. Read old keys: global structs v2 + legacy v1 + per-file `hexScope.structs.<uri>`, global integrity profiles, and per-file labels/names/pins/checks/endian under this root.
3. Normalize with existing functions.
4. Seed the **currently-open document's** profile slots (writes are self-write-marked so the watcher ignores them). If the target profile/file already exists, skip its write (keep committed copy) but still execute the defensive key deletion.
5. **Hard-delete** every touched key including all legacy variants (`update(key, undefined)`). Defensive deletion always runs.
6. Idempotent: second open sees existing files → skips seeding, still cleans keys. In-memory once-guard per root.
7. No user prompt.

## JSON Schemas (locked decisions)

- Three JSON Schema files describe the on-disk shapes so editors and AI agents can validate/author `.hexscope/` data:
  - `index.schema.json` — `data: IndexFileData`.
  - `structs.schema.json` — `data: StructDef[]`.
  - `integrity.schema.json` — `data: IntegrityProfile[]`.
- **Strict**: `required` on all scalar objects, `enum` for `StructFieldType` / `IntegrityAlgorithm` / `endian`, envelope `version: const 1`. `additionalProperties: false` on nested objects; the payload **root** tolerates extra keys (forward compat, runtime leniency documented).
- **Editor binding**: `contributes.jsonValidation` globs map `.hexscope/firmware_profiles/*/{index,structs,integrity}.json` to the bundled schemas. Workspace-relative only (single-file-open fallback gets no editor validation).
- **`$schema` discoverability**: every profile file carries a `$schema` sibling (relative path to a workspace-seeded copy), and schemas are **seeded once into `.hexscope/schemas/*.schema.json`** at first profile creation so installed-extension users and terminal AI agents can resolve the contract from the file itself. The extension's normalizers **preserve the `$schema` key** (never strip it in self-heal write-back).
- Schema copies the drift risk (workspace seed vs bundled extension schema) is deferred behind a schema-version bump; the ajv drift-guard test anchors the bundled copy to the TS types.
- Files stay `{ version, data, $schema }` — minimal tooling hint, no per-environment coupling.

## Acceptance criteria

- All rows in the data map round-trip and survive an extension reload, with zero Memento reads in the storage paths after migration (grep shows no `globalState`/`workspaceState` reads in `hexEditorSession` storage wiring).
- A document opened for the first time creates a new ordinal-named profile dir with a seeded `index.json.relPath`; reopening resolves to the same dir; renaming the dir keeps resolving (relPath match).
- All three file shapes write `{ version: 1, data }`; self-heal rewrites only on parse-ok + normalized-changed; corrupt JSON loads empty + warns once + file untouched; a `version != 1` file also loads empty + warns once + untouched.
- External edits to any of the three profile files auto-apply to the open webview; host-issued writes never re-trigger the watcher.
- Migration seeds the first-opened file's profile and hard-deletes every legacy Memento key (test proves zero keys remain); existing committed profile files are preserved; rerun is a no-op.
- `npm run compile` (check-types + lint + esbuild) and `npm run test` green; no lingering `globalState`/`workspaceState` references in session storage paths.
- Docs (`docs/HEXSCOPE_STORAGE.md`) and specs (`state-management.md`, `directory-structure.md`) describe the new layout and correct the stale `structMigration` ownership reference.
- JSON schemas validate all three shapes (ajv drift-guard test green); profile files persist `$schema` and schemas are seeded at `.hexscope/schemas/`; handout after `$schema` resolve without workspace-glob dependency; `npm run compile`/`npm run test` green after schema work.