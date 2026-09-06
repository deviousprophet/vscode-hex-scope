# HexScope On-Disk Storage Code-Spec

## Scenario: persist all Hex Scope state as committed three-tier `.hexscope/` JSON files

### 1. Scope / Trigger

Applies to everything stored under `.hexscope/` in a workspace: `JsonStore` slot semantics, the version envelope, the workspace struct pool, the single-file profile registry, the file-binding table, binding lifecycle (rename/delete/prune), the external-change watcher, JSON Schema binding, and the legacy migrations (Memento v1/v2 + `firmware_profiles/*` tree + per-dir `profiles/<id>/` registry). Owner module: `src/hexScopeStorage.ts` (host adapter — top level, never imported by `src/core/`), with `src/hexScopeMigration.ts` for the one-time transfers and `src/hexEditorSession.ts` (+ `src/extension.ts` CRUD commands) for wiring. No VS Code Memento is read or written outside `hexScopeMigration.ts`.

This spec is the single source of truth for the on-disk contract. `docs/HEXSCOPE_STORAGE.md` is the user-facing summary; the three `schemas/*.schema.json` files are the machine-readable copy (ajv drift-guarded in `src/test/schemas/schemaValidation.test.ts`).

### 2. Signatures

```typescript
export const DATA_VERSION = 1;                       // hexScopeStorage.ts
export type ProfileJsonName = 'profiles.json';
type JsonRead = { status: 'ok'; value: unknown } | { status: 'missing' } | { status: 'corrupt' };
function withEnvelope(payload: unknown): unknown;                      // { version: DATA_VERSION, data: payload }
function unwrapEnvelope(raw: unknown): unknown | null;                 // null = unknown version
async function readJson(uri): Promise<JsonRead>;                       // corrupt covers read-err + parse-err + envelope
async function writeJson(uri, value): Promise<void>;                   // ensureParentDir, $schema sibling, pretty 2-space
async function writeIfMissing(uri, value): Promise<void>;              // keep committed copy

function resolveHexScopeRoot(uri): string;            // workspace folder else dirname(document)
function perFileRelativePath(root, uri): string;      // posix, e.g. "firmware/boot.hex"
function hexScopeRootDir(root): string;               // <root>/.hexscope
function hexScopeSchemasDir(root): string;            // <root>/.hexscope/schemas
function profilesJsonUri(root): Uri;                  // <root>/.hexscope/profiles.json  (single registry file)
function bindingsJsonUri(root): Uri;                  // <root>/.hexscope/bindings.json
function structPoolJsonUri(root): Uri;                // <root>/.hexscope/structs.json
async function nextProfileOrdinal(root): Promise<number>;             // lowest unused "profile_<n>" scanning the array

function normalizeProfilesRegistry(raw): NormalizedValue<ProfileRecord[]>;  // array-or-[], drop malformed, dedupe id + case-insensitive name, preserve order
async function collectProfileRecords(root): Promise<ProfileRecord[]>;       // normalized registry array ([] when missing/corrupt)
async function readProfileRecord(root, profileId): Promise<ProfileRecord | null>;  // scan the array
async function writeProfileRecord(root, rec): Promise<void>;                // upsert into the array (read-modify-write); first write seeds schemas
async function removeProfileRecord(root, profileId): Promise<void>;
async function renameProfileRecord(root, profileId, name): Promise<void>;
async function migrateLegacyProfileDirs(root): Promise<void>;               // merge .hexscope/profiles/<id>/profile.json dirs into the array (dedupe, order-preserving)
export async function seedSchemaCopies(root): Promise<void>;                // writeIfMissing the 3 bundled schemas

interface ProfileRecord { id; name; structPins: StructPin[]; activeChecks: IntegrityCheckSet;
                          endian: 'le'|'be'; segmentNames: SegmentNameOverrides; labels: SegmentLabel[]; }
interface Binding { fileKey: string /* workspace-relative posix */; profileId: string; }
function emptyProfileRecord(id, name): ProfileRecord;
function normalizeBindings(raw): NormalizedValue<Binding[]>;

class JsonStore<T> {
    constructor(options: { uri; normalizer(raw)->{value,changed}; empty()->T; debounceMs?; onSelfWrite?; onReload?;
                           lazyDir?: () => Promise<string | null> });  // generic deferred mode: reads return empty() in memory, first write resolves a dir (file = dir + basename); null = stay in-memory
    async load(force?): Promise<T>;    get(): T | null;    set(next: T): void;
    async flush(): Promise<void>;      scheduleReload(ms?): void;    async reload(): Promise<T>;
    dispose(flushPending?: boolean): void;
}

function attachProfileWatcher(options: { root; onProfileChanged }): vscode.Disposable;
function attachBindingFileLifecycle(root): vscode.Disposable;          // onDidRenameFiles rewrite + onDidDeleteFiles remove
async function pruneBindings(root, bindings): Promise<Binding[]>;      // drop entries whose fileKey no longer resolves on disk
async function migrateLegacyData(root, uri, context): Promise<void>;   // hexScopeMigration.ts
```

### 3. Contracts

Layout (whole tree git-tracked — no `.gitignore` seeding, no local/private split; pins/checks/endian shared by design). No per-profile directories:

```text
.hexscope/
├── structs.json              { version, data: StructDef[], $schema? }   # workspace pool, one flat list
├── profiles.json             { version, data: ProfileRecord[], $schema? } # whole registry, one array
├── bindings.json             { version, data: Binding[], $schema? }      # fileKey → profileId table
├── schemas/                  # seeded copies of the 3 bundled schemas (writeIfMissing); profiles.schema.json
└── scripts/                  # script runner, unchanged
```

- **Three tiers**: struct *types* live once in the workspace pool (`.hexscope/structs.json`); a *profile* is a named annotation bundle (`ProfileRecord`) storing structPins / activeChecks / endian / segmentNames / labels, not owned by any file; a *file* is bound to a profile by a `Binding` entry keyed on its workspace-relative posix `relPath`. The pool's in-memory fallback cache is **per root** (keyed by `root`, never a module global), so one root's defs can never leak as another root's empty default. All profiles live in the single `profiles.json` array (order preserved; ids unique — `normalizeProfilesRegistry` drops duplicates and malformed records). The old `firmware_profiles/*` per-file dirs (`index.json` + `structs.json` + `integrity.json`) and the per-dir registry (`profiles/<id>/profile.json`) no longer exist outside migration. The standalone `IntegrityProfile[]` template registry is removed — checks live only as `activeChecks` inside a `ProfileRecord` (the Integrity panel shows only the bound profile's `activeChecks`; see integrity-checks.md).
- **Envelope**: every file is `{ version: 1, data }`. `writeJson`/`flush` write it; `readJson` unwraps. Unknown `version` → `corrupt` (empty default + warn once per store instance + file never overwritten — forward protection). Unversioned payloads (bare array/object) accepted as current version, lazily upgraded on next write. `$schema` lives at envelope level only, never in `data`.
- **`$schema`**: on any write `writeJson` injects the matching `schemas/<name>.schema.json` sibling (keeps an existing string sibling if present). Normalizers never see it (`readJson` unwraps first) so self-heal cannot strip it. Top-level files reference `schemas/<name>.schema.json` directly (no `../../` — there are no profile subdirs anymore).
- **Load semantics** (`JsonStore.load`): missing → `empty()`; corrupt/unknown-version → warn once + `empty()`; parse-ok → normalize; self-heal write-back only when `changed` (parse-ok AND normalized differs).
- **Write cadence**: per-slot debounce (default 400 ms), last-write-wins within a slot, slots independent; `flush()` (panel close / `save*` handlers) writes immediately; `dispose()` clears timers and flushes pending by default. Host writes call `onSelfWrite` (session stamps `lastSelfWriteAt`).
- **Registry writes are read-modify-write on the single file**: `writeProfileRecord`/`removeProfileRecord`/`renameProfileRecord` scan the array, apply, re-normalize (`normalizeProfilesRegistry`), and write `profiles.json`. The first registry write also seeds `.hexscope/schemas/`. Registry mutations are debounced through the session's `registryStore: JsonStore<ProfileRecord[]>`; a per-file mutation routes through `withBoundProfile(patch)` (see state-management.md) which materializes when unbound, stages in-memory when out-of-workspace non-explicit, and otherwise patches the bound record inside the array.
- **Deferred creation (no write on open)**: a bare open never writes. `registryStore` reads return `empty()` (`[]`) until the first mutation or explicit profile action. No binding on open → in-memory default record; the first per-file mutation `materializePending()` creates a profile (`createProfileFromName` → `writeProfileRecord`) + a `Binding` (writes `bindings.json`), seeds schemas, and attaches the watcher. Out-of-workspace files: the resolver declines non-explicit writes (`if (!hasWorkspaceFolder && !forceMaterializeOnSave) return null`), so the mutation is staged in a **session in-memory bound cache** (`boundProfileCache`) — no `.hexscope/` sibling ever seeded. Only an explicit **Save** (`saveProfile` sets `forceMaterializeOnSave` for the op) or an explicit "Select/New Profile" action materializes out-of-workspace (`materializePending` → cache folded into the new profile → persisted + flushed).
- **Binding lifecycle**: `onDidRenameFiles` → rewrite matching `fileKey`s to new relPaths (silent, `attachBindingFileLifecycle`, process-lifetime per root); `onDidDeleteFiles` → remove entries for deleted files immediately; every `bindings.json` write → `pruneBindings` drops entries whose `fileKey` no longer resolves to a file on disk (catches CLI mv/rm VS Code never saw). A rename VS Code never saw → file opens as "No Profile" → one-click dropdown reselect re-binds under the new path; profile + pool are never recreated.
- **Watcher**: `attachProfileWatcher` watches `profiles.json`, `structs.json`, and `bindings.json` under `.hexscope/` (create/change/delete). Session debounces (`onProfileChanged` → per-slot `scheduleReload`) and guards self-writes via the 1 s self-write horizon. External edits auto-apply silently (see editing-save-external-change.md §1a).
- **Webview fan-out** on external change: `profiles.json` → `perFileDataChange` (bound record changed) + `profilesState` (registry/binding changed); `.hexscope/structs.json` → `structsExternalChange` (webview prunes pins with vanished `structId`). Struct edits (`saveStructs`) always write the workspace pool; pin/label/check/endian edits always write the bound profile; picking/creating a profile writes a binding.
- **Migration** (once per root, first panel open, before first `postInit`): (0) per-dir registry `.hexscope/profiles/<id>/profile.json` → merge into `profiles.json` array (dedupe ids + case-insensitive names; existing array records win), one-time Memento marker `hexScope.profilesArray.v1`, dir tree left in place for rollback (runs before the firmware_profiles conversion, which pushes more records into the array); (a) Memento-era `globalState`/`workspaceState` keys (structs v2/v1, integrity templates, per-file labels/segmentNames/pins/checks/endian/structs) → deduped pool + unbound template profiles + a bound profile for the open doc, then hard-delete keys; (b) on-disk `firmware_profiles/*` tree → merge every `structs.json` into the pool (dedup via structMigration `mergeLegacyStructDefs`) and convert each `index.json`+`integrity.json` pair into one registry profile + one binding (extra integrity templates → unbound profiles). Idempotent: Memento tariffs + per-converted-dir `.converted` marker file (restart-safe, no duplicate profiles); the mere existence of `bindings.json` is **never** treated as proof of completion, so a pre-existing binding from an unrelated file cannot suppress conversion of a remaining legacy tree. Legacy trees left in place for rollback. Failures never block opening.
- **JSON Schemas**: repo `schemas/{profiles,structs,bindings}.schema.json` bundled; `contributes.jsonValidation` globs map the three file paths → bundled schema (`schemas/index.schema.json`, `schemas/integrity.schema.json`, `schemas/profile.schema.json` retired); seeded `.hexscope/schemas/` copies for installed-extension/agent resolution. `profiles.schema.json` data is an array (each item = the ProfileRecord shape; `uniqueItems` catches exact duplicates; id/name uniqueness beyond that is runtime-enforced by `normalizeProfilesRegistry`). `structPins` stays `required`; the legacy pre-rename `pins` key is declared as an **allowed deprecated property** (same `structPin` array, `"deprecated": true`) so files still carrying it pass strict authoring while the runtime's `structPins ?? pins` tolerance keeps reading them. Envelope root tolerant (`additionalProperties: true`), nested payload objects strict (`required` + `additionalProperties: false` + enums from `STRUCT_FIELD_TYPES` / `INTEGRITY_ALGORITHMS` / `endian`). Schemas describe the contracted shape; they do not gate loading (runtime stays lenient).

### 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| File missing | `empty()` default; no file created by a bare `load()` |
| No binding on open (deferred) | In-memory `empty()` reads, zero fs access, no watcher; no mutation = no registry write |
| First per-file mutation (unbound, workspace) | Materialize once: create profile + write binding + seed schemas + attach watcher |
| First per-file mutation (unbound, out-of-workspace non-explicit) | Staged in `boundProfileCache`; zero `.hexscope/` writes |
| Explicit Save (out-of-workspace) | `forceMaterializeOnSave` → materialize + fold staged cache into the profile + persist + flush pools |
| Corrupt JSON / unknown `version` | empty default + `console.warn` once per store instance; original file untouched/never overwritten |
| Parse OK, normalized differs | Self-heal write-back (satisfies `$schema` + envelope) |
| Parse OK, normalized equal | No write |
| `set()` then panel close | Flush pending write immediately |
| External edit to profiles/pool/binding file | Watcher → debounced reload → re-normalize → re-broadcast (silent) |
| Host self-write (save/self-heal) | Stamped self-write; watcher ignores within 1 s horizon |
| Rename/move inside VS Code | `onDidRenameFiles` rewrites the binding `fileKey` in place (silent); profile + pool untouched |
| Delete inside VS Code | `onDidDeleteFiles` removes the entry immediately |
| Entry whose file no longer exists | Pruned on the next `bindings.json` write (`pruneBindings`) |
| Profile switched via dropdown | Writes a binding only; never mutates any profile's contents; overlays refresh |
| Profile deleted | Array record removed; its bindings cleared (files revert to "No Profile"); struct pool untouched |
| Duplicate profile id / case-insensitive name in registry | `normalizeProfilesRegistry` drops the later occurrence on every read/write |
| Old per-dir `profiles/<id>/` registry exists | Merged into `profiles.json` once (Memento marker `hexScope.profilesArray.v1`); dir tree left for rollback; re-merge is idempotent |
| Legacy tree already migrated | `.converted` marker per converted `firmware_profiles/<n>` dir → dir skipped (idempotent); `bindings.json` existence never suppresses conversion |
| Migration failure | Logged; key deletion still runs in `finally`; opening not blocked |

### 5. Good / Base / Bad Cases

- Good: two documents under one root open → nothing is written by the opens themselves (legacy migrations aside); the first edit to either file creates exactly one binding (or binds both to a shared profile via Select Profile) and one `profiles.json`.
- Good: user selects the same profile for a second firmware variant → both files' `bindings.json` entries point at one `ProfileRecord`; pins/checks/endian stored exactly once; struct types shared from the pool.
- Good: renaming a bound file in the Explorer → `onDidRenameFiles` rewrites its `fileKey`; reopening the renamed file keeps its profile.
- Base: panel opens a never-seen document then closes with no edits → zero files/directories created (no `structs.json`, no `profiles.json`, no `bindings.json`, no `.hexscope/` sibling when out-of-workspace); the same open + any per-file edit (labels/pins/structs/checks/endian) → `bindings.json` entry + `profiles.json` record + seeded `schemas/`. Out-of-workspace writes stay in-memory until an explicit Save/profile action.
- Bad: writing `.hexscope/` state to `globalState`/`workspaceState` (migration is the sole Memento consumer).
- Bad: importing `vscode` from `src/core/` to read `.hexscope/` — storage I/O stays in the host adapter.
- Bad: treating an unknown-version file as OK and writing back over it.
- Bad: bypassing the registry-array write path with a raw `writeJson(profilesJsonUri(root), ...)` that skips `normalizeProfilesRegistry` (duplicate ids/names would survive).
- Bad: mutating a shared profile unconditionally without surfacing the "used by N files" state (select `title` tooltip + switch toast).

### 6. Tests Required

- `src/test/extension/hexScopeStorage.test.ts` (extension host): envelope matrix (missing/corrupt/unknown-version/self-heal/debounce/flush/dispose), registry array semantics (upsert/remove/rename/ordinal over the array, `normalizeProfilesRegistry` dedupe order), deferred `lazyDir` store (read-only open creates nothing; first write materializes; `null` resolver stays in-memory; later explicit write materializes), binding lifecycle (rename rewrite / delete remove / prune on write / unwatched-rename → No Profile re-pick), multi-file sharing (2 files → 1 profile), watcher conflict (external auto-applies; self-write persists), migration pipeline (Memento era + `firmware_profiles/*` tree + per-dir registry merge → pool + profiles + bindings, dedup, idempotence, markers), no gitignore seeding.
- `src/test/schemas/schemaValidation.test.ts` (node): ajv strict-pass + negatives (wrong version/endian/type-enum/required/non-array data/duplicate items) + drift guard (`version` const === `DATA_VERSION`, enums === source consts, `profiles.schema.json` array shape).
- Webview `src/test/webview/webviewMessageModel.test.ts`: `structsExternalChange` (replace + pin-prune), `perFileDataChange` slices, `profilesState`/`selectProfile`/`newProfile`/`saveProfile`/`duplicateProfile`/`renameProfile`/`deleteProfile` message flow (discriminated-union shape).
- Gate: `npm run compile` (check-types + lint + esbuild) and `npm run test` green; `npx fallow` 4-axis green; grep gates (no `globalState`/`workspaceState` outside migration; no `firmware_profiles`/`index.json`/`integrity.json` reads outside migration; no `profileRegistryJsonUri`/`hexScopeProfilesRegistryDir`/`resolveProfileDir`/`createProfileRegistryEntry`; no `.gitignore`/`local/` in `src/`).

### 7. Wrong vs Correct

#### Wrong

```typescript
const value: StructDef[] = JSON.parse(text);            // skip normalizer, accept unknown version
await vscode.workspace.fs.writeFile(uri, rawText);       // no envelope, no $schema, no margin for v2
context.workspaceState.update(`hexScope.labels.${uri}`, labels);   // Memento read/write in session
await writeJson(profilesJsonUri(root), withEnvelope([...records, rec]));   // skip normalizeProfilesRegistry → dup ids/names survive
```

#### Correct

```typescript
await writeProfileRecord(root, next);                   // read-modify-write through the registry array (normalized)
registryStore.set(normalizeProfilesRegistry(nextRecords).value);   // per-file mutations stage through the debounced registry store
await writeJson(bindingsJsonUri(root), withEnvelope(await pruneBindings(root, next)));   // binding writes always prune first
// persistence happens through JsonStore slots wired in hexEditorSession.ts; migration owns the only Memento access
```

## Related specs

- `state-management.md` — persistence scope + webview owner rules + message flow (`withBoundProfile`, registry ownership).
- `editing-save-external-change.md` §1a — silent auto-apply deviation vs the hex-file prompt/lock/repair contract.
- `directory-structure.md` — host-adapter placement (`hexScopeStorage.ts`, `hexScopeMigration.ts`, `schemas/`).
- `struct-model.md` / `integrity-checks.md` — `StructDef` / `IntegrityProfile` normalization owners in `src/core/`.