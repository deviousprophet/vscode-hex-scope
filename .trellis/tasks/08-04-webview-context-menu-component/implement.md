# Implement — ContextMenu component rework

Task: `.trellis/tasks/08-04-webview-context-menu-component`. Design decisions locked; do not re-litigate.

## Preconditions
- Branch `feat/webview-context-menu-component` (base main, RecordView merged). `npm run check-types` + tests green before.

## Checklist

1. **Study baseline** — read `src/webview/contextMenu.ts` (render), `contextMenuController.ts` (show/hide/wiring), `contextCommands.ts` (cmd → result mapping), `utils.ts` (`positionContextMenu`/`wireHoverSubmenus`), `styles/context-menu.css`, `hexViewer.ts` (`showCtxMenu`/`handleCtxCommand`/`applyContextCommandResult`), `webview.test.ts` context-menu assertions.
2. **Create component** `src/webview/components/ContextMenu/ContextMenu.ts`
   - Types `ContextMenuState`, `ContextMenuCallbacks`; pure `renderContextMenuHtml(state)`; `class ContextMenu(cb)` with idempotent `mount()` (doc-delegated click-outside/Escape/hover-submenu), `show(x,y,state)`, `hide()`, `setCallbacks`. NO `S`, no command execution, no postProviderMessage.
   - New layout per design: direct Copy Hex/ASCII/(C Array multi); Copy as… submenu; Analyze (multi); Go address (4B, endian preview, valid-gate); Select all/segment; Create label row (no auto-focus, click activates inline input + Apply, Enter/Apply confirm, Apply disabled on empty name + always-visible short hint, closes on create); Patch (edit mode).
   - Single-byte: no Analyze, no Go.
3. **Create `ContextMenu.css`** — move `styles/context-menu.css` verbatim + add new rules (go-address preview, label input, disabled state).
4. **Update `hexEditorSession.ts`** — remove `'context-menu'` from static CSS link list.
5. **Rewrite host** `hexViewer.ts`
   - `const contextMenu = new ContextMenu({ onCommand, onCreateLabel })`; mount once.
   - `showCtxMenu` → `contextMenu.show(x,y,state)` with computed goAddress (len===4 → uint32 by `S.endian`; valid = `getByte(addr)!==undefined`).
   - Map new cmds: copy-hex/copy-ascii/copy-c-array → existing `contextCommandResult` args; go-address → `scrollTo` + select; select-all → select whole doc; select-segment → select containing segment.
   - `onCreateLabel(name,address)` → label creation flow + rerender labels.
   - Remove `setupContextMenu`/`showContextMenu` imports; delete `contextMenuController.ts`/`contextMenu.ts` absorption.
6. **Delete** `src/webview/contextMenu.ts`, `contextMenuController.ts`, `styles/context-menu.css`.
7. **Tests** `src/test/webview/components/context-menu.test.ts` (mocha + jsdom + css-import-hook): render layout variants (single/multi/editMode/goAddress), interaction (onCommand, dismiss, hover-submenu, label Enter, fill invalid), host cmd mapping via `contextCommandResult` standalone.
8. **Validate**
   - `npm run lint`, `npm run check-types`, `npm run compile-tests`.
   - `npx mocha --ui tdd out/test/webview/components/context-menu.test.js` + component batch + `webview.test.ts`.
   - `npm test` (full).
   - Fallow all-axes green.

## Review gates
- `contextCommandResult` format outputs unchanged (byte-tools untouched).
- `rg "contextMenuController|contextMenu\b" src/` — only component + host wiring.
- Component zero `S`, zero postProviderMessage, zero command logic.
- context-menu.css gone from styles/ + static list.

## Rollback
- Rework is bigger than pure extraction: host command mapping + new actions. One commit; `git revert` restores old two-file menu + host wiring.
