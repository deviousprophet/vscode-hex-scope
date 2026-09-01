# Component Spec — MenuController

> Built from `component-template.md`. One headless menu controller owns every
> popover menu in the webview (hex grid ctx menu, struct field menu, integrity
> ⋮ menu): positioning, dismissal, hover submenus, keyboard navigation, and
> input modality. Replaces the pre-unification `ContextMenu` class (hex only)
> and the sidebar `wireMenuPopup` registry (popovers) — see task
> `08-23-menu-controller-unification` for the divergence it removed.

## Scope / Trigger

Owns `src/webview/components/menuController/menuController.ts` + `menu.css`:
the shared `#menu` container, per-document dismissal/listener wiring, hover
submenus (`wireMenuSubmenus`), full keyboard navigation, custom-fill inline
input behavior, and the pure hex-menu renderer (`renderMenuHtml`). Hosts own
command execution: the controller never reads/writes `S`, never posts provider
messages, never executes commands — it reports via **per-show `emit`**.

Boundary rule: the controller is headless — it never renders content of its
own. Callers supply `innerHTML` per `show()` (hex, struct) or `attach()` a
pre-authored static popover (integrity). Integration-specific classes
(`integrity-profile-menu-*`, `si-field-menu`) stay caller-owned and are NOT
renamed.

## Layout

```text
src/webview/components/menuController/
    menuController.ts   MenuController (module-private class) + singleton
                        `menuController` + focus/registry/dismissal core
    menuNav.ts          stateless DOM keyboard-navigation helpers
    menuRender.ts       pure renderMenuHtml + MenuState for the hex menu
    menuFill.ts         hex-menu "Patch / Fill" custom-input wiring
    menu.css            renamed from contextMenu.css; `ctx-*` → `menu-*`
src/webview/hexViewer.ts                hex grid show/emit wiring
src/webview/components/sidebar/structPanel/structPanel.ts   struct field menu
src/webview/components/sidebar/integrityPanel/integrityProfiles.ts  integrity ⋮
src/test/webview/components/menuController/menuController.test.ts   (mocha + jsdom)
```

Former files deleted: `contextMenu.ts`, `contextMenu.css`, old `contextMenu.test.ts`,
`menuPopup.test.ts`, and the sidebar popup block (`wireMenuPopup`,
`toggleMenuPopup`, `closeMenuPopup`, popup registry — previously sidebar.ts).

## Contract

```typescript
export interface MenuState {
    selectionActive: boolean;   // vestigial? still call-site-provided; nothing reads it inside the controller
    len: number;
    bytes: number[];
    editMode: boolean;
    locked: boolean;             // external-change lock (edit-selected menu row disabled when true)
    endian: 'le' | 'be';
    goAddress: { address: number; valid: boolean } | null;   // null = len !== 4
}

interface MenuShowOpts {
    innerHTML?: string;          // caller-rendered HTML for dynamic menus; omit for static popovers
    anchor?: HTMLElement;        // button-popover: aria-expanded synced to open state
    focusFirst?: string;         // e.g. '.menu-item:not(.menu-disabled)'
    emit?: (cmd: string) => void;  // called when a [data-cmd] item activates (click or Enter/Space)
    onClose?: () => void;        // every close (any reason)
}

export function renderMenuHtml(state: MenuState): string;   // pure hex menu renderer

class MenuController {          // module-private; only the singleton is exported
    attach(el: HTMLElement, opts?: Pick<MenuShowOpts,'emit'|'onClose'>): void;
    detach(el: HTMLElement): void;
    show(x: number, y: number, opts?: MenuShowOpts & { el?: HTMLElement }): void;
    hide(): void;                                  // close active menu + restore focus
    close(el: HTMLElement): void;                  // close a specific attached/active menu
    openMenu(): HTMLElement | null;                // the single active menu
    emitFor(el: HTMLElement): ((cmd: string) => void) | undefined;
}
export const menuController = new MenuController();   // module-wide singleton
```

Opening a menu closes any other open menu (one active at a time). The dynamic
`#menu` container is created once on first `show()` and reused. Attached
static popovers are shown with `show(x, y, { el, anchor })` and keep their own
`hidden` attribute/CSS positioning.

## Rules

- **Report-only via per-show `emit`:** clicks and Enter/Space on
  `.menu-item[data-cmd]` (non-disabled) → `emit(cmd)` + close. Native `<button>`
  items (integrity) with no `data-cmd` are LEFt to native activation — the
  controller never synthesizes a command. Keys typed into inline inputs
  (custom fill) stay native.
- **Dismissal:** click-outside, `focusout` to outside the active menu (or
  `relatedTarget === null`), `window blur` (VS Code chrome / alt-tab), Escape.
  Close-before-restore ordering (the restore itself moves focus and must not
  re-trigger `focusout`). Focus moves inside the menu never close it.
- **Focus restore:** `show()` snapshots `document.activeElement` before
  focusing the first item; every close restores it if still connected and not
  already active. `window blur` and duplicate-show close skip the restore.
- **Keyboard model (capture-phase):** handled keys get
  `preventDefault + stopPropagation` so host grid/undo/edit/save handlers never
  see them while a menu is open. ArrowUp/Down move among enabled items in the
  active scope (open submenu's rows when focus is inside; else the parent menu's
  own `:scope >` rows), skipping disabled/custom rows and wrapping. Home/End
  jump. ArrowRight on `.menu-has-sub` opens the submenu and focuses its first
  enabled item; ArrowLeft inside an open submenu closes it and returns focus to
  the parent row. Enter/Space activate `.menu-item[data-cmd]`; on a `data-sub`
  row they open the submenu instead. Escape is two-step: first closes an open
  submenu, then the menu (submenu-less menus close on the first press).
- **Keyboard scope helpers:** item selector is `.menu-item, [role="menuitem"]`
  (integrity buttons participate); rows inside a `display:none` submenu are not
  navigable. Submenu open-state checks use `style.display === 'block'`.
- **Input modality:** `#menu.menu-kb` gates the `:focus-visible` highlight —
  any `keydown` adds `.menu-kb`, any `pointerdown` removes it, `show()` sets it
  from the tracked last input mode (mouse-open → no first-row highlight; the
  grid `ContextMenu` key / Shift+F10 or any later keypress lights it).
- **Positioning / submenus:** `positionMenu` (root) + `wireMenuSubmenus`
  (submenu hover + edge flip) from `utils.ts`. Root and every submenu stay
  on-screen with an 8px gutter; flips left on right-edge overflow and up on
  bottom overflow; over-tall menus get `.menu-scroll`.
- **One active menu: opening one closes any other (registry semantics).**
  Per-document listeners are registered once (WeakSet-deduped); re-mounts never
  stack.
- **aria:** anchored popovers sync the anchor's `aria-expanded` on
  open/close. `#menu` has `role="menu"`; rows `role="menuitem" tabindex="-1"`
  (disabled rows `menu-disabled` + `aria-disabled`), separators `role="separator"`.
- **Rename lexicon:** all former `ctx-*` classes/ids retired (`#ctx-menu`,
  `.ctx-row`, `.ctx-submenu`, `.ctx-has-sub`, `.ctx-kb`, `contextMenu.css`,
  `renderContextMenuHtml`, `positionContextMenu`, `wireHoverSubmenus`,
  `ContextMenu`). See prd table in task `08-23-menu-controller-unification` for
  the full `ctx-*` → `menu-*` mapping. Grep-clean: no `ctx-` remains in
  src/webview or src/test.

## Behaviour

- Hex grid: host builds menu body via `renderMenuHtml(state)` and calls
  `menuController.show(x, y, { innerHTML, emit: handleCtxCommand })`.
  Go-address/select-all/select-segment are commands the host executes; the
  fill custom input lives in the controller (`.menu-fill-input` +
  `.menu-fill-apply`), Enter applies `fill-0x??`, invalid → `.menu-fill-invalid`.
  Input-keypresses never bubble to host shortcuts. The multi-byte body also
  carries the `edit-selected` row (rendered when `bytes.length >= 2`; disabled
  unless `editMode && !locked`) — the host starts the selection-edit session on
  emit.
- Struct field menu: `showFieldMenu` (structPanel.ts) renders per-field html
  (value-type/pointer disambiguators, struct value kinds) into the shared
  container with its own `emit`; right-click/copy/pointer commands unchanged.
- Integrity ⋮ menu: static popover `#integrity-profile-menu-pop` +
  `#integrity-profile-menu-btn`; `attach()` then `show({ el, anchor, focusFirst })`.
  Native buttons (Update/Rename/Delete) activate themselves; arrow/nav/Escape
  come from the shared controller.

## Validation & Error Matrix

| Condition | Behaviour |
|---|---|
| `el` (dynamic) cannot be created | `show` no-op. |
| Open while another menu is active | Current menu closed (no restore); new menu's snapshot taken fresh. |
| Go address, len !== 4 | Row omitted (host-side render). |
| Go address unmapped | Row `menu-disabled`, inert, `title="Not mapped"`; no `emit`. |
| Custom fill invalid hex | `.menu-fill-invalid`, input focused, no emit/close. |
| Click outside / Escape | Menu hides (Escape two-step with an open submenu). |
| Focus leaves menu / window blur | Menu hides; inside-menu focus moves keep it open; window blur skips focus restore. |
| ArrowRight on submenu row / ArrowLeft in submenu / Home / End | Submenu opens+focuses first / closes+parent refocus / jump to first / last enabled item. |
| Hover submenu row | Submenu shown (flip-aware). |
| Menu disconnected (re-render) | Registry entry pruned on next interaction; active close path avoids stale DOM. |

## Tests Required

`src/test/webview/components/menuController/menuController.test.ts` (mocha +
jsdom + cssImportHook): render variants (multi/single-byte/editMode/goAddress
valid+invalid), positioning/submenu flip, full keyboard matrix (arrows wrap +
skip-disabled, Home/End, submenu two-step, ArrowRight/Left,
Enter-on-submenu, Enter-left-to-native-button, Escape two-step), dismissal
(click-outside, focusout, window blur + skipRestore, Escape), focus restore,
input modality, single-active-menu invariants, attach/popover aria sync. Host
suites continue covering hexViewer/structPanel/integrityPanel integrations.

## Anti-patterns

- Controller rendering content (stays headless — callers render) or importing
  `S`/`state.ts`/posting provider messages.
- Executing commands (must report via per-show `emit`).
- Re-introducing a second popover-menu implementation (one controller).
- Duplicating `positionMenu`/`wireMenuSubmenus` (reuse from `utils.ts`).
- Renaming `integrity-profile-menu-*` / `si-field-menu` classes (caller-owned).
- Guarding host shortcuts with an `#ctx-menu` proximity check — capture-phase
  interception in the controller subsumes it (host `inContextMenu` deleted in
  the unification task; Ctrl+S while a menu is open now saves, matching struct
  behaviour). Re-add a `openMenu()`-based guard only if modal strictness is
  explicitly wanted.