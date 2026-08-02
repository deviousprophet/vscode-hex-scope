# Reuse HexViewComponent in single hex view

Child task of `08-02-reuse-ui-components-single-view`. One task, three interlocking phases: generalize component -> virtualize diff host -> adopt in single view.

## Goal

Make `HexViewComponent` the shared, virtualization-agnostic grid renderer for BOTH the single memory view and the diff view. The component owns grid rendering (hex + char columns, gap rows, segment banners, selection paint) and CSS; hosts own all logic (virtual scroll, editing, drag, context menu, inspector, search navigation). Adoption is behavior-preserving — zero user-facing change to single-view features including edit mode (#128) and the decoded-text column.

## Background / Confirmed Facts

- `HexViewComponent` (`src/webview/ui-components/hex-view/hexViewComponent.ts`, 407 LOC) is **diff-shaped**: consumes `DiffVisualRow[]` (diffViewModel), scoped `'a'/'b'`, hex-only cells (no char column), no virtualization, own scroll math in the diff host.
- Single view (`memoryView.ts`) renders its own rows: addr + hex `.data-cell` + char `.char-cell` per byte, gap rows, segment banners, buffered + compressed virtual scroll (`render/virtualScroll.ts`), byte edit (nibble buffer, #128 decoded-text editing + copy/paste), drag selection, context menu, inspector, search navigation/highlight, record-view switch.
- Diff view is a first-draft: renders all rows (no virtualization) — large-file compare has performance problems.
- Parity ground truth: single-view memory-grid behavior as of main (all features incl. #128 edit mode). The diff view has no release baseline; its virtualization is internal (behavior preserved).

## Requirements

- R1. **Generalize the component.** Component consumes a host-agnostic row model: `HexViewRow { address, cells: HexViewCell[], kind: 'data' | 'gap', banners?: HexViewBanner[] }`, `HexViewCell { hex: string; char: string; cls: string }`, `HexViewBanner { name; start; length; color }`. Component renders addr + hex cells + char cells (char column only when enabled), gap rows, banners, and selection paint. `HexViewRenderInput` gains `showChar: boolean` (decoded-text column header + char cells; diff passes false -> hex-only, unchanged visual).
- R2. **Decoded-text (ASCII) column lives in the component**, gated by `showChar`. The component renders the decoded-text column header and per-byte char cells; the host feeds char text/classes (printable-or-dot, dirty, integrity, edit-placeholder) — those are host display rules. Diff passes `showChar: false`.
- R3. **Component is virtualization-agnostic.** It renders the rows array it is given; the host computes the slice + position (`calcVisibleRange`, `calcRowOffset`, `calcCompressedWindowTop`) and feeds it. Host owns scroll state.
- R4. **Virtualize the diff host.** Diff wires `virtualScroll` once (uniform `DIFF_ROW_HEIGHT` getter, compressed phantom over `MAX_VIRTUAL_SCROLL_HEIGHT`), applies `viewMode` (all/diff) filter before slicing, feeds the same slice to both panels (a/b), positions via the shared anchor. Large-file compare works without performance problems.
- R5. **Adopt in single view — behavior-preserving.** `memoryView`'s own row/header rendering replaced by the component (mem-header replaced by component header incl. decoded-text label). All interaction stays host-side with compatible cell markup: `data-addr`, `data-col`, `data-val`, classes `.data-cell`/`.char-cell`/`be/cp/cd/edit-placeholder`, dirty/integrity. Host keeps edit (nibble, decoded-text editing, paste, fill, undo), drag selection, context menu, inspector, search navigation/highlight, record-view switch — identical UX (#128 included).
- R5a. **Cell-state + highlight visual parity (enumerated).** After adoption the component must render the ASCII/char column and ALL single-view-main grid visuals byte-identically: per-cell state classes (byte class, dirty `S.edits`, integrity stored/range, char `cp`/`cd`, edit-placeholder), selection paint (`.sel` on data+char cells in range, `.row-sel` on row containers, `.sel-col` on header column cells), column hover (`.col-hi` on body cells + header), search match (`.search-row`), gap rows, segment banners, addr formatting. The component's paint routines + CSS are the single source for these (moved from memory-view.css); the host feeds the same per-cell `{hex, char, cls}` and selection/match data main computed.
- R6. **Selection via render input.** Host owns selection state (`S.selStart/S.selEnd` in single view); component paints the selection passed in the render input and reports user changes via `onSelectionChange` -> host updates state -> rerender.
- R7. **Gap rows + segment banners through the component** (`kind`/`banners`); component owns their CSS (moves from memory-view.css into `hexViewComponent.css`). Single view feeds `S.memRows` 1:1.
- R8. **Search match highlight via render input** (host computes the match set; component paints), consistent with the component's existing `matchSet`/`searchRowIndex` inputs.
- R9. `hex-view-component.test.ts` moves to `src/test/webview/ui-components/` (parent cross-child C1).
- R10. Virtual-scroll contracts follow the dedicated `frontend/virtual-scroll.md` spec (anchor invariant, logical-position preservation).

## Acceptance Criteria

- [ ] AC1. Diff view: hex-only grid renders identically (showChar false); large-file (24 MB sample) compare scrolls smoothly via virtual scroll, no blank-band/row-gap artifacts; viewMode filter, diff-run/search highlight, swap still work.
- [ ] AC2. Single view: grid (addr/hex/char, gaps, banners) renders from the component, visually identical.
- [ ] AC3. Single-view edit mode identical UX: nibble typing, decoded-text editing, paste, fill, undo (#128 behaviors).
- [ ] AC4. Drag selection, context menu, inspector, search navigation + highlight, record-view switch all work unchanged.
- [ ] AC5. Selection paint syncs both ways (user drag -> `S`; search jump -> component repaint).
- [ ] AC6. `S.selStart/S.selEnd`, `S.edits`, inspector, search — single source unchanged; component never writes host state.
- [ ] AC7. Component CSS owns gap/banner/char/selection styles; memory-view.css keeps only single-view layout that is not grid rendering.
- [ ] AC8. `npm run compile`, `npm run lint`, `npm test` (component + webview suites), `npx fallow` 0/0/0. `hex-view-component.test.ts` in `src/test/webview/ui-components/`.

## Out of Scope

- Record view (`recordView.ts` page virtualization) — separate concern, untouched.
- New features (no UI/UX additions or changes) — this task is refactor + diff performance only.
- Changing char-text rules (printable threshold/dot), copy-format selection, or edit transactions.
- `core/` changes (search, memory, diff models) unless a shared bug demands it.

## Decisions (grill, 2026-08-02)

| Q | Decision |
|---|---|
| Q1 | Generalize component + adopt partially; **host owns logic** |
| Q2 | Generic `HexViewRow { address, cells[]{hex,char,cls}, kind:'data'|'gap', banners? }` |
| Q3 | Gap rows + banners **through the component**; component owns CSS |
| Q4 | **Host owns virtual scroll**; component virtualization-agnostic |
| Q5 | **One task, three phases**: generalize -> virtualize diff -> adopt single view |
| Q6 | Editing **host-side** (host listeners on compatible component cells) |
| Q7 | **Selection via render input**; `S` single source |
| Q8 | Diff: **one shared virtualScroll** state, uniform `DIFF_ROW_HEIGHT`, viewMode filter before slicing |
| Q9 | **ASCII column in component** — decoded-text header + char cells, `showChar` flag; diff off (unchanged); host feeds char text/classes |
| Q10 | **Hard parity** — behavior-preserving adoption, #128 edit mode identical UX, host-compatible cell markup |
| — | Single-view header replaced by component header (incl. decoded-text label); host horizontal scroll-sync adapts |
