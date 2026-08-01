# Design: Hex Diff View

Task: `08-01-hex-diff-view` · Branch: `feat/hex-diff-view` · Base: `main`

## 1. Architecture & Boundaries

Two new layers, mirroring the existing single-file editor's split (spec: `frontend/directory-structure.md`):

```text
extension host                          webview (browser)
─────────────────                       ─────────────────
src/editor/hexDiffProvider.ts ─protocol▶ src/webview/hexDiffViewer.ts  (composition root)
src/editor/hexDiffSession.ts  ─protocol▶ src/webview/diff/*            (render + model)
src/core/diff.ts              (pure, testable — no vscode/DOM imports)
```

- **`src/core/diff.ts`** — pure diff engine. Input: two `CompactParseResult`s. Output: serializable `DiffResult` (below). No `vscode`, no DOM. Unit-testable like `core/search.ts`, `core/memory.ts`.
- **`src/editor/hexDiffProvider.ts`** — `CustomReadonlyEditorProvider` for `viewType = 'hexScope.hexDiff'`; registers via `registerCustomEditorProvider` with `webviewOptions.retainContextWhenHidden: true`. `openCustomDocument` returns a **virtual document** whose `uri` encodes the canonicalized URI pair (D14). Delegates to `HexDiffSession`. Extends `ReadonlyEditorProviderBase` (shared plumbing with `HexEditorProvider`).
- **`src/editor/hexDiffSession.ts`** — per-panel orchestration: parse both files, run `core/diff`, serialize `DiffResult` over the protocol, watch both URIs + debounce (reuse pattern from `hexEditorSession.ts:524`), swap/staging state that is webview-local vs session-local. Builds the webview HTML (loads `base.css` + `diff.css`, R8/D24).
- **`src/webview/hexDiffViewer.ts`** — thin composition root: wires panels, shared label rail, summary bar, next/prev, swap, search. No diff logic.
- **`src/webview/diff/`** — `diffViewModel.ts` (pure navigation/window math, `DIFF_ROW_HEIGHT`, `DIFF_ROW_BYTES`) + `diffRenderer.ts` (row/summary HTML). No vscode/DOM imports; unit-testable.
- **`src/webview/styles/diff.css`** — diff-view styling, loaded after `base.css` for token parity (R8).

Where it plugs into existing code:

- `src/extension.ts` — register `hexDiffProvider`, plus 3 new commands (Compare Selected, Select as 1st, Compare to <name>) + staging state.
- `package.json` — new custom editor entry, new commands, explorer/editor-title menus (`resourceLangId =~ /^(intel-hex|srec)$/`), keybindings `Alt+↓/↑` (webview-local, D20).
- `src/webviewProtocol.ts` — new message discriminators (below); update `webviewMessageDispatcher.ts`/`webviewMessageModel.ts` per protocol-change discipline.

Boundary rules (from spec):

- Diff logic lives in `src/core/diff.ts`, never in the webview.
- Cross-runtime messages only via `src/webviewProtocol.ts`; a new discriminator needs host sender/handler + browser dispatch + model applier + tests (spec `editor-lifecycle.md` §5).
- No `vscode` import from `src/core/**` or `src/webview/**`.
- No new framework/wrapper; direct DOM as in the rest of the webview.

## 2. Data Flow & Contracts

### 2.1 Diff core (`src/core/diff.ts`)

```typescript
// per-address status; ranges are display groupings, not structures (D4)
type ByteStatus = 'unchanged' | 'changed' | 'added' | 'removed' | 'empty';

interface DiffResult {
    // union-of-rows alignment (D5): one row set for both panels
    rows: Array<{
        address: number;
        a: { present: boolean; byte: number } | null; // null = gap/empty on A
        b: { present: boolean; byte: number } | null;
        status: ByteStatus;                          // derived from a/b presence+value
    }>;
    summary: { unchanged: number; changed: number; added: number; removed: number };
    runs: Array<{ start: number; end: number; status: ByteStatus }>; // for next/prev (D16)
}
```

Row construction: union of both files' `buildMemoryRows` spans (address range per row), merged, sorted, deduped; `empty` cells where one side lacks a byte (D5). Status per address from presence + value (D4). Runs = contiguous non-`unchanged` addresses (D16). `BPR = 16` shared (D12), reusing `src/webview/state.ts:8`.

Memory-map construction reuses `buildSegmentIndex`/`getByteAt` from `core/memory.ts`.

### 2.2 Protocol (`src/webviewProtocol.ts`)

New provider→webview messages:

- `type: 'diffInit'` — full `DiffResult` + A/B panel metadata (fileName, format, per-side labels union with side tag per D22).
- `type: 'diffUpdate'` — recomputed `DiffResult` after external change (D13); replaces prior, keeps same tab.
- `type: 'diffSwap'` — host-confirmed swap orientation (`swapped: boolean`); applied client-side to panel/label order (D23).
- `type: 'diffSearch'` — union match list for a query (`matches: number[]`), from the host-side `SearchEngine` run against both files (D21).

New webview→provider messages:

- `type: 'diffReady'` — webview booted; host sends `diffInit` on first readiness.
- `type: 'diffSwapRequest'` — request panel swap; host flips its orientation and replies with `diffSwap`.
- `type: 'diffSearchRequest'` — query + generation; host runs `SearchEngine` against **both** sides, replies with `diffSearch`.

All new discriminators: dispatch + model handling + unknown-message no-op assertions (spec `editor-lifecycle.md` §5, §6).

### 2.3 Staging commands (extension host)

Staging state lives in extension host (module-level in `src/hexDiffSession.ts` or a small `src/diffStaging.ts`):

```typescript
let stagedFirst: vscode.Uri | null;   // ephemeral (D7)
```

- **`hexScope.compareSelected`** — invoked with 2 selected URIs; first selected = A (D17). Validates both via `parseResultIsValid` (D9, `src/extension.ts:26`), rejects same-URI/identical-content (D8), opens diff.
- **`hexScope.selectAsFirst`** — stages current file as A; adds explorer decoration (D18, `FileDecorationProvider`).
- **`hexScope.compareToStaged`** — current file vs staged A; opens diff, clears staging (D7).

Pair identity = canonicalized URI pair; same pair reuses one tab (D14). Virtual `CustomDocument.uri` encodes the pair so `vscode.openWith` dedupes; `openCustomDocument` parses the pair back out.

### 2.4 Read-only enforcement

`CustomReadonlyEditorProvider` + no save/edit messages wired. D10/AC7: no tabs, edit controls, scripts, structs, inspector, bit view, integrity. Selection + copy reuse existing copy formatters (D11) via existing `copyCommand` pattern (`src/extension.ts:84`).

### 2.5 Webview UI (visual parity + virtual scroll)

- **Styling (R8/D24).** `hexDiffSession._getHtml` loads `base.css` (design tokens, reset, scrollbar) then `diff.css` (diff-only rules). CSP allows `style-src 'unsafe-inline'` (mirrors the hex editor) so the renderer's inline geometry styles work. The webview HTML declares every node the script references at bootstrap — including `#status` (a missing `#status` element previously crashed the first `updateStatus()` call). Status colors (D24/D26): changed=red `#ff6b6b`, added=green `#4ec9a0`, removed=magenta `#c586c0`; A/B side accents blue `#9cdcfe` / orange `#e37933` (D23) applied to label-rail chips (`data-side` letter) and summary counts.
- **Data model — visual rows (critical).** `core/diff.ts` `computeDiff` emits **one `DiffRow` per address** (16 consecutive rows per 16-byte block, empty cells where a side lacks data). The renderer must **group 16 address rows into one visual row** via `groupVisualRows` (`diffViewModel.ts`): a `DiffVisualRow` carries `baseAddress`, `a[]`/`b[]` (16 `DiffCell|null`), and per-address `statuses[]`. Virtual scroll + `focusRow`/`searchRowIndexFor` operate on **visual rows** (`visualRowIndexForAddress`). An earlier version rendered each address-row as a full 16-cell row, repeating one byte 16× per visual row — fixed and regression-tested in `diff-renderer.test.ts`.
- **Grid layout (D26/D33 — reusable component).** One reusable **hexview component** per file: optional filename label (`panel-label`, empty = omitted) + 00..0F header + (address gutter + hex cells). The diff renders `[component A] ┃ [component B]` inside a single `.diff-grid` flex row (`width: fit-content; margin: 0 auto` → centered). Both components live in **one shared `#diff-scroll`**; each component's rows are absolutely positioned at the same `top: index × DIFF_ROW_HEIGHT`, so the two sides stay byte-aligned and scroll together. A **single `.diff-sep`** (2px line, `align-self: stretch`, sticky) spans the full height between them. Label + header are sticky (`top: 0` / `top: 24px`). **Swap** reorders the two components around the fixed separator via `.diff-grid` `order` rules (D23). The address gutter is inside each component (both show the aligned row address); the header's gutter is `visibility: hidden` but keeps its width for column alignment.
- **Virtual scroll (R9/D25).** `DIFF_ROW_HEIGHT` (22px) single constant; `.diff-row` absolute `top: index × DIFF_ROW_HEIGHT` in a `position:relative` body of height `visualRows × ROW_HEIGHT`; `#diff-scroll` is `flex:1; min-height:0` and **measured via `clientHeight`** (a fixed `innerHeight - 90` inline height plus flex sizing double-sized and clipped the toolbar). No `translateY`. Scroll container is rebuilt per render; `scrollTop` restored after.
- **Per-panel error (D27).** `diffInit`/`diffUpdate` carry `aError`/`bError` (`string|null`, from `parseErrorFor`). Affected panel gets `panel-error` (dimmed cells) + a `.side-error` banner under the summary.
- **Search (D28).** `diffSearchRequest {query, mode, endianness}` → `SearchEngine` against both sides, union `matches[]`. Renderer highlights **per cell** (`matchSet`) and marks the current focus row (`search-row`).
- **Selection + copy (D29).** Click-drag on a `[data-side][data-addr]` cell selects a byte range locked to one side; selection-clear only on empty `#diff-scroll` clicks. Toolbar copy select (hex/c-array/ascii) + Ctrl+C → `formatCopyCommand` over `selectionBytes()` (present bytes in address order).
- **Label rail (D6/D22).** `diffInit` carries `aLabels`/`bLabels` (`SegmentLabel[]` from per-uri `hexScope.labels.${uri}`). `.diff-rail` lists both unions, side-tagged (A blue / B orange chips), read-only. Range-highlight across panels not yet implemented (only the rail list) — future work.

## 3. Compatibility & Migration

- **No breaking change** to `hexScope.hexEditor`; new viewType is additive.
- Pair-key URI encoding must round-trip: two URIs → one opaque document URI → two URIs. Use a stable reversible encoding (e.g. base64 of a JSON `[aPath, bPath]`), canonical order by fsPath so same pair always maps to same URI (D14).
- Cross-format pairs (ihex vs srec) supported (AC8); both parse to `CompactParseResult` segments, diff operates on addresses only.
- Labels: read from per-uri `hexScope.labels.${uri}` workspaceState (existing key format, `hexEditorSession.ts:388`), unioned with side tags (D22); display-only, never persisted from diff view.

## 4. Important Trade-offs

| Decision | Trade-off |
|---|---|
| D3 host-side diff, **lazy transfer (locked Q2/Q4)** | Status/geometry computed host-side once; **per-cell data is NOT shipped** — both files transfer as binary `WireParseResult` segments (ArrayBuffer, zero-copy) + light meta (`rowStarts`/`hasDiff`/`summary`/`runs`), and the webview computes visible-window cells lazily. No full `DiffResult.rows` JSON at any scale. |
| D5 union rows | Guarantees address alignment (AC6) at the cost of rendering empty cells; same virtual-scroll state keeps it cheap. |
| D23 swap = position only | Identity stays file-bound; added/removed semantics never flip. Webview-local view preference; can be applied client-side without host round-trip — but diffUpdate must arrive with orientation the webview already knows (host sends A/B data keyed by side tag, webview renders left/right by its swap flag). |
| D21 union search | Two engine runs, one merged match list; **streamed** progressively (`onProgressUpdate`, final `done: true`). Cost is two segment scans, acceptable. |
| Virtual doc URI pair | Requires reversible encoding + careful canonicalization; failure mode = duplicate tabs. Test the round-trip. |
| Live re-diff (D13) | Recompute + reserialize on each external change; debounce 200ms like single-file. Identical/unparseable states handled per D15 without closing the tab. |

## 4a. Performance / scale decisions (grill, 2026-08-01)

Target **8MB** per file. Full materialization + JSON `postMessage` of `DiffResult.rows` (~1.5M objects, tens of MB JSON) is rejected. Locked:

| Q | Decision |
|---|---|
| Q1 | Scale target **8MB** |
| Q2 | **B — lazy window model**: segments once + light meta; cells computed per visible window (memory-view analog) |
| Q3 | **B1** — webview holds light full rows `[{address, hasDiff}]` + two segment indexes; no per-cell objects |
| Q4 | **ArrayBuffer binary transfer**, reuse `WireParseResult` (zero-copy `postMessage`) |
| Q5 | **Sequential** parse A → B, staged % (`read A → parse A →50% → read B → parse B →95% → build → transfer →100%`), reusing `LoadProgressReporter` throttle/flush |
| Q6 | **Abort + restart** on external change mid-load (generation bump); abort on dispose |
| Q7 | **Card only on initial load**; reloads re-render in place with `Reloading…` status/spinner |
| Q8 | **Streaming search** — partial `diffSearch` from engine `onProgressUpdate` (throttled 150ms) + first-jump to match #1; final `done: true` |
| Q9 | **Sync build pass** — light meta (`rowStarts`+`hasDiff`+`summary`+`runs`+`identical`) one O(bytes) scan, ~30–60ms, "build" checkpoint, NOT chunked |
| Q10 | **Enter-nav parity** — Enter on an unchanged completed query navigates next/prev match (Shift=prev), single-view `handleCompletedSearchNavigation` behavior |

Loading card reuses single view's `.loading-shell`/`.loading-card` (base.css). `loadError` before data → error card.

## 5. Operational / Rollback

- Rollback: feature lives behind new viewType + new commands; disabling the extension restores prior behavior. No migration of user data.
- Risky areas: pair-URI encoding round-trip; protocol additions (must update all four seam files); union-row alignment under gaps; webview virtual-scroll reuse with two panels.
- Performance: `core/diff.ts` must not do per-byte clock reads (reuse `core/search.ts` chunk-deadline pattern) on large files; keep diff computation bounded.

## 6. Tests Required (map to PRD ACs)

- `src/test/core/diff.test.ts` — statuses (unchanged/changed/added/removed/empty), union rows + gaps, summary counts, run extraction, address `0`/huge gaps/empty results, cross-format parse inputs (AC3/AC4/AC6/AC8).
- `src/test/core/` pair-URI encoding round-trip tests (D14/AC12).
- `src/test/webview/webview-message-model.test.ts` — new discriminators dispatch + unknown no-op (D1/D21).
- `src/test/webview/diff-view-model.test.ts` — `diffRunFocus` / `searchMatchFocus` wrap, row/column indexing, `DIFF_ROW_BYTES` parity with core (D16/D21).
- `src/test/extension/extension.test.ts` — new command registration + staging lifecycle (D7/D17/D18).
- Search union tests against `core/search.ts` on two segment sets (D21).
- Manual visual check: diff view matches hex editor's visual language (R8/AC9); scroll is smooth with no frozen/double-offset viewport (R9/AC10).

## 7. Follow-up before `task.py start`

- PRD convergence pass complete (no duplicate facts, no blocking open questions).
- Final planning summary presented and explicitly approved by user.
