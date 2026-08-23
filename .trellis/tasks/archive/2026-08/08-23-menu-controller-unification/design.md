# Design — MenuController unification

## Module layout

```
src/webview/components/menuController/
  menuController.ts   ← NEW: MenuController class + module singleton bootstrap
  menu.css            ← renamed from contextMenu.css, ctx-* → menu-*
```

Pure render fns (`renderMenuHtml` + `build*Body` helpers) move with the rename
into `menuController.ts` (single import for hexViewer). `contextMenu.ts`
deleted. Sidebar popup block (sidebar.ts:801-953) deleted.

## MenuController API

```ts
type MenuShowOpts = {
    /** Caller-rendered HTML for dynamic menus (hex, struct). omit for static popovers. */
    innerHTML?: string;
    /** Pre-open activeElement snapshot, restored on close (skipped on window blur). */
    restore: 'snapshot'; // implied; captured by show()
    /** aria-expanded anchor for button-popovers. */
    anchor?: HTMLElement;
    /** Focus selector for first item on open, e.g. '.menu-item:not(.menu-disabled)'. */
    focusFirst?: string;
    /** Called with the command when a [data-cmd] item is activated (click or Enter/Space). */
    emit?: (cmd: string) => void;
    /** Called every time this menu closes (any reason). */
    onClose?: () => void;
};

class MenuController {
    /** Attach a menu element (static popover) or rely on show()'s inner container. */
    attach(el: HTMLElement, opts?: Pick<MenuShowOpts, 'emit' | 'onClose'>): void;
    detach(el: HTMLElement): void;
    /** Open a menu: the internal #menu container by default, or an attached el. */
    show(x: number, y: number, opts: MenuShowOpts & { el?: HTMLElement }): void;
    hide(): void;
    close(el: HTMLElement): void;   // close a specific attached/active menu
    openMenu(): HTMLElement | null; // active menu (was ContextMenu.openMenu)
    emitFor(el: HTMLElement): ((cmd: string) => void) | undefined;
}
export const menuController = new MenuController();   // module singleton
```

- Dynamic menus: `menuController.show(x, y, { innerHTML: renderMenuHtml(state), emit, ... })`.
  Controller writes `innerHTML` into its one `#menu` container and positions it.
- Static popovers (integrity): menu element pre-authored in DOM. `attach(el, { ... })`
  + `show(x, y, { el, anchor })`. `attach` does NOT render, only registers + syncs aria.
  Detach on re-render cleanup.

## Interaction core (moved from old ContextMenu)

All document listeners registered once per document (WeakSet-deduped), matching
the WIP pattern:

- `click` (bubble): outside active menu → `hide()`; inside → run row command: if
  `[data-cmd]` → `emit`; else let native button behave (no preventDefault).
- `focusout` (bubble): relatedTarget `null` or not inside active menu root →
  `hide()` (restore first, then close to avoid re-trigger — WIP ordering bug fix).
- `window blur`: `hide()` with `skipRestore` flag.
- `keydown` **capture**: nav + Escape (see keyboard model).
- `pointerdown` capture: input modality → mouse (`.menu-kb` off).
- keydown capture: any key → keyboard modality (`.menu-kb` on).

## Keyboard model (parity with old ContextMenu, unified for all menus)

Active menu scoped, capture-phase. Consumed keys get `preventDefault` +
`stopPropagation`.

- `Escape`: open submenu focused → close submenu (focus returns to parent row);
  else close menu (restore focus).
- `ArrowDown/Up`: navigate among enabled `.menu-item` in the *active scope*
  (parent rows, or the open submenu's rows when focus is inside it); wrap.
- `ArrowRight`: on `.menu-has-sub` row → open submenu, focus first enabled item.
  From inside a submenu → no-op (forward-into already focused).
- `ArrowLeft`: inside open submenu → close it, focus parent row; else no-op.
- `Home/End`: jump to first/last enabled item in active scope.
- `Enter`/Space: on `.menu-item[data-cmd]` → `emit(cmd)` + `hide()`. On a real
  `<button>` or other focusable non-command item: not consumed — native click.
- Tab/Shift+Tab: not consumed; `focusout` dismissal closes the menu (restore snapped focus).

## Focus snapshot (Q9)

`show()` captures `document.activeElement` immediately (before focusing
`focusFirst`). `hide({ skipRestore })`: restore if snapshot connected, not
already active, and !== the active menu. `window blur` → `skipRestore: true`.

## Submenu navigation scope

Reuse DOM: `.menu-has-sub` rows contain `.menu-submenu` (hidden by default).
Scope = rows under active menu excluding `.menu-submenu` children, EXCEPT when
`document.activeElement` is inside an open submenu, in which case scope = that
submenu's own `.menu-item` rows (wrap within). Matches old behavior exactly.

## Rename mechanics (Q8)

Single-file CSS rename `ctx-*`→`menu-*` per lexicon table in prd.md. Utils:
`positionContextMenu`→`positionMenu`, `wireHoverSubmenus`→`wireMenuSubmenus`
(module `utils.ts`; update contextMenu.test → menuController.test). Struct panel
builders (structPanel.ts:4393-4431 `ctx-row`/`ctx-has-sub`/`ctx-submenu`) and
`wireFieldValMenuCommands` (`.ctx-row[data-cmd]`) → new names. Integrity
classes untouched.

## Migration sequence (Q12)

1. Write `menuController.ts` (controller + renamed pure render fns +
   interpreters) with new test suite `menuController.test.ts`.
2. hexViewer: import `menuController` + `renderMenuHtml`; replace 3 call sites;
   delete `inContextMenu`; delete `contextMenu.ts`, `contextMenu.css`,
   `contextMenu.test.ts`.
3. structPanel: `createFieldValMenu`/`wireFieldValMenuCommands` →
   `menuController.show(...)` with per-menu emit; drop `wireMenuPopup` import;
   rename builder classes; drop `hideFieldValMenu` element removal (controller
   hides); keep stale-comment fixes.
4. integrityProfiles: `wireProfileMenu` → `attach` + `show({ el, anchor })`;
   mutable open/close/toggle helpers deleted; update its comment.
5. sidebar.ts: delete popup block (registry, listeners, exports, header
   comment). Verify no dangling imports (integrityPanel, structPanel, hexViewer).
6. Delete `menuPopup.test.ts` (dismissal cases folded into menuController suite).
   Grep `ctx-` clean. Full suite + lint + types green.

## Risks / rollback

- Struct field menu submenus (view-type dispatch) must behave identically under
  unified nav — covered by dedicated tests + manual check.
- Step 2 breaks until step 3/4 land their callers → sequence enforces per-step
  green (compiles at each step; only hexViewer's swap sits on new API first).
- Rollback: revert branch; old files intact on `main`.