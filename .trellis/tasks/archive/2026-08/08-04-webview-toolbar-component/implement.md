# Implement — Toolbar component extraction

Task: `.trellis/tasks/08-04-webview-toolbar-component`. Design decisions locked; do not re-litigate.

## Preconditions
- Branch `feat/webview-toolbar-component` (base main, HexView merged). `npm run check-types` + tests green before.

## Checklist

1. **Study baseline** — read `hexViewer.ts` toolbar markup (`render()` `#toolbar` block) + `setupToolbarButtons`/`setupEditButtons`/`setShowAscii`/`updateMemoryOnlyControls`; `editControls.ts`; `styles/toolbar.css` toolbar-chrome rules; `webview.test.ts` toolbar/editor assertions. Catalog ids/classes (btn-mem/btn-rec/btn-ascii-toggle/btn-edit-mode/btn-save/btn-cancel/edit-mode-group/tb-editing-pill/edit-dirty-count, classes view-tabs/tb-sep/tb-ascii-btn/tb-edit-btn/tb-save-btn/tb-cancel-btn).
2. **Create component** `src/webview/components/Toolbar/Toolbar.ts`
   - Types `ToolbarCallbacks`, `ToolbarRenderState`; pure `renderToolbarHtml(searchBarHtml, state)`; `class Toolbar(cb)` with idempotent `mount()` (doc-delegated), `setView`, `setEditMode`, `setAscii`, `setDirty`. NO `S` import, no postProviderMessage, no edit logic.
3. **Create `Toolbar.css`** — move toolbar-chrome rules verbatim from `styles/toolbar.css`; `import './Toolbar.css'` in Toolbar.ts; leave stats/banner rules in toolbar.css.
4. **Rewrite host wiring** `hexViewer.ts`
   - Replace inline `#toolbar` markup with `${toolbar.toHtml()}` (SearchBar slot embedded).
   - Callbacks → switchView / setShowAscii / edit-entry / save-post / cancel-clear.
   - Replace `setupToolbarButtons`/`setupEditButtons` button listeners; `updateEditControls`/`updateDirtyBar` become host `setView`/`setEditMode`/`setAscii`/`setDirty` calls (on view switch, edit state change, dirty change).
   - SearchBar visibility: add `setVisible(bool)` to SearchBar component (encapsulated `#search-box` display toggle); host `switchView` calls `searchBar.setVisible(v==='memory')`; remove `setDisplayById('search-box', ...)` from `updateMemoryOnlyControls`.
5. **Slim `editControls.ts`** — remove `updateEditControls`/`updateDirtyBar` or repoint to toolbar setters; keep no toolbar DOM writes host-side.
6. **Tests** `src/test/webview/components/toolbar.test.ts` (mocha + jsdom + css-import-hook): render parity (tabs active, ASCII memory-gated, edit hidden while editing, EDITING group, dirty+save-disabled), callback reports, setters, SearchBar slot, idempotent mount.
7. **Validate**
   - `npm run lint`, `npm run check-types`, `npm run compile-tests`.
   - `npx mocha --ui tdd out/test/webview/components/toolbar.test.js` + existing component tests + `webview.test.ts`.
   - `npm test` (full).
   - Fallow all-axes green.

## Review gates
- `webview.test.ts` toolbar/edit assertions pass unchanged (parity proof).
- `rg "btn-edit-mode|btn-ascii|edit-dirty-count" src/webview/hexViewer.ts` — only through component; no direct button DOM writes host-side.
- `rg "S\.|postProviderMessage|saveEdits" src/webview/components/Toolbar/` — empty.
- toolbar.css keeps stats + banner rules; no duplicate toolbar rules.

## Rollback
- One commit; `git revert` restores inline toolbar markup + wiring + toolbar.css.
