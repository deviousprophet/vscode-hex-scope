# Design — shared parse worker + shared loading card

## 1. Boundaries

| Concern | Owner after this change |
|---|---|
| Worker entry, job dispatch, worker-side progress thinning, job/result types | `src/parse/parseWorker.ts` (moved from `src/diff/diffParseWorker.ts`) |
| Host-side spawn / abort / settle / terminate / relay | `src/parse/parseWorkerClient.ts` (new) |
| Compact-result serialize/hydrate | `src/core/parser/compact.ts` (extended) |
| Hex host parse orchestration + raw source | `src/hexEditorSession.ts` |
| Diff host parse orchestration | `src/diff/diffEditorPanel.ts` |
| Loading-card label formatting | `src/webview/utils.ts#loadingProgressLabel` (webview layer) |
| Loading-card CSS | `src/webview/styles/base.css` (single source) |

Layer rules preserved: the worker and client live in the extension-host runtime
(`src/parse/`), nothing in the host imports `src/webview/`, and no UI markup
lives in the runtime-neutral `src/core/`.

## 2. Module layout

```
src/parse/
    parseWorker.ts        worker entry; import-safe behind the kind sentinel;
                          exports pure fraction helpers + job/result types
    parseWorkerClient.ts  runParseJob(): spawn/abort/settle/terminate/relay
src/core/
    parser/compact.ts     + serializeCompactParseResult / hydrateCompactParseResult
src/webview/
    utils.ts              + loadingProgressLabel(stage, completed, total?)
```

`esbuild.js` worker entry: `src/diff/diffParseWorker.ts` → `src/parse/parseWorker.ts`,
outfile `dist/parseWorker.js`. `src/diff/diffParseWorker.ts` is deleted (moved).

## 3. Worker protocol

### Jobs (host → worker, `workerData`)

```ts
type ParseJob =
    | { kind: 'diffParse'; bytes: ArrayBuffer; extension: string }   // unchanged
    | { kind: 'hexParse'; source: string; extension: string };       // new
```

`hexParse` carries the already-decoded source string rather than bytes: the hex
host must hold `raw` anyway (splicing, record pages, repair), so decoding in the
worker would be a second pass over a multi-MB file and would force an awkward
decode-then-detach dance around `transferList`. Diff keeps bytes because its host
never needs the text.

### Worker → host

```ts
type WorkerOut =
    | { type: 'progress'; fraction: number }                              // diffParse
    | { type: 'progress'; stage: 'parse' | 'build'; completed: number; total: number } // hexParse
    | { type: 'result'; format: HexScopeFormat; wire: WireParseResult }   // diffParse
    | { type: 'result'; format: HexScopeFormat; compact: SerializedCompactParseResult } // hexParse
    | { type: 'error'; message: string };
```

- `diffParse` keeps the existing monotonic fraction model (`BUILD_FLOOR`,
  `stageFraction`, `nextLoadFraction`, integer-percent throttle) — untouched, so
  diff behavior is byte-identical.
- `hexParse` posts stage-tagged progress thinned to integer percent **per stage**
  (a separate small helper next to the fraction helpers). The host relays each
  through the existing `LoadProgressReporter.post(stage, completed, total)`, so
  the webview's `Math.floor(completed / total * 100)` label is unchanged.
- Both result variants are transferred: `wire.segments[].data` (diff) or
  `compact.segments[].data` + every metadata-page buffer (hex).

## 4. Serialized compact result

Added to `src/core/parser/compact.ts`:

```ts
export interface SerializedCompactPage {
    length: number;
    sourceStart: Uint32Array; sourceEnd: Uint32Array; lineNumber: Uint32Array;
    address: Uint32Array; resolvedAddress: Uint32Array;
    byteCount: Uint8Array; recordType: Uint8Array; checksum: Uint8Array; flags: Uint8Array;
}
export interface SerializedCompactParseResult {
    recordCount: number;
    pages: SerializedCompactPage[];
    segments: Array<{ startAddress: number; data: ArrayBuffer }>;
    totalDataBytes: number;
    checksumErrors: number;
    malformedLines: number;
    startAddress?: number;
}
export function serializeCompactParseResult(result: CompactParseResult): SerializedCompactParseResult;
export function hydrateCompactParseResult(payload: SerializedCompactParseResult): CompactParseResult;
```

`CompactRecordStore` gains two members so the module-level functions can reach
private pages without widening the public surface:

- `serializePages(): SerializedCompactPage[]` (public instance method)
- `static fromSerialized(pages: SerializedCompactPage[], recordCount: number): CompactRecordStore`
  (static can call the private constructor)

`serialize`/`hydrate` mirror `serializeParseResult` (`src/core/wire.ts`) for
segments: slice each `Uint8Array` into an exact `ArrayBuffer` for transfer, wrap
back into a `Uint8Array` on hydrate.

## 5. Host client

```ts
// src/parse/parseWorkerClient.ts
export interface ParseWorkerRun<T> {
    job: ParseJob;
    signal: AbortSignal;
    transferList?: readonly ArrayBuffer[];
    onProgress?: (message: Extract<WorkerOut, { type: 'progress' }>) => void;
    onResult: (message: Extract<WorkerOut, { type: 'result' }>) => T;
    abortMessage?: string;
}
export function runParseJob<T>(run: ParseWorkerRun<T>): Promise<T>;
```

Encapsulates exactly what `parseSideInWorker` does today: one worker, `settle`
guard so only the first of abort/error/result wins, `void worker.terminate()` on
settle, abort listener removed on settle, error → reject, and non-progress /
non-result messages ignored. Each caller supplies its own `onProgress` and
`onResult`, so the two surfaces share lifecycle without sharing result shape.

`src/diff/diffEditorPanel.ts` replaces `parseSideInWorker` + `WORKER_MESSAGE_HANDLERS`
+ `handleWorkerMessage` with one `runParseJob` call, keeping `acceptParsedSide`
and `assertNoParseDefects` as-is.

## 6. Hex host changes (`src/hexEditorSession.ts`)

- `readDocumentSource` now returns `{ raw, bytes }` (or just `raw` plus the
  buffer) so the raw string is produced once; failure handling and `loadError`
  posting stay.
- `parseCompactSafely` / `parseCompactByFormat` are replaced by one
  `parseHexInWorker(raw, extension, signal, onProgress)` that calls `runParseJob`
  with `{ kind: 'hexParse', source: raw, extension }`, relays progress through
  the caller's reporter, and returns `hydrateCompactParseResult(message.compact)`
  plus the worker-reported `format`.
- `loadInitialDocument` and `parseCompactSource` both call it. `parseCompactSource`
  keeps its `activeLoad.abort()` + fresh controller + generation semantics; abort
  now terminates the worker.
- `materializeParseResult`, `materializeRecordPage`, `repairChecksums`, and the
  splice/save paths are unchanged — they keep consuming `raw` + `CompactParseResult`.
- The inline `<style>` block at `_getHtml` is deleted; the card markup stays
  inline in `_getHtml` (see §7 — no shared markup builder). Font/token parity is
  verified visually against the previous inline fallbacks (`--border`,
  `--high-color`, `--fg`, `--addr-active-fg` in `base.css`).

## 7. Loading card (webview-only)

```ts
// src/webview/utils.ts  (existing pure-helper module, already in both bundles)
export function loadingProgressLabel(stage: string, completed: number, total?: number): string;
```

- The card is UI, so nothing card-related lives in `src/core/`. Only the *label
  formatter* is genuinely shared: it has two webview consumers
  (`hexViewer.loadProgressLabel`, `diffGrid.progressPercent`) and no host caller.
  It moves to `src/webview/utils.ts` (already imported by the diff bundle via
  `diffModel.ts#esc`), so both bundles get it for free.
- No shared markup builder. The two host boot shells emit their own small static
  card markup (they differ — `Comparing files` + per-file text vs `Opening file` +
  fixed text) and must exist before webview JS runs; the hex webview error card
  keeps its inline markup. A cross-runtime builder was rejected: a host→webview
  import is forbidden, and a runtime-neutral core builder is UI in the wrong
  layer.
- CSS stays in `base.css`, the single stylesheet both shells link. The hex
  `_getHtml` inline `<style>` is deleted: `base.css` already supplies the reset
  (`* { margin:0 }`), `html, body { height:100%; background:var(--bg) }`, and
  `#app { display:flex; height:100%; overflow:hidden }` that the inline block
  restated, so the deletion is a no-op. No new `.loading-*` selectors.

### Deliberate simplifications (documented, not accidental)

- **No `renderLoadingCardHtml`.** With the host callers excluded by the layer
  rule, the builder would have a single remaining caller (the hex error card) —
  not worth a shared module.
- **`hexParse` sends a string, not bytes.** See §3.

## 8. Compatibility & migration

- Diff: same job shape, same progress model, same wire result, same error
  strings — only the module path and the spawn helper change. Diff test updates
  are limited to the module import + `WORKER_PATH`.
- Hex: identical `CompactParseResult` after hydrate, so all downstream consumers
  are untouched. Visible behavior changes only in that the parse no longer blocks
  the host thread; the loading card/percent text is preserved.
- `src/test/core/diffParseWorker.test.ts` is renamed to `parseWorker.test.ts`,
  updated for the new path, and extended with `hexParse` cases; diff assertions
  are kept.
- Spec updates required by the change: `directory-structure.md` (module map),
  `document-formats.md` (serialize/hydrate), `editor-lifecycle.md` (worker
  protocol + hex offload), `css-guidelines.md` (loading card owned by `base.css`).

## 9. Trade-offs

- **Worker module location.** Moving to `src/parse/` is honest (it is no longer
  diff-specific) at the cost of mechanical churn (esbuild entry, one path in the
  client, the worker test). Keeping `src/diff/` would be less churn but leaves a
  misnamed module; the move is the better long-term seam.
- **Metadata pages transferred whole.** Pages are allocated at full
  `RECORD_PAGE_CAPACITY`, so partial pages transfer some unused capacity. This
  matches the existing typed-buffer allocation strategy and avoids a repack pass.
- **String clone vs double decode.** Node copies the source string across the
  thread boundary; the alternative (bytes + host decode + worker decode) costs a
  second full decode and a detach dance. Comparable work, simpler code wins.

## 10. Rollback

The work is one branch (`feat/shared-parse-worker`) with no persisted-state or
schema change. Rollback = revert the branch (or its commits). The diff suite is
the regression net; the hex path can be reverted independently of the loading
card, since §3-6 and §7 are separable.

## 11. Test-layer decoupling (`src/test/core/struct.test.ts`)

`decodeStruct(def, baseAddr, getByte, ...)` already takes a byte-accessor
callback, so `src/core/` is clean; only the test harness borrows webview state.
Fix: make `src/test/shared/structTestHelpers.ts` webview-free by holding its own
byte map and exporting the same two names it exports today.

```ts
// src/test/shared/structTestHelpers.ts  (no src/webview imports)
let bytes = new Map<number, number>();
export function setBytesInSegment(baseAddr: number, data: number[]): void {
    bytes = new Map(data.map((value, index) => [baseAddr + index, value]));
}
export function getByte(addr: number): number | undefined { return bytes.get(addr); }
```

`struct.test.ts` then imports `getByte`/`setBytesInSegment` from the helper
(not from `src/webview/`), replaces the `S.structs` defs arguments with a local
`structs` array, and drops the `S`-writing `resetStructState`. No assertion
changes; the unmapped-address case (`getByte → undefined`) still holds.
