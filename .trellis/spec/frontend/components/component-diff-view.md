# Component Spec — DiffView

> Built from `component-template.md`. Owns the read-only two-grid diff surface as a self-contained webview bundle, reusing `HexView` for each grid.

## Scope / Trigger

Owns `src/webview/diffViewer.ts` (composition root), `src/webview/diff/` (`diffModel.ts`, `diffGrid.ts`, `diffSummary.ts`, `diffSearch.ts`, `diffMessages.ts`, `diff.css`), and the host-side compare-selection store `src/diff/compareSelection.ts` + `src/core/diffLabels.ts`: the dedicated read-only editor comparing two IHEX/SREC files. It renders one shared union row model across two `HexView` instances, a summary/action bar, prev/next run navigation, a reused `SearchBar`, and mirrored read-only selection.

Boundary rule: the diff host owns data (both `DiffSideData`, `DiffModel`, shared `VirtualScrollState`) and all domain decisions. `HexView` stays presentational; the diff host never writes grid cell DOM directly and never touches the single-file app shell (`state.ts`, `S`, sidebar, toolbar, integrity, scripts).

## Layout

```text
src/webview/diffViewer.ts             composition root: shell HTML, ready handshake, message dispatch, Ctrl+C copy, side heads
src/webview/diff/diffModel.ts         hydrateDiffSide, buildDiffRows, getSideByte, diffKindAt, diffClassForSide, renderDiffErrorHtml
src/webview/diff/diffGrid.ts          mount/reset, setDiffData, view mode, mirrored selection, copy, swap, search matches, scrollToDiff, showDiffError
src/webview/diff/diffSummary.ts       renderDiffSummaryHtml, setDiffSummary + action bar wiring (prev/next, show all/diff, swap, find, sync)
src/webview/diff/diffSearch.ts        SearchBar reuse: one query over both sides, unioned match addresses, next/prev walk
src/webview/diff/diffMessages.ts      typed dispatchDiffMessage (unknown rejected)
src/webview/diff/diff.css             layout, .diff-split divider, .diff-chg/.diff-add/.diff-del, hidden-state guards
src/core/diffLabels.ts                disambiguatedLabels (shared by panel title + webview side heads)
src/diff/compareSelection.ts           host compare-selection store (session stash + hexScope.hasCompareSelection; no status-bar item)
src/webview/components/hexView/*      reused grid (showAscii:false)
src/webview/components/searchBar/*    reused search bar component
src/diffProtocol.ts                   hostwebview union
src/diff/diffEditorPanel.ts           host panel (webview bundle entry)
```

## Contract

```typescript
interface DiffSideData {
    name: string;
    format: 'ihex' | 'srec';
    parseResult: SerializedParseResult;
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
function showDiffError(message: string): void;

function setDiffSummary(diff: DiffModel): void;
function dispatchDiffMessage(message: unknown, handlers: DiffMessageHandlers): boolean;
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
- **Scroll sync:** `mountDiffGrid` wires each `HexView` `onVisibleWindowChange(top, left)` into `syncFrom`; the driver updates the shared `VirtualScrollState` and re-slices, then mirrors `setScrollTop`/`setScrollLeft` onto the follower behind a re-entrancy guard. `Sync scroll` (default ON) gates the mirror only — the driver always re-slices.
- **Swap:** `Swap sides` exchanges `data.a`/`data.b`, the side heads, and recomputes `computeByteDiff` for the new base pair, so counts and colors follow the file (`added` ↔ `removed`).
- **Search:** `Find` toggles the reused `SearchBar` (`diffSearch.ts`). One query runs over both sides' hydrated segments, match addresses are unioned/deduped, and both grids paint from render-input `matchSet`/`activeMatch`. The executed needle span expands the highlight (parity with `memoryGrid.addMatchSpan`); the count is the combined distinct address count.
- **Hidden-state gating:** `.diff-body[hidden]` and `.diff-error[hidden]` must keep `display: none`; `.diff-error`'s `display: grid` otherwise defeats the `hidden` attribute and splits the viewport (blank lower half).
- **Read-only surface:** no editing, save, scripts, integrity, sidebar, or context menus; selection/nav only.
- **Typed protocol:** `dispatchDiffMessage` rejects unknown/malformed messages; handlers are an exhaustive `DiffMessageHandlers` map.
- **Isolation:** the bundle imports only `diff/`, `components/hexView/`, `components/searchBar/`, `render/virtualScroll.ts`, `core/{diff,diffLabels,memory,search,types,byteTools}`, and `diffProtocol.ts`. No `vscode`, no `S`, no single-file shell.
- Untrusted text (file names, error text) escaped with `esc()`.

## Behaviour

- Root shell order: `#diff-summary` (summary + action bar), `#diff-search` (find bar, hidden until `Find`), `#diff-body` (two `.diff-side` panels with a `.diff-split` between them, each with its own address gutter), `#diff-error` (hidden error card).
- Side heads show `<name> · <FORMAT>` with the full path as `title`.
- Summary bar reports total bytes changed / added / removed, then the action buttons in this exact order: `Prev diff`, `Next diff`, `Show all`, `Show diff`, `Swap sides`, `Find`, `Sync scroll`. `Show all`/`Show diff`/`Sync scroll`/`Find` carry an `active` class when on; `Prev diff` is disabled at the first run, `Next diff` at the last.
- `scrollToDiff` finds the run's row, positions it a couple of rows below the top, re-slices, and mirrors both grids.
- Error state hides `#diff-body` (the `hidden` attribute must actually collapse it) and shows the escaped message card.
- On mount the webview posts `{ type: 'ready' }`; `diffInit` hydrates both sides, renders heads, grid, and summary. `Ctrl+C` with a selection posts `{ type: 'copyText', text, label }`.

## Validation & Error Matrix

| Condition | Behaviour |
|---|---|
| Empty run list (identical files) | Grid renders plain; no cell carries a `diff-*` class; summary shows 0/0/0. |
| `Show diff` on an identical pair | Filtered list is empty → both grids render the `No differences` placeholder. |
| Address mapped on one side only | Unmapped side renders an empty `be` cell; mapped side carries `diff-add`/`diff-del`. |
| Whole aligned block unmapped both sides | Gap row, never per-address rows. |
| `diffError` received | Error card replaces the body (body actually hidden); message escaped. |
| Unknown message type | `dispatchDiffMessage` returns false; no handler runs. |
| Large union range | Virtualized slice via shared `VirtualScrollState`; logical scroll preserved across re-slice. |
| One grid scrolled | With `Sync scroll` on, the follower mirrors vertical + horizontal and the header stays aligned; with it off the follower does not move. |
| Selection spans unmapped addresses | Mirrored range paints on both panes; copy emits only mapped source bytes. |
| Query matches both panes at the same address | Address unioned once; count reflects distinct addresses. |
| Search `Enter`/`Shift+Enter` | Fresh query runs; `Shift+Enter` starts from the last match. Repeat-Enter re-runs the search (host has no completed-query navigate shortcut). |

## Tests Required

`src/test/webview/diffViewer.test.ts` (mocha + jsdom + cssImportHook): shared `data-row` order across both sides + gap row between distant blocks; changed byte on both sides; added empty-on-A / value-on-B; removed value-on-A / empty-on-B; computed summary counts + the exact action-bar button order and `Sync scroll` default; prev/next traversal and end stops; vertical + horizontal scroll sync (both directions, header alignment) and the sync-off gate; decoded text hidden (`.mem-hdr-decoded`, `.col-decoded`, `.char-cell` absent); address gutter on both panes; error card + hidden body; a real `SearchBar`-driven query proving one search over both panes, address union/dedupe, needle-span highlight, and next walking the addresses; click/shift-click/address-gutter selection mirrored on both panes with copy reading the source pane; `Swap sides` flipping colors and counts; `Show diff` filtering + `No differences`; unknown-message rejection; a stylesheet guard for the `[hidden]` rules, the 3px splitter, and the absence of `.diff-hide-addr`.

`src/test/core/diff.test.ts` owns the run semantics and `disambiguatedLabels`; `src/test/extension/extension.test.ts` owns command registration (the three Explorer compare commands — `hexScope.selectAsFirst` / `hexScope.compareToStaged` / `hexScope.compareSelected`; `hexScope.compareWith` and the A3 command names are gone), the manifest gate (only those three sit in `group: "3_compare"`, each `when` carries `explorerViewletFocus` — never the editor title — `selectAsFirst` carries `!listMultiSelection`, `compareToStaged` carries `hexScope.hasCompareSelection`, `compareSelected` carries `listDoubleSelection` so 3+ shows no item, no other menu point lists a compare command, and `navigation` keeps only Open with HexScope / Quick Repair), the `CompareSelectionStore` set/clear lifecycle, `selectedComparePair`/`stashedComparePair` ordering and rejection, `runCompare` validation/clear-on-success, and `copyText` parsing + clipboard write.

## Anti-patterns

- Zero-filling unmapped bytes (`?? 0`) — creates false differences, and copy must skip unmapped addresses.
- Reading `S`/`state.ts` or posting single-file provider messages from the diff bundle.
- Registering the diff as a `CustomReadonlyEditorProvider` (it compares two documents).
- Writing grid cell DOM directly instead of using `HexView` render input + paint methods.
- Adding sidebar/toolbar/integrity/scripts chrome to the diff surface.
- Persisting diff state or touching `.hexscope/` from the diff panel.
- Letting `display: flex/grid` on `.diff-body`/`.diff-error` win over their `[hidden]` guard (reintroduces the blank lower half).
- Reintroducing a hidden-address-column variant instead of giving each pane its own gutter.
