# Remove column selection in hex view, keep address row selection

## Goal

Remove the column-selection feature in the memory hex view (clicking a column header `00..0F` selects the mapped byte column). Remove its column-hover highlight affordance, which only exists to support column selection. Keep address-gutter row selection (click `.addr-cell` selects whole mapped row) fully working. Update CHANGELOG.md and the relevant Trellis spec.

## Background / Confirmed Facts (from code inspection)

- Column selection = header cell click → `onHeaderColumnClick` → `selectByteColumn` → `columnAddressSpan`/`columnAddresses` → `updateByteSelection` (`src/webview/hexViewer.ts:1037,1175-1201`).
- Component routing: `handleHeaderColumn` in `hexView.ts:208` handles `#mem-header .data-cell[data-col]` mousedown; `handleMouseDown:199` calls it first.
- Column paint: `paintSelection` removes/adds header `.sel-col` classes (`hexView.ts:92,108-109`), computed via `selectedColumns()` (`hexViewPaint.ts:16`).
- Column hover: callbacks `onColumnHover`/`onColumnLeave` + `.col-hi` paint. Only column-selection support; remove as part of selection removal.
- Address row selection is independent: `handleAddressRow` (`hexView.ts:218`) → `onAddressRowClick` → `selectAddressRow` (`hexViewer.ts:1204`). KEEP unchanged.
- Header render (`hexViewRender.ts:69-75`) emits 16 `.data-cell[data-col]` labels; keep labels visible but non-interactive.
- Spec: `.trellis/spec/frontend/components/component-hex-view.md` documents column select/hover/sel-col. Changelog `[Unreleased] Added` bullet: "Added one-click column row selection... clicking column header selects mapped byte in column".

## Requirements

1. Remove column-header selection behavior: header cells no longer trigger any selection on click.
2. Remove column-hover highlight and its callbacks/`.col-hi` column-affordance paint where they support column selection.
3. Keep address row selection (`.addr-cell` click) fully working.
4. Keep the 16 column header labels visually rendered (non-interactive).
5. Update CHANGELOG.md: adjust the `[Unreleased]` bullet to reflect column selection removed, address row selection retained.
6. Update `.trellis/spec/frontend/components/component-hex-view.md` to drop column-select/`sel-col`/column-hover contract and behavior surface.
7. Update/extend tests in `src/test/webview/components/hexView.test.ts`: remove column-click + `sel-col` assertions, assert header click is inert and address row click still fires.

## Acceptance Criteria

- [ ] Clicking any column header cell in the hex view performs no selection (no `sel-col`, no `updateByteSelection`, no `.sel` cells).
- [ ] Column hover no longer paints `.col-hi` across the column; `onColumnHover`/`onColumnLeave` removed or inert.
- [ ] Clicking an address gutter cell still selects the whole mapped row (with Shift-extend), identical to current behavior.
- [ ] Header still shows the `00..0F` column labels.
- [ ] `selectByteColumn`, `columnAddressSpan`, `columnAddresses`, `selectedColumns`, `handleHeaderColumn`, `onHeaderColumnClick` removed (no dead code / unused exports).
- [ ] `tsc`/lint pass; webview test suite (incl `.trellis` `webview.test.ts` parity) passes.
- [ ] CHANGELOG `[Unreleased]` bullet corrected.
- [ ] `component-hex-view.md` spec updated; no lingering `sel-col`/column-select/column-hover references.

## Out of Scope

- Address row selection behavior/refactor.
- Diff-view/column features for future tasks.
- CSS debt cleanup unrelated to column selection removal.

## Key Decisions

- Remove column-hover (`onColumnHover`/`onColumnLeave`/`.col-hi` column affordance) together with column selection, since it only supports the removed feature.

## Open Questions

- None (task is spec'd and reviewed; awaiting final-planning approval).

---

> **SUPERSEDED (2026-08-16):** A later review-fix round (`fix/uiux-followups`) restored both the column-hover affordance (`705a854`) and the passive header `.sel-col` highlight of the current selection (`744ecd0`), the latter to v2.17.1 parity despite this PRD's "no lingering `sel-col`" acceptance criterion. Column-*selection-by-click* remains removed. Record kept honest here; see `component-hex-view.md` for the current contract.
