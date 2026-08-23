# Implement — Unify ContextMenu and MenuPopup into one MenuController

Branch: `refactor/menu-controller-unification` (off main). Delivery per design.md step sequence; each step ends green (check-types + lint + tests).

## Step 1 — menuController.ts + suites (design.md §Migration 1)

- [ ] Rename `contextMenu.css` → `menu.css`; apply lexicon table (prd.md) — all `.ctx-*`/`#ctx-menu` → `menu-*`/`#menu`.
- [ ] New `src/webview/components/menuController/menuController.ts`:
  - `MenuController` class (attach/detach/show/hide/close/openMenu/emitFor).
  - module singleton `menuController`.
  - per-doc singleton listeners (click/focusout/windowblur/capture-keydown/pointerdown/keyboard-attract) with WeakSet dedup.
  - full keyboard model (design.md) incl. submenu scoping, Home/End, skip-disabled, wrap, Escape two-step.
  - focus snapshot + skipRestore on window blur; close-before-restore ordering.
  - input modality (`.menu-kb`).
  - `renderMenuHtml` + build helpers (moved + renamed).
- [ ] `utils.ts`: rename `positionContextMenu`→`positionMenu`, `wireHoverSubmenus`→`wireMenuSubmenus`; update importers (only menuController.ts by end of task).
- [ ] NEW test `src/test/webview/components/menuController/menuController.test.ts`: port every assertion from `contextMenu.test.ts` (render + positioning + submenu flip + keyboard + dismissal + focus restore + input modality), renamed selectors; port `menuPopup.test.ts` dismissal cases; ADD: single-active-menu invariant, struct/submenu two-step Escape, integrity-button native activation (Enter left to button), window-blur skipRestore.
- [ ] Gate: check-types, lint, `npx vscode-test run --grep "menuController"` green.

## Step 2 — hexViewer migration (design.md §Migration 2)

- [ ] hexViewer.ts: swap `ContextMenu` class 3 call sites (`contextMenu.mount()` → bootstrapped singleton already wired; `showCtxMenu` → `menuController.show(...)`; `menu.hide()`) → `menuController`.
- [ ] delete `inContextMenu` (hexViewer.ts:783); capture-phase keydown subsumes guard.
- [ ] delete `contextMenu.ts`, `contextMenu.css`, `contextMenu.test.ts`.
- [ ] Gate: full webview test `--grep "hexViewer|menuController|webview"` green; manual: hex right-click → nav/dismiss identical.

## Step 3 — structPanel migration (design.md §Migration 3)

- [ ] structPanel.ts: `import { menuController } from ...menuController`; replace `wireMenuPopup` + `createFieldValMenu`/`hideFieldValMenu`/`wireFieldValMenuCommands` with `show(x,y,{ innerHTML, emit, onClose })`; per-menu emit wiring preserved (field cmd, pointer cmd, copy).
- [ ] rename struct menu builders (`ctx-row`/`ctx-has-sub`/`ctx-submenu` etc → `menu-*`); keep `.si-val-menu` id/class? → migrate to controller container (drop id), keep `si-field-menu` modifier class if used for CSS targeting.
- [ ] stale comments fixed (line 254, 3847).
- [ ] Gate: `npx vscode-test run --grep "structPanel|menuController"` green.

## Step 4 — integrityProfiles migration (design.md §Migration 4)

- [ ] integrityProfiles.ts: `wireProfileMenu` → `menuController.attach(pop,{ emit? none })` + button `show({ el, anchor })`; delete `toggleMenuPopup` usage; update line-55 comment.
- [ ] Gate: `npx vscode-test run --grep "integrityPanel|menuController"` green.

## Step 5 — delete popup machinery

- [ ] sidebar.ts: remove popup block (registry `popupRegistry`, `popup*Docs` WeakSets, `shouldCloseOnOutsideClick`, `ensurePopupDoc*`, `openMenuPopup`, `closeMenuPopup`, `toggleMenuPopup`, `wireMenuPopup`, `MenuPopupOptions`/`MenuPopupEntry`); update header comment; drop unused css if any.
- [ ] delete `menuPopup.test.ts`.
- [ ] grep clean: no `ctx-` (css/ts/tests), no `ContextMenu`, no `wireMenuPopup`.
- [ ] Gate: `npm run check-types`, `npm run lint`, full `npm test`.

## Step 6 — review gate

- [ ] `git diff --stat` shows: menuController.ts (+), menu.css (renamed), hexViewer/structPanel/integrityProfiles/sidebar/utils edits, one test suite, deletions.
- [ ] manual sanity: hex menu, struct field menu, integrity menu — nav + dismissal.
- [ ] sub-agent check (`trellis-check`) before commit.

## Rules
- Commit only after gate + explicit user ask (Phase 3.4).
- Each step compiles; commit as grouped per step if user asks for granular commits, else one squash at end.