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
- Webview sends `ready`; session reports generation-bearing load progress, then responds with `init` containing binary segments, record count, labels, types, pins, endian, bit-field allocation, and integrity profiles/checks.
- `HexEditorSession` owns file I/O, parsing, watchers, VS Code persistence, clipboard, and host-side profile/definition migration.
- The single-file load runs its compact parse **off the extension-host thread**: `loadInitialDocument` and the external-change/quick-repair reload call `parseHexInWorker(raw, extension, signal, onProgress)` → `runParseJob({ kind: 'hexParse', source, extension })` (`src/parse/parseWorkerClient.ts`) and hydrate the returned `SerializedCompactParseResult`. The host holds `raw` (splicing, record pages, repair); the worker detects the format and reports it back. No host-thread `parseIntelHexCompact`/`parseSRecCompact` call remains in `HexEditorSession`. Segment + metadata-page buffers are transferred zero-copy; superseding a load, aborting the `AbortController`, or disposing the panel terminates the worker and posts nothing for the stale generation.
- **Raw `.bin` initial load** branches before UTF-8 decoding: `loadBinDocument` reads `workspace.fs.readFile` bytes (no `TextDecoder`, no worker), reports `read → build → transfer` progress, awaits the pending `.hexscope` migration, then calls `resolveOpenBinBaseAddress(uri, bytes.length)` from `src/binBaseAddress.ts`. The effective base is the file's `binBases` entry (explicit `0` included) when it still fits, else `0x00000000`; opening never prompts and never writes `.hexscope`, and maps the bytes with `createBinParseResult`. A stored value that no longer fits warns once, maps at 0, and leaves the entry untouched until the next field commit. The session keeps `raw` for text formats and a separate `binBytes` (aliasing `segments[0].data` until an external reload) plus the captured `baseAddress`.
- **Raw `.bin` save** writes `segments[0].data` through `workspace.fs.writeFile` after `applyBinEdits`; a failed write reverts the in-memory bytes and rethrows (or reports `scriptSaveFailed` for a script-owned save). No splice plan, checksum repair, or reparse runs.
- **Raw `.bin` external change** uses the generic gate (`createExternalChangeGate<DocumentSource>(..., sameDocumentSource)`), compares byte arrays, rebuilds `createBinParseResult(bytes, baseAddress)` at the same base, and posts `externalChange`; `reloadAccepted` installs the pending bytes. There is no `externalChangeError` path and `repairAndReload` returns early for `bin`.
- **Base-address ownership**: the base is per-file memory-map data in `bindings.json` (`binBases`), independent of profiles. It applies on open and on an explicit field commit only; switching profiles or editing the stored value externally does not re-anchor a live document (`D4`). Read failures fall back to `0x00000000`; write failures (including a forward-only newer-table decline, verified after the write) warn once and keep the chosen address for the session. No profile or binding is created by a base save.
- **Raw `.bin` base field**: the profile bar shows a **BASE ADDRESS** field after the profile picker for `.bin` files only (`src/webview/binBaseField.ts`). View mode shows the uppercase label (shared `.profile-label`), a read-only `0x%08X` value label (`#bin-base-value`, mono 11px bold), and an icon **Edit** (pencil) button that is `opacity: 0` until the field is hovered or focused, like the sidebar `.act-btn` row actions (always visible on no-hover/touch surfaces); the bordered address box is hidden. Edit mode replaces the value with one bordered `.addr-field` box — a fixed non-selectable `0x` prefix (`.addr-pfx`) plus an eight-digit uppercase input (`.addr-input`) flush inside the same border with no gap — and icon **Save** (check) / **Cancel** (X) buttons. The same `.addr-field` geometry backs the Integrity panel's Start/End/Stored inputs. The label, value/box, and icon buttons are vertically centered on the 31px profile-bar row (`align-items:center`, `line-height:1` text). A typed or pasted `0x`/`0X` prefix is stripped (the prefix is fixed chrome) so it never consumes digit slots, and the field always canonicalizes back to digits; a pasted address longer than eight digits stays visible and reports an error instead of being truncated into another address. **Edit** (or the `hexScope.setBinBaseAddress` palette command / `focusBinBaseAddress` message) enters edit mode and focuses/selects the digits; **Save**/Enter commits a valid changed value via `{ type: 'setBinBaseAddress', value }` and returns to view mode with the value label, an unchanged value just returns to view mode, **Cancel**/Escape reverts to the value label, and blur never commits or cancels. Invalid/non-hex/overflow/empty input shows the inline error, sets `aria-invalid` on the input and the error border on the shared field, and stays in edit mode with the box visible. **Edit** is disabled with a tooltip while `hasUnsavedEdits()` or `lockedDueToExternalChange`; a document becoming dirty/locked while editing reverts and exits edit mode. Each icon button carries `title` + `aria-label` (`Edit base address` / `Save base address` / `Cancel base address`); Save/Cancel are never faded — their `[hidden]` state covers view mode, and while editing they stay visible. A fresh mount (`init`/full re-render) starts in view mode with the value label and effective base. The stats bar never repeats the base. The shared `.tb-sep` is **2px** wide for both the profile ↔ Base Address and Memory/Records ↔ ASCII dividers. The command posts `{ type: 'focusBinBaseAddress' }` (falling back to an informational message when no panel is active) and is absent from the HexScope submenu. A refused focus shows the shared toast.
- **Raw `.bin` change flow**: the host guard requires `format === 'bin'`, present `binBytes`, and no `pendingExternalReload` (pending shows one warning and returns); it validates `isValidBinBaseAddress` + `binAddressRangeFits(value, binBytes.length)` and treats an unchanged value as a no-op. Inside `enqueuePerFileOp` it repeats that gate, calls `saveBinBaseAddress(uri, value)` (direct write + verify + one warning on decline/failure, which still re-anchors the session), sets `baseAddress`, replaces `parseResult = createBinParseResult(binBytes, value)`, bumps the generation, and posts a fresh `init`. The file is never rewritten, so labels, types, and checks keep their absolute addresses; no registry flush/load/rebind runs. `postToActive` returns whether an active panel received the request.
- `hexViewer.ts` owns browser composition. It dispatches known provider messages, applies model transitions, then DOM invalidations/effects.
- Unknown/malformed provider message types return `false` and cause no handler execution.
- Segment bytes cross the webview seam as exact `ArrayBuffer` values and hydrate to `Uint8Array` in the browser. Record details remain host-side and cross only in aligned 512-record pages.
- Every load and record page carries a generation. Browser and host ignore stale generations after replacement, save, repair, external reload, or disposal.
- Panel disposal aborts active parsing, clears page/document ownership, and prevents later posts.
- Register complete panel cleanup before awaiting file reads or parsing. Early cancellation and invalid-document redirects release the same resources as a fully initialized panel.
- Own panel-scoped subscriptions, watchers, timers, and cleanup callbacks in one idempotent `DisposableStore`; disposal runs callbacks once in reverse registration order.
- Webview state needs no unload-time clearing: destroying the panel destroys the iframe realm. Host-side `_panels`, raw source, compact parse result, and pending reload references are the surviving ownership boundary to clear.
- `postToActive` is best-effort, targets only the currently active Hex Scope panel, and returns whether a panel received the post (`false` drives the `setBinBaseAddress` informational fallback).

### 4. Validation & Error Matrix

| Condition | Required response |
|---|---|
| File read/parse cannot initialize | Send `loadError`; render safe error UI. |
| File contains checksum/malformed errors | Preserve parse details; use external/error or repair flows, not silent acceptance. |
| Unknown browser message | Ignore; no unchecked dynamic call. |
| Unknown provider message | `dispatchProviderMessage` returns false. |
| Persisted profiles/checks malformed | Normalize/drop invalid entries; report profile error when relevant. |
| Legacy type definitions overlap global IDs/names | Deduplicate during migration. |
| Panel disposed | Abort active load; dispose watcher/listeners; drop raw/parsed state and active-panel ownership. |
| Panel disposed during initial load | Run the already-registered complete cleanup; do not retain the panel in `_panels`. |
| `.bin` open with no stored base | Maps at `0x00000000`; no prompt and no `.hexscope` write. |
| `.bin` reopen with a stored base | Opens silently at the stored value (explicit `0` counts) when it still fits the file; no prompt, no write. |
| `.bin` stored base no longer fits the file (file grew) | Maps at `0x00000000`, field shows 0, one warning; the entry changes only on the next commit. |
| `.bin` binding-table read fails/corrupt | Effective base `0x00000000`; the editor stays usable and the next commit attempts a write. |
| `.bin` base save fails/declined | One warning; the session still re-anchors at the committed value. |
| Change base: text document / dirty / locked | Webview toast from the palette guard; **Edit** is disabled (dirty/locked), the value label stays read-only, and no provider message is sent. |
| Change base: view mode | Read-only `0x%08X` value label + icon **Edit** (revealed on field hover/focus, always visible on no-hover surfaces); the address box is hidden. |
| Change base: Edit/palette while clean | Enters edit mode, reveals the bordered box, focuses it, and selects the digits. |
| Change base: Save/Enter with a valid changed value | Posts one `setBinBaseAddress`; the field returns to view mode with the value label. |
| Change base: Save/Enter with an unchanged value | Returns to view mode with the value label; no message, no write. |
| Change base: Cancel/Escape | Reverts the draft and returns to the value label; no message. |
| Change base: blur while editing | No commit and no cancel; edit mode stays open with the box visible. |
| Change base: invalid/non-hex/overflowing/empty input | Inline error + `aria-invalid`; stays in edit mode with the box visible; no message. |
| Change base: dirty/locked arrives while editing | Draft is dropped, the box hides with the committed value in the value label, and the field exits edit mode. |
| Change base: pending external reload on the host | One warning; nothing re-anchors. |
| Change base: unchanged | No write and no reload. |
| Change base: accepted | The `binBases` entry persists (write + verify), the live buffer re-anchors at the new base, and a fresh `init` replaces the webview state; no profile/binding/registry write. |
| Change base: persistence declined/failed | One warning; the current session still re-anchors. |

### 5. Good/Base/Bad Cases

- Base: open supported file -> parse -> webview `ready` -> complete `init` -> full render.
- Good: new message adds one union variant, host sender/handler, dispatcher list, model applier, effects, and tests in one change.
- Bad: feature module reads VS Code storage directly from browser code.
- Bad: cast `unknown` to a message variant and dispatch its `type` as an object key.

### 6. Tests Required

- `src/test/extension/extension.test.ts`: activation and command registration; the three compare commands accept `.bin`; `.bin` is in the custom-editor selector and submenu host/open/compare gates but never the quick-repair gate.
- `src/test/extension/binBaseAddress.test.ts`: default 0 with no entry (open writes nothing), stored round-trip, explicit `0` counts as stored, same-value save no-op, overflow fallback to 0, corrupt/newer binding-table fallback, no profile/binding creation on save, compare and open agree, and the persistence-failure warning path.
- `src/test/webview/baseAddressChange.test.ts`: the shared guard refuses non-`bin`, dirty, and locked states and allows a clean raw document.
- `src/test/webview/binBaseField.test.ts`: `.bin`-only visibility, the uppercase `BASE ADDRESS` label, the read-only `0x%08X` value label + icon Edit in view mode (no visible box), edit mode's shared `.addr-field` box (fixed `0x` prefix inside the border, digit-only selection) + icon Save/Cancel, icon glyphs/tooltips/aria labels, Save/Enter commit (bare digits, a typed `0x`/`0X` prefix stripped back to digits, and a pasted `0x`/`0X` prefix) returning to the value label, over-long and malformed prefixed pastes that error instead of truncating with the box visible, an unchanged Save, Cancel/Escape revert, blur neither committing nor cancelling, invalid/overflow/empty inline errors that stay in edit mode, disabled Edit dirty/locked tooltips, a dirty/locked transition exiting edit mode, re-enable sync, a fresh mount starting in view mode, and CSS guards for `.tb-sep` 2px, the uppercase label, the shared `.addr-field`, the 22px icon buttons, the default-hidden pencil Edit with its hover/focus/no-hover reveal (and Save/Cancel staying unfaded).
- `src/test/webview/statsBar.test.ts`: raw stats are `BIN`/bytes/segments with no base or record count and no `#stats-base-change`; text formats keep the record count.
- `src/test/extension/extension.test.ts` also covers `hexScope.setBinBaseAddress`: contribution/title/category, palette-only (absent from every menu point), focus delivery, and the no-panel informational message.
- `src/test/webview/webviewMessageModel.test.ts`: unknown-message rejection, known dispatch, init and invalidations.
- `src/test/core/provider-utils.test.ts`: format detection and legacy type migration.
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

interface DiffSide { name: string; path: string; format: HexScopeFormat; parseResult: WireParseResult; labels: SegmentLabel[]; baseOverride?: boolean; }

type DiffProviderToWebview =
    | { type: 'diffInit'; generation: number; a: DiffSide; b: DiffSide; diff: DiffModel }
    | { type: 'diffError'; generation?: number; message: string }
    | { type: 'diffProgress'; stage: 'read' | 'parse' | 'diff'; completed: number; total: number }
    | { type: 'diffExternalChange'; generation: number; a: DiffSide; b: DiffSide; diff: DiffModel }
    | { type: 'diffExternalChangeError'; generation: number; side: 'a' | 'b'; checksumErrors: number; malformedLines: number; canQuickRepair: boolean }
    | { type: 'diffBaseChanged'; side: DiffSide };

type DiffWebviewToProvider =
    | { type: 'ready' }
    | { type: 'copyText'; text: string; label?: string }
    | { type: 'reloadAccepted' }
    | { type: 'repairAndReload' }
    | { type: 'viewInNormalEditor' }
    | { type: 'setDiffBaseAddress'; path: string; value: number }
    | { type: 'resetDiffBaseAddress'; path: string };

function diffMessageType(message: unknown): string | undefined;
function diffCopyText(message: unknown): string | null;
function diffBaseRequest(message: unknown): DiffBaseRequest | null;
```

Union lives only in `src/diffProtocol.ts`; the webview dispatcher is `src/webview/diff/diffMessages.ts`. `DiffModel` lives in `src/core/diff.ts`.

### 3. Contracts

- Three commands are contributed in `package.json` (category HexScope) and listed only in the `hexScope.actions` submenu with `explorerViewletFocus`, so none appears in the editor title: `hexScope.selectAsFirst` (`Set as 1st file to compare`, `!listMultiSelection`), `hexScope.compareToStaged` (`Compare with the 1st file`, `!listMultiSelection && hexScope.hasCompareSelection`), `hexScope.compareSelected` (`Compare Two Files`, `listDoubleSelection`). The compare items use `group: "3_compare"` (VS Code's Explorer compare group) while `Open with HexScope` / `Quick Repair` stay in `group: "navigation"` — `navigation` always sorts first, so the submenu shows a compare category below the navigation category. `Set Raw Binary Base Address` is palette-only (absent from the submenu). `resourceLangId` describes only the clicked file, so each command re-validates the other file(s) itself. The dialog-based `hexScope.compareWith` and its `src/diff/diffPicker.ts` helpers are removed; there is no clear command.
- `CompareSelectionStore` (`src/diff/compareSelection.ts`) holds the session-only left/first candidate. `set(uri)` stores the basename and sets the `hexScope.hasCompareSelection` context key; `clear()` drops the candidate and unsets the key. There is no status-bar item. Nothing is persisted (no Memento).
- `selectAsFirst(uri)` warns `Select a firmware file in the Explorer` for a missing/unsupported resource, else stashes it and reports the next step.
- `compareToStaged(uri)`: pair = stash A/left, clicked file B/right (`stashedComparePair`); warns `Select a firmware file in the Explorer` when either is missing.
- `compareSelected(uri, selectedUris)`: deduped, supported files only; exactly two are required (`selectedComparePair`) — clicked file A/left, the other B/right. One or 3+ warns `Select exactly two firmware files`.
- `runCompare(pair, hint, deps)` validates both sides with `validateComparable`, then `await`s `DiffEditorPanel.open(context, a, b)`, and only after it resolves runs `onSuccess` (which clears the stash for `compareToStaged`). A failed validation **or** a thrown `open` keeps the stash (C2).
- The panel is a `WebviewPanel` in `vscode.ViewColumn.Active`, read-only (`enableScripts`, `retainContextWhenHidden`, `localResourceRoots`), titled `<a> ↔ <b>`.
- A = left file, B = right file. `added` = mapped in B only; `removed` = mapped in A only.
- Host reads both files, then parses each in its **own Node worker thread** (`src/parse/parseWorker.ts` → `dist/parseWorker.js`, one worker per side, spawned by `parseSideInWorker` via `runParseJob`) so a pair of similar files loads in roughly one file's parse time; the read bytes are transferred zero-copy. The host rejects any file with `checksumErrors > 0 || malformedLines > 0` (message points at Quick Repair) once the worker returns the wire result, and `computeByteDiff` wraps each `wire.segments[i].data` in a `Uint8Array` view.
- **Raw `.bin` diff sides** read both files concurrently, then resolve each side's base concurrently through `resolveCompareBinBaseAddress(uri, byteLength)`: the file's stored `binBases` value when it fits, else `0x00000000`. There is no prompt, no cancellation branch, and no `.hexscope` write; `validateComparable` only stats the file. Each side's base is cached in the panel (`Record<DiffSideKey, number | undefined>`) and reused by external reloads; the comparison never re-anchors a live side. `readAndParseSide`/`parseSideInWorker` pass the cached base in `DiffParseJob.baseAddress`. Same-base images compare bytes directly; different bases produce address-aligned gap/added/removed rows with no synthetic zero fill. Both raw side heads render `BIN` plus `Base 0x%08X` from the wire `baseAddress`. `sideDefects` stays zero for raw sides, `repairChecksumsOnDisk` returns early for `bin`, and `repairAndReload` is never offered for a raw side.
- **Comparison-only base override** (`setDiffBaseAddress` / `resetDiffBaseAddress` / `diffBaseChanged`): a raw side head offers `Edit base`, which opens an inline fixed-`0x` + eight-digit input with `Apply`/`Cancel` (`src/webview/diff/diffBaseEditor.ts`). Apply validates with `parseBinBaseAddress(draft, side.parseResult.totalDataBytes)` (invalid/empty/overflow stays inline with `aria-invalid`), then posts `{ type: 'setDiffBaseAddress', path, value }` where `path` is the **displayed side's `side.path`** (never the pane key, because `Swap sides` is webview-only); Reset posts `{ type: 'resetDiffBaseAddress', path }`. The host resolves the side by matching `path` against `uriFor('a').fsPath` / `uriFor('b').fsPath` (unknown paths are ignored), re-validates `isRawBinaryExtension` + `isValidBinBaseAddress` + `binAddressRangeFits(value, liveByteLength)` against freshly read bytes, bumps `reloadGeneration[side]` (invalidating an in-flight reload for that side), sets `baseAddresses[side]` + `baseOverrides[side]`, re-reads/re-parses **only** that file, rebuilds via `reloadState(state, side, ref, parsed, override)`, and posts `diffBaseChanged { side }` with the rebuilt side. It must **not** post `diffInit`: the webview's swap order and view mode survive. Reset re-resolves the stored per-file base through `resolveCompareBinBaseAddress` (or 0) and clears the flag. Override state is panel-only: no `writeBinBase`/`saveBinBaseAddress` import, no profile/binding/`.hexscope` write, and the editor's saved base is untouched. An external reload reuses the cached (override) base and `reloadState`'s preserved flag; if the reloaded file makes it overflow the reload path keeps the last bytes. Swap sides closes an open editor (the override itself travels with the side data), a fresh `diffInit` resets the editor, and closing the panel discards every override. Text sides render no base controls.
- **Single-side update in the webview** (`diffBaseChanged`): `src/webview/diff/diffGrid.ts` exposes `replaceSideData(path, sideData): DiffModel | null`, which replaces the side whose `path` matches (the current pane order may be swapped), recomputes `computeByteDiff`, and re-renders through the `applyReload` path so view mode and each pane's scroll anchor survive; an unknown path returns null. `diffViewer.ts` hydrates the incoming side, replaces it by path, refreshes its mirrored `sides` from `currentSides()`, closes the inline editor, re-renders both heads, resets search matches (addresses may have shifted), and re-pushes the summary. `diffBaseChanged` is registered in `src/webview/diff/diffMessages.ts` (structural `DiffSide` guard) and in `diffViewer.ts`.
- The diff webview posts through its own `postDiffProviderMessage(msg: DiffWebviewToProvider)` seam (`src/webview/vscodeApi.ts`); `postProviderMessage` stays single-file-only.
- Shared worker protocol (`src/parse/parseWorker.ts`): `ParseJob` is `{ kind: 'diffParse'; bytes; extension }` (bytes transferred) or `{ kind: 'hexParse'; source: string; extension }` (the hex host must hold `raw` anyway, so it sends the decoded source rather than forcing a second decode + detach dance). `kind` is the job sentinel: the worker module is import-safe (its test imports the pure helpers, so fallow sees a static edge) and runs its body only for a known sentinel, since the test/extension host can itself be a worker thread (`parentPort` alone is not a reliable guard). `WorkerOut` is `{ type: 'progress'; fraction }` (diff) | `{ type: 'progress'; stage: 'parse' | 'build'; completed; total }` (hex, thinned to integer percent **per stage** in the worker) | `{ type: 'result'; format; wire: WireParseResult }` (diff; every segment `ArrayBuffer` transferred, produced by `serializeParseResult`) | `{ type: 'result'; format; compact: SerializedCompactParseResult }` (hex; produced by `serializeCompactParseResult`, transferring every segment + metadata-page buffer via `compactTransferList`) | `{ type: 'error'; message }`. `diffParse` progress stays one monotonic `[0,1]` fraction per file — the parser's `parse` scan fills `[0, 0.9]`, `build` fills `[0.9, 1]`, clamped to a running max, **throttled to integer percent** (post only when `Math.floor(fraction * 100)` strictly advances, ≤101 posts, never time-based). Job-shape validation runs inside the async entry, so a bad job posts `{ type: 'error' }` instead of crashing the thread.
- `runParseJob<T>({ job, signal, transferList?, onProgress?, onResult, abortMessage? })` (`src/parse/parseWorkerClient.ts`) is the one host worker client: it spawns the worker, relays progress, settles exactly once on the first of result/error/abort, terminates on settle, and rejects an already-aborted signal before spawning. Both `DiffEditorPanel` and `HexEditorSession` consume it; each supplies its own `onProgress`/`onResult`.
- Webview sends `ready`; the host loads both sides concurrently (`Promise.all`) and streams throttled `diffProgress` (`read` → `parse` → `diff`), then responds with one `diffInit` (generation-stamped) or `diffError`. Each file contributes a fraction in `[0,1]` — its read fills a small leading slice (`0 → 0.05`, `READ_SHARE`) and its parse the rest (`0.05 → 1` via `READ_SHARE + (1 - READ_SHARE) * advanceFraction(running, workerFraction)`) — so `parse` never regresses below the read fraction. The read slice is deliberately small (0.05, not 0.5) because reading is fast and posts no intermediate progress: a half-bar reservation made the bar jump straight to 50% and then crawl, instead of tracking the dominant parse. `completed = combinedLoadProgress([fractionA, fractionB])` (`src/diff/loadProgress.ts`, clamped sum; `advanceFraction` keeps each file monotonic) with `total = 2`: monotonic even when the two files' reports interleave. Stage is `read` while any file is still ≤ `READ_SHARE` (0.05), else `parse`; `diff` brackets `computeByteDiff` (`0 → 1`).
- Cleanup is registered before any await: `panel.onDidDispose` → `DisposableStore.dispose()`; disposal sets `disposed` and aborts the `AbortController`; a load whose generation is stale or disposed posts nothing.
- External change (C6/R8): after registration and before the first await, `DiffEditorPanel.open` adds one `FileSystemWatcher` per compared URI (`RelativePattern` on the file's dir + basename) to the same `DisposableStore`. `onDidChange`/`onDidCreate` set a 200 ms debounce (coalescing both sides), re-read + re-parse **only** the changed side(s) (`readDiffSource` + `parseSideInWorker`, the other side reused), then: on checksum/malformed → post `diffExternalChangeError` with `side` and `canQuickRepair = malformedLines === 0`; else recompute the diff (`reloadState`) and post `diffExternalChange` with a bumped generation. Stale reloads (`reloadIsStale`: disposed/older generation/base state replaced) post nothing; a read failure keeps the last loaded bytes. `reloadAccepted` is a host no-op (the post already carries the payload); `repairAndReload` repairs the last broken URI's checksums in place (self-write suppressed by `SELF_WRITE_HORIZON_MS`), then reloads that side; `viewInNormalEditor` opens the broken URI with `showTextDocument`. The diff host never writes the compared files except through the repair path. Decision D1: banner-and-click — `diffExternalChange` shows the reused `ExternalChange.showReload` (webview applies the pending pair locally via `applyReload` and posts `reloadAccepted`); `diffExternalChangeError` shows `showError` (`Quick Repair & reload` / `View in text editor`). The diff is read-only, so no conflict/unsaved-edit banner. `applyReload` preserves `viewMode` and each pane's top-address scroll anchor (nearest row when gone), and resets selection + search matches (addresses may have shifted).
- The panel shell renders the shared `.loading-*` card (`id="diff-loading"`, `id="diff-loading-fill"`) inside `#app` from its own inline static markup in `diffHtml`; `#diff-root` (the two-row toolbar + grids + error card) is hidden until `diffInit`, and `diffError` also hides the loading card. `diffProgress` updates the card's text only (`loadingProgressLabel` in `src/webview/utils.ts` → `Loading <stage> <pct>%…`, raw stage names); the bar is the shared indeterminate animation, never width-driven. The card CSS (`.loading-*`, `[hidden]` collapse, keyframes) lives only in `src/webview/styles/base.css`, linked by both shells — the hex shell no longer carries an inline `<style>`.
- The diff bundle is isolated: two-row toolbar + two grids + always-visible search bar only. It never imports the single-file app shell (`state.ts`, sidebar, toolbar, integrity, scripts).
- Diff grids render hex only: `showAscii:false` (no decoded-text label, no char cells).
- Both panes render their own address gutter and are separated by a static 3px `.diff-split`; the error card and body are gated on `[hidden]` so a short pair never leaves a blank lower half.
- The webview owns one mirrored read-only selection: `HexView` click/drag/address-gutter callbacks repaint both panes, and `Ctrl+C` posts `copyText` with the **source pane's** mapped bytes only (unmapped addresses skipped, never zero-filled); the panel answers with `vscode.env.clipboard.writeText` via `diffCopyText`.
- The action bar is two rows of icon+text buttons (`title` + `aria-label`, one uniform `flex: 0 0 84px` width / 22px height / `0 6px` padding, 10px text + 12px glyph, a `aria-hidden` Unicode glyph span + a visible text span — no codicon font): row 1 left `≡ Show all` / `≠ Show diff` then `▲ Prev diff` / `▼ Next diff` / `⇅ Sync scroll`, row 1 center `⇄ Swap sides` (on the pane split), row 1 right the always-visible search bar; row 2 center the changed/added/removed stat (left/right cells empty). Buttons match the hex-view toolbar ghost controls: transparent background with `1px solid var(--border)` and `color: var(--addr-fg)` idle, transparent with `color: var(--fg)` and a brighter border on hover (same as `.tb-ascii-btn`/`.tb-edit-btn`), `var(--btn-bg)`/`var(--btn-fg)` with a transparent border when active, `.35` opacity plus the default cursor when disabled, and `outline: 1px solid var(--focus-bdr)` / `outline-offset: 1px` on focus. A narrow split scrolls the row horizontally rather than wrapping. `Show diff` filters to rows containing a diff byte and shows `No differences` when empty; `Sync scroll` defaults ON and gates only the follower mirror; `Swap sides` swaps panes/labels and recomputes the diff for the new base pair. Scroll-driven renders coalesce to one per animation frame and skip an unchanged slice.
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
| `Swap sides` | Panes, heads, counts, and `added`/`removed` colors follow the new base pair. An open base editor closes; a later base request targets the displayed file's `path`, so the swap never retargets the wrong file. |
| Compare: raw side bound | Uses the stored per-file base silently; no prompt and no `.hexscope` write. |
| Compare: raw side unbound | Uses `0x00000000`; the side head shows the base and `.hexscope` stays untouched. |
| Compare: raw side differing bases | Address-aligned gap/added/removed rows; never zero-filled data; each side head shows its base. |
| Compare: raw external change | Reloads that side at its captured base through the existing banner flow; a range that no longer fits is ignored and the last bytes stay. |
| Compare: `Edit base` → Apply (valid changed value) | Inline editor closes; one `setDiffBaseAddress { path, value }` posts; the host resolves that file by path and re-reads/re-parses it at the new base; one `diffBaseChanged` updates that side and re-aligns the rows without resetting swap order or view mode; the head shows `override` + `Reset`; `.hexscope` and the editor field are untouched. |
| Compare: Apply after `Swap sides` | The request carries the **displayed** side's path; the host re-parses that file (not the pane's original file). |
| Compare: `Apply` with invalid/empty/overflowing input | Inline error + `aria-invalid`; stays in edit mode; no host message. |
| Compare: `Apply` with an unchanged value | Editor closes; no host message and no reparse. |
| Compare: `Cancel`/Escape | Draft dropped, controls restored, no host message. |
| Compare: `Reset` | `resetDiffBaseAddress { path }` posts; the stored per-file base (or 0) re-resolves; one `diffBaseChanged` clears the `override` marker and recomputes. |
| Compare: malformed `setDiffBaseAddress`/`resetDiffBaseAddress` (missing/empty/non-string path, bad value) | `diffBaseRequest` returns null; ignored, no handler runs. |
| Compare: `diffBaseChanged` with an unknown path | Ignored; nothing re-renders. |
| Compare: override while an external reload is in flight | The host bumps that side's reload generation, so the stale reload posts nothing. |
| Compare: external reload after an override | Reuses the cached override base and preserves `baseOverride`; a no-longer-fitting range keeps the last bytes. |
| Compare: swap while editing | The editor closes (pane mapping changed); the override travels with its side data. |
| Compare: close the panel | Every override is discarded with the panel; nothing was persisted. |

### 5. Good/Base/Bad Cases

- Base: `Set as 1st file to compare` on a valid Explorer file → `Compare with the 1st file` on a second valid file → panel tab → loading card with advancing `diffProgress` → `diffInit` → aligned grids + toolbar.
- Good: self-compare yields zero changed/added/removed.
- Good: `Show diff` on a pair differing in two places frames each run with `Prev`/`Next` while keeping the filtered mode.
- Good: `Ctrl+C` after selecting in the right pane copies the right file's bytes, not the left pane's.
- Good: a failed comparison swaps the loading card for the error card; the grids never render.
- Bad: the diff webview imports `state.ts` or posts single-file messages; the host writes `.hexscope/` from the diff panel.
- Bad: dispatching `(handlers as any)[msg.type]` instead of the typed dispatcher.

### 6. Tests Required

- `src/test/extension/extension.test.ts`: the three compare commands are registered (`hexScope.compareWith`, `hexScope.selectForCompare`, `hexScope.compareWithSelected`, `hexScope.compareSelectedFiles`, and `hexScope.clearCompareSelection` are gone); the `hexScope.actions` manifest gate (`3_compare` group holds only those three, each `when` carries `explorerViewletFocus` and its selection-count clause, no other menu point lists a compare command, `navigation` holds Open with HexScope / Quick Repair and the base command is palette-only); `CompareSelectionStore` set/clear lifecycle (`src/diff/compareSelection.ts`); `selectedComparePair` clicked-file-is-A ordering plus 1/3+/unsupported rejection; `stashedComparePair` stash-first ordering; `runCompare` validation-failure opens nothing and clears the stash only on success; `selectAsFirst` warns without a supported resource; and `diffCopyText` payload parsing with a real clipboard round-trip plus `diffMessageType` recognizing `diffProgress`/`diffInit`.
- `src/test/core/diff.test.ts`: `computeByteDiff` identical / one changed / added-only / removed-only / gaps / adjacent-run merge / empty / address 0 / last-byte, plus `disambiguatedLabels`.
- `src/test/core/diffLoadProgress.test.ts`: `combinedLoadProgress` sums the two per-file fractions, clamps an out-of-range input, never exceeds `total` (2) or goes negative, and stays monotonic when one file advances while the other holds and when the two files' reports interleave; `advanceFraction` never decreases, clamps out-of-range, and keeps the combined value monotonic across a scan→build stage switch.
- `src/test/core/parseWorker.test.ts`: spawns the compiled worker for a tiny IHEX and a tiny SREC fixture and asserts `format`, transferred segment bytes, monotonic progress bounded to ≤101 integer-percent messages, and error propagation for an invalid parse job; it also covers `hexParse` (IHEX + SREC) — transferred segments + metadata, hydrate + `materialize()` round-trip, per-stage integer-percent-throttled monotonic progress, and an invalid job posting `{ type: 'error' }`; a `bin` `diffParse` job maps the transferred bytes at the required base, a `.bin` whose bytes look like an IHEX record stays raw, missing/invalid/overflowing bases post an error, and a `bin` `hexParse` job posts an error; and `runParseJob` itself — progress relay, the caller's result projection, an already-aborted signal rejecting before a worker spawns, and a first-settle-wins abort that never projects a late result.
- `src/test/core/parser/compactParser.test.ts`: `serializeCompactParseResult` → `structuredClone(..., { transfer: compactTransferList(...) })` → `hydrateCompactParseResult` round-trips records + segments for IHEX and SREC.
- `src/test/webview/utils.test.ts`: the shared `loadingProgressLabel` `Loading <stage> <pct>%…` text (no-total form, clamping, zero total). The card markup itself is per-shell inline and is covered by `src/test/webview/diffViewer.test.ts` (`applyDiffProgress` card text + the `.loading-shell[hidden]` stylesheet guard).
- `src/test/webview/diffViewer.test.ts`: shared union row model + address alignment, changed marking on both sides, added empty-on-A, removed empty-on-B, computed summary counts + exact action-button order with per-button glyph span + text span + tooltips, the two-row toolbar grouping (row 1 left ends `Next diff` → `Sync scroll`, row 2 stat only with no action), the 84×22 uniform ghost-button stylesheet guard (transparent idle, `--fg` hover, `--btn-bg` active, `.35` disabled), prev/next traversal + end stops + modulo wrap, repeat-Enter navigation with no second engine run, same-key keep vs diverged drop, a streamed progress batch, count survival across a summary re-render, vertical + horizontal scroll sync + sync-off gate + render coalescing/unchanged-slice skip, decoded-text hidden, addresses on both panes, error-state card + hidden body, always-visible `SearchBar` (no `Find` button) + `Ctrl+F`, a real query over both panes (union/dedupe, needle span, next walk), mirrored click/shift-click/address-gutter selection + source-pane copy, `Show diff` filtering + `No differences`, `Swap sides` color/count flip, the format pill (`renderSideHeadHtml`, no separator, `BIN` + `Base 0x%08X` for raw sides, none for text), raw-side base controls (`Edit base`/`override`/`Reset`, text sides have none), the inline editor (fixed prefix + digits, Apply posts, unchanged closes without a post, invalid/overflow stays inline with `aria-invalid`, Cancel/Escape, over-long paste errors instead of truncating, diffInit/swap close it), `diffBaseRequest` valid path-based set/reset and malformed missing/empty/non-string path + bad-value rejection, path-targeted Apply/Reset (including after a simulated swap), `diffBaseChanged` side replacement by path with the other side kept + diff recomputed and malformed messages rejected, `replaceSideData` view-mode preservation, base carried through hydration (+ `baseOverride`), `.bin` side acceptance in `diffInit`, raw sides aligned at a nonzero base + different bases producing gap/added/removed rows, `applyDiffProgress` card updates, unknown-malformed-message rejection, the external-change reload (dispatcher routes/rejects the two reload messages, reload banner shown + accept applies the pair and posts `reloadAccepted`, view mode + scroll anchor kept, selection/search reset, error banner posts `repairAndReload`/`viewInNormalEditor`), and a stylesheet guard for the `[hidden]` rules, the 3px splitter, the removed `.diff-hide-addr`, the compact 84×22 ghost action size, and the side-head base controls.
- `src/test/core/diffReload.test.ts`: `sideDefects` (clean null, checksum-only quick-repairable, malformed blocks repair), `buildDiffState` (both refs + diff), and `reloadState` (only the changed side replaced, diff recomputed, override flag preserved by default, explicitly set/cleared, and surviving an external reload of the other side).

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
