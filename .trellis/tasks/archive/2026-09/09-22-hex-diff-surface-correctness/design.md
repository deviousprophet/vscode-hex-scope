# Design — Hex diff surface correctness fixes

## Boundaries

- **Extension host:** `src/extension.ts` (compare command), `src/diff/diffEditorPanel.ts` (panel,
  `diffSide`), `src/diff/compareSelection.ts` (stash store).
- **Webview diff surface:** `src/webview/diff/diffGrid.ts`, `diffModel.ts`, `diffMessages.ts`,
  `diffSearch.ts`.
- **Shared core/render:** `src/core/memory.ts`, `src/webview/memory/memoryGrid.ts`,
  `src/webview/render/*`, `src/webview/components/hexView/*`.
- **No protocol shape change** except `DiffSideData` narrowing (webview-internal) — the wire
  `DiffSide`/`DiffProviderToWebview` in `src/diffProtocol.ts` is unchanged.

## Data flow

`DiffEditorPanel.open` → reads/parses both sides → posts `diffInit` (wire `DiffSide` + `DiffModel`) →
webview `dispatchDiffMessage` → `hydrateDiffSide` → `setDiffData` → `renderDiffGrid`/`drawSlice`.
Scroll events feed `syncFrom` → shared virtual-scroll state → re-render. Search feeds
`setSearchMatches` + `scrollToDiff`.

## S3 — De-duplicate clone groups

1. New shared module `src/webview/render/matchSpans.ts`:
   `export function addMatchSpan(set: Set<number>, base: number, length: number): void`.
   - `memoryGrid.buildVisibleMatchSet` calls it (delete the local `addMatchSpan`, `memoryGrid.ts:265`).
   - `diffGrid.matchSetWithSpans` loops `addrs` calling it (delete the inline inner loop).
2. File-name helper: one implementation. Preferred: move `fileName(uri)` into
   `src/core/pathName.ts` (`export function fileName(uri: { fsPath: string }): string`) and have
   `compareSelection.selectionName` re-export/alias it and `diffEditorPanel` import it, deleting the
   duplicate at `diffEditorPanel.ts:266`. Preserve the `selectionName` public name (used by
   `src/extension.ts:208`) so no caller churn.

Trade-off: a tiny new core module for a one-liner is acceptable to satisfy the zero-clone gate; the
alternative (importing `selectionName` from `compareSelection` into `diffEditorPanel`) also works but
couples panel and command modules — the core module is the cleaner seam.

## S9 — Shared row/cell builder

Extract the common loop from `memoryGrid.buildRowCells` + `diffGrid.buildCells`:

```ts
// src/webview/render/hexCells.ts
export interface CellDecoration { hexCls?: string; charCls?: string }
export function buildHexCells(
    base: number, bytesPerRow: number,
    readByte: (addr: number) => number | undefined,
    decorate: (addr: number, val: number) => CellDecoration,
): HexViewCell[];
```

- `memoryGrid.buildRowCells` calls it with `decorate` returning dirty/integrity/edit-placeholder
  classes; `diffGrid.buildCells` calls it with `decorate` returning the `diffClassForSide` suffix and
  the `cp`/`cd` char class. Printable test (`0x20 ≤ val < 0x7F`) lives in the shared builder; both
  call sites currently agree on it.
- Guard: memoryGrid has no `val === undefined` early-return shape difference? Both push an empty cell
  for unmapped addresses (`memoryGrid.emptyCell()` vs `diffGrid.EMPTY_CELL`) — unify to one
  `EMPTY_CELL` export and prove parity with the existing memory/diff render tests.
- Risk: this is the highest-churn refactor. Add/keep parity tests for both grids (cell text, classes,
  empty cell) before deleting the local builders. Rollback point: this extraction is one commit,
  revertable alone.

## S5 — `diffInit` boundary validation

Replace presence-only `isDiffInit` (`diffMessages.ts:21-28`) with structural validation, mirroring
`DIFF_PROGRESS_STAGES`/`hasProgressCounts`:

```ts
function isDiffSide(value: unknown): value is DiffSide { /* name/path/format strings,
    parseResult.recordCount number, parseResult.segments array of {startAddress number, data}, labels array */ }
function isDiffModel(value: unknown): value is DiffModel { /* runs array; each run has start/end/kind */ }
function isDiffInit(m): m is DiffInitMessage {
    return !!m && m.type === 'diffInit' && isDiffSide(m.a) && isDiffSide(m.b) && isDiffModel(m.diff);
}
```

- Keep it shallow-but-structural: enough that `hydrateDiffSide` cannot throw on a malformed payload
  (the boundary pattern from `type-safety.md` "normalize once from `unknown`"). Do not deep-validate
  segment bytes (perf on large files) — validate `segments` is an array and each entry has a numeric
  `startAddress` and a `data` value.
- A rejected message returns `false` from `dispatchDiffMessage` and runs no handler.

## S6 — Drop the fabricated `records: []`

- Add `export interface SegmentSource { readonly segments: readonly SerializedSegment[] }` (in
  `src/core/memory.ts` or `src/core/types.ts`).
- Widen `buildSegmentIndex(source: SegmentSource | null)` and
  `getByteAt(source: SegmentSource | null, ...)` — both only read `segments`.
  `memoryData.ts` callers pass the full `SerializedParseResult` (structurally compatible).
- Change `DiffSideData.parseResult` to `Omit<SerializedParseResult, 'records'>` (webview-internal) and
  build it in `hydrateDiffSide` without `records`.
- `memoryGrid`/`statsBar` are untouched.

## C1 — Search selection pane

- In `diffGrid`, add `paneForAddress(addr): DiffPane | null` using `getSideByte` on both sides.
- `applySelectionOption(range, options)` sets `selection` **and**, when selection is set, sets
  `selectionPane` to `paneForAddress(range.start) ?? paneForAddress(range.end) ?? selectionPane`
  (prefer the current pane if it already maps the range, else the other).
- Manual click/drag selection keeps its existing `applySelection(side, …)` path (`selectionPane = side`).

## C2 — Stash clears only after a successful open

- `runCompare`: move `onSuccess?.()` to after `await deps.open(...)` and only when it resolves without
  throwing (`src/extension.ts:195-196`). On throw, propagate/skip success so the stash survives. Match
  the doc at `:186`.
- `compareToStaged` keeps passing `() => compareSelection.clear()`.
- Test: `src/test/extension/extension.test.ts` — add an open-failure case (existing open-failure
  coverage is validation-only at `:229-256`); assert stash still set.

## C4 — `Show diff` search navigation

- Reorder `scrollToDiff` (`diffGrid.ts:334-340`): apply selection + `selectionPane` first, then look up
  the row; only call `scrollToRow` when `rowIndex >= 0`. A hidden row therefore gets the mirrored
  selection with no scroll — the predictable skip. (Chosen over revealing the row, which would fight
  the `Show diff` filter.)
- `diffSearch.scrollToActive` unchanged.

## C5 — Independent scroll (per-pane render window)

Current design has one `vscroll` and one slice; that cannot represent two positions. Refactor:

- Replace the single `vscroll`/`vscrollContainer` cache with per-pane state:
  `let scrollA: VirtualScrollState | null`, `scrollB: VirtualScrollState | null`, each with its own
  container element (`scrollContainerA()`/new `scrollContainerB()`).
- `ensureScrollState(container)` returns/refreshes the state for that container; the existing
  `isCurrentScrollState` version/rowCount/height gate moves per pane. Reset clears both.
- `currentSlice(pane): RenderSlice` computes `[start, end]` from that pane's state and container.
- `drawSlice` renders each pane from **its own** slice: `topSpacer`/`bottomSpacer`/`sliceHeight`/
  `windowTop` computed per pane from that pane's `state.scrollTop` and container `scrollTop`.
- `sliceKey` includes both panes' `[start,end]` so an unchanged follower does not force a repaint and a
  changed one does.
- `syncFrom(driver, top, left)`: update the driver's state (`physicalToLogicalScroll`); when
  `syncScroll` is on, mirror the follower's physical `scrollTop`/`scrollLeft` (existing
  `mirrorToFollower`) so its derived window matches.
- `setSyncScroll(true)` re-aligns the follower to the driver's current `scrollTop` (re-enable should
  snap them together); `false` leaves each pane where it is.
- `scrollToRow` (`scrollToDiff`, prev/next): when sync is on set both panes' physical scroll; when off,
  set the pane being navigated (default A, or the pane that maps the range per C1).
- `renderDiffGrid`/`renderScrollSlice`/`flushDiffRender` unchanged in shape; `flushDiffRender` still
  renders pending frame synchronously for tests.

Trade-off: this is the largest change in the child. It is contained to `diffGrid.ts` and the virtual
scroll math is reused unchanged. Alternative (two full HexView virtual-scroll instances) re-does the
shared row model and is rejected as larger.

## Compatibility / rollback

- No wire/protocol change; no storage/migration change.
- Split into ordered commits (S3 → S9 → S5/S6 → C1 → C2 → C4 → C5) so any single fix reverts alone.
  C5 is isolated at the end.

## Validation

- `npm run check-types`, `npm run lint`, `npm test`.
- `npx -y fallow audit --base origin/main --gate all` (zero clone groups).
- New/updated tests: `src/test/webview/diffViewer.test.ts` (C1, C4, C5 content, S5 via dispatcher),
  `src/test/extension/extension.test.ts` (C2 open failure), plus memory-grid parity for S9.
