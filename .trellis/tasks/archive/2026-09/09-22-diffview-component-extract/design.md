# Design — DiffView component extraction

## Scope & boundary

Mirror the `hexView` component/host split. Component = markup + interaction +
paint + styles. Host = data + state + virtual-scroll math + render loop + the
rows-wrapper DOM.

| Concern | Component `components/diffView/` | Host `diff/diffGrid.ts` |
|---|---|---|
| Markup | two-pane grid body, empty state, per-pane header/scroll/rows shell | summary/error/toolbar/side-head composition |
| Interaction | owns the two `HexView` instances; pane-qualified callbacks | wires `syncFrom`, selection, copy, nav |
| Paint | mirrored selection, header injection, scroll get/set | — |
| Styles | grid-surface + diff cell classes | `.diff-root`, summary/toolbar, error |
| State | only the two `HexView` handles | data, `visibleRows`, selection, view mode, `syncScroll`, per-pane `VirtualScrollState`, matches |
| Render loop | — (host resolves rows + writes `innerHTML`, like `memoryGrid`) | slice compute, `sliceKey`, poll, transform/reconcile, `repositionPane`, `drawPane` |

Parity note: `memoryGrid` itself resolves `#mem-rows` by id and writes its
`innerHTML`; `DiffView` doing the interaction/markup/paint while the host writes
rows is the faithful analog, not a half-extraction.

## File structure (target)

```text
src/webview/components/diffView/
    diffView.ts         DiffView class + DiffViewCallbacks; owns viewA/viewB; pane-qualified delegation
    diffViewRender.ts   pure: renderDiffViewBodyHtml(), renderDiffEmptyHtml(message)
    diffView.css        .diff-body, .diff-side, .diff-split, .diff-grid-root, .diff-chg/.add/.del
src/webview/diff/
    diffGrid.ts         host (unchanged responsibilities minus markup/controller/CSS)
    diff.css            .diff-root, .diff-summary/toolbar, .diff-error (grid rules removed)
    diffModel.ts diffSummary.ts diffSearch.ts diffMessages.ts diffExternalChange.ts   unchanged
src/webview/diffViewer.ts   composition root: summary + renderDiffViewBodyHtml() + error shell
```

## Contract

```typescript
// components/diffView/diffView.ts
export type DiffPane = 'a' | 'b';

export interface DiffViewCallbacks {
    onVisibleWindowChange?: (pane: DiffPane, top: number, left: number) => void;
    onCellClick?: (pane: DiffPane, addr: number, shift: boolean, column: 'hex' | 'char') => void;
    onSelectionChange?: (pane: DiffPane, range: HexViewRange) => void;
    onAddressRowClick?: (pane: DiffPane, rowBase: number, shift: boolean) => void;
    onAddressRowDrag?: (pane: DiffPane, rows: HexViewRange) => void;
}

export class DiffView {
    constructor(cb?: DiffViewCallbacks);
    setCallbacks(cb: DiffViewCallbacks): void;
    mount(): void;                    // idempotent: create + mount both HexViews on #diff-a / #diff-b
    reset(): void;                    // drop the HexView instances (test seam; replaces resetDiffGrid's viewA/viewB nulling)
    paintSelection(range: HexViewRange | null): void;   // both panes
    injectHeaders(): void;            // both #diff-header-* from renderHexViewHeader(false)
    setScrollTop(pane: DiffPane, top: number): void;
    setScrollLeft(pane: DiffPane, left: number): void;
    getScrollTop(pane: DiffPane): number;
}

// components/diffView/diffViewRender.ts  (pure, DOM-free)
export function renderDiffViewBodyHtml(): string;         // <div class="diff-body" id="diff-body"> two sides + .diff-split </div>
export function renderDiffEmptyHtml(message: string): string;   // escaped empty-state card
```

`DiffPane` moves with the component and is re-exported for the host; the host's
local `type DiffPane` alias is removed (import from the component). `HexView` and
`renderHexViewHeader` are imported by the component (shared, as `memoryGrid`
already imports the same render layer).

## Host changes (`diffGrid.ts`)

- Replace `let viewA/viewB` + `paneView()` with `let diffView: DiffView | null` and
  `diffView = new DiffView(hostCallbacks())` in `mountDiffGrid`; `resetDiffGrid` →
  `diffView?.reset()`.
- `callbacksFor(side)` becomes `hostCallbacks()` producing the pane-qualified
  handlers (`(pane, top, left) => syncFrom(pane, top, left)`, etc.).
- `paintMirroredSelection`, `renderHeaders`, `alignFollowerToDriver`,
  `mirrorFollowerLeft`, `scrollPaneToRow`, `restoreAnchor`, `drawPane`'s scroll
  writes → call `diffView.paintSelection` / `injectHeaders` / `setScrollTop(pane,…)`
  / `setScrollLeft(pane,…)` / `getScrollTop(pane)`.
- Keep: `scrollContainer(pane)`/`rowsId(pane)` (host-owned rows, as `memoryGrid`),
  `drawPane` (writes `rows.innerHTML` via `renderHexViewHtml(buildInput(...))`),
  `renderEmptyGrid` (uses `renderDiffEmptyHtml`), `repositionPane`, poll/transform.
- `renderDiffGrid`/`renderScrollSlice`/`sliceKey`/`currentSlice`/`ensureScrollState`
  unchanged.

## Markup ownership

`renderDiffViewBodyHtml()` returns the current lines 23–36 of
`diffViewer.ts#renderDiffShellHtml` verbatim (same `id`s,
`class`es, and structure) so every existing test selector
(`#diff-rows-a`, `#diff-a .mem-scroll`, `#diff-header-b`, `.diff-side`, `.diff-split`)
keeps working. `diffViewer.ts#renderDiffShellHtml` becomes
`renderDiffSummaryHtml`-era composition: `...summary... + renderDiffViewBodyHtml() + ...error...`.

## CSS split decision

Move to `diffView.css`: `.diff-body`, `.diff-side`, `.diff-split`, `.diff-grid-root`,
and the diff cell classes `.diff-chg`/`.diff-add`/`.diff-del` (rendered inside the
component grid). Keep in `diff.css`: `.diff-root`, `.diff-summary`/toolbar,
`.diff-error` and its `[hidden]` guards. Rationale: component CSS owns what the
component renders; toolbar/error are host chrome. Accepted risk: esbuild CSS import
order changes cascade order; the moved rules must be verified non-overlapping with
the retained ones (they are disjoint today). Review gate may widen the move to all
of `diff.css` if ordering proves fragile.

## Behavior-preservation strategy

- Keep every id/class/data-attribute byte-identical; this is the main guard that
  the existing `diffViewer.test.ts` suites pass with only import-path edits.
- Move code, don't rewrite: `DiffView` methods are the existing `viewA`/`viewB`
  call sites with the pane parameter threaded through.
- Test split:
  - `src/test/webview/components/diffView.test.ts` (new, mirrors
    `hexView.test.ts`): markup (`renderDiffViewBodyHtml` ids/classes/order,
    `renderDiffEmptyHtml` escaped), `mount` creates/mounts two HexViews and only
    once, pane-qualified callback re-exposure for each of the five callbacks,
    `paintSelection` on both panes, `injectHeaders` both headers, scroll
    get/set per pane, `reset` drops instances, `setCallbacks` swap.
  - `src/test/webview/diffViewer.test.ts`: host suites unchanged (only imports /
    any direct `viewA`-style access updated).
- Run the full `diffViewer.test.ts` suite as the parity gate before and after.

## Dependency / sequencing

- Depends on `09-22-diffview-scroll-latency` (commit `b767c79`). The poll /
  transform / reconcile code is in `diffGrid.ts` at the baseline; it stays in the
  host, so this extraction does not re-touch that logic. Re-baseline on the
  committed tree; do not build on an uncommitted working tree.
- No protocol/persistence/data change. No visual change intended.

## Risks

- **Test brittleness**: any id/class drift breaks many tests. Mitigation: verbatim
  markup move + full-suite parity run.
- **CSS order regression**: moving rules changes `dist/webview.css` order.
  Mitigation: disjoint selectors + a stylesheet-order/guard test if needed + manual
  visual check of the diff surface.
- **Import cycle**: `diffView.ts` imports `hexView/` (component → component, fine);
  `diffGrid.ts` imports `diffView.ts`. No host module is imported by the component.
- **Scope creep**: the anti-pattern line in `component-diff-view.md` must be
  rewritten rather than silently contradicted.

## Rollback

Single-branch extraction; revert = delete `components/diffView/`, restore the inline
`viewA`/`viewB` wiring and the moved CSS in `diff.css`. No data/migration surface.

## Rejected alternatives

- **Render-layer only** (no controller): leaves `diffGrid` owning `HexView`
  instances and per-pane callbacks — the exact mixed structure the task removes.
- **Full controller move** (host logic into the component): contradicts the
  hexView precedent where the host owns the render loop and rows DOM; would
  relocate virtual-scroll math into the component (an explicit hexView
  anti-pattern).
- **Moving `diffSummary`/`diffSearch`/`diffExternalChange` into the component**:
  those are host/composition concerns, not the grid surface.

## Out of scope

- Any behavior, visual, protocol, or persistence change.
- `diffSummary.ts`, `diffSearch.ts`, `diffMessages.ts`, `diffExternalChange.ts`,
  `diffModel.ts`, `hexView/`, `memoryGrid.ts`.
