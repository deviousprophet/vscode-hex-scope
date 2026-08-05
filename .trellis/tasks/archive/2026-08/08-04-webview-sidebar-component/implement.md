# Implement — Sidebar generic tabbed-shell component

Task: `.trellis/tasks/08-04-webview-sidebar-component` (parent; panels = child tasks). Design decisions locked; do not re-litigate.

## Preconditions
- Branch `feat/webview-sidebar-component` (base main, ContextMenu merged). `npm run check-types` + tests green before.

## Checklist

1. **Study baseline** — read `hexViewer.ts` sidebar markup (`render()` `#sidebar`/`#side-tabs` blocks), `setupSideTabs`/`applySidebarState`/`setupSidebarResize`/`setFileEndian`/`updateMemoryOnlyControls`; `sidebarResize.ts` (all); `sidebar.ts` (orchestration + label/segment/bits render); `styles/sidebar.css`; `sidebarTypes.ts`; `webview.test.ts` sidebar assertions. Catalog ids/classes (sidebar, side-tabs, stab-*, sbp-*, sidebar-common-settings, sidebar-btn-le/be, sidebar-resizer + .dragging, sb-section/sb-hdr/sb-body).
2. **Create component** `src/webview/components/Sidebar/Sidebar.ts`
   - Types `SidebarPanel`, `SidebarCallbacks`; `class Sidebar(options)` with idempotent `mount()` (doc-delegated tab clicks + resizer drag + headerSlot), `setTab(tab)`, `setCallbacks`, `toHtml()`. NO `S`, NO panel module imports, NO feature/panel logic.
   - `toHtml()` derives tabs + slots from `panels` config (no hardcoded panel ids/labels).
3. **Create `Sidebar.css`** — move shell rules verbatim from `styles/sidebar.css` (`#sidebar`, resizer+`.dragging`, `#side-tabs`/`.stab`, `#sidebar-common-settings`, `.sb-section/.sb-hdr/.sb-body`); `import './Sidebar.css'`.
4. **Refactor panel render fns to accept `root` param** (default current `document.getElementById(slot)`) — `sidebar.ts`/`inspector/index.ts` (`renderInspector`/`renderBits`/`renderSegments`/`renderLabels`), `side{struct,integrity,scripts}` entry points. Minimal mechanical change.
5. **Rewrite host** `hexViewer.ts`
   - Build `panels: SidebarPanel[]` config wrapping refactored render fns; `headerSlot` = renderEndianToggle (from `setFileEndian` + button markup).
   - `new Sidebar({ panels, headerSlot, cb })`; mount; `toHtml()` in render() replacing inline `#sidebar`/`#side-tabs`.
   - `onTabChange(tab)` → set `S.sidebarTab`, `sidebar.setTab(tab)`, run per-tab side-effect switch (moved from `setupSideTabs`).
   - `onPanelActivate(tab)` → lazy-mount map: first = mount(slotRoot), later = rerender via render fns.
   - Remove `setupSideTabs`/`applySidebarState`/`setupSidebarResize`; delete `sidebarResize.ts`.
   - Record-view sidebar visibility stays `updateMemoryOnlyControls` (#sidebar/#side-tabs display toggle).
6. **Tests** `src/test/webview/components/sidebar.test.ts` (mocha + jsdom + css-import-hook): generic render (tabs from config, slots, header slot), tab switch (active classes + slot visibility + onTabChange/onPanelActivate), lazy first-activation mount once, resizer drag (width clamp + localStorage persist + `--sidebar-w`), adding config panel renders new tab.
7. **Validate**
   - `npm run lint`, `npm run check-types`, `npm run compile-tests`.
   - `npx mocha --ui tdd out/test/webview/components/sidebar.test.js` + component batch + `webview.test.ts`.
   - `npm test` (full).
   - Fallow all-axes green.

8. **Known-bug fix (taken over from `08-03`)** — endian toggle wiped inspector data: `setFileEndian` used `renderInspector()` (shell rebuild → `#insp-vals` empty placeholder) instead of data-path `updateInspector()`. Fix: `setFileEndian` → `updateInspector()`; drop now-unused `renderInspector` import in `hexViewer.ts`. Regression test: endian toggle preserves inspector selection + multi-byte uint16 re-decodes (in `webview.test.ts`).
   - Also fixed test-state leaks found while verifying: `webview-message-model.test.ts` left `S.endian='be'` and `S.lockedDueToExternalChange=true` (added `teardown(resetState)` + endian in its resetState); `struct-ui.test.ts` scalar-endian test now restores `S.endian='le'`; `webview.test.ts` resetState resets `S.endian`.

## Review gates
- `webview.test.ts` sidebar/tab/endian/resizer assertions pass unchanged (parity).
- `rg "S\.|panel|renderStruct|renderInspector|renderIntegrity|renderScripts" src/webview/components/Sidebar/` — empty.
- No hardcoded panel id/label inside Sidebar.ts (all from `panels` config).
- shell CSS moved; panel-content CSS stays in sidebar.css (children claim).
- `sidebarResize.ts` deleted; persistence + drag in Sidebar.

## Rollback
- One commit; `git revert` restores inline sidebar markup + sidebarResize.ts + sidebar.ts orchestration + sidebar.css.