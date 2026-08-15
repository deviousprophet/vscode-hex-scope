# Restore hex-grid column hover, keep column selection removed

## Goal

Restore the column-hover highlight in the memory hex grid (hovering any byte or header cell highlights the whole column via `.col-hi` + reports `onColumnHover`/`onColumnLeave`). Column **selection** stays removed: clicking a column header still selects nothing. This restores behavior inadvertently removed alongside column-selection removal so users still see the column highlight while hovering, but no column-select action.

## Background / Confirmed Facts (from the prior removal commit 3616919)

Column hover and column selection are independent features that were removed together. This task re-adds ONLY column hover.

Removed with column hover (targets to reintroduce):
- `src/webview/components/hexView/hexView.ts`: `onColumnHover`/`onColumnLeave` callbacks + interface fields, `activeColumn` field, `setColumn`/`unpaintColumn`/`paintColumn` methods, the column branch in `handleMouseOver`, `relatedTargetInColumn` guard + `setColumn(null)` call in `handleMouseOut`, file-header comment "column hover".
- `src/webview/components/hexView/hexView.css`: `.col-hi` rules for `.data-cell`, `.char-cell`, and `#mem-header .data-cell`.
- `src/test/webview/components/hexView.test.ts`: `columnHovers`/`columnLeaves` fields in `CallLog`/`emptyLog`, `onColumnHover`/`onColumnLeave` callbacks in `installHexView`, the column-highlight hover test.
- `.trellis/spec/frontend/components/component-hex-view.md`: column-hover contract + behavior + tests-required text.

Column **selection** removal is KEPT (do not reintroduce):
- `handleHeaderColumn` / `onHeaderColumnClick` / `selectByteColumn` / `columnAddressSpan` / `columnAddresses` / `selectedColumns` — stay deleted.
- Header cells remain inert (clicking a column header does nothing).
- `paintSelection` stays without `.sel-col` painting.

## Requirements

1. Re-add `onColumnHover`/`onColumnLeave` callbacks + `activeColumn` + `setColumn`/`unpaintColumn`/`paintColumn` + `relatedTargetInColumn` + column hover branches in mouse handlers (hover on a byte or header cell highlights the entire column `.col-hi` and reports the column).
2. Re-add the three `.col-hi` CSS rules.
3. Keep column-header click inert (no column selection; `handleHeaderColumn`/`selectByteColumn` stay removed).
4. Update tests: restore `columnHovers`/`columnLeaves` in `CallLog`/`emptyLog` + `installHexView` callbacks + the column-hover test. Keep the inert-header-click test and the `selectedColumns`-free `paintSelection` test.
5. Update `.trellis/spec/frontend/components/component-hex-view.md` to restore column-hover contract/behavior/tests while retaining column-selection-removal text.
6. CHANGELOG: no change needed (column-hover is not a user-visible shipping outcome; column selection never shipped so no removal entry).

## Acceptance Criteria

- [ ] Hovering any byte cell or header cell paints `.col-hi` across the whole column (hex + char + header) and fires `onColumnHover`.
- [ ] Leaving the column fires `onColumnLeave` and clears `.col-hi`.
- [ ] Clicking a column header still selects nothing (header click inert; no `selectByteColumn`, no `.sel-col`).
- [ ] `tsc`/lint pass; `hexView.test.ts` all green (incl. restored column-hover test, inert-header-click test, row-selection test); `webview.test.ts` parity green.
- [ ] No lingering/duplicate callbacks or dead `selectedColumns`/column-select code.

## Out of Scope

- Column selection (remains removed).
- Address row selection changes.
- Any other hover/selection refactor.

## Key Decisions

- Restore byte-cell AND header-cell hover highlight (parity with pre-removal behavior).
- Keep column selection removal fully intact.

## Open Questions

- None.
