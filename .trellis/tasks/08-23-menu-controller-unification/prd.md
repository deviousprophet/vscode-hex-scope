# PRD — Unify ContextMenu and MenuPopup into one MenuController

Merge the two parallel menu implementations into one headless controller with
full keyboard navigation parity. Kills the divergence class where #196 fixed
the hex grid only.

## Problem

Two independent implementations of the same popover-menu concept:

- **ContextMenu** (src/webview/components/contextMenu/contextMenu.ts) — hex grid
  only. Full controller: render (`renderContextMenuHtml`), hover submenus,
  keyboard nav (arrows/Enter/Escape/Home/End, submenu two-step), click-outside,
  focusout, window blur, input-modality (`ctx-kb`).
- **wireMenuPopup** (src/webview/components/sidebar/sidebar.ts) — shared popover
  registry for struct field menu (`#si-val-menu`) + integrity profile `⋮` menu.
  Open/close/aria + (after the archived follow-up) click-outside, focusout,
  window blur, Escape. No keyboard nav, no input-modality.

Shared only via `positionContextMenu`, `wireHoverSubmenus`, and the `ctx-*`
CSS vocabulary. Every behavioral fix lands on one side and leaks the other.

## Scope

- New headless `MenuController` in
  `src/webview/components/contextMenu/menuController.ts`.
- Migrate all menu users onto it: hexViewer grid ctx menu, struct field menu,
  integrity profile `⋮` menu.
- Delete the sidebar popup machinery (`wireMenuPopup`, `toggleMenuPopup`,
  `closeMenuPopup`, registry, per-doc listeners) and old `ContextMenu` class.
- Full rename of the shared menu lexicon `ctx-*` → `menu-*` (ids, classes,
  CSS file, utils functions, struct builders), where feasible.
- Consolidated test suite.

## Rename lexicon (Q8)

| old | new |
| --- | --- |
| `#ctx-menu` id | `#menu` |
| `.ctx-menu` | `.menu` |
| `contextMenu.css` | `menu.css` |
| `.ctx-row` | `.menu-item` |
| `.ctx-hdr` | `.menu-header` |
| `.ctx-sep` | `.menu-sep` |
| `.ctx-has-sub` | `.menu-has-sub` |
| `.ctx-submenu` | `.menu-submenu` |
| `.ctx-scroll` | `.menu-scroll` |
| `.ctx-kb` | `.menu-kb` |
| `.ctx-label` | `.menu-label` |
| `.ctx-hint` | `.menu-hint` |
| `.ctx-go` | `.menu-go` |
| `.ctx-disabled` | `.menu-disabled` |
| `.ctx-fill-*`, `.ctx-custom-*`, `.ctx-edit-badge` | `.menu-fill-*`, `.menu-custom-*`, `.menu-edit-badge` |
| `renderContextMenuHtml` | `renderMenuHtml` |
| `positionContextMenu` | `positionMenu` |
| `wireHoverSubmenus` | `wireMenuSubmenus` |
| `ContextMenu` class | `MenuController` |

Integrity-specific classes (`integrity-profile-menu-*`) stay — those elements
are wired by id elsewhere; forcing the rename buys nothing.

## Requirements

1. **Headless controller**: `MenuController` never renders content. Callers
   supply `innerHTML` per show (hex/struct) or attach a pre-authored static
   popover (integrity). Pure render fns (`renderMenuHtml`) stay caller-side.
2. **One active menu**: opening a menu closes any other (registry semantics).
3. **Singleton**: module-level controller owns one set of per-document
   listeners; re-mounts never stack (mirror the WIP `popupClickDocs` pattern).
4. **Full keyboard-nav parity on every menu** (Q2): ArrowUp/Down moves focus
   skipping disabled, wraps; ArrowRight/Left opens/closes submenu; Enter/Space
   activates focused `.menu-item[data-cmd]` (emit) and leaves native buttons
   alone; Home/End jump; Escape two-step (submenu → menu) everywhere (Q3);
   first enabled item focused on open.
5. **Dismissal** (Q9): click-outside, focusout-to-outside, window blur,
   Escape. Focus restore to pre-open `document.activeElement` snapshot on all
   closes except window blur (skip — snapshot gone). Snapshot replaces the
   WIP button-only special case; unanchored struct menus restore to the field row.
6. **Interception** (Q11): controller handles nav/Escape in document
   **capture-phase** with `preventDefault + stopPropagation` for consumed keys,
   so hexViewer grid/undo/edit/save handlers never see them while open.
   Deletes `inContextMenu` (hexViewer.ts:783), behavior subsumed.
7. **Emit per show** (Q6): `opts.emit(cmd)` delivered for `[data-cmd]` rows
   (hex → `postMessage`, struct → field/pointer handlers). Integrity buttons
   activate natively; no emit synthesized for non-command items (Q7).
8. **Submenu identity** (Q10): reuse `.menu-has-sub` / `.menu-submenu` shared by
   hex + struct field menu (structPanel.ts:4418). No new selectors.
9. **aria**: anchored popovers sync `aria-expanded` on the anchor button.

## Acceptance criteria

- [ ] Hex grid right-click menu: identical behavior to current — render,
      submenus, full keyboard nav (all arrow/Enter/Escape/Home/End cases from
      old `contextMenu.test.ts`), input-modality `menu-kb`, dismissal.
- [ ] Struct field menu (right-click field): all hex nav + dismissal parity —
      arrows/Enter/Enter-on-submenu/ArrowRight/ArrowLeft/Escape two-step, and
      Field-command emit unchanged.
- [ ] Integrity `⋮` menu: opens on button, arrow nav among items, Escape
      closes, aria-expanded sync, click-outside + focusout + window blur close.
- [ ] Only one menu open at a time; opening one closes the other.
- [ ] `npm run check-types`, `npm run lint`, full `npm test` green.
- [ ] No `ctx-` identifiers remain in src/ (grep clean). No `ContextMenu`
      exports, no `wireMenuPopup` exports.
- [ ] `#ctx-menu`, `ctx-menu` references gone from webview css/ts/tests.
- [ ] Stale sidebar/structPanel comments from the archived task correct.
- [ ] Sub-agent dispatch flow recorded in implement.jsonl.

## Constraint

- One branch: `refactor/menu-controller-unification` off `main`.
- PR target: main.
- Null pointer modality: `#menu` container is created once by the controller
  on first mount.
- No typeahead (out of scope).