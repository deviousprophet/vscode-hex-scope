# Sidebar PaneView — Technical Design

## Scope

Replace the shared-scroll stacked section layout with a vertical split-view of resizable panes (VS Code `PaneView`). Lives in `sidebar.ts` (framework) + `sidebar.css`; all four panel mounts use it. Non-collapsible variant removed.

## Ownership

| layer | change |
|---|---|
| `sidebar.ts` | `SidebarSections` → grows a split container. Constructor: build `<div class="sb-pane-view">`; each section is `<section class="sb-section sb-pane">`; insert `<div class="sb-pane-sash" role="separator" aria-orientation="vertical" tabindex="0">` between consecutive sections. Pane sizing state: per-section `{ px, collapsed }`; `flex-basis` applied to `.sb-pane`; collapsed → basis = header 22px (body hidden via overflow). Whole-header toggle/chevron/keyboard logic unchanged. Remove `collapsible` option (always collapsible); delete `.not-collapsible`/tabindex=-1 path and Up/Down nav now includes all headers (all are collapsible). Add sash wiring + persistence helpers. |
| `sidebar.css` | `.sb-tab-panel` stops scrolling (panel-level). `.sb-pane-view { display:flex; flex-direction:column; flex:1; min-height:0; }`. `.sb-pane { display:flex; flex-direction:column; min-height:0; }` with `transition: flex-basis .15s ease-out`; header fixed 22px; `.sb-pane .sb-body { flex:1; min-height:0; overflow-y:auto; overflow-x:hidden; }` (independent scroll). `.sb-pane-sash` 3px grab area with hover/active highlight; collapsed pane basis 22px. Remove `.not-collapsible*` rules; keep `.sb-section + .sb-section` border via sash instead? Sash replaces visual divider (sash itself is the divider line). Remove grid `1fr→0fr` collapse mechanism (superseded by flex-basis). `prefers-reduced-motion` → 0s. |
| panels (`inspectorPanel.ts`, `structPanel.ts`, `integrityPanel.ts`, `scriptsPanel.ts`) | mounts unchanged except spec list drops `collapsible:false` on Struct Instances / Integrity / Scripts (now default collapsible). `setCollapsed` calls unchanged. |
| tests | sidebar.test.ts + panel tests: split-container DOM (sashes count = sections-1, role/aria), sash drag/arrow/dblclick-reset, clamp, collapse distribution (expanded grows), expand-restore saved size, localStorage round-trip + invalid-drop, single-pane no-sash, all-collapsible (no not-collapsible asserts). |

## Layout & sizing model (JS + flex)

- Pane view fills the panel (`flex:1; min-height:0`). Each `.sb-pane` is a flex item: `flex-grow:0`, `flex-shrink:0`, `flex-basis: <px>` for fixed sizing; expanded panes `flex-grow:1` to absorb free space.
- `layout()` computes px allocations on: mount, any collapse/expand, sash drag, panel size change (ResizeObserver on the panel or on `#sidebar` resize). Expanded panes get `basis = share(px)`; collapsed panes `basis = HEADER_H`.
- Distribution: total panel height minus header-sum(collapsed) minus sash-space → free space. Expanded panes split it: each gets its persisted px when available, remainder distributed so total = free (proportional remainder). Min pane = HEADER_H + 60.
- Collapse: animate `flex-basis` expanded→HEADER_H (150ms) then mark collapsed. Expand: restore saved px (clamped) or equal share; siblings recompute (their persisted px re-clamped against reduced free space).
- Sash drag: pointerdown → track deltaY; pane above gets `basis += delta` clamped `[min,max]`; the pane below absorbs the same delta (clamped); persist both. Arrow: ±10px same path. Dblclick: the two adjacent panes (above+below) get `combined/2`.
- Persistence: `hexScope.sidebarPanes.<panelId>.<sectionId>` = px (string number). Restore: parse, clamp to `[min, panelMax]`, drop NaN/<=0. Remove key when pane collapses? No — keep last expanded px so re-expand restores (R5).

## Collapse animation

`flex-basis` transition on `.sb-pane` (150ms ease-out; reduced-motion 0s). Body is `overflow:hidden` while animating, then stays clipped when collapsed. No grid rows, no DOM reparent, no timers. Body content stays in DOM.

## Rendered DOM

```
<div class="sb-pane-view">                                  (flex:1; min-height:0)
  <section class="sb-section sb-pane" id="<prefix>-<id>" [.collapsed] style="flex-basis:..px">
    <div class="sb-section-head" role="button" tabindex="0" aria-expanded aria-controls aria-label>
      <span class="sb-section-chevron" aria-hidden="true"></span>
      <h3 class="sb-section-title"><span class="sb-section-label">…<span class="sb-badge" hidden></span></span></h3>
      <div class="sb-section-actions"></div>
    </div>
    <div class="sb-body" id="<prefix>-<id>-body" role="region" aria-labelledby="<prefix>-<id>-title"></div>
  </section>
  <div class="sb-pane-sash" role="separator" aria-orientation="vertical" tabindex="0" aria-label="Resize <above> section"></div>
  <section class="sb-section sb-pane" …>…</section>
  …
</div>
```

## Compatibility / rollback

- `.sb-tab-panel` id/classes unchanged; panel roots unchanged. Panels lose `collapsible:false` args only.
- One commit revert restores stacked scroll layout + non-collapsible variant.
- Persistence key prefix new; no migration needed.

## Risks

| risk | mitigation |
|---|---|
| Flex-basis math drift on panel resize | Recompute on ResizeObserver of `#sidebar` + on mount; clamp everything |
| Sash drag jank | rAF-throttled resize; `user-select:none` on body during drag (like sidebar resizer) |
| Saved sizes stale vs smaller panel | clamp on restore AND on every layout |
| Independent body scroll breaks existing scroll assumptions | panel body content unchanged; only the scroll container moves per-pane |
| Sash inside `.sb-tab-panel` flex column vs dock removal leftovers | no dock exists (removed 7d4c219); container is purely the pane-view |