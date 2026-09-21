# Component Spec — DiffView

> Built from `component-template.md`. Owns the read-only two-grid diff surface as a self-contained webview bundle, reusing `HexView` for each grid.

## Scope / Trigger

Owns `src/webview/diffViewer.ts` (composition root) and `src/webview/diff/` (`diffModel.ts`, `diffGrid.ts`, `diffSummary.ts`, `diffMessages.ts`, `diff.css`): the dedicated read-only editor comparing two IHEX/SREC files. It renders one shared union row model across two `HexView` instances, a summary bar, and prev/next navigation.

Boundary rule: the diff host owns data (both `DiffSideData`, `DiffModel`, shared `VirtualScrollState`) and all domain decisions. `HexView` stays presentational; the diff host never writes grid cell DOM directly and never touches the single-file app shell (`state.ts`, `S`, sidebar, toolbar, integrity, scripts).

## Layout

```text
src/webview/diffViewer.ts             composition root: shell HTML, ready handshake, message dispatch
src/webview/diff/diffModel.ts         hydrateDiffSide, buildDiffRows, getSideByte, diffKindAt, diffClassForSide, renderDiffErrorHtml
src/webview/diff/diffGrid.ts          mount/reset, setDiffData, scrollToDiff, showDiffError; two HexView instances + virtual scroll + scroll sync
src/webview/diff/diffSummary.ts       renderDiffSummaryHtml, setDiffSummary + prev/next wiring
src/webview/diff/diffMessages.ts      typed dispatchDiffMessage (unknown rejected)
src/webview/diff/diff.css             layout, .diff-chg/.diff-add/.diff-del, .diff-hide-addr
src/webview/components/hexView/*      reused grid (showAscii:false)
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
function scrollToDiff(range: HexViewRange): void;   // nav: frame + scroll both grids
function showDiffError(message: string): void;

function setDiffSummary(diff: DiffModel): void;
function dispatchDiffMessage(message: unknown, handlers: DiffMessageHandlers): boolean;
```

## Rules

- **Address-keyed, host-computed:** the host computes `DiffModel` in `src/core/diff.ts` and ships both serialized sides; the webview only maps runs to cell classes and rows.
- **One shared row model:** `buildDiffRows` unions the mapped 16-byte blocks of both sides; either grid renders the same rows, so scroll stays aligned.
- **Empty over synthetic:** `getSideByte` returns `undefined` for unmapped addresses; unmapped cells are `be` empties, never `00`.
- **Hex only:** both grids render `showAscii:false` — no decoded-text header label, no char cells.
- **Side semantics:** `diff-chg` on both sides; `diff-add` on B only; `diff-del` on A only (`diffClassForSide`).
- **One address column:** the right panel carries `.diff-hide-addr`; both grids share the left column's addresses.
- **Scroll sync:** `mountDiffGrid` wires each `HexView` `onVisibleWindowChange(top, left)` into `syncFrom`; the driver updates the shared `VirtualScrollState`, re-slices, and mirrors `setScrollTop`/`setScrollLeft` onto the follower behind a re-entrancy guard.
- **Read-only surface:** no editing, save, scripts, integrity, sidebar, or context menus; selection/nav only.
- **Typed protocol:** `dispatchDiffMessage` rejects unknown/malformed messages; handlers are an exhaustive `DiffMessageHandlers` map.
- **Isolation:** the bundle imports only `diff/`, `components/hexView/`, `render/virtualScroll.ts`, `core/{diff,memory,types}`, and `diffProtocol.ts`. No `vscode`, no `S`.
- Untrusted text (file names, error text) escaped with `esc()`.

## Behaviour

- Root shell: `#diff-summary` (summary bar), `#diff-body` (two `.diff-side` panels, right one `.diff-hide-addr`), `#diff-error` (hidden error card).
- Side heads show `<name> · <FORMAT>`.
- Summary bar reports total bytes changed / added / removed plus prev/next controls; prev disabled at first run, next disabled at last.
- `scrollToDiff` finds the run's row, positions it a couple of rows below the top, re-slices, and mirrors both grids.
- Error state hides `#diff-body` and shows the escaped message card.
- On mount the webview posts `{ type: 'ready' }`; `diffInit` hydrates both sides, renders heads, grid, and summary.

## Validation & Error Matrix

| Condition | Behaviour |
|---|---|
| Empty run list (identical files) | Grid renders plain; no cell carries a `diff-*` class; summary shows 0/0/0. |
| Address mapped on one side only | Unmapped side renders an empty `be` cell; mapped side carries `diff-add`/`diff-del`. |
| Whole aligned block unmapped both sides | Gap row, never per-address rows. |
| `diffError` received | Error card replaces the body; message escaped. |
| Unknown message type | `dispatchDiffMessage` returns false; no handler runs. |
| Large union range | Virtualized slice via shared `VirtualScrollState`; logical scroll preserved across re-slice. |
| One grid scrolled | Follower mirrors vertical + horizontal; header stays aligned. |

## Tests Required

`src/test/webview/diffViewer.test.ts` (mocha + jsdom + cssImportHook): shared `data-row` order across both sides + gap row between distant blocks; changed byte on both sides; added empty-on-A / value-on-B; removed value-on-A / empty-on-B; summary counts + prev/next traversal and end stops; vertical + horizontal scroll sync (both directions, header alignment); decoded text hidden (`.mem-hdr-decoded`, `.col-decoded`, `.char-cell` absent); error card; unknown-message rejection.

`src/test/core/diff.test.ts` owns the run semantics; `src/test/extension/extension.test.ts` owns command registration.

## Anti-patterns

- Zero-filling unmapped bytes (`?? 0`) — creates false differences.
- Reading `S`/`state.ts` or posting single-file provider messages from the diff bundle.
- Registering the diff as a `CustomReadonlyEditorProvider` (it compares two documents).
- Writing grid cell DOM directly instead of using `HexView` render input + paint methods.
- Adding sidebar/toolbar/integrity/scripts chrome to the diff surface.
- Persisting diff state or touching `.hexscope/` from the diff panel.
