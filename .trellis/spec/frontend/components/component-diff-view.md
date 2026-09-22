# Component Spec — DiffView

> Built from `component-template.md`. Owns the read-only two-grid diff surface as a self-contained webview bundle, reusing `HexView` for each grid.

## Scope / Trigger

Owns `src/webview/diffViewer.ts` (composition root), `src/webview/diff/` (`diffModel.ts`, `diffGrid.ts`, `diffSummary.ts`, `diffSearch.ts`, `diffMessages.ts`, `diff.css`), and the host-side compare-selection store `src/diff/compareSelection.ts` + `src/core/diffLabels.ts`: the dedicated read-only editor comparing two IHEX/SREC files. It renders one shared union row model across two `HexView` instances, a two-row summary/action toolbar, prev/next run navigation, an always-visible reused `SearchBar`, mirrored read-only selection, and a host-driven loading card with an indeterminate bar and a text progress label.

Boundary rule: the diff host owns data (both `DiffSideData`, `DiffModel`, per-pane `VirtualScrollState` — `scrollPaneA`/`scrollPaneB`) and all domain decisions. `HexView` stays presentational; the diff host never writes grid cell DOM directly and never touches the single-file app shell (`state.ts`, `S`, sidebar, toolbar, integrity, scripts).

## Layout

```text
src/webview/diffViewer.ts             composition root: shell HTML, ready handshake, message dispatch (init/error/progress), Ctrl+C copy, side heads
src/webview/diff/diffModel.ts         hydrateDiffSide, buildDiffRows, getSideByte, diffKindAt, diffClassForSide, renderDiffErrorHtml, renderSideHeadHtml
src/webview/diff/diffGrid.ts          mount/reset, setDiffData, view mode, mirrored selection, copy, swap, search matches, scrollToDiff, loading-card swap, coalesced scroll renders
src/webview/diff/diffSummary.ts       renderDiffSummaryHtml + setDiffSummary: two-row toolbar, icon+text action buttons, stat, search slot, action wiring
src/webview/diff/diffSearch.ts        SearchBar reuse (always mounted): one query over both sides, unioned match addresses, completed-key nav, streaming paint, modulo next/prev walk, refreshDiffSearchCount
src/webview/search/searchNavigation.ts pure shared search decisions (shouldNavigateCompletedSearch, isSearchDiverged) — no DOM/`S`, reused by both hosts
src/webview/diff/diffMessages.ts      typed dispatchDiffMessage (unknown rejected) for diffInit/diffError/diffProgress
src/webview/diff/diff.css             layout, .diff-root, .diff-split divider, .diff-chg/.diff-add/.diff-del, toolbar rows, icon buttons, hidden-state guards
src/webview/styles/base.css           shared `.fmt-pill` utility (stats bar + diff side heads)
src/core/diffLabels.ts                disambiguatedLabels (shared by panel title + webview side heads)
src/diff/compareSelection.ts           host compare-selection store (session stash + hexScope.hasCompareSelection; no status-bar item)
src/webview/components/hexView/*      reused grid (showAscii:false)
src/webview/components/searchBar/*    reused search bar component
src/diffProtocol.ts                   hostwebview union (incl. diffProgress)
src/diff/diffEditorPanel.ts           host panel (webview bundle entry): loading card + throttled progress posts, worker spawn
src/diff/diffParseWorker.ts           Node worker (own thread per file): decode + format detect + compact parse; monotonic integer-percent-throttled fraction + wire result; import-safe (runs only for the `diffParse` job sentinel)
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
function flushDiffRender(): void;                    // test seam: render a pending scroll frame synchronously
function applyDiffProgress(message: DiffProgressMessage): void;   // loading-card text only (indeterminate bar)
function showDiffError(message: string): void;       // hides the loading card, shows the error card

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

`DiffPane` is module-private to `diffGrid.ts`; callers use `DiffViewMode` only.

## Rules

- **Address-keyed, host-computed:** the host computes `DiffModel` in `src/core/diff.ts` and ships both serialized sides; the webview only maps runs to cell classes and rows.
- **One shared row model:** `buildDiffRows` unions the mapped 16-byte blocks of both sides; either grid renders the same rows, so scroll stays aligned.
- **Empty over synthetic:** `getSideByte` returns `undefined` for unmapped addresses; unmapped cells are `be` empties, never `00`.
- **Hex only:** both grids render `showAscii:false` — no decoded-text header label, no char cells.
- **Side semantics:** `diff-chg` on both sides; `diff-add` on B only; `diff-del` on A only (`diffClassForSide`).
- **Address columns:** both panes render their own address gutter; there is no `.diff-hide-addr` variant.
- **Divider:** a dedicated `.diff-split` element sits between the panes — `flex: 0 0 3px`, higher-contrast token, `:hover` brighten, static (not draggable). `.diff-side` carries no border.
- **Panel labels:** `disambiguatedLabels` labels each side with its basename, upgrading to the shortest distinct trailing path suffix when both basenames collide; the full path is always the element `title`. The panel tab title uses the same labels.
- **Mirrored read-only selection:** the host owns one `selection` range plus the source pane. `HexView` callbacks (`onCellClick`, `onSelectionChange`, `onAddressRowClick`, `onAddressRowDrag`) feed `applySelection`, which repaints both grids with `paintSelection`.
- **Copy:** `Ctrl+C` (host document keydown, selection present) resolves the source pane's mapped bytes for the selection, skips unmapped addresses (never zero-filled), and posts `copyText`; the panel writes `vscode.env.clipboard`. `HexView`'s drag-time `onCopy` is deliberately not wired — the document handler owns copy.
- **View modes:** `Show all` (default) renders the full union row model; `Show diff` keeps only `data` rows with at least one diff byte (gap and identical rows hidden) and shows `No differences` when the filtered list is empty. Navigating a run keeps the current mode.
- **Scroll sync (per-pane state):** each pane owns its own virtual-scroll state (`scrollPaneA`/`scrollPaneB`, `ensureScrollState`/`currentSlice(pane)`), so two scroll positions are representable. `mountDiffGrid` wires each `HexView` `onVisibleWindowChange(top, left)` into `syncFrom`: the driver updates **its** state and renders its slice; `Sync scroll` (default ON) then mirrors `setScrollTop`/`setScrollLeft` onto the follower behind a re-entrancy guard, and the follower re-derives its own window from the mirrored position. With `Sync scroll` OFF the follower is not mirrored and keeps rendering its own rows at its own position. `setSyncScroll(true)` re-aligns the follower to the driver's current `scrollTop`. Rejected alternative: one shared `VirtualScrollState` — it cannot hold two positions, so the un-mirrored pane rendered the driver's window at its stale offset and showed blank space (C5).
- **Scroll stability:** scroll-driven renders coalesce to one per animation frame (`requestAnimationFrame`, `setTimeout(16)` fallback) and are skipped when the slice key — both panes' visible `[start, end)`, `heightVersion`, container height, row count, view mode, sync flag — is unchanged. Container height is part of the key because it is part of the scroll-state identity (`isCurrentScrollState`), so a resize that keeps the same row range still re-applies the physical layout. Direct renders (`setDiffData`/`setViewMode`/`setSearchMatches`/`scrollToRow`) stay synchronous; `setDiffData`/`resetDiffGrid` cancel a pending frame. `flushDiffRender` is the test seam.
- **Toolbar (two rows):** row 1 is `Show all`/`Show diff` + `Prev diff`/`Next diff` (left), `Swap sides` (center, on the pane split), the always-visible `SearchBar` (right); row 2 is `Sync scroll` (left) and the changed/added/removed stat centered. A 3-slot `1fr auto 1fr` grid keeps the centers on the split line.
- **Icon + text action buttons:** every `.diff-action` is an `inline-flex` button (`gap: 5px`, `height: 26px`, `padding: 0 8px`, auto width) holding `<span class="diff-action-glyph" aria-hidden="true">` (`▲` prev, `▼` next, `≡` show all, `≠` show diff, `⇄` swap, `⇅` sync) plus `<span class="diff-action-text">` (`Prev diff` / `Next diff` / `Show all` / `Show diff` / `Swap sides` / `Sync scroll`), with the descriptive `title` + `aria-label` unchanged; toggles keep the `.active` state, `:disabled` stays dimmed. Unicode glyphs only — no codicon font/SVG.
- **Format pill:** side heads render `<name> <span class="fmt-pill">IHEX|SREC</span>` via `renderSideHeadHtml` (no `·` separator); `.fmt-pill` is the one shared utility in `styles/base.css` also used by the single-file stats bar. The full path stays the head's `title`.
- **Loading card + progress:** `diffHtml` renders the shared `.loading-*` card (`#diff-loading`) in `#app`; `DiffEditorPanel` reads both files, parses each in its own `worker_threads` worker (`src/diff/diffParseWorker.ts`, one per side, bytes transferred), and posts throttled `diffProgress` (`read`/`parse`/`diff`, completed/total) by summing the two per-file fractions (`src/diff/loadProgress.ts`; read fills `0 → 0.05` (`READ_SHARE`, deliberately small because reads are fast and post no progress), parse `0.05 → 1`, `total = 2`, each file clamped monotonic by `advanceFraction`) while diffing. The the worker reports one monotonic `fraction` per file (parser `parse` scan `[0, 0.9]`, `build` `[0.9, 1]`, running max), throttled to integer percent so at most 101 progress messages are posted per file (a per-event post is a firehose the single host main thread must drain, serializing the two workers), so the bar never regresses across the stage switch. The card is swapped for `#diff-root` on `diffInit`/`diffError` (`applyDiffProgress` updates the card text meanwhile; the bar keeps the shared indeterminate animation, never width-driven).
- **Swap:** `Swap sides` exchanges `data.a`/`data.b`, the side heads, and recomputes `computeByteDiff` for the new base pair, so counts and colors follow the file (`added` ↔ `removed`).
- **Search:** the reused `SearchBar` (`diffSearch.ts`) is mounted on boot into the row-1 right slot and re-injected after each toolbar render; there is no `Find` button and no open/close gating. One query runs over both sides' hydrated segments, match addresses are unioned/deduped, and both grids paint from render-input `matchSet`/`activeMatch`. The executed needle span expands the highlight (parity with `memoryGrid.addMatchSpan`); the count is the combined distinct address count. `Ctrl+F` focus/select stays inside the component.
- **Search parity with the hex view:** the pure decisions live in `src/webview/search/searchNavigation.ts` (`shouldNavigateCompletedSearch`, `isSearchDiverged` — DOM/`S`-free, imported by both hosts). The diff host tracks `completedKey`/`activeKey`/`running`: repeat-Enter on an unchanged completed query navigates instead of re-running, a new key while running cancels the old search, a Run click on the in-flight search is a no-op (hex parity), `onProgressUpdate` streams matches (paint + count + a one-time first jump), `onComplete` preserves the active match, `stepMatch` wraps with modulo, a UI-only change drops matches only when `isSearchDiverged` (empty query counts as diverged), `applyMatches` selects the active match (`scrollToDiff(..., { selection: true })`), and `mountDiffSearch` re-pushes the count via `refreshDiffSearchCount()` after each re-injection.
- **Search selection pane / hidden rows:** a search-driven selection sets `selectionPane` to a pane that maps the match address (`paneForAddress`, preferring a pane that maps the span), so `Ctrl+C` copies real bytes for a hit mapped only in B (C1). `scrollToDiff` applies the mirrored selection before the row lookup and scrolls only when the row is visible, so in `Show diff` mode a match on a hidden (identical/gap) row is selected on both panes without scrolling (C4).
- **Hidden-state gating:** `.diff-body[hidden]` and `.diff-error[hidden]` must keep `display: none`; `.diff-error`'s `display: grid` otherwise defeats the `hidden` attribute and splits the viewport (blank lower half).
- **Read-only surface:** no editing, save, scripts, integrity, sidebar, or context menus; selection/nav only.
- **Typed protocol:** `dispatchDiffMessage` rejects unknown/malformed messages; handlers are an exhaustive `DiffMessageHandlers` map. `diffInit` is validated structurally before hydration — `isDiffSide` (name/path/format strings, `parseResult.recordCount` number, `segments` array of `{ startAddress: number, data }`, `labels` array) and `isDiffModel` (`runs` array with `start`/`end`/`kind`) — so a malformed `diffInit` returns `false` from the dispatcher and never reaches `hydrateDiffSide` (S5). Validate shapes shallowly (no per-byte scan) to keep large-pair loads cheap.
- **Isolation:** the bundle imports only `diff/`, `search/searchNavigation.ts`, `components/hexView/`, `components/searchBar/`, `render/virtualScroll.ts`, `core/{diff,diffLabels,memory,search,types,byteTools}`, and `diffProtocol.ts`. No `vscode`, no `S`, no single-file shell.
- Untrusted text (file names, error text) escaped with `esc()`.

## Behaviour

- Root shell order: `#app` holds the `#diff-loading` card; `#diff-root` (hidden until init) holds `#diff-summary` (two-row toolbar + injected search slot), `#diff-body` (two `.diff-side` panels with a `.diff-split` between them, each with its own address gutter), and `#diff-error` (hidden error card).
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
| `diffError` received | Error card replaces the body (body actually hidden, loading card hidden); message escaped. |
| `diffProgress` received | Loading card text becomes `Loading read …%` / `Loading parse …%` / `Loading diff …%` (raw stage names, parity with the hex view); the bar stays indeterminate and is never width-driven; grids stay hidden until `diffInit`. |
| Unknown message type | `dispatchDiffMessage` returns false; no handler runs (malformed `diffProgress` stage/fields rejected too, and a malformed `diffInit` is rejected structurally without throwing). |
| Large union range | Virtualized slice per pane via its own `VirtualScrollState`; logical scroll preserved across re-slice. |
| One grid scrolled | With `Sync scroll` on, the follower mirrors vertical + horizontal and the header stays aligned. With it off the follower does not move **and keeps rendering its own rows at its own position** (no blank pane). |
| Scroll while compressed | Scroll renders coalesce to one per frame and skip an unchanged slice — the actively scrolled pane is never blanked per event. |
| Selection spans unmapped addresses | Mirrored range paints on both panes; copy emits only mapped source bytes. |
| Query matches both panes at the same address | Address unioned once; count reflects distinct addresses. |
| Search `Enter`/`Shift+Enter` | Fresh query runs; `Shift+Enter` starts from the last match; repeat-Enter on an unchanged completed query navigates (no re-run); next/prev wrap at both ends. Always-visible bar; `Ctrl+F` focuses/selects the input. |
| Search UI-only change | Matches kept while the visible key still matches the running/completed search; dropped (`0 / 0`) once it diverges (empty query counts as diverged). |

## Tests Required

`src/test/webview/diffViewer.test.ts` (mocha + jsdom + cssImportHook): shared `data-row` order across both sides + gap row between distant blocks; changed byte on both sides; added empty-on-A / value-on-B; removed value-on-A / empty-on-B; computed summary counts + the exact action-button order with per-button glyph span + text span + `title`+`aria-label` (glyph `aria-hidden`); the two-row toolbar grouping (row 1 left/center/right, row 2 sync + centered stat); prev/next traversal and end stops; vertical + horizontal scroll sync (both directions, header alignment), the sync-off gate, and scroll-render coalescing + unchanged-slice skip (innerHTML-write probe via `flushDiffRender`); decoded text hidden (`.mem-hdr-decoded`, `.col-decoded`, `.char-cell` absent); address gutter on both panes; error card + hidden body; always-visible search (no `Find` button) + `Ctrl+F` focus; a real `SearchBar`-driven query proving one search over both panes, address union/dedupe, needle-span highlight, and next walking the addresses; repeat-Enter navigation with no second engine run (spy on `SearchEngine.prototype.search`), next/prev modulo wrap, same-key keep vs diverged drop, a streamed `onProgressUpdate` batch painting/counting/selecting, and the count surviving a `setDiffSummary` toolbar re-render; click/shift-click/address-gutter selection mirrored on both panes with copy reading the source pane; `Swap sides` flipping colors and counts; `Show diff` filtering + `No differences`; `renderSideHeadHtml` format pill (no separator, escaped label) + the `.fmt-pill` base.css guard; `applyDiffProgress` text-only updates (`Loading read …%`) with no inline bar width and no `det` class, and `diffProgress` dispatch/rejection; unknown-message rejection; a stylesheet guard for the `[hidden]` rules, the 3px splitter, and the absence of `.diff-hide-addr`.

`src/test/core/diff.test.ts` owns the run semantics and `disambiguatedLabels`; `src/test/core/diffLoadProgress.test.ts` owns the concurrent-load fraction summing (clamped, monotonic via `advanceFraction`, bounded by `total`); `src/test/core/diffParseWorker.test.ts` owns the worker round-trip (IHEX + SREC format/segment bytes, monotonic integer-percent-bounded progress, invalid-job error); `src/test/extension/extension.test.ts` owns command registration (the three Explorer compare commands — `hexScope.selectAsFirst` / `hexScope.compareToStaged` / `hexScope.compareSelected`; `hexScope.compareWith` and the A3 command names are gone), the manifest gate (only those three sit in `group: "3_compare"`, each `when` carries `explorerViewletFocus` — never the editor title — `selectAsFirst` carries `!listMultiSelection`, `compareToStaged` carries `hexScope.hasCompareSelection`, `compareSelected` carries `listDoubleSelection` so 3+ shows no item, no other menu point lists a compare command, and `navigation` keeps only Open with HexScope / Quick Repair), the `CompareSelectionStore` set/clear lifecycle, `selectedComparePair`/`stashedComparePair` ordering and rejection, `runCompare` validation/clear-on-success, and `copyText` parsing + clipboard write plus `diffProgress`/`diffInit` recognition by `diffMessageType`.

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
