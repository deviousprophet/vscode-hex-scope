# Component Spec — DiffView

> Built from `component-template.md`. Owns the read-only two-grid diff surface as a self-contained webview bundle, reusing `HexView` for each grid.

## Scope / Trigger

Owns `src/webview/diffViewer.ts` (composition root), `src/webview/diff/` (`diffModel.ts`, `diffGrid.ts`, `diffSummary.ts`, `diffSearch.ts`, `diffMessages.ts`, `diffExternalChange.ts`, `diff.css`), `src/webview/components/diffView/` (`diffView.ts`, `diffViewRender.ts`, `diffView.css`), and the host-side compare-selection store `src/diff/compareSelection.ts` + `src/core/diffLabels.ts`: the dedicated read-only editor comparing two IHEX/SREC files. It renders one shared union row model across two `HexView` instances (owned by `DiffView`), a two-row summary/action toolbar, prev/next run navigation, an always-visible reused `SearchBar`, mirrored read-only selection, and a host-driven loading card with an indeterminate bar and a text progress label.

Boundary rule: the diff host owns data (both `DiffSideData`, `DiffModel`, per-pane `VirtualScrollState` — `scrollPaneA`/`scrollPaneB`) and all domain decisions. `DiffView` owns the two-pane grid surface — its markup, the two `HexView` instances, interaction callbacks, paint, and styles — mirroring the `HexView`/`memoryGrid` split. The host drives the grids only through `DiffView` and never writes grid **cell** DOM directly; it does own the rows wrappers (`drawPane` writes `rows.innerHTML` via the shared `renderHexViewHtml`, exactly as `memoryGrid` writes `#mem-rows`). It never touches the single-file app shell (`state.ts`, `S`, sidebar, toolbar, integrity, scripts).

## Layout

```text
src/webview/diffViewer.ts             composition root: shell HTML (summary + body markup from the DiffView render layer + error card), ready handshake, message dispatch (init/error/progress), Ctrl+C copy, side heads
src/webview/diff/diffModel.ts         hydrateDiffSide, buildDiffRows, getSideByte, diffKindAt, diffClassForSide, renderDiffErrorHtml, renderSideHeadHtml
src/webview/diff/diffGrid.ts          host grid controller: data, visibleRows, view mode, selection, sync flag, per-pane VirtualScrollState, slice compute/render loop (drawPane writes the rows innerHTML), driver poll, rows-wrapper DOM; drives the two grids only through DiffView
src/webview/diff/diffSummary.ts       renderDiffSummaryHtml + setDiffSummary: two-row toolbar, icon+text action buttons, stat, search slot, action wiring
src/webview/diff/diffSearch.ts        SearchBar reuse (always mounted): one query over both sides, unioned match addresses, completed-key nav, streaming paint, modulo next/prev walk, refreshDiffSearchCount
src/webview/diff/diffExternalChange.ts reused ExternalChange banner wiring: diffExternalChange → showReload(pending) → applyReload + reloadAccepted; diffExternalChangeError → showError(repair/view-text posts)
src/webview/search/searchNavigation.ts pure shared search decisions (shouldNavigateCompletedSearch, isSearchDiverged) — no DOM/`S`, reused by both hosts
src/webview/diff/diffMessages.ts      typed dispatchDiffMessage (unknown rejected) for diffInit/diffError/diffProgress/diffExternalChange/diffExternalChangeError
src/diff/diffReload.ts                host reload decisions: sideDefects classification, buildDiffState, reloadState (replace one side + recompute diff)
src/webview/components/diffView/diffView.ts        DiffView controller + DiffViewCallbacks + DiffPane: owns the two HexView instances, pane-qualified callback re-exposure, mirrored-selection paint, incremental match paint, header injection, per-pane scroll get/set, reset
src/webview/components/diffView/diffViewRender.ts  pure DOM-free markup: renderDiffViewBodyHtml (two-pane body shell) + renderDiffEmptyHtml (escaped empty-state card)
src/webview/components/diffView/diffView.css       grid-surface styles (.diff-body/.diff-side/.diff-split/.diff-grid-root/.diff-side-head/.diff-empty + diff cell classes)
src/webview/diff/diff.css             host chrome: .diff-root, .diff-summary/toolbar, .diff-error + hidden-state guards; :root --diff-split-bg token (consumed by diffView.css)
src/webview/styles/base.css           shared `.fmt-pill` utility (stats bar + diff side heads)
src/core/diff.ts                      computeByteDiff: address-keyed DiffModel (host-computed)
src/core/diffLabels.ts                disambiguatedLabels (shared by panel title + webview side heads)
src/core/wire.ts                      serializeParseResult: ParseResult -> WireParseResult (worker result)
src/diff/loadProgress.ts              combinedLoadProgress/advanceFraction: summed per-file fractions
src/diff/compareSelection.ts           host compare-selection store (session stash + hexScope.hasCompareSelection; no status-bar item)
src/webview/components/hexView/*      reused grid (showAscii:false)
src/webview/components/searchBar/*    reused search bar component
src/diffProtocol.ts                   hostwebview union (incl. diffProgress)
src/diff/diffEditorPanel.ts           host panel (webview bundle entry): loading card + throttled progress posts, worker spawn
src/parse/parseWorker.ts               shared Node worker (own thread per parsed file): `diffParse` (decode + format detect + compact parse → wire) and `hexParse` (compact parse → serialized compact result); monotonic integer-percent-throttled progress; import-safe (runs only for a known `kind` sentinel)
src/parse/parseWorkerClient.ts         shared host worker client `runParseJob()` (spawn/settle-once/abort-terminate/relay)
src/webview/render/matchSpans.ts      shared addMatchSpan (match-span set → Set<number>); used by memoryGrid + diffGrid (S3)
src/webview/render/hexCells.ts        shared buildHexCells (hex row/cell model) + isPrintableByte; used by memoryGrid + diffGrid (S9)
src/core/pathName.ts                  shared fileName(uri) basename helper; used by compareSelection.selectionName + diffEditorPanel (S3)
```

## Contract

```typescript
interface DiffSideData {
    name: string;
    format: 'ihex' | 'srec';
    parseResult: Omit<SerializedParseResult, 'records'>;  // records are host-only; the diff surface reads segments
    segmentIndex: SegmentIndexEntry[];
    labels: SegmentLabel[];
}

function hydrateDiffSide(side: DiffSide): DiffSideData;
function buildDiffRows(a: DiffSideData, b: DiffSideData): DiffRow[];
function getSideByte(side: DiffSideData, addr: number): number | undefined;
function diffKindAt(runs: readonly DiffRun[], addr: number): DiffKind | undefined;
function diffClassForSide(side: 'a' | 'b', kind: DiffKind | undefined): string;

// components/diffView/diffView.ts — DiffView controller
type DiffPane = 'a' | 'b';
interface DiffViewCallbacks {
    onVisibleWindowChange?: (pane: DiffPane, top: number, left: number) => void;
    onCellClick?: (pane: DiffPane, addr: number, shift: boolean, column: 'hex' | 'char') => void;
    onSelectionChange?: (pane: DiffPane, range: HexViewRange) => void;
    onAddressRowClick?: (pane: DiffPane, rowBase: number, shift: boolean) => void;
    onAddressRowDrag?: (pane: DiffPane, rows: HexViewRange) => void;
}
class DiffView {
    constructor(cb?: DiffViewCallbacks);
    setCallbacks(cb: DiffViewCallbacks): void;      // live: existing HexViews read the new set
    mount(): void;                                  // idempotent: create + mount both HexViews on #diff-a / #diff-b
    reset(): void;                                  // drop the HexView instances (test seam; a later mount re-creates)
    paintSelection(range: HexViewRange | null): void;   // both panes
    paintMatch(matchAddrs: readonly number[], index: number, length: number): void;   // both panes, incremental (no row rebuild)
    injectHeaders(): void;                          // both pane headers from renderHexViewHeader(false)
    setScrollTop(pane: DiffPane, top: number): void;
    setScrollLeft(pane: DiffPane, left: number): void;
    getScrollTop(pane: DiffPane): number;
}
// components/diffView/diffViewRender.ts — pure, DOM-free
function renderDiffViewBodyHtml(): string;          // the two-pane body shell (ids/classes verbatim)
function renderDiffEmptyHtml(message: string): string;  // escaped empty-state card

function mountDiffGrid(): void;
function resetDiffGrid(): void;                     // test seam: drop cached instances
function setDiffData(a: DiffSideData, b: DiffSideData, diff: DiffModel): void;
function setDiffGridHooks(hooks: { onSidesSwapped?: (a, b) => void }): void;
function setViewMode(mode: DiffViewMode): void;     // 'all' (default) | 'diff'
function getViewMode(): DiffViewMode;
function setSyncScroll(on: boolean): void;          // default true
function getSyncScroll(): boolean;
function setSearchMatches(addrs: readonly number[], active: number, length: number): void;
function currentSides(): { a: DiffSideData; b: DiffSideData } | null;
function copySelectionText(): { text: string; label: string } | null;
function swapSides(): DiffModel | null;             // swaps a/b, recomputes the diff, re-renders
function scrollToDiff(range: HexViewRange, options?: { selection?: boolean }): void;   // nav: frame + scroll both grids
function flushDiffRender(): void;                    // test seam: complete a pending scroll frame synchronously (poll included)
function applyReload(a: DiffSideData, b: DiffSideData, diff: DiffModel): void;   // external reload: preserve viewMode + per-pane scroll anchors, reset selection/search
function applyDiffProgress(message: DiffProgressMessage): void;   // loading-card text only (indeterminate bar)
function showDiffError(message: string): void;       // hides the loading card, shows the error card

function createDiffExternalChangeBanner(post: (message: DiffWebviewToProvider) => void): DiffExternalChangeBanner;  // diffExternalChange.ts
function sideDefects(wire: WireParseResult): { checksumErrors; malformedLines; canQuickRepair } | null;  // diffReload.ts
function buildDiffState(refA, a: ParsedDiffSide, refB, b: ParsedDiffSide): DiffReloadState;             // diffReload.ts
function reloadState(state: DiffReloadState, side: 'a' | 'b', ref, parsed: ParsedDiffSide): DiffReloadState; // diffReload.ts

function mountDiffSearch(): void;                    // diffSearch.ts: inject the bar + re-push the count
function refreshDiffSearchCount(): void;             // re-push the count after a toolbar re-render
function resetDiffSearch(): void;                    // drop matches/bar for a replaced document
function shouldNavigateCompletedSearch(query: string, searchKey: string, trigger: SearchTrigger, lastCompletedSearchKey: string): boolean;  // src/webview/search/searchNavigation.ts
function isSearchDiverged(query: string, mode: SearchMode, endianness: SearchEndianness, activeKey: string, completedKey: string): boolean;  // src/webview/search/searchNavigation.ts

function setDiffSummary(diff: DiffModel): void;      // also re-injects the always-visible SearchBar
function dispatchDiffMessage(message: unknown, handlers: DiffMessageHandlers): boolean;  // diffInit | diffError | diffProgress
function renderSideHeadHtml(label: string, format: 'ihex' | 'srec'): string;             // diffModel.ts: name + `.fmt-pill`
function disambiguatedLabels(a: PathLabelInput, b: PathLabelInput): [string, string];   // src/core/diffLabels.ts
```

`DiffPane` ships from `components/diffView/diffView.ts`; the host imports it. `DiffView` is the only grid controller the host talks to — the host never constructs a `HexView` or wires per-pane callbacks. Callers use `DiffViewMode` for the view toggle.

## Rules

- **Address-keyed, host-computed:** the host computes `DiffModel` in `src/core/diff.ts` and ships both serialized sides; the webview only maps runs to cell classes and rows.
- **One shared row model:** `buildDiffRows` unions the mapped 16-byte blocks of both sides; either grid renders the same rows, so scroll stays aligned.
- **Empty over synthetic:** `getSideByte` returns `undefined` for unmapped addresses; unmapped cells are `be` empties, never `00`.
- **Hex only:** both grids render `showAscii:false` — no decoded-text header label, no char cells.
- **Side semantics:** `diff-chg` on both sides; `diff-add` on B only; `diff-del` on A only (`diffClassForSide`).
- **Address columns:** both panes render their own address gutter; there is no `.diff-hide-addr` variant.
- **Divider:** a dedicated `.diff-split` element sits between the panes — `flex: 0 0 3px`, higher-contrast token, `:hover` brighten, static (not draggable). `.diff-side` carries no border.
- **Panel labels:** `disambiguatedLabels` labels each side with its basename, upgrading to the shortest distinct trailing path suffix when both basenames collide; the full path is always the element `title`. The panel tab title uses the same labels.
- **Component/host split (mirrors `HexView`/`memoryGrid`):** `DiffView` (`components/diffView/`) owns the two `HexView` instances bound to `#diff-a`/`#diff-b`, the two-pane body markup (`renderDiffViewBodyHtml`), the empty-state card (`renderDiffEmptyHtml`), pane-qualified callback re-exposure (`(pane, …)`), mirrored-selection paint (`paintSelection`), incremental match paint (`paintMatch`), header injection (`injectHeaders`), per-pane scroll control (`setScrollTop`/`setScrollLeft`/`getScrollTop`), reset, and the grid-surface styles. `diffGrid.ts` keeps all state and decisions (data, `visibleRows`, view mode, selection range + source pane, `syncScroll`, per-pane `VirtualScrollState`, slice compute, the render loop + driver poll, `sliceKey` gating, `scrollToDiff`/`scrollToRow`, matches, copy, error/progress), resolves each pane's rows/container, and writes the rows `innerHTML`/layout - exactly as `memoryGrid` writes `#mem-rows`. The component never imports a host module or computes a slice.
- **Mirrored read-only selection:** the host owns one `selection` range plus the source pane. `DiffView` re-exposes the five `HexView` callbacks (`onCellClick`, `onSelectionChange`, `onAddressRowClick`, `onAddressRowDrag`, `onVisibleWindowChange`) with the pane argument; they feed `applySelection`, which repaints both grids via `diffView.paintSelection`.
- **Copy:** `Ctrl+C` (host document keydown, selection present) resolves the source pane's mapped bytes for the selection, skips unmapped addresses (never zero-filled), and posts `copyText`; the panel writes `vscode.env.clipboard`. `HexView`'s drag-time `onCopy` is deliberately not wired — the document handler owns copy.
- **View modes:** `Show all` (default) renders the full union row model; `Show diff` keeps only `data` rows with at least one diff byte (identical rows hidden; `No differences` when the filtered list is empty) and inserts a bare `kind:'gap'` row with `gap.line` between two consecutive kept rows that skip address space (non-contiguous: next row base > previous base + 16), rendered as an empty `.gap-line` at the existing gap height, so the skipped span is visible in both panes without adding a row kind or metric. Navigating a run keeps the current mode.
- **Scroll sync (per-pane state):** each pane owns its own virtual-scroll state (`scrollPaneA`/`scrollPaneB`, `ensureScrollState`/`currentSlice(pane)`), so two scroll positions are representable. `mountDiffGrid` wires `DiffView`'s pane-qualified `onVisibleWindowChange(pane, top, left)` into `syncFrom`. `Sync scroll` (default ON) then tracks the follower on two clocks (see the next bullet): its **logical window** (`state.scrollTop`) mirrors the driver every frame, while its **native `scrollTop`** is written only at reconcile/settle. With `Sync scroll` OFF the follower is neither mirrored nor polled and keeps rendering its own rows at its own position (`state` and native `scrollTop` both untouched); `setSyncScroll(true)` re-aligns the follower to the driver's current position and clears any transform. Rejected alternative: one shared `VirtualScrollState` — it cannot hold two positions, so the un-mirrored pane rendered the driver's window at its stale offset and showed blank space (C5). Second rejected alternative: one shared scroll container for both panes (zero mirror latency) — it removes the independent per-pane position `Sync scroll` off relies on.
- **Driver poll + follower tracking/reconcile (two clocks):** the driver's native `scrollTop` is animated by the compositor and `scroll` events are coalesced, so a per-event mirror makes the follower visibly trail. `applyDriverScroll` therefore only documents the event (`state`, horizontal mirror, `lastDriver`) and calls `startScrollPoll(driver)`: a `requestAnimationFrame` loop (`pollFrame`) that reads the driver container's **live** `scrollTop` each frame, updates the driver's logical state, mirrors the follower's logical state, and re-runs `renderScrollSlice` (no separate per-event render — `scheduleRender` no-ops while `scrollPollHandle` is alive). The poll starts only on a driver `scroll` event with sync on and stops once `scrollTop` is unchanged for `SETTLE_FRAMES = 2` consecutive frames (no idle background polling); `resetDiffGrid`/`setDiffData`/`applyReload`/`setSyncScroll`/`flushDiffRender` stop it. Vertical tracking is split: `applyFollowerVisual` computes `delta = driver.container.scrollTop − follower.container.scrollTop` fresh each frame and writes `translateY(${-delta}px)` on the follower's host-owned `.mem-rows` wrapper (compositor-only, never accumulated ⇒ cannot drift); `reconcileFollower` writes the follower's real `scrollTop`/state and clears the transform. `renderScrollSlice` reconciles before `drawSlice` whenever `sliceKey` changed, and on a `sliceKey`-unchanged tracking frame only repositions the driver and applies the visual delta. Settle (`finalizeFollower`) and every real `drawSlice` restore the invariant *transform empty, follower `scrollTop` real*, so one-shot operations (`scrollToDiff`, `alignFollowerToDriver`, reload anchor restore) are never double-offset. Accepted tradeoff: the follower's native scrollbar thumb snaps between reconciles.
- **Scroll stability:** scroll-driven renders coalesce to one per animation frame (`requestAnimationFrame`, `setTimeout(16)` fallback) and rebuild row HTML only when the slice key — both panes' visible `[start, end)`, `heightVersion`, container height, row count, view mode, sync flag — changes. Per-pane `bufferSize` is `overscanRowCount(containerHeight, rowHeight, BUFFER_SIZE)` (shared helper in `render/virtualScroll.ts`): at least `BUFFER_SIZE = 10` rows floor, growing to a full viewport of extra rows per side so a fast/inertial fling cannot outrun the rendered slice before the next frame. Container height is part of the key because it is part of the scroll-state identity (`isCurrentScrollState`), so a resize that keeps the same row range still re-applies the physical layout (and re-derives the overscan). On the skip path (key unchanged) `repositionPane(pane)` still runs for the driver every frame (and for the follower on the non-tracking reconcile path): in compressed mode it rewrites the absolute rows wrapper's `top` (`clampWindowTop(container.scrollTop + topSpacer − state.scrollTop, physicalHeight, sliceHeight)`, identical math to `drawPane`), memoised per pane so an unchanged value is not written again, while the slice tracks the pane's real native `scrollTop` even when the visible row range holds; in uncompressed mode it is a no-op (native flow already stays aligned). Without this the driver pane's compositor-driven `scrollTop` outran the frozen wrapper and blanked the pane. Direct renders (`setDiffData`/`setViewMode`/`scrollToRow`) stay synchronous; `setDiffData`/`resetDiffGrid` cancel a pending frame. `flushDiffRender` is the test seam: it completes a pending frame synchronously and stops the poll (reconciling the follower).
- **Programmatic-scroll guard (one render per jump):** `scrollToDiff`/`scrollToRow` already renders synchronously at the destination, so the native `scroll` event a programmatic `setScrollTop`/`setScrollLeft` write would fire (in a real browser) must not schedule a second frame. `scrollPaneToRow`, `restoreAnchor`, and `alignFollowerToDriver` each record `suppressDriverScroll(pane, physicalTop)` — a `Map<DiffPane, number>` keyed on the exact physical position written; `applyDriverScroll` calls `consumeSuppressedScroll(driver, top)`, which deletes the entry and, on an exact match (`< 0.001px`), documents the logical state + `lastDriver` and returns before `startScrollPoll`/`scheduleRender`. A mismatch (a genuine user scroll) consumes the stale entry and processes normally, so the guard is one-shot; `resetDiffGrid`/`setDiffData`/`applyReload`/`setSyncScroll` clear the map. Net: a search jump costs exactly one synchronous render per pane at the destination — no pre-jump full rebuild and no deferred redraw from the programmatic scroll.
- **Toolbar (two rows):** row 1 is `Show all`/`Show diff` + `Prev diff`/`Next diff` (left), `Swap sides` (center, on the pane split), the always-visible `SearchBar` (right); row 2 is `Sync scroll` (left) and the changed/added/removed stat centered. A 3-slot `1fr auto 1fr` grid keeps the centers on the split line.
- **Icon + text action buttons:** every `.diff-action` is an `inline-flex` button (`gap: 5px`, `height: 26px`, `padding: 0 8px`, auto width) holding `<span class="diff-action-glyph" aria-hidden="true">` (`▲` prev, `▼` next, `≡` show all, `≠` show diff, `⇄` swap, `⇅` sync) plus `<span class="diff-action-text">` (`Prev diff` / `Next diff` / `Show all` / `Show diff` / `Swap sides` / `Sync scroll`), with the descriptive `title` + `aria-label` unchanged; toggles keep the `.active` state, `:disabled` stays dimmed. Unicode glyphs only — no codicon font/SVG.
- **Format pill:** side heads render `<name> <span class="fmt-pill">IHEX|SREC</span>` via `renderSideHeadHtml` (no `·` separator); `.fmt-pill` is the one shared utility in `styles/base.css` also used by the single-file stats bar. The full path stays the head's `title`.
- **Loading card + progress:** `diffHtml` renders the shared `.loading-*` card (`#diff-loading`) in `#app`; `DiffEditorPanel` reads both files **concurrently on the extension host** (`Promise.all`; reads are host-side and only concurrent — **not** in workers), then parses each in its own `worker_threads` worker (`src/parse/parseWorker.ts` via `runParseJob`, one per side, parallel parse, bytes transferred), and posts throttled `diffProgress` (`read`/`parse`/`diff`, completed/total) by summing the two per-file fractions (`src/diff/loadProgress.ts`; read fills `0 → 0.05` (`READ_SHARE`, deliberately small because reads are fast and post no progress), parse `0.05 → 1`, `total = 2`, each file clamped monotonic by `advanceFraction`) while diffing. The worker reports one monotonic `fraction` per file (parser `parse` scan `[0, 0.9]`, `build` `[0.9, 1]`, running max), throttled to integer percent so at most 101 progress messages are posted per file (a per-event post is a firehose the single host main thread must drain, serializing the two workers), so the bar never regresses across the stage switch. The card is swapped for `#diff-root` on `diffInit`/`diffError` (`applyDiffProgress` updates the card text meanwhile; the bar keeps the shared indeterminate animation, never width-driven).
- **Swap:** `Swap sides` exchanges `data.a`/`data.b`, the side heads, and recomputes `computeByteDiff` for the new base pair, so counts and colors follow the file (`added` ↔ `removed`).
- **Search:** the reused `SearchBar` (`diffSearch.ts`) is mounted on boot into the row-1 right slot and re-injected after each toolbar render; there is no `Find` button and no open/close gating. One query runs over both sides' hydrated segments, match addresses are unioned/deduped, and both grids paint from render-input `matchSet`/`activeMatch`. The executed needle span expands the highlight (parity with `memoryGrid.addMatchSpan`); the count is the combined distinct address count. `Ctrl+F` focus/select stays inside the component. `setSearchMatches` updates `matchSet`/`activeMatch` and repaints **incrementally** through `DiffView.paintMatch(addrs, active, span)` (both panes' `HexView.paintMatch` → `paintMatchesInRoot`) — it never triggers a row rebuild, so a streamed batch is O(visible cells) instead of a full double-pane `innerHTML` rebuild; the declarative `matchSet`/`activeMatch` still drive any later redraw (scroll/view-mode/reload), exactly as `memoryGrid` does. Each search action (`onProgress`'s first-jump, `onComplete`, `stepMatch`) issues one `setSearchMatches` then one `scrollToActive()`, so a jump renders once, at the destination.
- **Search parity with the hex view:** the pure decisions live in `src/webview/search/searchNavigation.ts` (`shouldNavigateCompletedSearch`, `isSearchDiverged` — DOM/`S`-free, imported by both hosts). The diff host tracks `completedKey`/`activeKey`/`running`: repeat-Enter on an unchanged completed query navigates instead of re-running, a new key while running cancels the old search, a Run click on the in-flight search is a no-op (hex parity), `onProgressUpdate` streams matches (incremental paint + count + a one-time first jump, no full double-pane rebuild per batch; a later redraw repaints from the declarative `matchSet`), `onComplete` preserves the active match, `stepMatch` wraps with modulo, a UI-only change drops matches only when `isSearchDiverged` (empty query counts as diverged), `applyMatches` selects the active match (`scrollToDiff(..., { selection: true })`), and `mountDiffSearch` re-pushes the count via `refreshDiffSearchCount()` after each re-injection.
- **Search selection pane / hidden rows:** a search-driven selection sets `selectionPane` to a pane that maps the match address (`paneForAddress`, preferring a pane that maps the span), so `Ctrl+C` copies real bytes for a hit mapped only in B (C1). `scrollToDiff` applies the mirrored selection before the row lookup and scrolls only when the row is visible, so in `Show diff` mode a match on a hidden (identical/gap) row is selected on both panes without scrolling (C4).
- **Hidden-state gating:** `.diff-body[hidden]` and `.diff-error[hidden]` must keep `display: none`; `.diff-error`'s `display: grid` otherwise defeats the `hidden` attribute and splits the viewport (blank lower half).
- **Read-only surface:** no editing, save, scripts, integrity, sidebar, or context menus; selection/nav only.
- **Typed protocol:** `dispatchDiffMessage` rejects unknown/malformed messages; handlers are an exhaustive `DiffMessageHandlers` map. `diffInit` is validated structurally before hydration — `isDiffSide` (name/path/format strings, `parseResult.recordCount` number, `segments` array of `{ startAddress: number, data }`, `labels` array) and `isDiffModel` (`runs` array with `start`/`end`/`kind`) — so a malformed `diffInit` returns `false` from the dispatcher and never reaches `hydrateDiffSide` (S5). Validate shapes shallowly (no per-byte scan) to keep large-pair loads cheap.
- **Isolation:** the bundle imports only `diff/`, `search/searchNavigation.ts`, `components/{diffView,hexView,searchBar}/`, `render/virtualScroll.ts`, `core/{diff,diffLabels,memory,search,types,byteTools}`, and `diffProtocol.ts`. `components/diffView/` imports `components/hexView/` (component → component, fine); no host module imports back up into the component. No `vscode`, no `S`, no single-file shell.
- Untrusted text (file names, error text) escaped with `esc()`.

## Behaviour

- Root shell order: `#app` holds the `#diff-loading` card; `#diff-root` (hidden until init) holds `#diff-summary` (two-row toolbar + injected search slot), then `renderDiffViewBodyHtml()`'s `#diff-body` (two `.diff-side` panels with a `.diff-split` between them, each with its own address gutter), then `#diff-error` (hidden error card). The composition root (`diffViewer.ts`) assembles summary + body markup + error card; the body markup is owned by the component render layer.
- Side heads show the (disambiguated) `<name>` plus the `.fmt-pill` format, with the full path as `title`.
- Toolbar row 1 (left→right): `Show all` `≡`, `Show diff` `≠`, `Prev diff` `▲`, `Next diff` `▼` — then `Swap sides` `⇄` centered on the split and the always-visible search bar on the right. Row 2: `Sync scroll` `⇅` left, changed/added/removed stat centered. `Show all`/`Show diff`/`Sync scroll` carry an `active` class when on; `Prev diff` is disabled at the first run, `Next diff` at the last.
- `scrollToDiff` finds the run's row, positions it a couple of rows below the top, re-slices, and mirrors both grids.
- Error state hides `#diff-body` (the `hidden` attribute must actually collapse it) and shows the escaped message card; the loading card is hidden in both the init and error paths.
- On mount the webview posts `{ type: 'ready' }`; the host streams `diffProgress` while loading, then `diffInit` hydrates both sides, renders heads, grid, and summary (or `diffError` shows the error card). `Ctrl+C` with a selection posts `{ type: 'copyText', text, label }`.

## Validation & Error Matrix

| Condition | Behaviour |
|---|---|
| Empty run list (identical files) | Grid renders plain; no cell carries a `diff-*` class; summary shows 0/0/0. |
| `Show diff` on an identical pair | Filtered list is empty → both grids render the `No differences` placeholder. |
| Address mapped on one side only | Unmapped side renders an empty `be` cell; mapped side carries `diff-add`/`diff-del`. |
| Whole aligned block unmapped both sides | Gap row, never per-address rows. |
| `Show diff` with non-contiguous kept diff rows | A bare `gap.line` separator row sits between them in both panes at the same position; contiguous rows (next base = previous + 16) get none, and a single diff row / empty filtered list gets none (no leading/trailing separator). |
| `diffError` received | Error card replaces the body (body actually hidden, loading card hidden); message escaped. |
| `diffProgress` received | Loading card text becomes `Loading read …%` / `Loading parse …%` / `Loading diff …%` (raw stage names, parity with the hex view); the bar stays indeterminate and is never width-driven; grids stay hidden until `diffInit`. |
| Unknown message type | `dispatchDiffMessage` returns false; no handler runs (malformed `diffProgress` stage/fields rejected too, and a malformed `diffInit` is rejected structurally without throwing). |
| Large union range | Virtualized slice per pane via its own `VirtualScrollState`; logical scroll preserved across re-slice. |
| One grid scrolled | With `Sync scroll` on, the driver is polled per frame: the follower's logical window, horizontal offset, and header follow immediately; its native `scrollTop` is written at the next slice-key change or on settle; sub-row frames move it with `translateY` only. With it off the follower does not move **and keeps rendering its own rows at its own position** (no blank pane). |
| Scroll while compressed | Scroll renders coalesce to one per frame; an unchanged slice skips the row rebuild but still repositions the compressed wrapper (write-if-changed) so the actively scrolled pane is never blanked per event. |
| Scroll settles | After ~2 unchanged poll frames the loop stops with no pending frame; the follower's real `scrollTop` is reconciled and its transform cleared, so no idle polling and no residual delta for a later one-shot scroll. |
| Selection spans unmapped addresses | Mirrored range paints on both panes; copy emits only mapped source bytes. |
| Query matches both panes at the same address | Address unioned once; count reflects distinct addresses. |
| Search `Enter`/`Shift+Enter` | Fresh query runs; `Shift+Enter` starts from the last match; repeat-Enter on an unchanged completed query navigates (no re-run); next/prev wrap at both ends. Always-visible bar; `Ctrl+F` focuses/selects the input. |
| Search UI-only change | Matches kept while the visible key still matches the running/completed search; dropped (`0 / 0`) once it diverges (empty query counts as diverged). |
| Streamed search batches | Each batch updates `matchSet`/`activeMatch` and repaints matches incrementally on both panes (`DiffView.paintMatch`), with **zero** row `innerHTML` rebuilds; the first non-empty batch jumps once; a later redraw (scroll / `setViewMode`) repaints matches from the declarative state. |
| Search jump (`Next`/`Prev`/Enter/streamed first match) | Exactly one synchronous render per affected pane, at the destination — no pre-jump full rebuild; the programmatic `setScrollTop`'s native `scroll` event is suppressed (no poll, no deferred frame), while a genuine later user scroll still polls. |

## Tests Required

`src/test/webview/diffViewer.test.ts` (mocha + jsdom + cssImportHook): shared `data-row` order across both sides + gap row between distant blocks; changed byte on both sides; added empty-on-A / value-on-B; removed value-on-A / empty-on-B; computed summary counts + the exact action-button order with per-button glyph span + text span + `title`+`aria-label` (glyph `aria-hidden`); the two-row toolbar grouping (row 1 left/center/right, row 2 sync + centered stat); prev/next traversal and end stops; vertical + horizontal scroll sync (both directions, header alignment) after the frame settles, the sync-off gate, and scroll-render coalescing + unchanged-slice skip (innerHTML-write probe via `flushDiffRender`) plus a compressed-mode frame proving the wrapper's `top` tracks the new `scrollTop` without a row rebuild and a write-if-changed probe; the controllable-rAF poll contract (one self-rescheduling frame while the position changes, a sub-row frame applying `translateY(-delta)` with the follower's real `scrollTop` untouched and no row rebuild, a slice-change frame reconciling the real `scrollTop` + redrawing + clearing the transform, settle stopping the loop and restoring the real position with an empty transform, repeated gestures leaving no drift and no pending frame, sync-off never polling, and a one-shot `scrollToDiff` after a tracking frame leaving no residual delta); decoded text hidden (`.mem-hdr-decoded`, `.col-decoded`, `.char-cell` absent); address gutter on both panes; error card + hidden body; always-visible search (no `Find` button) + `Ctrl+F` focus; a real `SearchBar`-driven query proving one search over both panes, address union/dedupe, needle-span highlight, and next walking the addresses; repeat-Enter navigation with no second engine run (spy on `SearchEngine.prototype.search`), next/prev modulo wrap, same-key keep vs diverged drop, a streamed `onProgressUpdate` batch painting/counting/selecting, and the count surviving a `setDiffSummary` toolbar re-render; click/shift-click/address-gutter selection mirrored on both panes with copy reading the source pane; `Swap sides` flipping colors and counts; `Show diff` filtering + `No differences`; `renderSideHeadHtml` format pill (no separator, escaped label) + the `.fmt-pill` base.css guard; `applyDiffProgress` text-only updates (`Loading read …%`) with no inline bar width and no `det` class, and `diffProgress` dispatch/rejection; the external-change messages (dispatcher routes/rejects `diffExternalChange`/`diffExternalChangeError`, the reused reload banner shown, accept applies the new pair + posts `reloadAccepted`, `viewMode` + scroll anchor kept, selection/search reset, the error banner posting `repairAndReload`/`viewInNormalEditor`); `src/test/core/diffReload.test.ts` for `sideDefects`/`buildDiffState`/`reloadState`; unknown-message rejection; a stylesheet guard for the `[hidden]` rules, the 3px splitter, and the absence of `.diff-hide-addr`. Search-latency additions: the first streamed batch jumps with one render per pane (both panes' `innerHTML`-write probe); later streamed batches rebuild **zero** rows yet still paint their visible match, and the completed count stays correct; a redraw after a batch repaints matches from the declarative `matchSet`; a jump queues no deferred frame and its programmatic `scroll` event is suppressed (`rafController.pending()` probe), while a genuine later user scroll at a different position still starts the poll.

`src/test/webview/components/diffView.test.ts` (mocha + jsdom + cssImportHook) owns the component's DOM primitives: `renderDiffViewBodyHtml` ids/classes/pane order; `renderDiffEmptyHtml` escaping; `mount` creates + mounts both `HexView`s and is idempotent; `reset` drops the instances so a later mount re-creates them; pane-qualified re-exposure for each of the five callbacks (cell click + column, drag selection, address-gutter click, address-gutter row-drag range, scroll window); `setCallbacks` swaps the live handler set; `paintSelection` mirrors on both panes (null clears); `injectHeaders` fills both hex-only headers; per-pane `setScrollTop`/`getScrollTop`/`setScrollLeft` (header alignment); `paintMatch` mirrors the match/active-match span on both panes and clears on an empty list. The host suite below keeps the data/behavior coverage.

`src/test/core/diff.test.ts` owns the run semantics and `disambiguatedLabels`; `src/test/core/diffLoadProgress.test.ts` owns the concurrent-load fraction summing (clamped, monotonic via `advanceFraction`, bounded by `total`); `src/test/core/parseWorker.test.ts` owns the worker round-trip (IHEX + SREC format/segment bytes, monotonic integer-percent-bounded progress, invalid-job error; plus `hexParse` hydrate/materialize + per-stage throttling); `src/test/extension/extension.test.ts` owns command registration (the three Explorer compare commands — `hexScope.selectAsFirst` / `hexScope.compareToStaged` / `hexScope.compareSelected`; `hexScope.compareWith` and the A3 command names are gone), the manifest gate (only those three sit in `group: "3_compare"`, each `when` carries `explorerViewletFocus` — never the editor title — `selectAsFirst` carries `!listMultiSelection`, `compareToStaged` carries `hexScope.hasCompareSelection`, `compareSelected` carries `listDoubleSelection` so 3+ shows no item, no other menu point lists a compare command, and `navigation` keeps only Open with HexScope / Quick Repair), the `CompareSelectionStore` set/clear lifecycle, `selectedComparePair`/`stashedComparePair` ordering and rejection, `runCompare` validation/clear-on-success, and `copyText` parsing + clipboard write plus `diffProgress`/`diffInit` recognition by `diffMessageType`.

## Decisions

Review-follow-up decisions (parent `09-21-hex-diff-review-followups`, D1/D3). These are deliberate keeps, not accidental scope.

- **B1 — tab-title `↔` separator kept.** The panel title is `<a> ↔ <b>` (`diffEditorPanel.ts`). No originating requirement names a title separator; it is a small disambiguation of the two compared files and is kept.
- **B2 — aggregate `"No data records found."` kept.** The aggregate view renders this placeholder when the union row model has no `data` rows. R12 only mandates `"No differences"` for the `Show diff` filter on an identical pair; the aggregate empty state is kept so an all-gap pair is never a blank grid.
- **B3 — runtime message guards kept.** `dispatchDiffMessage` plus the `isDiffSide` / `isDiffModel` structural checks reject malformed `diffInit`/`diffProgress` before hydration. Design declared typed unions only; the guards are defensive and are reinforced by the boundary tightening (S5). Kept.
- **B4 — `DiffSide.labels` retained seam.** `diffSide()` sends `labels: []` and `hydrateDiffSide` copies the field, but nothing renders it on this branch. It is a harmless wire field retained to keep a future per-side segment-label feature cheap. Kept.
- **R7 — segment-label context deliberately NOT implemented on this branch** (parent D1; the `hex-diff-r7-label-context` child was deleted). `diffSide()` hardcodes `labels: []`, and `.seg-banner` exists only in the single-file renderer (`hexViewRender.ts`). `src/core/diffLabels.ts` is file-name disambiguation for pane labels/tab title (R16) — not segment labels.

## Anti-patterns

- Zero-filling unmapped bytes (`?? 0`) — creates false differences, and copy must skip unmapped addresses.
- Reading `S`/`state.ts` or posting single-file provider messages from the diff bundle.
- Registering the diff as a `CustomReadonlyEditorProvider` (it compares two documents).
- Writing grid cell DOM directly instead of using `HexView` render input + paint methods.
- Adding sidebar/toolbar/integrity/scripts chrome to the diff surface.
- Persisting diff state or touching `.hexscope/` from the diff panel.
- Letting `display: flex/grid` on `.diff-body`/`.diff-error` win over their `[hidden]` guard (reintroduces the blank lower half).
- Writing grid DOM from the scroll path without coalescing (per-event `innerHTML` rebuild blanks/flickers the scrolled pane).
- A `Find` button / hidden-until-toggled search bar in the diff surface (the bar is always visible).
- Duplicating the format-pill rule outside the shared `.fmt-pill` utility (or reintroducing the ` · ` name/format separator).
- Reintroducing a hidden-address-column variant instead of giving each pane its own gutter.
- Forking a diff-only external-change banner instead of reusing `ExternalChange`, or applying a reload with `setDiffData` (it resets view mode/scroll; use `applyReload`).
