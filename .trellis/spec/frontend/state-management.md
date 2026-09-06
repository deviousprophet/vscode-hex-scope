# State, Persistence, and Invalidation

## State Owners

- `src/webview/state.ts`: `S`, default values, and state types.
- `src/webview/appModel.ts`: shared state transitions for init, parsed memory, labels, external-change lock, and edit clearing.
- `src/webview/webviewMessageModel.ts`: provider-message reducers returning `WebviewInvalidations`.
- `src/hexEditorSession.ts`: host-side file/session state and the per-session `.hexscope` profile stores; `src/hexScopeStorage.ts` owns the I/O.
- Integrity and struct modules own feature-local transient UI state but persist through typed protocol messages.
- `S.labelDraft` (`LabelDraftPreview | null`) is a host-owned transient grid preview (same category as `S.integrityHighlight`): the Inspector panel reports it via `onLabelDraftChange`; `hexViewer.ts` stores it and `memoryGrid.paintMemoryLabelDraft()` repaints it (also after every slice re-render). It is never persisted.

## Core Invariants

- `S.parseResult` is the source for records and segments; `S.segmentIndex` and `S.memRows` are derived and rebuilt together.
- `S.edits` overlays parsed bytes. `getByteAt`/`getByte` must prefer pending edits without mutating source segments.
- A selection is inclusive (`start`, `end`) with `start <= end`.
- External changes lock editing until reload/repair resolution.
- `clearEditModel()` clears pending edits and undo/redo history together.
- Provider `savedEdits` (light, no `parseResult`) folds pending edits into local segment bytes, clears the overlay, and keeps undo/redo/edit mode so a save is reversible (Ctrl+Z); legacy `parseResult` payloads still reload parsed memory and clear edit state.

## Provider Message Flow

```text
VS Code/file/storage
  -> HexEditorSession
  -> ProviderToWebviewMessage
  -> dispatchProviderMessage
  -> applyProviderMessageToModel
  -> WebviewInvalidations
  -> hexViewer DOM effects
```

Reverse flow uses `WebviewToProviderMessage` through `postProviderMessage`. The discriminated unions in `src/webviewProtocol.ts` are the single contract owner.

## Persistence Scope

- Per-firmware-document state (labels, segment name overrides, struct pins, active integrity check set, endian) lives in the file's **bound `ProfileRecord`** inside `.hexscope/profiles.json`, keyed by a `bindings.json` entry (`fileKey → profileId`).
- Shared/global state (struct definitions) lives in the workspace pool `.hexscope/structs.json`; integrity profiles were removed — checks live only as `activeChecks` inside a `ProfileRecord`.
- Single-file profile registry: `.hexscope/profiles.json` holds the whole `ProfileRecord[]` array (one file for all profiles, order preserved, ids unique). No per-profile directories.
- Host adapter: `src/hexScopeStorage.ts` owns all `.hexscope/` I/O (envelope read/write, per-slot `JsonStore`, registry-array lookup/upsert/delete, watcher). Normalization functions are injected per slot from the owning module.
- Per-session wiring: `src/hexEditorSession.ts` opens the root `registryStore: JsonStore<ProfileRecord[]>` + pool store, applies per-file mutations through `withBoundProfile(patch)` (materialize when unbound; in-memory `boundProfileCache` for out-of-workspace non-explicit; explicit Save materializes), and broadcasts genuine external edits to the webview (silent auto-apply — no prompt dialogs):

  - `profiles.json` bound-record changes → `perFileDataChange` (labels/segmentNames/pins/endian/activeChecks).
  - `profiles.json` / bindings registry changes → `profilesState` refresh (toolbar dropdown, `boundFileCount`).
  - `.hexscope/structs.json` (workspace pool) changes → `structsExternalChange`; the webview replaces `S.structs` and prunes pins whose `structId` vanished.

- Repositories are never read from browser feature logic — the webview only consumes typed `ProviderToWebviewMessage` slices.
- Schema-bearing values (`IntegrityProfile`, `IntegrityCheckSet`) must be normalized from `unknown` before use; `endianOrDefault` in `src/webviewProtocol.ts` is the single shared endian normalizer (session + webview model); `normalizeProfilesRegistry` in `src/hexScopeStorage.ts` is the single registry normalizer.
- Struct migration/deduplication belongs in `src/core/structMigration.ts` (`migrateStructDefinitions`, `normalizeStructDefsValue`, `mergeLegacyStructDefs`), shared by the session and `src/hexScopeMigration.ts` — not in render code.
- Legacy Memento keys (global structs v2/v1 + per-file keys, integrity profiles, per-file labels/names/pins/checks/endian) are migrated once per workspace root by `src/hexScopeMigration.ts` and then hard-deleted; the per-dir `profiles/<id>/` registry merges into `profiles.json` once (Memento marker).

## WebviewToProviderMessage additions (profile actions)

`saveProfile` (explicit flush; materializes out-of-workspace), `duplicateProfile` (Save as…: copies the bound profile, binds the current file to the copy), `renameProfile`, `deleteProfile` (confirms with bound-file count). All run inside `enqueuePerFileOp` and end with `broadcastPerFileData()` + `broadcastProfilesState()`.

## On-disk JSON Schema contract

- Three strict JSON Schemas describe the `.hexscope/` on-disk shapes so editors and AI agents can validate/author team state: `schemas/{profiles,structs,bindings}.schema.json` in the repo (bundled in the VSIX) and seeded into `.hexscope/schemas/` on the first registry write.
- Every storage file is envelope `{ version: const 1, data, $schema? }`; `$schema` is a **relative path** to the workspace-seeded schema copy (`schemas/<name>.schema.json`) so terminal agents resolve the contract from the file itself. `readJson` unwraps the envelope before normalizing, so normalizers never see `$schema`; `writeJson` re-injects the canonical sibling on every write — self-heal cannot strip it.
- Editors bind via `contributes.jsonValidation` globs (`.hexscope/profiles.json`, `.hexscope/structs.json`, `.hexscope/bindings.json`). Schemas are **strict for authoring** (`required` everywhere, enums for struct types / integrity algorithms / endian, nested `additionalProperties: false`, `profiles.json` data is an array with `uniqueItems`), but the runtime **remains lenient** — normalizers tolerate the extra fields the schema flags, corrupt/unknown-version files load empty + warn once, never overwrite. Id/name uniqueness beyond exact duplicates is runtime-enforced by `normalizeProfilesRegistry`.
- Drift guard: `ajv` (devDependency, test-only) validates fixtures in `src/test/schemas/schemaValidation.test.ts`, pinned to `DATA_VERSION` and the source enum consts.

## Update Pattern

```typescript
const update = applyProviderMessageToModel(msg);
applyModelUpdateEffects(update);
applyInvalidations(update.invalidations);
```

When adding state:

1. Choose one owner.
2. Add a typed transition.
3. Enumerate all derived state to rebuild.
4. Return narrow invalidations.
5. Test the transition without requiring full DOM where possible.

## Anti-patterns

- Mutating source segment arrays when staging edits.
- Updating derived rows/index in only one message path.
- Persisting raw UI drafts instead of validated domain types.
- Reading VS Code storage directly from browser feature logic.
- Re-parsing the same provider payload with local assertions in multiple consumers.
- Scattered `if/else` message transitions instead of the typed applier map.

## Test Anchors

- `src/test/webview/webviewMessageModel.test.ts`
- `src/test/webview/webview.test.ts` (`initFlatBytes`, defaults, memory rows)
- `src/test/core/provider-utils.test.ts` (format detection and struct migration)
- `src/test/extension/hexScopeStorage.test.ts` (storage slots, envelopes, migration, watcher)
- `src/test/webview/integrityCheckModel.test.ts`
- `src/test/webview/structPinsModel.test.ts`
