# Diff View Code-Spec

Feature: `hexScope.hexDiff` custom editor — side-by-side byte diff of two Intel HEX / SREC firmware files.

## 1. Scope / Trigger

- A pair of supported files is opened via `hexScope.compareSelected` (explorer multi-select `Uri[]` or two-arg invoke; **no file picker**), or the staging flow (`selectAsFirst` → `compareToStaged`).
- Same-file (same `fsPath`) pairs are refused. Identical-content pairs open and show the "identical files" state (they are NOT blocked).
- `vscode.openWith(diffViewUri(a,b), 'hexScope.hexDiff')`; `diffViewUri` = scheme `hexdiff`, **readable path** `/<A name> ⟷ <B name>`, opaque pair key in the **query** (`k=<encodePairKey>`). Tab title reads both filenames. `openCustomDocument`/session decode the pair key from `uri.query` (`pairKeyFromUri`).

## 2. Data model

- `src/core/diff.ts` `computeDiff(aResult, bResult)` emits **one `DiffRow` per address**: `{ address, a: DiffCell|null, b: DiffCell|null, status }` with `status ∈ unchanged|changed|added|removed|empty`. Union-of-row-spans alignment (16-byte blocks, empty cells where a side lacks data). Also `summary`, `runs` (contiguous non-unchanged), `identical`.
- The webview **groups 16 address rows into one 16-byte visual row**: `groupVisualRows(rows): DiffVisualRow[]` where `DiffVisualRow = { baseAddress, a[], b[], statuses[] }` (`diffViewModel.ts`). Virtual scroll, `focusRow`, `searchRowIndexFor` operate on **visual rows** (`visualRowIndexForAddress`).
  - Anti-pattern (fixed): rendering each per-address row as a full 16-cell visual row repeats one byte 16× per visual row.
- `pairUri.ts`: `encodePairKey`/`decodePairKey` — base64 of canonical-sorted `[aPath, bPath]`, uri-encoded. Same pair → same key.

## 3. Protocol (webviewProtocol.ts)

Provider → webview:
- `diffInit { generation, result: DiffResult, aLabel, bLabel, aFormat, bFormat, aError: string|null, bError: string|null, aLabels: SegmentLabel[], bLabels: SegmentLabel[] }`
- `diffUpdate { generation, result, aError, bError }` — recomputed after external change
- `diffSwap { generation, swapped }`
- `diffSearch { generation, query, matches: number[] }`
- `loadError { generation, message }`

Webview → provider:
- `diffReady`
- `diffSwapRequest`
- `diffSearchRequest { generation, query, mode: SearchMode, endianness: SearchEndianness }` (`SearchMode = bytes|value|ascii|addr`, `SearchEndianness = le|be|auto`)

Dispatch + model handling for the new discriminators + unknown-message no-op are tested in `webview-message-model.test.ts`.

## 4. Session (src/editor/hexDiffSession.ts)

- Parses both files (`parseIntelHexCompact`/`parseSRecCompact`), runs `computeDiff`, sends `diffInit` on `diffReady`.
- `readLabels(context, uri)` → `workspaceState.get('hexScope.labels.' + uri.toString(), [])`; sent as `aLabels`/`bLabels` (read-only display).
- External-change watchers per side + 200ms debounce → re-parse that side → `diffUpdate`.
- Per-side validity: `parseErrorFor(result)` returns a message when `checksumErrors`/`malformedLines` > 0; carried as `aError`/`bError` so the webview shows a per-panel parse-error state.
- Search: runs core `SearchEngine` over **both** sides' segments with the requested `mode`/`endianness`, merges matches into one sorted union.
- Swap is a view preference; host echoes orientation via `diffSwap`.

## 5. Webview layout (hexDiffViewer.ts + diff.css)

- Chrome: label rail (filenames, side chips), summary bar, label rail, error banners, `#diff-scroll` (rows + sticky header), toolbar, `#status`.
- **Row = `[addr.a][side.a][addr.b][side.b]`** — dual address gutters (both panels show the row address, so a one-sided address stays visible). Swap reorders the four cells via `order` rules (rows and header identically).
- **00..0F column header** (`renderDiffHeaderHtml`, `.hcell`) is `position: sticky; top: 0` inside `#diff-scroll`: fixed vertically, scrolls horizontally with content.
- **Centered**: `.diff-header`/`.diff-body` are `width: fit-content; margin: 0 auto`.
- **Gutter** between panels: `.side.a` `border-right: 2px solid var(--border)` + padding/margin.
- `#diff-scroll` is `flex:1; min-height:0`, measured via `clientHeight` (not a hard `innerHeight - N`).
- Status colors: changed = red `#ff6b6b`, added = green `#4ec9a0`, removed = magenta `#c586c0`; A/B accents blue `#9cdcfe` / orange `#e37933`.
- Cells: `data-cell ${status}` (`base.css` geometry + `diff.css` status colors), per-cell `match` (search) and `sel` (selection), `panel-error` dims an invalid side.

## 6. Selection + copy

- Click-drag on a `[data-side][data-addr]` cell selects a byte range locked to the starting side; selection clears only on empty `#diff-scroll` clicks (toolbar/rail clicks keep it).
- Toolbar copy select (hex / c-array / ascii) + Ctrl+C → `formatCopyCommand(fmt, selectionBytes())` over the selected side's present bytes in address order.

## 7. Tests Required

- `core/diff.test.ts` — statuses, union rows + gaps, summary, runs, address 0/huge gaps/empty, cross-format.
- `core/pairUri.test.ts` — round-trip, canonical order, distinct same-name pairs.
- `webview/diff-renderer.test.ts` — `groupVisualRows` (16→1 visual row, distinct bytes, gaps), per-cell match, panel-error, selection class, identical summary.
- `webview/diff-view-model.test.ts` — run/match focus wrap, indexing, `DIFF_ROW_BYTES === DIFF_BPR`.
- `webview/webview-message-model.test.ts` — diff discriminators dispatch + unknown no-op.
- `core/package-config.test.ts` — `compareSelected` in submenu, bare Alt+↓/↑ not bound to staging.
- `extension/extension.test.ts` — command registration, staging lifecycle, `Uri[]` multi-select, readable tab title.

## 8. Wrong vs Correct

Wrong: opaque base64 in the tab title; `compareSelected` missing from the explorer menu; bare `Alt+↓/↑` bound to staging (menu shows "Alt+Down"); per-address rows rendered as 16-cell rows (byte repeated); `translateY` + container scroll double-offset (frozen viewport); `#status` element missing (bootstrap crash); no CSS loaded (unstyled HTML); identical-content pair blocked instead of showing identical state.
Correct: readable `a.hex ⟷ b.hex` title; Compare Selected in the `hexScope.actions` submenu handling `Uri[]`; `Alt+↓/↑` = diff navigation in the webview, staging on `Ctrl+Alt`; 16-byte visual rows; measured flex scroll container; styled diff view; identical-state display.
