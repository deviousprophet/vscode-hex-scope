# PRD — Extract HexView grid into self-contained component

## Origin
Child of `08-03-webview-component-refactor` (issue #151: "Refactor webview UI into self-contained components"). Issue ACs: per-component `.ts`+`.css`, colocated styles, shared styles only global concerns, no functional/visual change.

## Problem
The memory hex grid is the most complex webview UI and is not componentized:

- `src/webview/memory/memoryView.ts` (723 lines) mixes render, virtual-scroll metrics, DOM height measurement, scroll listeners, interaction handlers, and reads of `S` in one module.
- `memory/dragSelection.ts`, `memory/selectionClick.ts` hold interaction logic (drag range reporting; click/context selection). `selectionClick.ts` reads `S` directly.
- Grid CSS lives in shared `src/webview/styles/memory-view.css`.
- Grid has near-zero direct test coverage; `webview.test.ts` covers it indirectly through `S` mutations.

## Goal
Extract a self-contained presentational `HexView` component that owns the grid's markup, transient interaction, and styles. Host (`hexViewer.ts`) owns all data/state. Structure:

```text
src/webview/components/HexView/
    HexView.ts        // row model types + pure render fn + interaction controller class
    HexView.css       // colocated (moved verbatim from memory-view.css)
```

## Design decisions (locked in planning grills)
- **Architecture: host-agnostic presentational component (B).** Component is a *view over host state*: it renders a row slice and reports pointer interaction; it never reads `S`, never computes domain state, never runs search/edit/copy.
- **Row model + pure render.** `HexViewRow`/`HexViewCell` types; pure `renderHexViewHtml(input): string` — DOM-free, jsdom-testable. All paint state is an input.
- **Cell state derivation (B).** Host passes declarative state (base byte class, match set, selection range, edit/integrity/struct maps); the component composites per-cell classes at render time (match/sel/col-hi/editing). Host does not precompute final `cls` per cell.
- **Interaction split.** Component owns pointer interaction + reporting: hover, column-hover, drag-selection range reporting (`onSelectionChange`), click/context reporting (`onCellClick(addr, shiftKey)`, `onCellContext(addr, x, y)`), copy-intent (`onCopy(range)`). Host owns state decisions: applies selection (`S.selStart/selEnd`), context menu, nibble-edit keyboard (data mutation), copy bytes.
- **Drag selection** is component-transient (reports range); persistent selection is host `S`. Component reports; host repaints via render input.
- **Virtual scroll** stays `render/virtualScroll.ts` (shared with record view). Host computes the visible slice + offsets using the shared math; component positions rows absolutely per render input.
- **Data/state modules stay host-side:** `memory/memoryData.ts` (`buildMemRows`, `initFlatBytes`, `getByte` — used by appModel, sidebar, struct, inspector, search), `memory/selection.ts` (`SelectionRange`, `currentSelectionRange`, `selectedBytes` — used by editTransactions, scriptList, hexViewer). Only `memoryView.ts` (render), `dragSelection.ts`, `selectionClick.ts` move into the component.
- **Naming:** `components/HexView/HexView.ts` + `HexView.css`, class `HexView`.
- **CSS:** moved verbatim from `styles/memory-view.css` into `HexView.css`, imported from `HexView.ts` (esbuild bundles into `dist/webview.css`; `styles/memory-view.css` deleted).

## Scope
In:
- New `src/webview/components/HexView/HexView.ts` + `HexView.css`.
- `hexViewer.ts` — wires `HexView` (render input from `S`+virtualScroll, callbacks → selection/context/edit), drops inline grid markup/events.
- `searchEngine.ts` — `applyMatchHighlights`/`scrollTo`/`applySel` replaced by host calls into component setters.
- `styles/memory-view.css` → moved to `HexView.css`.
- **Small feature:** memory-view ASCII toggle in the toolbar flipping the grid's `showAscii` between `true` and `false`. Default `true` (hex + decoded-ASCII, byte-identical to current single view). Only two states (hex-only / hex+ascii); no ascii-only. This lets the component's `showAscii` path be exercised before diff view exists.

Out:
- Diff-view reuse / multi-instance (`side`, mirror, rowOffset) — future feature.
- Moving `virtualScroll.ts` into the component — stays shared.
- Moving `memoryData.ts`/`selection.ts` — stay host-side data layer.

## Acceptance Criteria
- [ ] `components/HexView/HexView.ts` + `HexView.css` exist; component owns grid markup, transient interaction, and styles. Zero `S` references in the component; no data/domain computation inside it.
- [ ] Pure `renderHexViewHtml(input)` is DOM-free and jsdom-tested: row/header/gap/banner rendering, cell class compositing (byte state, match, sel, col-hi, editing, integrity, struct), virtualized positioning.
- [ ] Interaction controller reports hover/column-hover/drag-selection/click/context/copy via callbacks; it does not mutate `S` or selection state directly.
- [ ] Host owns selection state, matches, edit buffer, data, and virtualization slice (via `render/virtualScroll.ts`).
- [ ] Grid renders and behaves identically (same DOM ids/classes, same interactions, same visual) as pre-refactor; `npm test` green, `webview.test.ts` grid assertions still pass.
- [ ] `styles/memory-view.css` deleted; rules moved verbatim into `HexView.css`.
- [ ] `npm run lint`, `npm run check-types`, `npm run test` pass. Fallow green (dead-code/complexity/dupes 0).
- [ ] No functional or visual change to memory view behavior in the running extension.
