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

interface DiffSide { name: string; path: string; format: 'ihex' | 'srec'; parseResult: WireParseResult; labels: SegmentLabel[]; }

type DiffProviderToWebview =
    | { type: 'diffInit'; generation: number; a: DiffSide; b: DiffSide; diff: DiffModel }
    | { type: 'diffError'; generation?: number; message: string };

type DiffWebviewToProvider =
    | { type: 'ready' }
    | { type: 'copyText'; text: string; label?: string };

function diffMessageType(message: unknown): string | undefined;
function diffCopyText(message: unknown): string | null;
```

Union lives only in `src/diffProtocol.ts`; the webview dispatcher is `src/webview/diff/diffMessages.ts`. `DiffModel` lives in `src/core/diff.ts`.

### 3. Contracts

- Four commands are contributed in `package.json` (category HexScope) and listed only in the `hexScope.actions` submenu with `explorerViewletFocus`, so none appears in the editor title: `hexScope.selectForCompare` (`Select Compare`, `!listMultiSelection`), `hexScope.compareWithSelected` (`Compare Selected`, `!listMultiSelection && hexScope.hasCompareSelection`), `hexScope.clearCompareSelection` (`Clear Compare Selection`, same gate), `hexScope.compareSelectedFiles` (`Compare Selected Files`, `listDoubleSelection`). `resourceLangId` describes only the clicked file, so each command re-validates the other file(s) itself. The dialog-based `hexScope.compareWith` and its `src/diff/diffPicker.ts` helpers are removed.
- `CompareSelectionStore` (`src/diff/compareSelection.ts`) holds the session-only left/first candidate. `set(uri)` stores the basename, shows a left-aligned status-bar item (`$(diff) HexScope: <name>`, tooltip `<fullPath>\nClick to clear`, `command = hexScope.clearCompareSelection`) and sets the `hexScope.hasCompareSelection` context key; `clear()` drops the candidate, hides the item, and unsets the key. The store is registered in `context.subscriptions`; nothing is persisted (no Memento).
- `selectForCompare(uri)` warns `Select a firmware file in the Explorer` for a missing/unsupported resource, else stashes it and reports the next step (`runSelectForCompare`).
- `compareWithSelected(uri)`: pair = stash A/left, clicked file B/right (`stashedComparePair`); warns `Select a firmware file in the Explorer` when either is missing.
- `compareSelectedFiles(uri, selectedUris)`: deduped, supported files only; exactly two are required (`selectedComparePair`) — clicked file A/left, the other B/right. One or 3+ warns `Select exactly two firmware files`.
- `runCompare(pair, hint, deps)` validates both sides with `validateComparable` and opens `DiffEditorPanel.open(context, a, b)`; the stash clears only on a successful compare, so a failed validation keeps it.
- The panel is a `WebviewPanel` in `vscode.ViewColumn.Active`, read-only (`enableScripts`, `retainContextWhenHidden`, `localResourceRoots`), titled `<a> ↔ <b>`.
- A = left file, B = right file. `added` = mapped in B only; `removed` = mapped in A only.
- Host reads + compact-parses both files, rejects any file with `checksumErrors > 0 || malformedLines > 0` (message points at Quick Repair), computes `computeByteDiff(base.segments, other.segments)`, and serializes each side through `serializeParseResult` (`src/core/wire.ts`).
- Webview sends `ready`; host responds with one `diffInit` (generation-stamped) or `diffError`.
- Cleanup is registered before any await: `panel.onDidDispose` → `DisposableStore.dispose()`; disposal sets `disposed` and aborts the `AbortController`; a load whose generation is stale or disposed posts nothing.
- The diff bundle is isolated: summary/action bar + two grids + find bar only. It never imports the single-file app shell (`state.ts`, sidebar, toolbar, integrity, scripts).
- Diff grids render hex only: `showAscii:false` (no decoded-text label, no char cells).
- Both panes render their own address gutter and are separated by a static 3px `.diff-split`; the error card and body are gated on `[hidden]` so a short pair never leaves a blank lower half.
- The webview owns one mirrored read-only selection: `HexView` click/drag/address-gutter callbacks repaint both panes, and `Ctrl+C` posts `copyText` with the **source pane's** mapped bytes only (unmapped addresses skipped, never zero-filled); the panel answers with `vscode.env.clipboard.writeText` via `diffCopyText`.
- The action bar exposes `Prev diff`, `Next diff`, `Show all`, `Show diff`, `Swap sides`, `Find`, `Sync scroll` plus the changed/added/removed counts. `Show diff` filters to rows containing a diff byte and shows `No differences` when empty; `Sync scroll` defaults ON and gates only the follower mirror; `Swap sides` swaps panes/labels and recomputes the diff for the new base pair.
- `Find` reuses the `SearchBar` component in the diff bundle (`src/webview/diff/diffSearch.ts`): one query runs over both sides' hydrated segments, addresses are unioned/deduped, both grids paint from render-input `matchSet`/`activeMatch` (expanded by the executed needle span), and next/prev walk the union while scrolling both grids. The component stays host-agnostic — no `S`, no direct engine calls.
- `DiffSide.path` carries the full path: pane labels use `disambiguatedLabels` (basename, upgraded to the shortest distinct trailing suffix on collision) with the full path as `title`, and the panel tab title uses the same labels.
- `DiffEditorPanel` owns no persistence, watchers, profiles, or `.hexscope/` state.

### 4. Validation & Error Matrix

| Condition | Required response |
|---|---|
| `Select Compare` with no/unsupported resource | Warn `Select a firmware file in the Explorer`; no stash, no panel. |
| `Compare Selected` with no stash or no clicked resource | Warn; open nothing. |
| `Compare Selected Files` with 1 or 3+ selected, or an unsupported companion | Warn `Select exactly two firmware files`; open nothing. |
| Stashed file deleted/moved/invalid at compare time | `validateComparable` warns and opens nothing: unreadable (missing/moved/folder) names the file; checksum/malformed offers Quick Repair. The stash is kept because no compare opened. |
| Either file has checksum/malformed errors | No compare; message names the file and says to run Quick Repair. |
| File read/parse throws | Post `diffError`; webview renders the error card and hides the body. |
| Unknown webview message | `diffMessageType` returns undefined; ignored. |
| Panel disposed mid-load / superseded generation | Post nothing; abort active parse. |
| Identical files | `diffInit` with an empty summary and run list; grids render plain; `Show diff` shows `No differences`. |
| Address gaps / differing formats | Union row model; gap rows / empty cells; no synthetic zero bytes. |
| `copyText` with a non-string `text` / unknown browser message | `diffCopyText` returns null; clipboard untouched. |
| Selection covers unmapped addresses | Mirrored range paints on both panes; copy emits only the source pane's mapped bytes. |
| `Swap sides` | Panes, heads, counts, and `added`/`removed` colors follow the new base pair. |

### 5. Good/Base/Bad Cases

- Base: `Select Compare` on a valid Explorer file → status bar shows it → `Compare Selected` on a second valid file → panel tab → `ready` → `diffInit` → aligned grids + summary.
- Good: self-compare yields zero changed/added/removed.
- Good: `Show diff` on a pair differing in two places frames each run with `Prev`/`Next` while keeping the filtered mode.
- Good: `Ctrl+C` after selecting in the right pane copies the right file's bytes, not the left pane's.
- Bad: the diff webview imports `state.ts` or posts single-file messages; the host writes `.hexscope/` from the diff panel.
- Bad: dispatching `(handlers as any)[msg.type]` instead of the typed dispatcher.

### 6. Tests Required

- `src/test/extension/extension.test.ts`: the four compare commands are registered (`hexScope.compareWith` is gone); `CompareSelectionStore` set/clear lifecycle (`src/diff/compareSelection.ts`); `selectedComparePair` clicked-file-is-A ordering plus 1/3+/unsupported rejection; `stashedComparePair` stash-first ordering; `runCompare` validation-failure opens nothing and clears the stash only on success; `runSelectForCompare` warns without a supported resource; and `diffCopyText` payload parsing with a real clipboard round-trip.
- `src/test/core/diff.test.ts`: `computeByteDiff` identical / one changed / added-only / removed-only / gaps / adjacent-run merge / empty / address 0 / last-byte, plus `disambiguatedLabels`.
- `src/test/webview/diffViewer.test.ts`: shared union row model + address alignment, changed marking on both sides, added empty-on-A, removed empty-on-B, computed summary counts + exact action-bar order, prev/next traversal + end stops, vertical + horizontal scroll sync + sync-off gate, decoded-text hidden, addresses on both panes, error-state card + hidden body, a real `SearchBar` query over both panes (union/dedupe, needle span, next walk), mirrored click/shift-click/address-gutter selection + source-pane copy, `Show diff` filtering + `No differences`, `Swap sides` color/count flip, unknown-message rejection, and a stylesheet guard for the `[hidden]` rules, the 3px splitter, and the removed `.diff-hide-addr`.

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
