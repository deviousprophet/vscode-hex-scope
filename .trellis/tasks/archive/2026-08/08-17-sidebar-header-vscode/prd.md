# Sidebar section framework — VS Code header model

## Goal

Rebuild `SidebarSections` header/collapse on the VS Code reference model (from `viewPane.ts` + `paneview.ts`): the whole section header is one collapse control, the chevron is decorative, collapse animates smoothly and sections shrink in place. This **removes the bottom dock** (dockContainer, reparent, timer orchestration, `.sb-panel-scroll` zone split) and the broken partial zone-split/orchestration changes currently failing 3 tests.

## Confirmed design decisions (grilled)

1. **Whole header is the toggle** — `.sb-section-head` carries `role="button"`, `tabindex="0"`, and `aria-expanded` on collapsible sections. Click, Enter, Space, **Left arrow (collapse), Right arrow (expand)** toggle. The chevron is a decorative `aria-hidden` glyph (like VS Code's codicon), not a button.
2. **Non-collapsible headers are plain** — no `role`/`tabindex`/`aria-expanded`; title renders normally (VS Code `collapsible=false` behavior).
3. **Actions slot inside the header** — mounted beside the title; clicks inside the actions slot call `stopPropagation` so they never toggle the header (VS Code `preventDefault` on `.actions`). Always-visible compact controls (decided Q2-B), not hover-reveal.
4. **Smooth collapse animation** — `.sb-section` body animates via CSS grid `1fr → 0fr` (~180ms), body stays in the DOM (decided Q3-A). Collapsed section = slim header row in place.
5. **No dock** — collapsed sections remain in the stack as slim headers; scroll passes them. Remove `.sb-dock`, `dockContainer`, `moveForCollapse`, `restoreToSlot`, `moveTimers`, `COLLAPSE_MS`, `.sb-panel-scroll`, and the mounts' scroll/dock scaffolding (decided Q4-B).
6. **Up/Down arrow navigation between section headers** (VS Code PaneView parity) — focusing a header and pressing Up/Down moves focus to the previous/next section header in the same panel.

## Requirements

R1. Header semantics per decision 1 (collapsible sections only). `aria-expanded` reflects state; heading structure (`h3.sb-section-title`) preserved.
R2. Non-collapsible: plain title, no toggle affordance, no role.
R3. Actions slot: mounted once, `stopPropagation` on all pointer/key events so clicking/focusing actions never collapses.
R4. Collapse: class + `aria-expanded` toggled; smooth grid-height animation; body content remains in DOM (hidden via 0fr + overflow) — no reparent, no timers, no dock.
R5. Up/Down header navigation within each panel; Left/Right collapse/expand (Left collapses, Right expands) on focused header.
R6. Existing panel migrations unchanged (Inspector merged labels/segments, Struct stacked sections, Integrity/Struct/Scripts action placement stays).

## Acceptance Criteria

- [ ] Rendered collapsible header: `.sb-section-head` is focusable (`tabindex=0`), `role=button`, `aria-expanded` correct; chevron `aria-hidden`; click anywhere on head (except actions) toggles.
- [ ] Enter/Space toggle; Left collapses; Right expands; focused header Up/Down moves to adjacent section header (wraps or stops at ends — pick stop-at-ends).
- [ ] Clicking an action button does not change collapse state and the action still runs.
- [ ] Non-collapsible headers (Struct Instances, Integrity, Scripts): no role/tabindex, plain, no chevron.
- [ ] Collapse animates the body height smoothly (~180ms) and the collapsed section renders as a slim header row in place; body stays in DOM.
- [ ] No `.sb-dock`, `dockContainer`, `sb-panel-scroll`, reparent/timer code anywhere; `git grep` clean.
- [ ] All panel tests updated: dock assertions removed, header-toggle assertions rewritten for whole-head click + keyboard, actions-stopPropagation test, no 3 failing tests (full suite green).
- [ ] `npm run check-types`, `npm run lint`, `npm test` green.

## Out of scope

- Hover-reveal actions + always-show setting (decided against).
- Body detach/relazy on collapse (decided against).
- Drag-to-dock / pane drag-and-drop.
- Preserving localStorage collapse state.