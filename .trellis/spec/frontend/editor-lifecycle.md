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
    | { type: 'diffError'; generation?: number; message: string }
    | { type: 'diffProgress'; stage: 'read' | 'parse' | 'diff'; completed: number; total: number }
    | { type: 'diffExternalChange'; generation: number; a: DiffSide; b: DiffSide; diff: DiffModel }
    | { type: 'diffExternalChangeError'; generation: number; side: 'a' | 'b'; checksumErrors: number; malformedLines: number; canQuickRepair: boolean };

type DiffWebviewToProvider =
    | { type: 'ready' }
    | { type: 'copyText'; text: string; label?: string }
    | { type: 'reloadAccepted' }
    | { type: 'repairAndReload' }
    | { type: 'viewInNormalEditor' };

function diffMessageType(message: unknown): string | undefined;
function diffCopyText(message: unknown): string | null;
```

Union lives only in `src/diffProtocol.ts`; the webview dispatcher is `src/webview/diff/diffMessages.ts`. `DiffModel` lives in `src/core/diff.ts`.

### 3. Contracts

- Three commands are contributed in `package.json` (category HexScope) and listed only in the `hexScope.actions` submenu with `explorerViewletFocus`, so none appears in the editor title: `hexScope.selectAsFirst` (`Set as 1st file to compare`, `!listMultiSelection`), `hexScope.compareToStaged` (`Compare with the 1st file`, `!listMultiSelection && hexScope.hasCompareSelection`), `hexScope.compareSelected` (`Compare Two Files`, `listDoubleSelection`). The compare items use `group: "3_compare"` (VS Code's Explorer compare group) while `Open with HexScope` / `Quick Repair` stay in `group: "navigation"` — `navigation` always sorts first, so the submenu shows a compare category below the navigation category. `resourceLangId` describes only the clicked file, so each command re-validates the other file(s) itself. The dialog-based `hexScope.compareWith` and its `src/diff/diffPicker.ts` helpers are removed; there is no clear command.
- `CompareSelectionStore` (`src/diff/compareSelection.ts`) holds the session-only left/first candidate. `set(uri)` stores the basename and sets the `hexScope.hasCompareSelection` context key; `clear()` drops the candidate and unsets the key. There is no status-bar item. Nothing is persisted (no Memento).
- `selectAsFirst(uri)` warns `Select a firmware file in the Explorer` for a missing/unsupported resource, else stashes it and reports the next step.
- `compareToStaged(uri)`: pair = stash A/left, clicked file B/right (`stashedComparePair`); warns `Select a firmware file in the Explorer` when either is missing.
- `compareSelected(uri, selectedUris)`: deduped, supported files only; exactly two are required (`selectedComparePair`) — clicked file A/left, the other B/right. One or 3+ warns `Select exactly two firmware files`.
- `runCompare(pair, hint, deps)` validates both sides with `validateComparable`, then `await`s `DiffEditorPanel.open(context, a, b)`, and only after it resolves runs `onSuccess` (which clears the stash for `compareToStaged`). A failed validation **or** a thrown `open` keeps the stash (C2).
- The panel is a `WebviewPanel` in `vscode.ViewColumn.Active`, read-only (`enableScripts`, `retainContextWhenHidden`, `localResourceRoots`), titled `<a> ↔ <b>`.
- A = left file, B = right file. `added` = mapped in B only; `removed` = mapped in A only.
- Host reads both files, then parses each in its **own Node worker thread** (`src/diff/diffParseWorker.ts` → `dist/diffParseWorker.js`, one worker per side, spawned by `parseSideInWorker`) so a pair of similar files loads in roughly one file's parse time; the read bytes are transferred zero-copy. The host rejects any file with `checksumErrors > 0 || malformedLines > 0` (message points at Quick Repair) once the worker returns the wire result, and `computeByteDiff` wraps each `wire.segments[i].data` in a `Uint8Array` view.
- Diff parse worker messages: host → worker `workerData: { kind: 'diffParse'; bytes: ArrayBuffer; extension: string }` (bytes transferred). `kind` is the job sentinel: the worker module is import-safe (its test imports the pure helpers, so fallow sees a static edge) and runs its body only for that sentinel, since the test/extension host can itself be a worker thread (`parentPort` alone is not a reliable guard). Worker → host `{ type: 'progress'; fraction }` (one monotonic `[0,1]` fraction for that file — the parser's `parse` scan fills `[0, 0.9]`, `build` fills `[0.9, 1]`, clamped to a running max so a stage restart never regresses; **throttled to integer percent** — post only when `Math.floor(fraction * 100)` strictly advances past the last emitted percent, ≤101 posts per file, never time-based — because the parser reports once per source line and the host's single main thread draining those posts serializes the two workers), `{ type: 'result'; format: HexScopeFormat; wire: WireParseResult }` (every segment `ArrayBuffer` transferred, produced by `serializeParseResult` in `src/core/wire.ts`; never throttled), or `{ type: 'error'; message }`. Job-shape validation runs inside the async entry, so a bad job posts `{ type: 'error' }` instead of crashing the thread. An abort terminates the worker.
- Webview sends `ready`; the host loads both sides concurrently (`Promise.all`) and streams throttled `diffProgress` (`read` → `parse` → `diff`), then responds with one `diffInit` (generation-stamped) or `diffError`. Each file contributes a fraction in `[0,1]` — its read fills a small leading slice (`0 → 0.05`, `READ_SHARE`) and its parse the rest (`0.05 → 1` via `READ_SHARE + (1 - READ_SHARE) * advanceFraction(running, workerFraction)`) — so `parse` never regresses below the read fraction. The read slice is deliberately small (0.05, not 0.5) because reading is fast and posts no intermediate progress: a half-bar reservation made the bar jump straight to 50% and then crawl, instead of tracking the dominant parse. `completed = combinedLoadProgress([fractionA, fractionB])` (`src/diff/loadProgress.ts`, clamped sum; `advanceFraction` keeps each file monotonic) with `total = 2`: monotonic even when the two files' reports interleave. Stage is `read` while any file is still ≤ `READ_SHARE` (0.05), else `parse`; `diff` brackets `computeByteDiff` (`0 → 1`).
- Cleanup is registered before any await: `panel.onDidDispose` → `DisposableStore.dispose()`; disposal sets `disposed` and aborts the `AbortController`; a load whose generation is stale or disposed posts nothing.
- External change (C6/R8): after registration and before the first await, `DiffEditorPanel.open` adds one `FileSystemWatcher` per compared URI (`RelativePattern` on the file's dir + basename) to the same `DisposableStore`. `onDidChange`/`onDidCreate` set a 200 ms debounce (coalescing both sides), re-read + re-parse **only** the changed side(s) (`readDiffSource` + `parseSideInWorker`, the other side reused), then: on checksum/malformed → post `diffExternalChangeError` with `side` and `canQuickRepair = malformedLines === 0`; else recompute the diff (`reloadState`) and post `diffExternalChange` with a bumped generation. Stale reloads (`reloadIsStale`: disposed/older generation/base state replaced) post nothing; a read failure keeps the last loaded bytes. `reloadAccepted` is a host no-op (the post already carries the payload); `repairAndReload` repairs the last broken URI's checksums in place (self-write suppressed by `SELF_WRITE_HORIZON_MS`), then reloads that side; `viewInNormalEditor` opens the broken URI with `showTextDocument`. The diff host never writes the compared files except through the repair path. Decision D1: banner-and-click — `diffExternalChange` shows the reused `ExternalChange.showReload` (webview applies the pending pair locally via `applyReload` and posts `reloadAccepted`); `diffExternalChangeError` shows `showError` (`Quick Repair & reload` / `View in text editor`). The diff is read-only, so no conflict/unsaved-edit banner. `applyReload` preserves `viewMode` and each pane's top-address scroll anchor (nearest row when gone), and resets selection + search matches (addresses may have shifted).
- The panel shell renders the shared `.loading-*` card (`#diff-loading`) inside `#app`; `#diff-root` (the two-row toolbar + grids + error card) is hidden until `diffInit`, and `diffError` also hides the loading card. `diffProgress` updates the card's text only (`Loading <stage> <pct>%…`, raw stage names); the bar is the shared indeterminate animation, never width-driven.
- The diff bundle is isolated: two-row toolbar + two grids + always-visible search bar only. It never imports the single-file app shell (`state.ts`, sidebar, toolbar, integrity, scripts).
- Diff grids render hex only: `showAscii:false` (no decoded-text label, no char cells).
- Both panes render their own address gutter and are separated by a static 3px `.diff-split`; the error card and body are gated on `[hidden]` so a short pair never leaves a blank lower half.
- The webview owns one mirrored read-only selection: `HexView` click/drag/address-gutter callbacks repaint both panes, and `Ctrl+C` posts `copyText` with the **source pane's** mapped bytes only (unmapped addresses skipped, never zero-filled); the panel answers with `vscode.env.clipboard.writeText` via `diffCopyText`.
- The action bar is two rows of icon+text buttons (`title` + `aria-label`, `inline-flex`/26px high/auto width, a `aria-hidden` Unicode glyph span + a visible text span — no codicon font): row 1 left `≡ Show all` / `≠ Show diff` then `▲ Prev diff` / `▼ Next diff`, row 1 center `⇄ Swap sides` (on the pane split), row 1 right the always-visible search bar; row 2 left `⇅ Sync scroll`, row 2 center the changed/added/removed stat. `Show diff` filters to rows containing a diff byte and shows `No differences` when empty; `Sync scroll` defaults ON and gates only the follower mirror; `Swap sides` swaps panes/labels and recomputes the diff for the new base pair. Scroll-driven renders coalesce to one per animation frame and skip an unchanged slice.
- The `SearchBar` component is always mounted in the diff bundle (`src/webview/diff/diffSearch.ts`) — there is no `Find` button: one query runs over both sides' hydrated segments, addresses are unioned/deduped, both grids paint from render-input `matchSet`/`activeMatch` (expanded by the executed needle span), and next/prev walk the union (modulo wrap) while scrolling both grids. The diff host matches the hex host: repeat-Enter on an unchanged completed query navigates instead of re-running, `onProgressUpdate` streams matches (paint + count + one-time first jump), the active match is selected, a UI-only change drops matches only when `isSearchDiverged` (empty query counts), and `mountDiffSearch` re-pushes the count after a toolbar re-render. `Ctrl+F` focus/select stays in the component. The component stays host-agnostic — no `S`, no direct engine calls; both hosts share the pure decisions in `src/webview/search/searchNavigation.ts`.
- Side heads render the disambiguated `<name>` plus the shared `.fmt-pill` format (no `·` separator).
- `DiffSide.path` carries the full path: pane labels use `disambiguatedLabels` (basename, upgraded to the shortest distinct trailing suffix on collision) with the full path as `title`, and the panel tab title uses the same labels.
- `DiffEditorPanel` owns no persistence, watchers, profiles, or `.hexscope/` state.

### 4. Validation & Error Matrix

| Condition | Required response |
|---|---|
| `Set as 1st file to compare` with no/unsupported resource | Warn `Select a firmware file in the Explorer`; no stash, no panel. |
| `Compare with the 1st file` with no stash or no clicked resource | Warn; open nothing. |
| `Compare Two Files` with 1 or 3+ selected, or an unsupported companion | Warn `Select exactly two firmware files`; open nothing. |
| Stashed file deleted/moved/invalid at compare time | `validateComparable` warns and opens nothing: unreadable (missing/moved/folder) names the file; checksum/malformed offers Quick Repair. The stash is kept because no compare opened. |
| Either file has checksum/malformed errors | No compare; message names the file and says to run Quick Repair. |
| File read/parse throws | Post `diffError`; webview renders the error card, hides the body, hides the loading card. |
| Unknown webview message | `diffMessageType` returns undefined; ignored. |
| Malformed `diffProgress` (bad stage/non-number fields) | `dispatchDiffMessage` returns false; card untouched. |
| Panel disposed mid-load / superseded generation | Post nothing; abort active parse. |
| Identical files | `diffInit` with an empty summary and run list; grids render plain; `Show diff` shows `No differences`. |
| Address gaps / differing formats | Union row model; gap rows / empty cells; no synthetic zero bytes. |
| `copyText` with a non-string `text` / unknown browser message | `diffCopyText` returns null; clipboard untouched. |
| Selection covers unmapped addresses | Mirrored range paints on both panes; copy emits only the source pane's mapped bytes. |
| `Swap sides` | Panes, heads, counts, and `added`/`removed` colors follow the new base pair. |

### 5. Good/Base/Bad Cases

- Base: `Set as 1st file to compare` on a valid Explorer file → `Compare with the 1st file` on a second valid file → panel tab → loading card with advancing `diffProgress` → `diffInit` → aligned grids + toolbar.
- Good: self-compare yields zero changed/added/removed.
- Good: `Show diff` on a pair differing in two places frames each run with `Prev`/`Next` while keeping the filtered mode.
- Good: `Ctrl+C` after selecting in the right pane copies the right file's bytes, not the left pane's.
- Good: a failed comparison swaps the loading card for the error card; the grids never render.
- Bad: the diff webview imports `state.ts` or posts single-file messages; the host writes `.hexscope/` from the diff panel.
- Bad: dispatching `(handlers as any)[msg.type]` instead of the typed dispatcher.

### 6. Tests Required

- `src/test/extension/extension.test.ts`: the three compare commands are registered (`hexScope.compareWith`, `hexScope.selectForCompare`, `hexScope.compareWithSelected`, `hexScope.compareSelectedFiles`, and `hexScope.clearCompareSelection` are gone); the `hexScope.actions` manifest gate (`3_compare` group holds only those three, each `when` carries `explorerViewletFocus` and its selection-count clause, no other menu point lists a compare command, `navigation` keeps only Open with HexScope / Quick Repair); `CompareSelectionStore` set/clear lifecycle (`src/diff/compareSelection.ts`); `selectedComparePair` clicked-file-is-A ordering plus 1/3+/unsupported rejection; `stashedComparePair` stash-first ordering; `runCompare` validation-failure opens nothing and clears the stash only on success; `selectAsFirst` warns without a supported resource; and `diffCopyText` payload parsing with a real clipboard round-trip plus `diffMessageType` recognizing `diffProgress`/`diffInit`.
- `src/test/core/diff.test.ts`: `computeByteDiff` identical / one changed / added-only / removed-only / gaps / adjacent-run merge / empty / address 0 / last-byte, plus `disambiguatedLabels`.
- `src/test/core/diffLoadProgress.test.ts`: `combinedLoadProgress` sums the two per-file fractions, clamps an out-of-range input, never exceeds `total` (2) or goes negative, and stays monotonic when one file advances while the other holds and when the two files' reports interleave; `advanceFraction` never decreases, clamps out-of-range, and keeps the combined value monotonic across a scan→build stage switch.
- `src/test/core/diffParseWorker.test.ts`: spawns the compiled worker for a tiny IHEX and a tiny SREC fixture and asserts `format`, transferred segment bytes, monotonic progress bounded to ≤101 integer-percent messages, and error propagation for an invalid parse job.
- `src/test/webview/diffViewer.test.ts`: shared union row model + address alignment, changed marking on both sides, added empty-on-A, removed empty-on-B, computed summary counts + exact action-button order with per-button glyph span + text span + tooltips, the two-row toolbar grouping, prev/next traversal + end stops + modulo wrap, repeat-Enter navigation with no second engine run, same-key keep vs diverged drop, a streamed progress batch, count survival across a summary re-render, vertical + horizontal scroll sync + sync-off gate + render coalescing/unchanged-slice skip, decoded-text hidden, addresses on both panes, error-state card + hidden body, always-visible `SearchBar` (no `Find` button) + `Ctrl+F`, a real query over both panes (union/dedupe, needle span, next walk), mirrored click/shift-click/address-gutter selection + source-pane copy, `Show diff` filtering + `No differences`, `Swap sides` color/count flip, the format pill (`renderSideHeadHtml`, no separator), `applyDiffProgress` card updates, unknown-malformed-message rejection, the external-change reload (dispatcher routes/rejects the two new messages, reload banner shown + accept applies the pair and posts `reloadAccepted`, view mode + scroll anchor kept, selection/search reset, error banner posts `repairAndReload`/`viewInNormalEditor`), and a stylesheet guard for the `[hidden]` rules, the 3px splitter, and the removed `.diff-hide-addr`.
- `src/test/core/diffReload.test.ts`: `sideDefects` (clean null, checksum-only quick-repairable, malformed blocks repair), `buildDiffState` (both refs + diff), and `reloadState` (only the changed side replaced, diff recomputed).

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
