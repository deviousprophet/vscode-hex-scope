# Sidebar section framework — VS Code header model — Technical Design

## Scope

Rework `SidebarSections` (src/webview/components/sidebar/sidebar.ts + sidebar.css) to the confirmed VS Code header model and delete the bottom dock. Panels (Inspector/Struct/Integrity/Scripts) keep their current section composition and body rendering; only header semantics, keyboard behavior, collapse rendering, and removal of dock scaffolding change.

## Ownership

| layer | change |
|---|---|
| `sidebar.ts` `SidebarSections` | constructor: drop `dockContainer` param. `buildSection`: collapsible head renders as `role=button`, `tabindex=0`, `aria-expanded`, decorative chevron span `aria-hidden=true`; whole head click/Enter/Space/Left/Right toggles via delegated listener on head; actions slot `stopPropagation` on click + keydown. Non-collapsible: plain head, no role/tabindex, no chevron. Add optional keyboard nav: `setCollapsed` unchanged signature; new `navigateHeaders(dir)` or a per-panel Up/Down handler wired once at construction over sibling `.sb-section-head` elements. Remove `dockContainer`, `moveForCollapse`, `restoreToSlot`, `moveTimers`, `COLLAPSE_MS`, `syncDock`. Keep `body/setLabel/setBadge/setCollapsed/isCollapsed` public API (setCollapsed simply toggles class + aria, no reparent). |
| `sidebar.css` | keep `.sb-section` grid rows + transition; remove `.sb-dock*`, `sb-dock-in` keyframes, `.sb-panel-scroll`. Collapsed = `.sb-section.collapsed { grid-template-rows: auto 0fr }` (header stays, body 0). Header chevron: `.sb-section-head::before`? No — a real `span.sb-section-chevron` (decorative, `aria-hidden`), rotates 90deg when expanded. Add head hover/active/focus-visible styles (`role=button` affordance). Non-collapsible: `.sb-section-head.not-collapsible { cursor: default }`, no chevron. |
| `inspectorPanel.ts` `mount` | remove scroll/dock scaffolding; `new SidebarSections(root, 's', [...])` (no 4th arg). Bits/labels composition unchanged. |
| `structPanel.ts` `mount` | same removal; sections direct children of root again. |
| `integrityPanel.ts` / `scriptsPanel.ts` | unchanged (no dock today) except any `not-collapsible` class handling via SidebarSections automatically. |
| tests | structPanel.test.ts + inspectorPanel.test.ts + webview.test.ts: delete dock/`.sb-dock`/`.sb-panel-scroll` assertions; whole-head toggle tests (click head, Enter/Space, Left/Right, actions-stopPropagation, Up/Down nav, non-collapsible no-role). |

## Keyboard behavior detail

- Toggle listener: `keydown` on head → Enter/Space toggle; ArrowLeft → `setCollapsed(id, true)`; ArrowRight → `setCollapsed(id, false)`. `preventDefault` for handled keys (Space scroll, arrows scroll).
- Nav: one `keydown` listener on the panel root (or per panel) filtering `target.closest('.sb-section-head')`: ArrowUp/ArrowDown move focus to the adjacent head among the panel's collapsible+non-collapsible headers (stop at ends). VS Code moves between pane headers regardless of collapsibility.
- Actions slot: mount calls `addEventListener('click', e => e.stopPropagation())` and `keydown` stopPropagation so a focused action's Enter never bubbles to the head toggle (head toggle reads `e.target.closest('.sb-section-head')` and ignores events whose target is inside `.sb-section-actions`).

## Rendered DOM (collapsible)

```
<section.sb-section id="<prefix>-<id>" [.collapsed]>
  <div class="sb-section-head" role="button" tabindex="0" aria-expanded="true">
    <h3 class="sb-section-title">
      <span class="sb-section-chevron" aria-hidden="true"></span>
      <span class="sb-section-label">Label<span class="sb-badge" hidden></span></span>
    </h3>
    <div class="sb-section-actions"></div>
  </div>
  <div class="sb-body" id="<prefix>-<id>-body" role="region" aria-labelledby="<prefix>-<id>-title"></div>
</section>
```

Non-collapsible: head without role/tabindex/aria-expanded; no chevron span.

## Compatibility / rollback

- Public `SidebarSections` API: constructor drops the optional 4th param; methods unchanged. `setCollapsed` no longer reparents.
- Panels unaffected structurally; tests rewritten for the new interaction contract.
- One commit revert restores the old header + dock. No persistence.

## Risks

| risk | mitigation |
|---|---|
| Whole-head click fights action clicks | actions stopPropagation; toggle ignores events inside `.sb-section-actions` |
| Keyboard arrows conflict with inner inputs (field grids, selects) | ArrowLeft/Right/Up/Down handled ONLY when target is the head itself (not descendants) |
| aria-expanded on div-button needs label | `aria-label` = section label on the head (title text) for SR |
| Body 0fr transition in old browsers | Chromium-only webview; `@supports` not needed |
| Removing dock changes Inspect  | tests delete dock assertions; labels default-collapsed now shows slim header in place |