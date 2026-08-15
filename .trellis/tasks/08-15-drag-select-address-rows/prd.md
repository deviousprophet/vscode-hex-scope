# Allow drag to select multiple address rows in hex view

## Goal

Let the user select multiple whole rows by mouse-dragging vertically over the address gutter (`.addr-cell`), extending the selection across several address rows. Single-click address-row selection (current `onAddressRowClick`) is preserved. The selection covers all mapped bytes spanned by the dragged rows, consistent with existing byte-range selection.

## Background / Confirmed Facts (from code inspection)

- Address-row single click: `hexView.ts` `handleAddressRow` → `cb.onAddressRowClick(rowBase, shift)` → `hexViewer.ts` `selectAddressRow` → `rowAddressSpan`/`rowAddresses` → `updateByteSelection(mappedSelectionRange(first,last,shift))`. Selects only the mapped bytes of that one row.
- Byte-cell drag already exists: `handleDataCell` sets `dragAnchor` + `lastDragRange`; `handleMouseMove` → `reportDragRange(range)` → `cb.onSelectionChange(range)` → host `onHexViewSelectionChange` sets `S.selStart/End` + `paintMemorySelection`. Immediate live feedback.
- Gutter currently has NO drag: `handleAddressRow` fires the click and swallows on mousedown; no `dragAnchor` set for gutter. Need a parallel row-drag mode.
- Selection is address-based (`S.selStart/End`). Dragging rows = select contiguous mapped span from first dragged row's first mapped byte to last dragged row's last mapped byte. Unmapped gaps naturally excluded (byte-addressed).
- Host wires callbacks in `hexViewer.ts` `mountHexView({...})` (onCellClick, onCellContext, onSelectionChange, onCopy, onAddressRowClick). memoryGrid passes hostCallbacks through.
- Component contract lives in `hexViewRender.ts` (`HexViewRange`) and `hexView.ts` (`HexViewCallbacks`). Tests: `src/test/webview/components/hexView.test.ts` (mocha+jsdom).

## Requirements

1. Component (`hexView.ts`): add an address-row **drag** mode.
   - On address-gutter mousedown: keep firing `onAddressRowClick(rowBase, shift)` (single-row select on press, parity with current) AND arm a row-drag anchor + mark drag mode as row (distinct from cell drag).
   - On mousemove during row drag: compute the current row base under the pointer, build the row range `{startRow, endRow}` (min/max of anchor and current), and report it.
   - On mouseup: clear row-drag mode.
   - Do not disturb the existing byte-cell drag path.
2. Component namespace: add `onAddressRowDrag?: (rows: HexViewRange) => void` to `HexViewCallbacks` (Reuse `HexViewRange` — rows expressed as base-address range), plus internal `rowDragAnchor`/`dragMode` state.
3. Host (`hexViewer.ts`): wire `onAddressRowDrag` to select the mapped span across the dragged rows by computing `[rowAddressSpan(firstRow)[0], rowAddressSpan(lastRow)[1]]` → `updateByteSelection(first, last)`. Reuse existing `rowAddressSpan`/`rowAddresses`.
4. Tests: add component tests for gutter drag (mouse down on an address gutter cell sets anchor; mouse move to a lower/upper row reports the correct row range; mouse up stops). Keep single-click row test + inert-header test + cell-drag test unchanged.
5. Spec + changelog: update `component-hex-view.md` (callbacks + behaviour + tests) and add a user-visible `[Unreleased]` Changed/Added bullet.

## Acceptance Criteria

- [ ] Dragging vertically over the address gutter selects all mapped bytes across the dragged rows (live update while dragging).
- [ ] Dragging upward (reverse direction) works (min/max normalize the range).
- [ ] Single click on a gutter address still selects exactly that row (unchanged).
- [ ] Byte-cell drag still works (unchanged; no regression).
- [ ] Row-drag selection skips unmapped gap bytes (consistency with `selectedBytes` gap filtering).
- [ ] `tsc`/lint pass; `hexView.test.ts` and `webview.test.ts` parity green; new gutter-drag tests pass.
- [ ] `component-hex-view.md` and CHANGELOG updated.

## Out of Scope

- Auto-scroll during drag (parity: byte drag doesn't auto-scroll either).
- Ctrl/Cmd multi-select (toggle) of rows.
- Shift-drag extension semantics beyond parity with existing shift-click behavior.

## Key Decisions

- Reuse `onSelectionChange`-style live painting: row-drag reports through a new dedicated `onAddressRowDrag` callback wired to host selection, matching the byte-drag feedback model.
- Express row range as a base-address `HexViewRange` so host reuses `rowAddressSpan` unchanged.

## Open Questions

- None.
