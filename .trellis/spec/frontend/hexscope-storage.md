# HexScope On-Disk Storage Code-Spec

## Scenario: persist all Hex Scope state as committed three-tier `.hexscope/` JSON files

### 1. Scope / Trigger

Applies to everything stored under `.hexscope/` in a workspace: `JsonStore` slot semantics, the version envelope, the workspace struct pool, the profile registry, the file-binding table, binding lifecycle (rename/delete/prune), the external-change watcher, JSON Schema binding, and the legacy migrations (Memento v1/v2 + `firmware_profiles/*` tree). Owner module: `src/hexScopeStorage.ts` (host adapter — top level, never imported by `src/core/`), with `src/hexScopeMigration.ts` for the one-time transfers and `src/hexEditorSession.ts` (+ `src/extension.ts` CRUD commands) for wiring. No VS Code Memento is read or written outside `hexScopeMigration.ts`.

This spec is the single source of truth for the on-disk contract. `docs/HEXSCOPE_STORAGE.md` is the user-facing summary; the three `schemas/*.schema.json` files are the machine-readable copy (ajv drift-guarded in `src/test/schemas/schemaValidation.test.ts`).

### 2. Signatures

```typescript
export const DATA_VERSION = 1;                       // hexScopeStorage.ts
export type ProfileJsonName = 'profile.json';
type JsonRead = { status: 'ok'; value: unknown } | { status: 'missing' } | { status: 'corrupt' };
function withEnvelope(payload: unknown): unknown;                      // { version: DATA_VERSION, data: payload }
function unwrapEnvelope(raw: unknown): unknown | null;                 // null = unknown version
async function readJson(uri): Promise<JsonRead>;                       // corrupt covers read-err + parse-err + envelope
async function writeJson(uri, value): Promise<void>;                   // ensureParentDir, $schema sibling, pretty 2-space
async function writeIfMissing(uri, value): Promise<void>;              // keep committed copy

function resolveHexScopeRoot(uri): string;            // workspace folder else dirname(document)
function perFileRelativePath(root, uri): string;      // posix, e.g. "firmware/boot.hex"
function hexScopeRootDir(root): string;               // <root>/.hexscope
function hexScopeProfilesRegistryDir(root): string;   // <root>/.hexscope/profiles
function hexScopeSchemasDir(root): string;            // <root>/.hexscope/schemas
function profileRegistryJsonUri(dir): Uri;            // <profile-dir>/profile.json
function bindingsJsonUri(root): Uri;                  // <root>/.hexscope/bindings.json
function structPoolJsonUri(root): Uri;                // <root>/.hexscope/structs.json
async function resolveProfileDir(root, profileId): Promise<string | null>;
async function nextProfileOrdinal(root): Promise<number>;             // lowest unused "profile_<n>"
async function createProfileRegistryEntry(root, id, name): Promise<string>;  // seeds dir + profile.json + schemas
export async function seedSchemaCopies(root): Promise<void>;          // writeIfMissing the 3 bundled schemas

interface ProfileRecord { id; name; pins: StructPin[]; activeChecks: IntegrityCheckSet;
                          endian: 'le'|'be'; segmentNames: SegmentNameOverrides; labels: SegmentLabel[]; }
interface Binding { fileKey: string /* workspace-relative posix */; profileId: string; }
function emptyProfileRecord(id, name): ProfileRecord;
function normalizeProfileRecord(raw, fallback?: ProfileRecord): NormalizedValue<ProfileRecord>;
function normalizeBindings(raw): NormalizedValue<Binding[]>;

class JsonStore<T> {
    constructor(options: { uri; normalizer(raw)->{value,changed}; empty()->T; debounceMs?; onSelfWrite?; onReload?;
                           lazyDir?: () => Promise<string | null> });  // deferred mode: reads return empty() in memory, first write resolves dir; null = stay in-memory
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

Layout (whole tree git-tracked — no `.gitignore` seeding, no local/private split; pins/checks/endian shared by design):

```text
.hexscope/
├── structs.json              { version, data: StructDef[], $schema? }   # workspace pool, one flat list
├── profiles/<id>/profile.json { version, data: ProfileRecord, $schema? } # named reusable annotation bundle
├── bindings.json             { version, data: Binding[], $schema? }      # fileKey → profileId table
├── schemas/                  # seeded copies of the 3 bundled schemas (writeIfMissing)
└── scripts/                  # script runner, unchanged
```

- **Three tiers**: struct *types* live once in the workspace pool (`.hexscope/structs.json`); a *profile* is a named annotation bundle (`ProfileRecord`) storing pins / activeChecks / endian / segmentNames / labels, not owned by any file; a *file* is bound to a profile by a `Binding` entry keyed on its workspace-relative posix `relPath`. The old `firmware_profiles/*` per-file dirs (`index.json` + `structs.json` + `integrity.json`) no longer exist outside migration. The standalone `IntegrityProfile[]` template registry is removed — checks live only as `activeChecks` inside a `ProfileRecord` (the Integrity panel shows only the bound profile's `activeChecks`; see integrity-checks.md).
- **Envelope**: every file is `{ version: 1, data }`. `writeJson`/`flush` write it; `readJson` unwraps. Unknown `version` → `corrupt` (empty default + warn once per store instance + file never overwritten — forward protection). Unversioned payloads (bare array/object) accepted as current version, lazily upgraded on next write. `$schema` lives at envelope level only, never in `data`.
- **`$schema`**: on any profile/write `writeJson` injects the matching `schemas/<name>.schema.json` sibling (keeps an existing string sibling if present). Normalizers never see it (`readJson` unwraps first) so self-heal cannot strip it.
- **Load semantics** (`JsonStore.load`): missing → `empty()`; corrupt/unknown-version → warn once + `empty()`; parse-ok → normalize; self-heal write-back only when `changed` (parse-ok AND normalized differs).
- **Write cadence**: per-slot debounce (default 400 ms), last-write-wins within a slot, slots independent; `flush()` (panel close / `save*` handlers via `updateStore`) writes immediately; `dispose()` clears timers and flushes pending by default (`dispose(false)` used on profile re-key). Host writes call `onSelfWrite` (session stamps `lastSelfWriteAt`).
- **Deferred creation (no write on open)**: a bare open never writes. When no profile is bound to the file, the session builds stores in **deferred mode** (`lazyDir` set, shared single-flight resolver): reads return in-memory `empty()` defaults, no `.hexscope/` files, no schemas seed, no watcher. The first mutation of profile state (`set()` on any slot) or an explicit "Select Profile"/"New Profile" materializes: `createProfileRegistryEntry` (or binds to an existing profile) → a `Binding` is written, `.hexscope/schemas/` seeded, `bindings.json` written, watcher attaches. The store-level resolver is single-flight and a `null` result keeps the write in-memory (retried on the next write, enabling a later explicit action to materialize). Out-of-workspace files: `resolveHexScopeRoot` falls back to `dirname(document)`, so non-explicit writes stay in-memory (no `.hexscope/` sibling ever seeded) unless an explicit profile action occurs.
- **Binding lifecycle**: `onDidRenameFiles` → rewrite matching `fileKey`s to new relPaths (silent, `attachBindingFileLifecycle`, process-lifetime per root); `onDidDeleteFiles` → remove entries for deleted files immediately; every `bindings.json` write → `pruneBindings` drops entries whose `fileKey` no longer resolves to a file on disk (catches CLI mv/rm VS Code never saw). A rename VS Code never saw → file opens as "No Profile" → one-click dropdown reselect re-binds under the new path; profile + pool are never recreated.
- **Watcher**: `attachProfileWatcher` watches the `.hexscope/` tree the three tiers live under (create/change/delete), excluding `.hexscope/schemas/`. Session debounces (`onProfileChanged` → per-slot `scheduleReload`) and guards self-writes via the 1 s self-write horizon. External edits auto-apply silently (see editing-save-external-change.md §1a).
- **Webview fan-out** on external change: `profiles/<id>/profile.json` → `perFileDataChange`; `.hexscope/structs.json` → `structsExternalChange` (webview prunes pins with vanished `structId`); registry/binding changes → `profilesState`/`init` refresh. Struct edits (`saveStructs`) always write the workspace pool; pin/label/check/endian edits always write the bound profile; picking/creating a profile writes a binding.
- **Migration** (once per root, first panel open, before first `postInit`): (a) Memento-era `globalState`/`workspaceState` keys (structs v2/v1, integrity templates, per-file labels/segmentNames/pins/checks/endian/structs) → deduped pool + unbound template profiles + a bound profile for the open doc, then hard-delete keys; (b) on-disk `firmware_profiles/*` tree → merge every `structs.json` into the pool (dedup via structMigration `mergeLegacyStructDefs`) and convert each `index.json`+`integrity.json` pair into one registry profile + one binding (extra integrity templates → unbound profiles). Idempotent: Memento tariff + skip tree migration when `bindings.json` exists (restart-safe, no duplicate profiles). Legacy tree left in place for rollback. Failures never block opening.
- **JSON Schemas**: repo `schemas/{profile,structs,bindings}.schema.json` bundled; `contributes.jsonValidation` globs map the three new file paths → bundled schema (`schemas/index.schema.json`, `schemas/integrity.schema.json` retired); seeded `.hexscope/schemas/` copies for installed-extension/agent resolution. Envelope root tolerant (`additionalProperties: true`), nested payload objects strict (`required` + `additionalProperties: false` + enums from `STRUCT_FIELD_TYPES` / `INTEGRITY_ALGORITHMS` / `endian`). Schemas describe the contracted shape; they do not gate loading (runtime stays lenient).

### 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| File missing | `empty()` default; no file created by a bare `load()` |
| No binding on open (deferred) | In-memory `empty()` reads, zero fs access, no watcher; never `createProfileRegistryEntry` on a read path |
| First `set()` in deferred mode | Resolve/create profile once (`createProfileRegistryEntry` or existing) + write binding; `null` resolver = stay in-memory (out-of-workspace non-explicit write), retried on next write |
| Corrupt JSON / unknown `version` | empty default + `console.warn` once per store instance; original file untouched/never overwritten |
| Parse OK, normalized differs | Self-heal write-back (satisfies `$schema` + envelope) |
| Parse OK, normalized equal | No write |
| `set()` then panel close | Flush pending write immediately |
| External edit to a profile/pool/binding file | Watcher → debounced reload → re-normalize → re-broadcast (silent) |
| Host self-write (save/self-heal) | Stamped self-write; watcher ignores within 1 s horizon |
| Rename/move inside VS Code | `onDidRenameFiles` rewrites the binding `fileKey` in place (silent); profile + pool untouched |
| Delete inside VS Code | `onDidDeleteFiles` removes the entry immediately |
| Entry whose file no longer exists | Pruned on the next `bindings.json` write (`pruneBindings`) |
| Profile switched via dropdown | Writes a binding only; never mutates any profile's contents; overlays refresh |
| Profile deleted | Registry entry removed; its bindings cleared (files revert to "No Profile"); struct pool untouched |
| `migrateLegacyData` target profile exists | `writeIfMissing` keeps committed copy; keys still deleted |
| Legacy tree already migrated | `bindings.json` exists → tree migration is a no-op (idempotent) |
| Migration failure | Logged; key deletion still runs in `finally`; opening not blocked |

### 5. Good / Base / Bad Cases

- Good: two documents under one root open → nothing is written by the opens themselves (legacy migrations aside); the first edit to either file creates exactly one binding (or binds both to a shared profile via Select Profile).
- Good: user selects the same profile for a second firmware variant → both files' `bindings.json` entries point at one `ProfileRecord`; pins/checks/endian stored exactly once; struct types shared from the pool.
- Good: renaming a bound file in the Explorer → `onDidRenameFiles` rewrites its `fileKey`; reopening the renamed file keeps its profile.
- Base: panel opens a never-seen document then closes with no edits → zero files/directories created (no `structs.json`, no `profiles/`, no `bindings.json`, no `.hexscope/` sibling when out-of-workspace); the same open + any per-file edit (labels/pins/structs/checks/endian) → `bindings.json` entry + `profiles/<id>/profile.json` + seeded `schemas/`. Out-of-workspace writes stay in-memory until an explicit profile action.
- Bad: writing `.hexscope/` state to `globalState`/`workspaceState` (migration is the sole Memento consumer).
- Bad: importing `vscode` from `src/core/` to read `.hexscope/` — storage I/O stays in the host adapter.
- Bad: treating an unknown-version file as OK and writing back over it.
- Bad: mutating a shared profile unconditionally without surfacing the "used by N files" hint in the inline editors.

### 6. Tests Required

- `src/test/extension/hexScopeStorage.test.ts` (extension host): envelope matrix (missing/corrupt/unknown-version/self-heal/debounce/flush/dispose), deferred `lazyDir` store (read-only open creates nothing; first write materializes dir + slots; `null` resolver stays in-memory; later explicit write materializes), registry ordinal create + find, binding lifecycle (rename rewrite / delete remove / prune on write / unwatched-rename → No Profile re-pick), multi-file sharing (2 files → 1 profile), watcher conflict (external auto-applies; self-write persists), migration pipeline (Memento era + `firmware_profiles/*` tree → pool + profiles + bindings, dedup, idempotence), no gitignore seeding.
- `src/test/schemas/schemaValidation.test.ts` (node): ajv strict-pass + negatives (wrong version/endian/type-enum/required/non-array data) + drift guard (`version` const === `DATA_VERSION`, enums === source consts).
- Webview `src/test/webview/webviewMessageModel.test.ts`: `structsExternalChange` (replace + pin-prune), `perFileDataChange` slices, `profilesState`/`selectProfile`/`newProfile` message flow (discriminated-union shape).
- Gate: `npm run compile` (check-types + lint + esbuild) and `npm run test` green; `npx fallow` 4-axis green; grep gates (no `globalState`/`workspaceState` outside migration; no `firmware_profiles`/`index.json`/`integrity.json` reads outside migration; no `.gitignore`/`local/` in `src/`).

### 7. Wrong vs Correct

#### Wrong

```typescript
const value: StructDef[] = JSON.parse(text);            // skip normalizer, accept unknown version
await vscode.workspace.fs.writeFile(uri, rawText);       // no envelope, no $schema, no margin for v2
context.workspaceState.update(`hexScope.labels.${uri}`, labels);   // Memento read/write in session
await writeJson(profileRegistryJsonUri(await resolveProfileDir(root, profileId)!), withEnvelope(pins));  // bypass JsonStore debounce/cache
```

#### Correct

```typescript
const data = profileStore.borrow(c => c);               // JsonStore cache is the source of truth
profileStore.set({ ...bound, pins: next });             // session slot persists into the bound profile
await writeJson(bindingsJsonUri(root), withEnvelope(await pruneBindings(root, next)));   // binding writes always prune first
// persistence happens through JsonStore slots wired in hexEditorSession.ts; migration owns the only Memento access
```

## Related specs

- `state-management.md` — persistence scope + webview owner rules + on-disk JSON Schema contract summary.
- `editing-save-external-change.md` §1a — silent auto-apply deviation vs the hex-file prompt/lock/repair contract.
- `directory-structure.md` — host-adapter placement (`hexScopeStorage.ts`, `hexScopeMigration.ts`, `schemas/`).
- `struct-model.md` / `integrity-checks.md` — `StructDef` / `IntegrityProfile` normalization owners in `src/core/`.