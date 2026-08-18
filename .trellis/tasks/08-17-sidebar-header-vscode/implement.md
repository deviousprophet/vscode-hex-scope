# Sidebar section framework — VS Code header model — Execution Plan

## Preconditions

Grilled design frozen (see prd.md). The current working tree contains the REVERTED-target partial zone-split/orchestration changes (3 failing tests) — this plan removes that machinery rather than fixing it.

## Implementation checklist

1. **sidebar.ts — remove dock machinery**
   - Delete `dockContainer` field, ctor param, `moveForCollapse`, `restoreToSlot`, `syncDock`, `moveTimers`, `COLLAPSE_MS`, `docked` class handling. Constructor drops the optional 4th arg.
   - `setCollapsed` reverts to: set map, toggle `collapsed` class, set `aria-expanded`. No reparent.
2. **sidebar.ts — VS Code header semantics in `buildSection`**
   - Collapsible: `head.role='button'`, `head.tabIndex=0`, `head.setAttribute('aria-expanded', ...)`, `head.setAttribute('aria-label', spec.label)`; render chevron `<span class="sb-section-chevron" aria-hidden="true"></span>` before label; wire `head` click + keydown (Enter/Space toggle, ArrowLeft collapse, ArrowRight expand), ignore events whose target is inside `.sb-section-actions`.
   - Non-collapsible: plain head (no role/tabindex/aria-expanded/chevron).
   - Actions slot mount: `root.addEventListener('click', e => e.stopPropagation())` + `keydown` stopPropagation on the actions container.
   - Keyboard nav: after mounting all sections, add one `keydown` listener on the SidebarSections `root` handling ArrowUp/ArrowDown when `e.target` is a `.sb-section-head` (focus sibling head; stop at ends).
3. **sidebar.css**
   - Delete `.sb-dock*`, `sb-dock-in`, `.sb-panel-scroll`.
   - Keep `.sb-section` grid + transition; `.sb-section.collapsed { grid-template-rows: auto 0fr; }`.
   - Add `.sb-section-chevron` (inline-block glyph, rotate 90deg when `.sb-section-head[aria-expanded="true"]` or `.sb-section:not(.collapsed)`), `.sb-section-head` cursor/focus-visible/hover styles; `.sb-section-head[aria-expanded]` affordance. `.sb-section-head.not-collapsible` plain cursor.
   - Remove the old `.sb-section-toggle` rules + `.sb-section-toggle::before` triangle.
4. **Mounts** — inspectorPanel.ts + structPanel.ts `mount()`: drop scroll/dock scaffolding, call `new SidebarSections(root, '<prefix>', [...])` without 4th arg.
5. **Tests**
   - structPanel.test.ts: replace dock assertions with in-place slim-header assertions (collapsed section stays in `.sb-panel-scroll`-free root, `.sb-section-head` role/aria); whole-head click toggle; keyboard Enter/Space/Left/Right; actions-stopPropagation; Up/Down nav.
   - inspectorPanel.test.ts: same; labels default-collapsed stays in stack (slim header), expand via head click returns list.
   - webview.test.ts: remove `.sb-dock`/`.sb-panel-scroll` asserts; labels default-collapsed renders slim header.
   - Add: non-collapsible header has no role/tabindex/chevron.
6. **Cleanup grep** — no `sb-dock|sb-panel-scroll|moveForCollapse|restoreToSlot|dockContainer|sb-section-toggle` remains in src or tests.

## Validation

- `npm run check-types`
- `npm run lint`
- `npm test`
- Manual EDH dark+light: click header toggles; Enter/Space; Left/Right arrows; Up/Down jumps between headers; action click doesn't collapse; Inspector labels default collapsed (slim header); Struct Types collapse/expand; smooth ~180ms height animation both directions; non-collapsible headers plain.

## Review gates

- No dock/reparent/timer/zone-split remnants (grep clean).
- Head-only arrow handling (no interference with field-grid/select inputs).
- Actions clicks never toggle; actions still run.
- aria-expanded + aria-label correct; SR names the header.
- Full suite green (the 3 failing tests gone).

## Rollback

One-commit revert restores previous header + dock. No persistence.