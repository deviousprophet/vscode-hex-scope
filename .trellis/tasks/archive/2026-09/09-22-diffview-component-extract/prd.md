# DiffView: extract self-contained component mirroring hexView

## Goal

Give the diff surface the same folder/component architecture as
`src/webview/components/hexView/`. Today `component-diff-view.md` is listed as a
component code-spec, but no diff component exists under
`src/webview/components/`; the diff surface lives in `src/webview/diff/` with the
host and DOM rendering mixed inside `diffGrid.ts`. The spec even carries an
anti-pattern saying diff layout "lives in the diff host" — contradicting its own
component listing.

## Problem

`src/webview/components/` holds `hexView`, `searchBar`, `toolbar`,
`externalChange`, `recordView`, `menuController`, and the `sidebar` panels — every
other self-contained UI unit. The diff surface is the only "component" spec
without a component folder.

The `hexView` pattern is a clean three-way split:

| Layer | hexView | Owner |
|---|---|---|
| Interaction controller | `hexView/hexView.ts` (`HexView` class + callbacks + paint) | component |
| Pure markup | `hexView/hexViewRender.ts` | component |
| DOM paint helpers | `hexView/hexViewPaint.ts` | component |
| Styles | `hexView/hexView.css` | component |
| Data, state, virtual scroll, slice loop | `memory/memoryGrid.ts` | host |

The diff surface has no equivalent component: `diff/diffGrid.ts` owns host data
(selection, view mode, sync flag, search matches, per-pane scroll state, copy) and
also reaches into the DOM directly — `drawPane` writes `slice.rows.innerHTML`,
`repositionPane` writes `style.top`, the poll/transform code writes
`.mem-rows` `style.transform`, and `scrollContainer`/`rowsId` resolve component
roots by global id. That violates the same "host never writes component DOM
directly" rule the hexView spec enforces.

## Requirements

### 1. Create the component folder

Add `src/webview/components/diffView/`:

```text
components/diffView/
    diffView.ts         DiffView interaction controller + DiffViewCallbacks + pane-qualified paint/scroll/header delegation
    diffViewRender.ts   pure DOM-free markup for the two-pane grid body + empty state
    diffView.css        grid-surface styles (body/side/split/grid-root), moved from diff/diff.css
```

Naming mirrors `hexView/hexView.ts` → `diffView/diffView.ts`,
`hexViewRender.ts` → `diffViewRender.ts`.

### 2. Boundary: mirror the hexView/host split exactly

The precedent (`HexView` + `memoryGrid`) is: the component owns markup,
interaction, and paint; the host owns data, virtual-scroll math, the render loop,
and the rows-wrapper DOM (memoryGrid itself writes `#mem-rows` innerHTML and
resolves it by id). Mirror that:

`DiffView` owns:

- the two `HexView` instances bound to `#diff-a` / `#diff-b`, with their
  callbacks re-exposed at diff level (`(pane, …)`) — the host never constructs a
  `HexView` or wires per-pane callbacks;
- the diff-specific markup (`diffViewRender.ts`): the two-pane grid body
  (`.diff-side` / `.diff-grid-root` / header / `.mem-scroll` / `.mem-rows`) and
  the empty-state markup;
- delegation over the two grids: mirrored selection paint, header injection,
  per-pane `setScrollTop`/`setScrollLeft`/`getScrollTop`, reset;
- the grid-surface styles (`diffView.css`).

The host `src/webview/diff/diffGrid.ts` keeps all state and decisions: data,
`visibleRows`, view mode, selection range + source pane, `syncScroll`, per-pane
`VirtualScrollState`, slice computation, the render loop and driver poll,
`sliceKey` gating, `scrollToDiff`/`scrollToRow` decisions, search matches, copy,
error/progress — and continues to resolve a pane's rows/container and write its
`innerHTML`/layout, exactly as `memoryGrid` does for the single grid. This is a
move of the interaction/paint/markup/styles out of `diffGrid.ts`, not a
relocation of host logic into the component.

### 3. Behavior-preserving

This is a structural extraction, not a feature change. Every existing test must
pass; the only permitted test edits are import paths, the test file split, and
selector helpers that now target the component API. Row order, diff classes,
scroll sync (including the new per-frame poll / transform / reconcile mechanics
from `09-22-diffview-scroll-latency`), selection mirroring, copy payload, search
paint, view modes, summary, error card, and external-change behavior are all
unchanged.

### 4. Tests split by layer

- `src/test/webview/components/diffView.test.ts` — new: the component's DOM
  primitives (shell/empty markup, draw per pane, reposition memo, transform
  apply/clear, scroll get/set, header injection, callback re-exposure with pane),
  mirroring `hexView.test.ts`.
- `src/test/webview/diffViewer.test.ts` — keeps host-level suites (data, view
  modes, selection/copy, scroll sync, search, summary, reload, protocol/error).
  Imports updated to the component path where needed.

### 5. Spec reconciled

`component-diff-view.md` must describe the real structure: the component folder +
host split in Layout, the `DiffView` contract, and it must drop the anti-pattern
that claims diff layout lives only in the host. Its Tests Required list splits per
requirement 4. `directory-structure.md` gains the new folder in the tree.

## Acceptance Criteria

- [ ] `src/webview/components/diffView/` exists with `diffView.ts`,
      `diffViewRender.ts`, `diffView.css`, mirroring the `hexView/` file split.
- [ ] `diffGrid.ts` no longer constructs or wires `HexView` instances, no longer
      calls `viewA.paintSelection`/`viewB.paintSelection` directly, and drives the
      grids only through `DiffView`.
- [ ] `DiffView` exposes the diff-level callbacks (`onVisibleWindowChange(pane,…)`,
      `onCellClick(pane,…)`, `onSelectionChange(pane,…)`,
      `onAddressRowClick(pane,…)`, `onAddressRowDrag(pane,…)`) and owns the two
      `HexView` instances.
- [ ] The two-pane grid body markup and empty-state markup are produced by
      `diffViewRender.ts` (toolbar/summary/error/side-head markup stays with the
      host/composition root).
- [ ] Grid-surface CSS (`#diff-body`, `.diff-side`, `.diff-split`,
      `.diff-grid-root`) moves to `diffView.css`, imported by `diffView.ts`;
      toolbar/summary/error rules stay in `diff/diff.css`. No visual regression.
- [ ] All existing diff behavior passes unchanged: `diffViewer.test.ts` host suite,
      new `components/diffView.test.ts`, `diffReload`/`diff`/`diffLoadProgress`/
      `diffParseWorker` core suites, and the extension suite.
- [ ] `component-diff-view.md`, `component-hex-view.md` (if its diff note changes),
      and `directory-structure.md` match the new structure; the contradictory
      anti-pattern is removed.
- [ ] `npx tsc --noEmit -p .` clean.
- [ ] `npm run lint`, `npm test`, and fallow (`--explain` + `audit --base origin/main
      --gate all`) clean.

## Notes

- Depends on `09-22-diffview-scroll-latency` (committed `b767c79`): the new poll /
  transform / reconcile primitives are part of what moves into the component.
  Ordering: latency first, extraction second (this task). Re-baseline against the
  committed latency behavior.
- CSS split is the one judgment call: the whole `diff.css` could move, but the
  component contract says component CSS holds only component-owned rules. Flagged
  as a design decision (see `design.md`) — the review gate can widen it.
- No protocol, persistence, data-format, or visual change expected ⇒ no migration.
- Out of scope: `diffSummary.ts`, `diffSearch.ts`, `diffMessages.ts`,
  `diffExternalChange.ts`, `diffModel.ts` (host/composition concerns, not the grid
  component); changing any diff behavior; touching `hexView/`.
