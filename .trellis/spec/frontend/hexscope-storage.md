# HexScope On-Disk Storage Code-Spec

## Scenario: persist all Hex Scope state as committed per-firmware `.hexscope/` JSON files

### 1. Scope / Trigger

Applies to everything stored under `.hexscope/` in a workspace: `JsonStore` slot semantics, the version envelope, profile lookup/creation, the external-change watcher, JSON Schema binding, and the legacy Memento migration. Owner module: `src/hexScopeStorage.ts` (host adapter — top level, never imported by `src/core/`), with `src/hexScopeMigration.ts` for the one-time transfer and `src/hexEditorSession.ts` for wiring. No VS Code Memento is read or written outside `hexScopeMigration.ts`.

This spec is the single source of truth for the on-disk contract. `docs/HEXSCOPE_STORAGE.md` is the user-facing summary; the three `schemas/*.schema.json` files are the machine-readable copy (ajv drift-guarded in `src/test/schemas/schemaValidation.test.ts`).

### 2. Signatures

```typescript
export const DATA_VERSION = 1;                       // hexScopeStorage.ts
export type ProfileJsonName = 'index.json' | 'structs.json' | 'integrity.json';
type JsonRead = { status: 'ok'; value: unknown } | { status: 'missing' } | { status: 'corrupt' };
function withEnvelope(payload: unknown): unknown;                      // { version: DATA_VERSION, data: payload }
function unwrapEnvelope(raw: unknown): unknown | null;                 // null = unknown version
async function readJson(uri): Promise<JsonRead>;                       // corrupt covers read-err + parse-err + envelope
async function writeJson(uri, value): Promise<void>;                   // ensureParentDir, $schema sibling, pretty 2-space
async function writeIfMissing(uri, value): Promise<void>;              // keep committed copy

function resolveHexScopeRoot(uri): string;            // workspace folder else dirname(document)
function perFileRelativePath(root, uri): string;      // posix, e.g. "firmware/boot.hex"
function hexScopeProfilesDir(root): string;           // <root>/.hexscope/firmware_profiles
function hexScopeSchemasDir(root): string;            // <root>/.hexscope/schemas
async function findProfile(root, relPath): Promise<string | null>;
async function createProfile(root, relPath): Promise<string>;         // ordinal next id + seeds index.json
export async function seedSchemaCopies(root): Promise<void>;          // writeIfMissing the 3 bundled schemas

class JsonStore<T> {
    constructor(options: { uri; normalizer(raw)->{value,changed}; empty()->T; debounceMs?; onSelfWrite?; onReload? });
    async load(force?): Promise<T>;    get(): T | null;    set(next: T): void;
    async flush(): Promise<void>;      scheduleReload(ms?): void;    async reload(): Promise<T>;
    dispose(flushPending?: boolean): void;
}

function attachProfileWatcher(options: { root; onProfileChanged }): vscode.Disposable;
async function migrateLegacyData(root, uri, context): Promise<void>;  // hexScopeMigration.ts

type IndexFileData = { relPath: string; labels: SegmentLabel[]; segmentNames: SegmentNameOverrides;
                       pins: StructPin[]; activeChecks: IntegrityCheckSet; endian: 'le' | 'be' };
```

### 3. Contracts

Layout (whole tree git-tracked — no `.gitignore` seeding, no local/private split; pins/checks/endian shared by design):

```text
.hexscope/
├── firmware_profiles/<id>/    # one dir per document; id = ordinal "profiles_<n>" by default, renameable
│   ├── index.json             { version, data: IndexFileData, $schema? }
│   ├── structs.json           { version, data: StructDef[], $schema? }
│   └── integrity.json         { version, data: IntegrityProfile[], $schema? }
├── schemas/                   # seeded copies of the 3 bundled schemas (writeIfMissing)
└── scripts/                   # script runner, unchanged
```

- **Identity**: a document owns exactly one profile, keyed by `index.json.data.relPath` (workspace-relative, posix). Directory name is cosmetic; renaming the dir never breaks lookup. Firmware renames are manual (`relPath` edit) — no rename machinery.
- **Envelope**: every file is `{ version: 1, data }`. `writeJson`/`flush` write it; `readJson` unwraps. Unknown `version` → `corrupt` (empty default + warn once per store instance + file never overwritten — forward protection). Unversioned payloads (bare array/object) accepted as current version, lazily upgraded on next write. `$schema` lives at envelope level only, never in `data`.
- **`$schema`**: on any profile write `writeJson` injects `"../../schemas/<name>.schema.json"` (keeps an existing string sibling if present). Normalizers never see it (`readJson` unwraps first) so self-heal cannot strip it.
- **Load semantics** (`JsonStore.load`): missing → `empty()`; corrupt/unknown-version → warn once + `empty()`; parse-ok → normalize; self-heal write-back BLA only when `changed` (parse-ok AND normalized differs).
- **Write cadence**: per-slot debounce (default 400 ms), last-write-wins within a slot, slots independent; `flush()` (panel close / `save*` handlers via `updateStore`) writes immediately; `dispose()` clears timers and flushes pending by default (`dispose(false)` used on profile re-key). Host writes call `onSelfWrite` (session stamps `lastSelfWriteAt`).
- **Profile creation**: `findProfile` misses → `createProfile`/`createProfileDir` picks the lowest unused `profiles_<n>`, seeds `.hexscope/schemas/`, writes `index.json.relPath`. Migration uses `createProfileDir` + `writeIfMissing`.
- **Watcher**: `attachProfileWatcher` watches `${PROFILE_CONTAINER}/*/*.json` + `${PROFILE_CONTAINER}/*` (create/change/delete) under the root; `.hexscope/schemas/` is NOT watched. Session debounces (`onProfileChanged` → per-slot `scheduleReload`) and guards self-writes via the 1 s self-write horizon. External edits auto-apply silently (see editing-save-external-change.md §1a).
- **Webview fan-out** on external change: `index.json` → `perFileDataChange`; `structs.json` → `structsExternalChange` (webview prunes pins with vanished `structId`); `integrity.json` → existing `integrityProfiles` broadcast.
- **Migration** (once per root, first panel open, before first `postInit`): read `globalState` structs v2/v1 + `integrityProfiles.global.v1` + per-file `workspaceState` keys (labels/segmentNames/structPins/integrityChecks/endian/structs) **under the root**; normalize; seed the open document's profile via `writeIfMissing`; hard-delete every touched key incl. legacy variants; sweep-delete remaining per-file keys of sibling documents under the same root. Idempotent; no prompt; failures never block opening.
- **JSON Schemas**: repo `schemas/{index,structs,integrity}.schema.json` bundled; `contributes.jsonValidation` globs map `.hexscope/firmware_profiles/*/{index,structs,integrity}.json` → bundled schema; seeded `.hexscope/schemas/` copy for installed-extension/agent resolution. Envelope root tolerant (`additionalProperties: true`), nested payload objects strict (`required` + `additionalProperties: false` + enums from `STRUCT_FIELD_TYPES` / `INTEGRITY_ALGORITHMS` / `endian`). Schemas describe the contracted shape; they do not gate loading (runtime stays lenient).

### 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| File missing | `empty()` default; no file created by a bare `load()` |
| Corrupt JSON / unknown `version` | empty default + `console.warn` once per store instance; original file untouched/never overwritten |
| Parse OK, normalized differs | Self-heal write-back (satisfies `$schema` + envelope) |
| Parse OK, normalized equal | No write |
| `set()` then panel close | Flush pending write immediately |
| External edit to a profile file | Watcher → debounced reload → re-normalize → re-broadcast (silent) |
| Host self-write (save/self-heal) | Stamped self-write; watcher ignores within 1 s horizon |
| External profile-dir rename/restructure | `findProfile` re-scan; stores re-keyed to new dir (old stores `dispose(false)`); reload scheduled |
| `migrateLegacyData` target profile exists | `writeIfMissing` keeps committed copy; keys still deleted |
| Migration failure | Logged; key deletion still runs in `finally`; opening not blocked |

### 5. Good / Base / Bad Cases

- Good: two documents under one root open → first seeds its profile, sweep deletes both docs' legacy per-file keys (`workspaceState.keys()` empty after).
- Good: user renames `profiles_1` → any name → reopening still resolves via `relPath` match; committed `.hexscope` survives.
- Good: external `git pull` edits `structs.json` while panel open → silent `structsExternalChange`, mid-edit draft clobbered (accepted — per-file scope).
- Base: panel opens a never-seen document → new `profiles_<n>` dir + seeded `index.json`.
- Bad: writing `.hexscope/` state to `globalState`/`workspaceState` (migration is the sole Memento consumer).
- Bad: importing `vscode` from `src/core/` to read `.hexscope/` — storage I/O stays in the host adapter.
- Bad: treating an unknown-version file as OK and writing back over it.

### 6. Tests Required

- `src/test/extension/hexScopeStorage.test.ts` (extension host): envelope matrix (missing/corrupt/unknown-version/self-heal/debounce/flush/dispose), ordinal create/lookup/rename-survival, watcher conflict (external auto-applies; self-write persists), migration pipeline incl. root-sweep multi-doc deletion, no gitignore seeding.
- `src/test/schemas/schemaValidation.test.ts` (node): ajv strict-pass + negatives (wrong version/endian/type-enum/required/non-array data) + drift guard (`version` const === `DATA_VERSION`, enums === source consts).
- Webview `src/test/webview/webviewMessageModel.test.ts`: `structsExternalChange` (replace + pin-prune) and `perFileDataChange` slices (`endianOrDefault` single home).
- Gate: `npm run compile` (check-types + lint + esbuild) and `npm run test` green; `npx fallow` 4-axis green; grep gates (no `globalState`/`workspaceState` outside migration; no `.gitignore`/`local/` in `src/`).

### 7. Wrong vs Correct

#### Wrong

```typescript
const value: StructDef[] = JSON.parse(text);            // skip normalizer, accept unknown version
await vscode.workspace.fs.writeFile(uri, rawText);       // no envelope, no $schema, no margin for v2
context.workspaceState.update(`hexScope.labels.${uri}`, labels);   // Memento read/write in session
```

#### Correct

```typescript
const data = indexStore.borrow(c => c);                 // JsonStore cache is the source of truth
await writeJson(profileJsonUri(dir, 'index.json'), withEnvelope(indexData));  // envelope + $schema handled
// persistence happens through JsonStore slots wired in hexEditorSession.ts; migration owns the only Memento access
```

## Related specs

- `state-management.md` — persistence scope + webview owner rules + on-disk JSON Schema contract summary.
- `editing-save-external-change.md` §1a — silent auto-apply deviation vs the hex-file prompt/lock/repair contract.
- `directory-structure.md` — host-adapter placement (`hexScopeStorage.ts`, `hexScopeMigration.ts`, `schemas/`).
- `struct-model.md` / `integrity-checks.md` — `StructDef` / `IntegrityProfile` normalization owners in `src/core/`.