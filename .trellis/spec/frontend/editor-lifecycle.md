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
- Webview sends `ready`; session reports generation-bearing load progress, then responds with `init` containing binary segments, record count, labels, structs, pins, endian, and integrity profiles/checks.
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
- `src/test/webview/webview-message-model.test.ts`: unknown-message rejection, known dispatch, init and invalidations.
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
