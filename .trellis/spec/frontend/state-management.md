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

- Per-firmware-document state (labels, segment name overrides, struct pins, active integrity check set, endian) lives in the document's `.hexscope/firmware_profiles/<id>/index.json`.
- Shared/global state (struct definitions, integrity profiles) lives in the same profile dir as `structs.json` / `integrity.json` — one profile per document means shared defs are naturally per-firmware.
- Host adapter: `src/hexScopeStorage.ts` owns all `.hexscope/` I/O (envelope read/write, per-slot `JsonStore`, profile lookup/creation, watcher). Normalization functions are injected per slot from the owning module.
- Per-session wiring: `src/hexEditorSession.ts` opens the document's profile slots, applies mutations through `updateStore`, and broadcasts genuine external edits to the webview (silent auto-apply — no prompt dialogs):

  - `index.json` changes → `perFileDataChange` (labels/segmentNames/pins/endian/activeChecks).
  - `structs.json` changes → `structsExternalChange`; the webview replaces `S.structs` and prunes pins whose `structId` vanished.
  - `integrity.json` changes → the existing `integrityProfiles` broadcast.

- Repositories are never read from browser feature logic — the webview only consumes typed `ProviderToWebviewMessage` slices.
- Schema-bearing values (`IntegrityProfile`, `IntegrityCheckSet`) must be normalized from `unknown` before use; `endianOrDefault` in `src/webviewProtocol.ts` is the single shared endian normalizer (session slot + webview model).
- Struct migration/deduplication belongs in `src/core/structMigration.ts` (`migrateStructDefinitions`, `normalizeStructDefsValue`, `mergeLegacyStructDefs`), shared by the session and `src/hexScopeMigration.ts` — not in render code.
- Legacy Memento keys (global structs v2/v1 + per-file keys, integrity profiles, per-file labels/names/pins/checks/endian) are migrated once per workspace root by `src/hexScopeMigration.ts` and then hard-deleted.

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
