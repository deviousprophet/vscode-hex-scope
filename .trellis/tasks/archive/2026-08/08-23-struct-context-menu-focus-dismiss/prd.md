# PRD — Focus-dismiss sidebar popover menus (struct context menu)

Follow-up to #196. Hex-grid context menu closes on focus loss; the struct field
value menu (`#si-val-menu`) and the other shared popovers do not.

## Problem

`ContextMenu.mount()` (src/webview/components/contextMenu/contextMenu.ts:190-200)
registers four dismissal paths for the hex ctx menu: click-outside, Escape,
`focusout`-to-outside, and window `blur` (VS Code chrome, alt-tab).

The shared sidebar popover machinery `wireMenuPopup`
(src/webview/components/sidebar/sidebar.ts:887) wires only Escape (pop-local
keydown) and click-outside (one shared per-document listener). No focus-loss
dismissals. Pathological: open struct field context menu (`right-click` a field),
press Tab / Shift-Tab / click into VS Code chrome → menu stays open.

Popups affected (all route through `wireMenuPopup`):
- struct field value menu `#si-val-menu` (createFieldValMenu, structPanel.ts:3940)
- integrity profile `⋮` menu `#integrity-profile-menu-pop` (integrityProfiles.ts:60)

> Note: struct card "⋮" from comments (sidebar.ts:803, structPanel.ts:254) is a
> stale label — `si-card-actions` are always-visible inline Edit/View/Delete
> buttons, not a popover. Out of scope for the dismissal fix, but the three
> stale comments referencing a non-existent per-card "⋮" menu
> (structPanel.ts:254, structPanel.ts:3847, sidebar.ts:803) get corrected in
> this task (spec accuracy).

## Scope

Fix at shared machinery level (one change covers every popover). No per-popup
patches.

## Settlement (grilled)

- **Q2 scope**: shared `wireMenuPopup` / popup registry level.
- **Q3 triggers**: mirror hex menu parity — add (a) `focusout` to somewhere
  outside the popup's capture root and (b) `window blur` → close all open
  popups. Keep existing click-outside + Escape.
- **Q4 focus restore**: on `focusout`-to-outside, restore focus to anchor
  trigger when still connected. On `window blur`, skip restore (window gone).
  Do not touch existing Escape handler behavior.
- **Q5 tests**: new `src/test/webview/components/sidebar/menuPopup.test.ts`
  mirroring `contextMenu.test.ts` style. Cover: focusout-to-outside closes,
  focusout-inside keeps open, window blur closes.
- **Task**: Trellis PRD (this file). Work on branch
  `fix/struct-context-menu-focus-dismiss` off `main`.

## Acceptance criteria

1. Right-click a struct field → open value menu → press Tab (focus leaves popup)
   → menu closes, focus returned to the field row (or documented restore target).
2. Open any `wireMenuPopup` popover → move focus out via Shift+Tab → closes.
3. Open popover → focus still inside → click inside popup / inner control → stays
   open (no regression on existing Escape, click-outside, aria-expanded sync).
4. Open popover → webview window blurs (simulated in test; real VS Code alt-tab)
   → closes.
5. Hex ctx menu (hexViewer path) unaffected: its `ContextMenu.mount()` behaves
   identically, no double-wiring, no test regressions.
6. Re-mounts never stack listeners (parity: per-document singleton pattern like
   `popupClickDocs`).
7. `npm test` webview suite + lint + typecheck pass.
8. Stale "per-card ⋮ menu" comments corrected (structPanel.ts:254, structPanel.ts:3847, sidebar.ts:803); no code behavior change from comment edits.

## Out of scope

- Keyboard arrow navigation inside sidebar popovers — tracked as follow-up
  task `08-23-menu-controller-unification` (unify ContextMenu + MenuPopup).
- Any change to hex ctx menu dismissal logic itself.
- Restoring focus to a disconnected trigger after window blur — skip by design.