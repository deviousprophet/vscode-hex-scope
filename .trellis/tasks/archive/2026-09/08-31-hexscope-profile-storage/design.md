# Design — per-file `.hexscope` firmware profiles

## Module: `src/hexScopeStorage.ts` (host adapter, top level — `src/core/` must not import `vscode`)

Single owner of `.hexscope/` I/O. No Memento access here. Normalization functions are passed in per slot from `hexEditorSession.ts`, keeping validation logic injectable and in its owning modules.

### Root & relative path resolution

```ts
export function resolveHexScopeRoot(uri: vscode.Uri): string {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    return folder ? folder.uri.fsPath : path.dirname(uri.fsPath);
}
// rel = path.relative(root, uri.fsPath) -> posix separators, e.g. "firmware/boot.hex"
export function profileDir(root: string, relPath: string): string  // root/.hexscope/firmware_profiles/<id>
```

`<id>` (ordinal `profiles_1`, …) is derived at lookup/create time (list `firmware_profiles/*` dirs, pick the lowest unused `profiles_N`). Dir name is cosmetic only.

### I/O primitives (use `vscode.workspace.fs`)

```ts
type JsonRead = { status: 'ok'; value: unknown } | { status: 'missing' } | { status: 'corrupt' };
async function readJson(uri): Promise<JsonRead>
async function writeJson(uri, value, root): Promise<void>  // encode envelope, seed nothing (no gitignore)
```

`corrupt` = read throws (non-ENOENT) or `JSON.parse` throws, **or `unwrapEnvelope` returns an unknown version**.

### Version envelope

```ts
export const DATA_VERSION = 1;
function withEnvelope(payload: unknown): unknown { return { version: DATA_VERSION, data: payload }; }
export function unwrapEnvelope(raw: unknown): unknown | null; // null => unknown version
```

- Write path: `flush()` writes `withEnvelope(cache)`. All three files get the envelope.
- Read path: `applyRead` unwraps; `null` → the corrupt path (empty default, warn once, never overwrite). Unversioned payloads (a bare array or object without `version`) are accepted as current-version and upgraded on the next write (lazy self-heal only when normalized output differs).

### Store class per file slot

```ts
interface NormalizedValue<T> { value: T; changed: boolean }
class JsonStore<T> {
    // uri, root, normalizer, empty(), onSelfWrite(), debounceMs=400
    async load(force?): Promise<T>       // read -> unwrap -> normalize -> lazy self-heal -> cache
    get(): T | null
    set(next: T): void                   // cache + debounced write
    async flush(): Promise<void>         // write now (envelope), markSelfWrite, clear timer
    dispose(): void
    // watcher hooks: reload() debounced, onReload callback -> session re-broadcast
}
```

Same semantics as the (discarded) predecessor: per-slot timer, corrupt→empty+once-warn+no-overwrite, self-heal only on parse-ok+changed, flush on dispose, slots independent.

### Per-file session stores (wired in session)

Three slots keyed to the session's profile dir:

| Slot | File | Normalizer (`hexEditorSession.ts`) | Empty |
|---|---|---|---|
| `indexStore` | `<profile>/index.json` | `normalizeIndexFile` | `{ relPath, labels: [], segmentNames: {}, pins: [], activeChecks: emptySet, endian: 'le' }` |
| `structsStore` | `<profile>/structs.json` | `migrateStructDefinitions` + `normalizeStructDefsValue` chain | `[]` |
| `integrityStore` | `<profile>/integrity.json` | `normalizeIntegrityProfiles` | `[]` |

`index.json.relPath` is set by the session at first-open (lookup miss) and stored through the slot so the envelope keeps it.

### Profile lookup / creation

`findProfile(root, relPath): Promise<string | null>` — scan `firmware_profiles/*`, read each `index.json`, compare `.data.relPath` (after unwrap). Return dir name (or absolute path) of the match. Miss → `createProfileDir`: ordinal next-id dir, `indexStore.set({...defaults, relPath})`, flush. No rename events: subsequent rename of firmware leaves the dir orphaned; manual `relPath` edit re-links.

### Watcher (`attachProfileWatcher`)

Per session: `createFileSystemWatcher(RelativePattern(root, 'firmware_profiles/*' /* or the resolved profile dir */))` covering the three files. Genuine (non-self-write) change → per-slot debounced reload → `onReload` callback → session re-broadcasts. On a new/renamed profile dir, index scan refreshes so an external `firmware_profiles` restructure is picked up. No prompt machinery at all — silent auto-apply hosting. Backward-compat: an **unversioned** manifest read returns the session, see File shapes.

## Session wiring (`src/hexEditorSession.ts`)

Replace the 30 Memento reads with store calls. Keep normalization call sites where they are; only the backend swaps.

- `resolve/open flow`: resolve root + relPath → `findProfile` (miss → create) → construct three `JsonStore`s → `postInit` reads the three slots (labels/segmentNames/pins/activeChecks/endian from index, structs, profiles) → broadcast the existing `init` payload.
- Save handlers become store mutations through one shared helper:

```ts
async function updateStore<T>(store: JsonStore<T>, update: (current: T) => T): Promise<void> {
    store.set(update(store.get() ?? await store.load()));
}
```

  Used by `saveLabels`, `saveStructPins`, `saveIntegrityChecks`, `saveEndian`, `updateLabelVisibility`, `reorderLabel` (index/local style) and `saveStructs`/`saveIntegrityProfiles` (structs/integrity slots). Index-slot ops serialize through the existing per-file promise chain (`enqueuePerFileOp`) to avoid lost updates within a panel.
- Dispose: flush all three slots, dispose watcher.

## Webview protocol (`src/webviewProtocol.ts`)

- New messages mirroring the old surface but **silent** (no `reloadDataAccepted` dialog; no `window.confirm`):
  - `{ type: 'structsExternalChange'; structs: StructDef[] }` — webview replaces `S.structs`, prunes pins whose `structId` vanished.
  - `{ type: 'perFileDataChange'; labels; segmentNames?; pins; endian; activeChecks }` — webview replaces those slices.
  - `integrity.json` reuse the existing `{ type: 'integrityProfiles'; profiles; error: '' }` broadcast.
- `endianOrDefault` — **single shared normalizer** exported from `webviewProtocol.ts` (own both host session slot normalizer and webview model, replacing the two duplicated copies). `HexScopeEndian` already lives there.

## Migration (`migrateLegacyData`, `src/hexScopeMigration.ts`, called before first `postInit`)

Per workspace root, once, in-memory guard keyed by fsPath.

1. Read: `globalState` `hexScope.structs.global.v2`, `hexScope.structs.global.v1`, `hexScope.integrityProfiles.global.v1`, per-file `hexScope.structs.<uri>`; scope `workspaceState` keys matching `hexScope.(labels|segmentNames|structPins|integrityChecks|endian).<uri>` under this root.
2. Normalize with existing helpers.
3. Seed the currently-open document's profile slots. If the target file already exists, `writeIfMissing` semantics: keep the committed copy, skip that slot's write (this also preserves teammate edits).
4. `update(key, undefined)` for every touched key incl. legacy variants — defensive deletion always runs.
5. Idempotent; no prompt.

## Tests

- `src/test/extension/hexScopeStorage.test.ts` — read/missing/corrupt/unknown-version envelope, self-heal-on-changed-only, debounce-flush, slot independence, ordinal profile-dir creation/lookup/rename-survival, `writeIfMissing` migration, memento key deletion (fake context), `.hexscope` fully-tracked (no gitignore seeding).
- Webview: reducer tests for `structsExternalChange` (pin-prune), `perFileDataChange`; `endianOrDefault` single-home test.
- Watcher-conflict test: external file edit auto-applies; host self-write does not re-trigger.

## Rollback / compatibility

- Fresh branch from `main`. Old branch (`feat/hexscope-fs-storage`) stashed/unpushed, never landed — discarded layout has no downstream.
- Migration is the only behavior with cross-version reach (deletes old Memento keys). It runs at first panel open and is idempotent + writeIfMissing-guarded.
- Forward protection: unknown envelope version is never overwritten (corrupt path), so a future schema bump cannot clobber data this release doesn't understand.

## JSON Schemas (editor + agent contract)

### Schema files

`schemas/{index,structs,integrity}.schema.json` in the repo, bundled into the VSIX and registered in `package.json`:

```json
"jsonValidation": [
  { "fileMatch": ".hexscope/firmware_profiles/*/index.json",     "url": "./schemas/index.schema.json" },
  { "fileMatch": ".hexscope/firmware_profiles/*/structs.json",   "url": "./schemas/structs.schema.json" },
  { "fileMatch": ".hexscope/firmware_profiles/*/integrity.json", "url": "./schemas/integrity.schema.json" }
]
```

pattern `additionalProperties: false` strict required fields: `version` const 1, `StructFieldType` enum, `IntegrityAlgorithm` enum, `endian` enum, nested object strict; payload-row root tolerant extendable.

`$schema` **sibling persisted on every profile file** so terminal AI agents (and editors where globs don't reach) resolve the contract from the file itself:

```
.hexscope/schemas/index.schema.json          <- workspace copy (seeded)
.hexscope/firmware_profiles/<id>/index.json  <- "$schema": "../../schemas/index.schema.json"
```

- `writeJson`/`JsonStore.flush` **always re-injects the canonical `$schema`** (`../../schemas/<name>.schema.json`, relative posix path from the profile file) into the **envelope level** (`{ version, data, $schema }`), never into `data`. The canonical value is written unconditionally on every profile-file write — there is **no round-trip preservation** of any user-authored different `$schema` value: a non-canonical sibling in the file is replaced on the next write (self-heal included).
- All normalizers (`normalizeIndexFile`, structs, integrity) must **carry `$schema` through** so self-heal write-back preserves it (the changed-compare already compares `JSON.stringify(value, raw)`; if `$schema` is part of `value`, it is never stripped).
- Seeding: on first profile creation (`createProfile`), write the three schema files into `.hexscope/schemas/` if absent (`writeIfMissing`-style; self-write-marked so the watcher ignores). Seed matches the schema the extension ships (schema-version drift deferred until a real bump).
- Repo+VSIX copy is the source of truth authors; workspace copy is a cache. The ajv drift-guard test anchors the repo copy to the TS types.