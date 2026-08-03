# Implement — HexView component extraction

Task: `.trellis/tasks/08-03-webview-hexview-component`. Complex (PRD + design + this plan required). Design decisions locked in grills; do not re-litigate.

## Preconditions
- Branch: `feat/webview-hexview-component` (base `main` @ SearchBar merged). `npm run check-types` + `npm test` green before changes.

## Checklist

1. **Study baseline** — read `src/webview/memory/memoryView.ts` (all 723 lines), `dragSelection.ts`, `selectionClick.ts`, `render/virtualScroll.ts`, `webview.test.ts` grid assertions. Catalog every DOM id/class the grid uses (mem-header, mem-scroll, mem-rows, data-cell/char-cell/addr/gap-row/seg-banner classes, data-addr/data-col/data-val) — these must survive byte-identical.
2. **Create component** `src/webview/components/HexView/HexView.ts`
   - Types: `HexViewRow`, `HexViewCell`, `HexViewBanner`, `HexViewRange`, `HexViewRenderInput`, `HexViewCallbacks` per design.md.
   - Pure `renderHexViewHtml(input)` — header + rows (data/gap/banner) + container-wrapper positioning (rows container height + inner wrapper `top: windowTop`; no per-row absolute); per-cell class compositing (base + match + sel + col-hi hooks); `showAscii` flag (default true = single-view parity); `esc()` everywhere; preserves `data-addr`/`data-col`/`data-val`.
   - `class HexView(rootSelector, cb)`: idempotent `mount()` (document-delegated, scoped to root), hover/column/drag-report/click/context/copy reporting, `setCallbacks`, `paintSelection`, `paintMatch`, `scrollTo`, `paintCell(addr, previewText|null)` (nibble-edit preview, restore from own `data-val`). NO `S` import, no data/domain logic, no global DOM ids (diff-compatible scoping).
3. **Create `HexView.css`** — move `styles/memory-view.css` verbatim; `import './HexView.css'` in HexView.ts; delete `styles/memory-view.css`.
4. **Rewrite host wiring** `src/webview/hexViewer.ts`
   - Build render input from `S` + `virtualScroll`; render grid via component (component renders header + body + scroll-sync); wire `onVisibleWindowChange` → host recomputes slice + re-renders; drop `renderMemHeader`/`renderMemBody`/`applySel`/`applyMatchHighlights`/`scrollTo` imports from `memoryView.ts`.
   - Callbacks: `onCellClick` (shift-expand via `S`), `onCellContext` (select-if-outside + `showCtxMenu`), `onSelectionChange` (drag → `S` + repaint), `onCopy` (`doCopySelection`).
   - Add memory-view ASCII toggle: button/small control in toolbar flipping render input `showAscii` between `true` and `false` (default `true`); labels **Hex** / **Hex+ASCII**. Host owns the toggle state; component only honors the input.
   - Keep nibble-edit typing (hexViewer.ts): host calls `paintCell(addr, 'D-')` / `paintCell(addr, null)`; delete `dataCellAt` + `dataset.val` DOM reads (component owns restore). Copy keyboard, context menu, `render/virtualScroll.ts`, `memory/memoryData.ts`, `memory/selection.ts` stay host-side.
5. **Delete** `memory/dragSelection.ts` + `memory/selectionClick.ts` (behavior absorbed into component reports + host handlers).
6. **Update `searchEngine.ts`** — replace `applyMatchHighlights`/`applySel`/`scrollTo` imports with host-provided actions (paint/scroll seams), e.g. via `initSearch`'s ui callbacks or host `rerender`; `runSearch` signature unchanged.
7. **Tests** `src/test/webview/ui-components/hex-view.test.ts` (mocha + jsdom + css-import-hook): pure render paint + positioning, interaction reports, paint methods, empty-cell/match/sel exclusions.
8. **Validate**
   - `npm run lint`, `npm run check-types`, `npm run compile-tests`.
   - `npx mocha --ui tdd out/test/webview/ui-components/hex-view.test.js` and full jsdom batch.
   - `npm test` (full, launches VS Code).
   - Fallow all-axes green (dead-code 0, complexity findings 0, dupes 0).

## Review gates
- `webview.test.ts` grid assertions pass unchanged (parity proof).
- `rg "memoryView|dragSelection|selectionClick" src/` — only allowed leftovers: none (files deleted).
- `rg "S\.|import.*state" src/webview/components/HexView/` — empty (no S coupling).
- Component has no `data-val`-parsing, no `stageIntegrityEdit`, no `postProviderMessage`.

## Rollback
- Single commit; `git revert` restores memory/* files + host wiring + memory-view.css.
