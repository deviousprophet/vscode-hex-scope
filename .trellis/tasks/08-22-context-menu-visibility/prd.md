# Context menu visibility in hexgrid view

## Goal

Right-click context menu (and every submenu) must never clip off the visible viewport,
at any window size or position. Applies to the hex-grid menu and the Struct panel
field-value menu (same shared code).

## Requirements

- R1: no clipping — menu and every submenu fully on-screen, any window size/position.
- R2: submenu overflowing the **right** edge opens left (existing behavior, keep).
- R3: submenu overflowing the **bottom** edge opens upward (new vertical flip).
- R4: menu/submenu **taller than the viewport** stay on-screen (gutter clamp + last-resort
  internal scroll cap).
- R5: left/top gutter never negative (`max(8, …)` floor on both axes).
- R6: Struct panel `si-val-menu` receives the same guarantee via the shared fix.
- R7 (decision a+b): menu closes when focus leaves it or the webview loses focus —
  any `focusout` whose `relatedTarget` is outside `#ctx-menu` (or null), and window `blur`
  (click in VS Code chrome, side-by-side editor, alt-tab). Focus moves *inside* the menu
  (row→row, row→fill input→Apply) never close it.
- R8: keyboard-selection highlight on `#ctx-menu` rows shows only after keyboard use —
  mouse-open shows no focus highlight (hover bg unaffected); first `keydown` adds `.ctx-kb`;
  keyboard-open (ContextMenu key / Shift+F10) shows it immediately; `pointerdown` hides it.
  Focus keeps moving to the first row on open either way (arrows still navigate from there).

## Acceptance Criteria

- [x] AC1: menu opened at window bottom-right: every submenu fully visible (no vertical clip).
- [x] AC2: menu at left edge: no negative offset; ≥8px gutter.
- [x] AC3: window smaller than the menu/submenu: whole thing on-screen (cap + scroll, nothing off-canvas).
- [x] AC4: top-left positioning unchanged from today (regression bar).
- [x] AC5: Struct panel field-value menu + its submenus pass AC1–AC3 too.
- [x] AC6: focus moves outside the open menu (Tab, focusable click, window blur) closes it; focus moves inside keep it open.
- [x] AC7: mouse-open menu hides the keyboard-selection highlight; first keydown reveals it; pointerdown hides it; context-menu-key/SF10 open shows it immediately.

## Technical notes (approach)

- Fix lives in shared `src/webview/utils.ts` (`positionContextMenu`, `wireHoverSubmenus`)
  + `contextMenu.css` — one change covers both surfaces.
- Vertical flip mirrors `shouldOpenLeft`: bottom-anchored (`top:auto; bottom:…`) when
  `rowBottom + subHeight > innerHeight - 8`.
- Tall menu: JS measures and adds a dynamic `.ctx-scroll` class; CSS applies
  `max-height: calc(100vh - 20px); overflow-y: auto` only under that class (no permanent
  scrollbars on short menus).
- jsdom has no layout (`offsetWidth/Height` → 0), so tests mock metrics.
- New jsdom tests for `positionContextMenu` + `wireHoverSubmenus` (currently zero coverage).

## Out of scope

- Reposition on live window resize while menu open (open-time measurement only).
- Drag/touch-initiated menus, keyboard submenu navigation, nested submenus (>1 level doesn't exist).
- Focus-loss dismissal for other menu types (e.g. struct field-value `si-val-menu`) — different
  wiring (`wireMenuPopup`); hex-grid `#ctx-menu` only.