# Sidebar PaneView — Execution Plan

## Preconditions

Grilled design frozen (prd.md): full SplitView port, localStorage persistence, all four panels, all sections collapsible, sash drag+arrows+dblclick, expand-restores-size.

## Implementation checklist

1. **sidebar.ts — split container + pane sizing core**
   - `SidebarSections` constructor builds `.sb-pane-view`, appends `<section class="sb-section sb-pane">` per spec with `.sb-pane-sash` between consecutive sections (skip when 1 section). Sash: `role="separator"`, `aria-orientation="vertical"`, `tabindex=0`, `aria-label`.
   - Sizing state: `Map<sectionId, { px: number; collapsed: boolean }>`. Constants `HEADER_H = 22`, `MIN_PANE = HEADER_H + 60`, `SASH_STEP = 10`.
   - `layout()`: measure pane-view clientHeight; compute free = height − (Σ collapsed HEADER_H) − (n−1)*SASH_H; distribute to expanded panes (persisted px clamped, proportional remainder); set `flex-basis` on each `.sb-pane` (collapsed → HEADER_H). Call on mount + `ResizeObserver` on `#sidebar`.
   - Collapse/expand: keep `setCollapsed(id, bool)` → sets flag, toggles `.collapsed` + `aria-expanded`, calls `layout()` (flex-basis transition animates the height). On expand: px = saved (clamped) or equal share of current free space; persist expanded px.
   - Remove `collapsible` option from `SidebarSectionSpec` (all collapsible); delete `.not-collapsible`/tabindex=-1 branch. Up/Down nav unchanged (all headers focusable).
2. **sidebar.ts — sash wiring**
   - Drag: pointerdown/move/up on sash → delta = pane-above basis += dy (clamp), pane-below absorbs (clamp), `layout()`, persist both px on up. Body `user-select:none` + cursor during drag.
   - Keydown on sash: ArrowUp → above +=10, below −=10; ArrowDown inverse; clamp; persist.
   - Dblclick: above & below both = combined/2; persist.
   - `localStorage` helpers: `loadPanes(panelId)` / `savePane(panelId, id, px)`; restore clamps + drops NaN/≤0.
3. **sidebar.css**
   - `.sb-tab-panel` keeps flex:1/min-height:0 but overflow removed (panel no longer scrolls); `.active` display:flex.
   - `.sb-pane-view { display:flex; flex-direction:column; flex:1; min-height:0; }`.
   - `.sb-pane { display:flex; flex-direction:column; min-height:0; transition: flex-basis .15s ease-out; }`, `.sb-pane.collapsed { flex-basis: 22px !important? }` (managed inline by JS; CSS only transitions). `.sb-pane .sb-body { flex:1; min-height:0; overflow-y:auto; overflow-x:hidden; }`.
   - `.sb-pane-sash { height:3px; flex:0 0 auto; cursor:row-resize; }` hover/active highlight; `.sb-pane-sash:focus-visible { outline:1px solid var(--focus-bdr); }`.
   - Remove grid `1fr→0fr` rules + `.sb-section.collapsed` grid override + `+ .sb-section` border-top (sash is the divider now; keep section borders minimal). Keep header styles. `prefers-reduced-motion` 0s on `.sb-pane`.
4. **Panels** — drop `collapsible:false` from Struct Instances, Integrity, Scripts specs (default collapsible). Inspector unchanged (already 2 collapsible). Verify panel bodies still render into `body(id)` (unchanged).
5. **Tests** (sidebar.test.ts + panel tests)
   - split DOM: `.sb-pane-view` exists; sashes count = sections−1; sash role/aria/tabindex.
   - sash: drag delta changes above-pane basis (clamped); ArrowUp/ArrowDown ±10; dblclick → equal; persists (localStorage assert); restore clamps invalid.
   - collapse: pane basis animates to 22px; sibling grows; collapsed header stays in view (bottom-pack order). expand: restores saved px; first-time 50/50.
   - all-collapsible: no `.not-collapsible` anywhere; Struct Instances/Integrity/Scripts toggle.
   - single-pane panels: no sash, pane fills.
   - existing header/click/keyboard/nav tests updated to split DOM.
6. **Cleanup grep** — no `not-collapsible`, no `grid-template-rows` in section collapse, no `collapsible:` false in panel mounts; `.sb-tab-panel` scroll rules gone.

## Validation

- `npm run check-types`, `npm run lint`, `npm test`
- Manual EDH dark+light: drag sash both panels; arrows; dblclick; collapse each section → pack bottom; reload → sizes restored; narrow sidebar (clamps); Integrity/Scripts collapse; independent scroll per pane.

## Review gates

- Panel no longer scrolls as a whole; per-pane scroll works.
- No non-collapsible variant anywhere (spec + code + tests).
- Persistence round-trip with invalid-value dropping.
- All existing header interactions preserved in the split layout.

## Rollback

One commit revert restores stacked shared-scroll layout. No persistence migration.