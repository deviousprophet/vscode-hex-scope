# Fix hex-grid keyboard nav: clicking a byte never focuses the grid

## Goal

Make arrow-key (and Shift+arrow, context-menu-key) navigation work immediately after the user clicks a byte in the hex grid. Currently clicking a cell leaves keyboard focus on `BODY`, so the grid selection gate (`isGridFocused` in `hexViewer.ts`) never passes and keyboard navigation appears dead. Clicking blank space inside the grid works because the container's native `tabindex="0"` focus applies.

## Requirements

- Clicking (mousedown) any mapped byte cell focuses the grid container `#memory-view` so document-level arrow-key navigation activates
- Applies on `mousedown`, covering both plain clicks and drag-selection starts (shift-click extension included)
- Focus also happens on the right-click / context-menu path, so arrows work after the context menu closes
- Focus applies in both edit mode and non-edit mode (arrow keys remain inert in edit mode by existing gate — no behavior change there)
- Implementation lives in the `HexView` component (`handleMouseDown`), not the host; host keeps owning selection/keyboard logic
- No host-facing DOM focus helpers, no per-cell `tabindex`

## Acceptance Criteria

- [ ] `mousedown` on a mapped byte cell sets `document.activeElement` to the grid root (component test in `src/test/webview/components/hexView.test.ts`)
- [ ] Integration test: a click then `ArrowDown` moves the selection to the next mapped address (jsdom, single document, module-level listeners registered)
- [ ] Right-click on a cell focuses the grid root (component test)
- [ ] Existing tests still pass: `npm run compile-tests`, `npm run lint`, `npm run check-types`, and the webview test suites
- [ ] Unmapped/empty cells still report nothing and do not start a drag (existing behavior preserved)

## Notes

- Root cause verified via repro harness: `hexView.ts` `handleMouseDown` calls `e.preventDefault()` (cancels browser default focus transfer) and never calls `focus()`; gate at `hexViewer.ts:1146` requires `activeElement` inside `#memory-view`.
- `updateByteSelection` → `paintMemorySelection()` is incremental; the grid container persists, so container-level focus survives the click.
- jsdom has no native click-to-focus; the component test must assert explicit focus transfer.
- no code edit until task activated.