# Design — `.hexscope/` File Storage

## Module: `src/hexScopeStorage.ts` (host adapter)

**Placement**: `src/core/` is forbidden from importing `vscode` (directory-structure.md). Storage I/O (`vscode.workspace.fs`, `createFileSystemWatcher`) lives in a host adapter at the top level, mirroring `src/scriptHost.ts`. Pass normalization functions in from `hexEditorSession.ts` so existing validation logic stays put and injectable in tests.

Single owner of `.hexscope/` I/O. No Memento access here.

### Root & relative-path resolution

```ts
export function resolveHexScopeRoot(uri: vscode.Uri): string {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    return folder ? folder.uri.fsPath : path.dirname(uri.fsPath);
}
// rel = path.relative(root, uri.fsPath)  ->  posix separators, e.g. "firmware/boot.hex"
// storeFile = path.join(root, '.hexscope', 'data', rel + '.json')
// localFile = path.join(root, '.hexscope', 'local', rel + '.json')
```

Used for data/local per-file paths. Global files: `<root>/.hexscope/structs.json`, `<root>/.hexscope/integrity.json`.

### I/O primitives (use `vscode.workspace.fs` — remote-workspace safe, hooks FileSystemWatcher)

```ts
async function readJson(file: string): Promise<{ ok: true; value: unknown } | { ok: false; reason: 'missing' | 'corrupt' }>
async function writeJson(file: string, value: unknown): Promise<void>  // mkdirp, JSON.stringify(, null, 2)
```

`corrupt` = `readFile` throws (non-ENOENT) or `JSON.parse` throws.

### Store class per file slot

```ts
class JsonStore<T> {
    private cache: T | null;              // normalized in-memory truth
    private timer: ReturnType<typeof setTimeout> | null;
    private writePending = false;
    private corruptNotified = false;
    constructor(file, normalize: (raw: unknown) => { value: T; changed: boolean }, onReload: (value: T) => void)
    async load(): Promise<T>              // read -> normalize -> self-heal write-back (only if parse OK) -> cache
    mutate(next: T, opts): void           // set cache + scheduleDebounce; flush requires await
    async flush(): Promise<void>          // write cache; markSelfWrite; clear timer
    dispose(onPendingFlush: 'flush'|'drop')
}
```

Self-heal write-back only when `parse ok && changed`. On `corrupt`: `value = empty`, `changed = false`, warn once per file per session (`vscode.window.showWarningMessage`), never overwrite.

`onReload` callback is invoked by the watcher on genuine external change so the session can re-broadcast.

### Debounce

Per-slot timer, 400ms default. `mutate` resets only its own timer. `flush` on dispose. A slot's debounced write captures `cache` at flush time (await the timer callback; guard against disposal races).

### `.gitignore` seeding

First successful write to any path under `<root>/.hexscope/`: if `.hexscope/.gitignore` missing **and** the workspace `.gitignore` (or discovered gitignore chain) lacks `.hexscope/local`, write `.gitignore` with `local/`. Memoize per root (in-memory once-guard). Never re-write if user deleted the line.

### Watcher hook (`attachWatcher`)

`vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, '.hexscope/{structs,integrity}.json'))` plus per-file `data/`/`local/` patterns. Self-write timestamp check; debounce ~200–400ms; re-read + normalize; `onReload`.

## Session wiring (`src/hexEditorSession.ts`)

Replace all Memento reads/writes with store calls. Keep normalization function usage exactly where it is — only the backend swaps.

- `loadStructs` → structsStore.load() (keep `migrateStructDefinitions`/`mergeLegacyStructDefs` pipeline; now fed from file, self-heal writes file). Return both defs + whether reload pending for webview prompt.
- `loadIntegrityProfiles` → integrityStore.load().
- `loadIntegrityChecks`/`loadEndian` → load once from localStore (`activeChecks`, `endian`).
- `postInit`: read labels/segmentNames/pins/checks/endian from dataStore/localStore instead of `workspaceState.get`.
- `saveLabels`/`updateLabelVisibility`/`reorderLabel` → read-modify-write dataStore (single cached array; `mutate` with next labels/segmentNames). Serialize concurrent handlers through an in-session promise chain to avoid lost updates within a panel.
- `saveStructs` → normalize → structsStore.mutate.
- `saveStructPins`/`saveIntegrityChecks`/`saveEndian` → mutate localStore.
- `saveIntegrityProfiles` → integrityStore.mutate + existing broadcast.
- Disposal: every slot `flush()` (pending writes), then watchers/closed.

Load helpers keep their current contract so `broadcastIntegrityProfiles`/`sendIntegrityProfileError` don't change shape.

## External-change & webview protocol

New `ProviderToWebviewMessage` types (mirror hex-doc flow, keep `externalChangeError` for hex only):

- `{ type: 'externalDataChange'; structs?: { defs: StructDef[]; labels... }; kind: 'structs'|'integrity'; ... }` — actually, follow data per target:
  - `structs`: `{ type: 'structsExternalChange'; structs: StructDef[] }` + webview resets `S.structs` (struct panel prompts if mid-edit; mirror hexViewer reload lock pattern).
  - `integrity`: reuse `{ type: 'integrityProfiles'; profiles; error: '' }` broadcast — already supported by webview. No new prompt machinery needed; profiles list is read-mostly.
- `data`/`local` auto-apply: post `{ type: 'labelsExternalChange'; labels; segmentNames }` / re-send pins? Simplify: data+local changes auto-reload silently by posting refreshed values under existing message surface (`addLabel`-style replace is heavy). Add `{ type: 'perFileDataChange'; labels; segmentNames; pins; endian; activeChecks }` — one new message, webview replaces those slices.

Rationale: only `structs` is contended ("mid-edit clobber" risk). `StructDef` is the type a teammate's `git pull` can change under an active struct editor. Integrity profiles list → existing `integrityProfiles` broadcast (no prompt; panel lists refresh). Per-file auto-apply.

`pendingExternalReload`-style guard: webview tracks `editingStructId` in the struct panel; on `structsExternalChange` while editing, show confirm-reload dialog (reuse hex reload-accept UX). Implement host-side `reloadDataAccepted` handler mirroring `reloadAccepted`.

## Migration (`migrateLegacyData`, called in `resolveCustomEditor` before first `postInit`)

Per workspace root, once. In-memory guard keyed by fsPath.

1. Read: v2 structs, v1 structs, per-file `hexScope.structs.<uri>`, `hexScope.integrityProfiles.global.v1`, and per-file labels/names/pins/checks/endian (`workspaceState` keys for THIS uri, plus other hex/srec files under root? → **all per-document keys under this root**: iterate `context.workspaceState.keys()` matching the 5 per-file prefixes whose uri-derived path is under root — see design Q; simplest correct: migrate the currently-open uri always, and any sibling keys found in keys() that map under this root).
2. Normalize (existing fns).
3. Write via stores (marks self-write so watchers ignore).
4. `update(key, undefined)` for every key touched incl. legacy.
5. Skip file-write step if target file already exists (keep team's copy), but still delete old keys defensively.

Migration is idempotent; second open sees existing files → skip + defensive key cleanup.

## Tests

- `src/test/core/hexscopeFs.test.ts` — read/missing/corrupt/self-heal/ignored-corrupt/debounce-flush/slot-independence/gitignore-once. Use temp dir + mocked `vscode.workspace.fs`? Prefer real fs via temp workspace folder (vscode-test harness provides one) — tests run in extension host, `workspace.fs` is real.
- `src/test/core/providerUtils.test.ts` (existing struct-migration tests) — keep, add: migrate pipeline produces file writes + memento key deletion (fake `context` double with `globalState`/`workspaceState` maps).
- `src/test/webview/...` — new `externalDataChange`/per-file message reducers (webviewMessageModel-style), mirror `externalChange.test.ts`.
- Watcher-conflict test mirroring hex-file external-change tests.

## Rollback

Feature branch. Old Memento keys deleted at migration — recovery path: users on previous release still have data only if never migrated. Not an in-release rollback concern; migration is guarded and idempotent.