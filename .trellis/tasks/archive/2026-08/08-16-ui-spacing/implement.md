# ui-spacing — Implementation plan

## Order

1. **Primitives** (`components/sidebar/sidebar.css`): add `.sb-btn { padding: 2px 8px }`, `.sb-btn-add { padding: 5px ... }` (note: `.sb-btn-add` already has dashed border; add vertical padding; inspect current block first), `.sb-card { margin-bottom: 4px }`. Header margin already `.sb-hdr { margin-bottom: 8px }` — verify no panel overrides it to a different value.
2. **Inspector** (`inspectorPanel.css`): confirm no overrides; nothing expected.
3. **Struct** (`structPanel.css`): delete button padding overrides (`.se-btns/.sa-btn-row/.sa-no-types-row .sb-btn`, `#si-add-btn`/`#si-types-btn`/`#sm-close-btn`/`#sm-new-btn` padding), keep non-padding props (`flex-shrink`, `margin-left:auto`). Set `.si-hdr-row`/`.sb-hdr-row` margin-bottom → 8px (or drop override, primitive wins). Keep dense-grid exceptions.
4. **Integrity** (`integrityPanel.css`): `.integrity-hdr-row` margin-bottom → 8px; delete `#integrity-fix-all`/`#integrity-add-btn` padding overrides (keep other props if any).
5. **Scripts** (`scriptsPanel.css`): `.script-card { margin: 6px 0 }` → `margin: 0 0 4px` (drop the top margin; bottom comes from primitive). `.script-refresh-btn` padding → primitive (keep `margin-left:auto`, and font-size 13px IF that's an intentional size — verify vs `.sb-btn` 10px; if the ⟳ glyph needs 13px, keep font-size as documented exception).
6. **Spec refresh**: add spacing-ownership note to `css-guidelines.md` (primitives own panel spacing; struct dense grid exception). No new tokens.

## Validation commands

- `npm run check-types`
- `npm run lint`
- `npm test`
- Grep audit: `Select-String "padding:|margin:"` on the 4 panel CSS files + sidebar.css; each remaining spacing declaration must be justified (dense grid or non-spacing-adjacent).

## Risk / rollback

- Risk: scripts toolbar header margin — `.sb-hdr` margin-bottom 8px applies to `.script-toolbar` (it rides `.sb-hdr`), but toolbar already has `border-bottom` + `padding`. Verify the 8px doesn't double-space the toolbar→list gap; if it does, scripts toolbar is a documented exception (toolbar border is the separator, margin 0). This is the one visual judgment call.
- Rollback: single commit revert.

## Gates before start

- prd approved in final review.