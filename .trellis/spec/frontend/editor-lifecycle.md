# Editor Session and Protocol Code-Spec

## Scenario: Open and coordinate one Hex Scope custom editor

### 1. Scope / Trigger

Applies to activation, custom-editor registration, `HexEditorSession`, webview bootstrap, host/browser messages, VS Code storage, clipboard, file watching, and panel-close behavior.

### 2. Signatures

```typescript
class HexEditorProvider implements vscode.CustomReadonlyEditorProvider {
    static readonly viewType = 'hexScope.hexEditor';
    static register(context: vscode.ExtensionContext): vscode.Disposable;
    openCustomDocument(uri: vscode.Uri, ...): Promise<vscode.CustomDocument>;
    resolveCustomEditor(document, panel, token): Promise<void>;
}

type ProviderToWebviewMessage = { type: 'init'; ... } | { type: 'loadError'; ... } | ...;
type WebviewToProviderMessage = { type: 'ready' } | { type: 'saveEdits'; ... } | ...;
function dispatchProviderMessage(message: unknown, handlers: ProviderMessageHandlers): boolean;
```

Full union lives only in `src/webviewProtocol.ts`.

### 3. Contracts

- Extension activation registers the custom editor and all contributed commands from `package.json`.
- Provider uses `retainContextWhenHidden: true` and does not support multiple editors per document.
- Webview sends `ready`; session reports generation-bearing load progress, then responds with `init` containing binary segments, record count, labels, structs, pins, endian, bit-field allocation, and integrity profiles/checks.
- `HexEditorSession` owns file I/O, parsing, watchers, VS Code persistence, clipboard, and host-side profile/definition migration.
- `hexViewer.ts` owns browser composition. It dispatches known provider messages, applies model transitions, then DOM invalidations/effects.
- Unknown/malformed provider message types return `false` and cause no handler execution.
- Segment bytes cross the webview seam as exact `ArrayBuffer` values and hydrate to `Uint8Array` in the browser. Record details remain host-side and cross only in aligned 512-record pages.
- Every load and record page carries a generation. Browser and host ignore stale generations after replacement, save, repair, external reload, or disposal.
- Panel disposal aborts active parsing, clears page/document ownership, and prevents later posts.
- Register complete panel cleanup before awaiting file reads or parsing. Early cancellation and invalid-document redirects release the same resources as a fully initialized panel.
- Own panel-scoped subscriptions, watchers, timers, and cleanup callbacks in one idempotent `DisposableStore`; disposal runs callbacks once in reverse registration order.
- Webview state needs no unload-time clearing: destroying the panel destroys the iframe realm. Host-side `_panels`, raw source, compact parse result, and pending reload references are the surviving ownership boundary to clear.
- `postToActive` is best-effort and targets only the currently active Hex Scope panel.

### 4. Validation & Error Matrix

| Condition | Required response |
|---|---|
| File read/parse cannot initialize | Send `loadError`; render safe error UI. |
| File contains checksum/malformed errors | Preserve parse details; use external/error or repair flows, not silent acceptance. |
| Unknown browser message | Ignore; no unchecked dynamic call. |
| Unknown provider message | `dispatchProviderMessage` returns false. |
| Persisted profiles/checks malformed | Normalize/drop invalid entries; report profile error when relevant. |
| Legacy struct definitions overlap global IDs/names | Deduplicate during migration. |
| Panel disposed | Abort active load; dispose watcher/listeners; drop raw/parsed state and active-panel ownership. |
| Panel disposed during initial load | Run the already-registered complete cleanup; do not retain the panel in `_panels`. |

### 5. Good/Base/Bad Cases

- Base: open supported file -> parse -> webview `ready` -> complete `init` -> full render.
- Good: new message adds one union variant, host sender/handler, dispatcher list, model applier, effects, and tests in one change.
- Bad: feature module reads VS Code storage directly from browser code.
- Bad: cast `unknown` to a message variant and dispatch its `type` as an object key.

### 6. Tests Required

- `src/test/extension/extension.test.ts`: activation and command registration.
- `src/test/webview/webviewMessageModel.test.ts`: unknown-message rejection, known dispatch, init and invalidations.
- `src/test/core/provider-utils.test.ts`: format detection and legacy struct migration.
- Any new discriminator needs host-to-browser or browser-to-host handling assertions and a no-op unknown-message assertion.
- Paging tests cover alignment, maximum page size, cache eviction, stale generations, and compressed record scrolling.
- `src/test/core/disposable-store.test.ts` covers once-only reverse-order cleanup and resources registered after disposal.
- `npm run profile:memory-release` allocates four 64 MiB panel payloads, disposes their resource stores, forces GC, and asserts `arrayBuffers` returns near baseline. Keep it separate from `npm test`; it is a resource profile, not a unit test.

### 7. Wrong vs Correct

#### Wrong

```typescript
(handlers as any)[message.type](message);
```

#### Correct

```typescript
const type = messageType(message);
if (!isProviderMessageType(type)) return false;
handlers[type](messageForKnownType);
```

Typed protocol is the interface/test surface; keep orchestration behind `HexEditorSession` and `webviewMessageModel`.

### Panel cleanup registration

#### Wrong

```typescript
const loaded = await loadInitialDocument();
panel.onDidDispose(cleanupEverything);
```

An early return before registration leaks host-side panel ownership.

#### Correct

```typescript
const resources = new DisposableStore();
panel.onDidDispose(() => resources.dispose());
resources.add(clearHostSessionState);
const loaded = await loadInitialDocument();
```

Optional late resources can be added safely; `DisposableStore.add()` disposes them immediately if the panel already closed.

## Scenario: Compare two firmware files in a read-only diff editor

### 1. Scope / Trigger

Applies to `HexScope: Compare with...`, `DiffEditorPanel`, `src/diffProtocol.ts`, and the isolated diff webview bundle (`src/webview/diffViewer.ts` → `dist/diffViewer.js`). This is the second editor surface; it does not reuse `HexEditorSession`.

### 2. Signatures

```typescript
class DiffEditorPanel {
    static readonly viewType = 'hexScope.hexDiff';
    static open(context: vscode.ExtensionContext, baseUri: vscode.Uri, otherUri: vscode.Uri): Promise<void>;
}

interface DiffSide { name: string; format: 'ihex' | 'srec'; parseResult: WireParseResult; labels: SegmentLabel[]; }

type DiffProviderToWebview =
    | { type: 'diffInit'; generation: number; a: DiffSide; b: DiffSide; diff: DiffModel }
    | { type: 'diffError'; generation?: number; message: string };

type DiffWebviewToProvider = { type: 'ready' };

function diffMessageType(message: unknown): string | undefined;
```

Union lives only in `src/diffProtocol.ts`; the webview dispatcher is `src/webview/diff/diffMessages.ts`. `DiffModel` lives in `src/core/diff.ts`.

### 3. Contracts

- `hexScope.compareWith` is contributed in `package.json` (category HexScope, editor title + command palette) and registered in `src/extension.ts`. It validates the active supported file with `parseResultIsValid`, prompts `showOpenDialog` filtered to `.hex .ihx .ihex .srec .mot .s19 .s28 .s37`, validates the pick, then calls `DiffEditorPanel.open`.
- The panel is a `WebviewPanel` in `vscode.ViewColumn.Active`, read-only (`enableScripts`, `retainContextWhenHidden`, `localResourceRoots`), titled `<base> ↔ <other>`.
- A = base (active) file, left; B = picked file, right. `added` = mapped in B only; `removed` = mapped in A only.
- Host reads + compact-parses both files, rejects any file with `checksumErrors > 0 || malformedLines > 0` (message points at Quick Repair), computes `computeByteDiff(base.segments, other.segments)`, and serializes each side through `serializeParseResult` (`src/core/wire.ts`).
- Webview sends `ready`; host responds with one `diffInit` (generation-stamped) or `diffError`.
- Cleanup is registered before any await: `panel.onDidDispose` → `DisposableStore.dispose()`; disposal sets `disposed` and aborts the `AbortController`; a load whose generation is stale or disposed posts nothing.
- The diff bundle is isolated: summary bar + two grids + prev/next only. It never imports the single-file app shell (`state.ts`, sidebar, toolbar, integrity, scripts).
- Diff grids render hex only: `showAscii:false` (no decoded-text label, no char cells).
- `DiffEditorPanel` owns no persistence, watchers, profiles, or `.hexscope/` state.

### 4. Validation & Error Matrix

| Condition | Required response |
|---|---|
| Active file unsupported / missing | Command returns without opening a panel. |
| Either file has checksum/malformed errors | No compare; message names the file and says to run Quick Repair. |
| File read/parse throws | Post `diffError`; webview renders the error card and hides the body. |
| Unknown webview message | `diffMessageType` returns undefined; ignored. |
| Panel disposed mid-load / superseded generation | Post nothing; abort active parse. |
| Identical files | `diffInit` with an empty summary and run list; grids render plain. |
| Address gaps / differing formats | Union row model; gap rows / empty cells; no synthetic zero bytes. |

### 5. Good/Base/Bad Cases

- Base: `Compare with...` on a valid file → pick a second valid file → panel tab → `ready` → `diffInit` → aligned grids + summary.
- Good: self-compare yields zero changed/added/removed.
- Bad: the diff webview imports `state.ts` or posts single-file messages; the host writes `.hexscope/` from the diff panel.
- Bad: dispatching `(handlers as any)[msg.type]` instead of the typed dispatcher.

### 6. Tests Required

- `src/test/extension/extension.test.ts`: `hexScope.compareWith` activation/registration (command contributed and registered; the pure command path is covered end-to-end by a fixture-driven test when a stubbed `showOpenDialog` is available).
- `src/test/core/diff.test.ts`: `computeByteDiff` identical / one changed / added-only / removed-only / gaps / adjacent-run merge / empty / address 0 / last-byte.
- `src/test/webview/diffViewer.test.ts`: shared union row model + address alignment, changed marking on both sides, added empty-on-A, removed empty-on-B, summary counts, prev/next traversal + end stops, vertical + horizontal scroll sync, decoded-text hidden, error-state card, unknown-message rejection.

### 7. Wrong vs Correct

#### Wrong

```typescript
const panel = vscode.window.createWebviewPanel(...);
const loaded = await parseBothFiles();       // panel not owned yet
panel.onDidDispose(() => panel.dispose());   // cleanup registered too late
```

#### Correct

```typescript
const panel = vscode.window.createWebviewPanel(...);
const resources = new DisposableStore();
resources.add(() => { disposed = true; controller.abort(); });
panel.onDidDispose(() => resources.dispose());
resources.add(panel);
const loaded = await parseBothFiles();
```

The diff panel mirrors the single-file editor's ownership rule: nothing survives disposal.
