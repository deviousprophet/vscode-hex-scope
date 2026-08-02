# Diff View Code-Spec

Feature: `hexScope.hexDiff` custom editor — side-by-side byte diff of two Intel HEX / SREC firmware files.

## 1. Scope / Trigger

- A pair of supported files is opened via `hexScope.compareSelected` (explorer multi-select `Uri[]` or two-arg invoke; **no file picker**), or the staging flow (`selectAsFirst` → `compareToStaged`).
- Same-file (same `fsPath`) pairs are refused. Identical-content pairs open and show the "identical files" state (they are NOT blocked).
- `vscode.openWith(diffViewUri(a,b), 'hexScope.hexDiff')`; `diffViewUri` = scheme `hexdiff`, **readable path** `/<A name> ⟷ <B name>`, opaque pair key in the **query** (`k=<encodePairKey>`). Tab title reads both filenames. `openCustomDocument`/session decode the pair key from `uri.query` (`pairKeyFromUri`).

## 2. Data model

**Scale target (locked): 8MB firmware.** For an 8MB pair the current full-materialization `DiffResult.rows` (512k rows × 16 cells × 2 sides ≈ 1.5M objects) must NOT be serialized/transferred as JSON. The diff grid is the memory view's analog, so it uses the **memory-view model**: segments once + lazy per-window compute.

- `src/core/diff.ts` keeps the pure, testable status engine: per-address `status ∈ unchanged|changed|added|removed|empty` from presence+value, `summary`, `runs` (contiguous non-unchanged), `identical`. It gains a **sync light-metadata pass** that produces `unionRowStarts` + per-row `hasDiff` (Uint8Array) + `summary` + `runs` + `identical` — O(bytes) scan, no cell objects materialized. This is the **only** full scan; it is fast (~30–60ms at 8MB) and runs synchronously (a "build" stage checkpoint, not chunked).
- The webview holds: both sides' **segment indexes** (`getByteAt`, `core/memory.ts`) + a **light full row array** `[{ address, hasDiff }]` (`unionRowStarts` → Uint8Array per row). It **computes the visible window's cells/status on scroll** (bytes + `statusFor` from the shared core), never materializing per-cell objects for the whole file. Scroll math, "Diff mode" filtering (`hasDiff`), `visualRowIndexForAddress` (binary search over row starts) unchanged.
- Transfer is **binary ArrayBuffer**, reusing the single view's `WireParseResult` (`data: ArrayBuffer`, zero-copy through `postMessage`). `diffInit` = `{ a: WireParseResult, b: WireParseResult, meta: { rowStarts: Uint32Array, hasDiff: Uint8Array, summary, runs, identical, totalRows, ... } }`.
- Webview visual grouping stays: `groupVisualRows` → `DiffVisualRow = { baseAddress, a[], b[], statuses[] }`, but cell data is read from the segments per window instead of from a full rows array.
- `pairUri.ts`: `encodePairKey`/`decodePairKey` — base64 of canonical-sorted `[aPath, bPath]`, uri-encoded. Same pair → same key.

## 3. Protocol (webviewProtocol.ts)

Provider → webview:
- `diffInit { generation, a: WireParseResult, b: WireParseResult, meta: DiffMeta, aLabel, bLabel, aFormat, bFormat, aError: string|null, bError: string|null }` — `DiffMeta = { rowStarts: Uint32Array, hasDiff: Uint8Array, summary, runs, identical, totalRows }` (ArrayBuffers transferable; no per-cell data). No address-range labels (`SegmentLabel`) are carried — the diff view shows none (REMOVED, user 2026-08-01).
- `diffUpdate { generation, a, b, meta, aError, bError }` — recomputed after external change (same wire shape)
- `diffProgress { generation, stage: 'read'|'parse'|'build'|'transfer', completed, total }` — staged load % (throttled, mirrors single view's `loadProgress`)
- `diffSwap { generation, swapped }`
- `diffSearch { generation, query, matches: number[], done: boolean }` — **streamed**: partial `diffSearch` posts forward each engine's `onProgressUpdate` (engine throttles to 150ms), final one has `done: true`
- `loadError { generation, message }`

Webview → provider:
- `diffReady`
- `diffSwapRequest`
- `diffSearchRequest { generation, query, mode: SearchMode, endianness: SearchEndianness }` (`SearchMode = bytes|value|ascii|addr`, `SearchEndianness = le|be|auto`)

Dispatch + model handling for the new discriminators + unknown-message no-op are tested in `webview-message-model.test.ts`.

## 4. Session (src/editor/hexDiffSession.ts)

- **Load pipeline (sequential, staged, cancellable):** `read A → parse A (→50%) → read B → parse B (→95%) → build light metadata (sync pass) → transfer (→100%)`. Per-file `onProgress` mapped onto the range (single view's `LoadProgressReporter` throttle/flush pattern). Parser called with `{ signal, onProgress }` — **cancellable**.
- **Cancellation = abort + restart on external change mid-load** (generation-bumped re-run; the watcher's debounced reload covers post-load changes). Abort also on panel dispose.
- **Loading card (single view's `.loading-shell`/`.loading-card`, styles already in base.css):** shown in the initial `_getHtml` HTML; webview keeps it until `diffInit`. On `loadError` before data → error card (same shell). **Reloads after load reuse the diff UI in place** with a `Reloading…` status/spinner — the full card is initial-load only.
- Parses both files (`parseIntelHexCompact`/`parseSRecCompact`), runs the light-metadata pass, sends `diffInit` on `diffReady`. No address-range labels are read or sent (REMOVED, user 2026-08-01).
- External-change watchers per side + 200ms debounce → re-parse that side → `diffUpdate`.
- Per-side validity: `parseErrorFor(result)` returns a message when `checksumErrors`/`malformedLines` > 0; carried as `aError`/`bError` so the webview shows a per-panel parse-error state.
- Search: the diff view uses the reusable **`SearchBarComponent`** (`ui-components/search-bar/`); its `onSearch(query, mode, endianness)` callback drives `diffSearchRequest`. The host runs core `SearchEngine` over **both** sides' segments with the requested `mode`/`endianness`, merges into one sorted union, and **streams** partial `diffSearch` posts from each engine's `onProgressUpdate` (final `done: true`). Enter on an **unchanged completed** query navigates next/prev match (single-view `handleCompletedSearchNavigation` parity). The endian control is a **segmented Auto/LE/BE pill** (single-view style).
- Swap is a view preference; host echoes orientation via `diffSwap`.

## 5. Webview layout (hexDiffViewer.ts + diff.css)

- Chrome: toolbar (top), summary bar, error banners, `#diff-scroll` (the grid), `#status`.
- **Reusable hexview component** (`renderHexViewComponentHtml`): optional filename label (`panel-label`, empty = omitted) + 00..0F header + (address gutter + hex cells). The diff renders `[component A] ┃ [component B]` in one `.diff-grid` flex row, **centered** (`width: fit-content; margin: 0 auto`).
- Both components share **one `#diff-scroll`**; rows are absolute at the same `top: index × DIFF_ROW_HEIGHT`, so sides stay byte-aligned and scroll together (single scrollbar).
- **Single continuous separator**: `.diff-sep` (2px, `align-self: stretch`, `position: sticky`) spans the full grid height; label + header are sticky (`top: 0` / `top: 24px`).
- **Swap** reorders the two whole components around the fixed separator via `.diff-grid` `order` rules (`body.swapped`).
- Per-panel errors: `aError`/`bError` → the affected component's side gets `panel-error` (dimmed cells) + a `.side-error` banner.
- Status colors: changed = red `#ff6b6b`, added = green `#4ec9a0`, removed = magenta `#c586c0`; cells `data-cell ${status}`, per-cell `match` (search) and `sel` (selection).
- **Hover/selection (layered, hover < selection)**: row hover (bg + addr brighten); per-cell hover (skip empty cells); **cross-panel mirror** — hovered byte's same address in the opposite component gets `cell-mirror`; **column hover** — 00..0F header hover highlights that offset across both components (`col-hi`); **selection** — click/click-drag (`sel`, single-view style) with a `sel-mirror` outline on the opposite component. Live hover/drag updates DOM classes (no per-cell re-render).
- **Reusable interaction**: `HexViewComponent` (`diff/hexViewComponent.ts`) owns render + hover + selection + column-hover and emits callbacks; the diff wires only the cross-panel layer between its two instances. `renderHexViewComponentHtml` is the pure HTML builder (label optional). Single hex view can later reuse one component.

## 6. Selection + copy

- Click-drag on a `[data-side][data-addr]` cell selects a byte range locked to the starting side; selection clears only on empty `#diff-scroll` clicks (toolbar clicks keep it).
- Ctrl+C copy is owned by `HexViewComponent` (keydown, text-input guarded): it emits `onCopy(range)`; the diff host reads the selected side's present bytes via its segment index and writes hex (`formatCopyCommand('hex', …)`). No global host keydown handler.

## 7. Tests Required

- `core/diff.test.ts` — statuses, union rows + gaps, summary, runs, address 0/huge gaps/empty, cross-format.
- `core/pairUri.test.ts` — round-trip, canonical order, distinct same-name pairs.
- `webview/diff-renderer.test.ts` — `groupVisualRows` (16→1 visual row, distinct bytes, gaps), per-cell match, panel-error, selection class, identical summary.
- `webview/diff-view-model.test.ts` — run/match focus wrap, indexing, `DIFF_ROW_BYTES === DIFF_BPR`.
- `webview/webview-message-model.test.ts` — diff discriminators dispatch + unknown no-op.
- `core/package-config.test.ts` — `compareSelected` in submenu, bare Alt+↓/↑ not bound to staging.
- `extension/extension.test.ts` — command registration, staging lifecycle, `Uri[]` multi-select, readable tab title.

## 8. Wrong vs Correct

Wrong: opaque base64 in the tab title; `compareSelected` missing from the explorer menu; bare `Alt+↓/↑` bound to staging (menu shows "Alt+Down"); per-address rows rendered as 16-cell rows (byte repeated); `translateY` + container scroll double-offset (frozen viewport); `#status` element missing (bootstrap crash); no CSS loaded (unstyled HTML); identical-content pair blocked instead of showing identical state; full `DiffResult.rows` JSON shipped for large files; no loading card / silent blank during parse+diff; Enter re-runs a completed search instead of navigating; endian control as an unlabeled cycling button.
Correct: readable `a.hex ⟷ b.hex` title; Compare Selected in the `hexScope.actions` submenu handling `Uri[]`; `Alt+↓/↑` = diff navigation in the webview, staging on `Ctrl+Alt`; 16-byte visual rows; measured flex scroll container; styled diff view; identical-state display; lazy per-window cells over binary segments; loading card with staged % (initial load) + in-place reloads; streaming search with first-jump; Enter cycles matches; segmented Auto/LE/BE pill.
