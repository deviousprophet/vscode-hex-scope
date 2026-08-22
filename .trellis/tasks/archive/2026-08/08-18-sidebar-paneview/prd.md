# Sidebar PaneView: resizable collapsible sections

## Goal

Port VS Code's `PaneView`/SplitView section model to the sidebar (Extensions-view style): every section is a resizable pane — fixed 22px whole-header toggle + independently scrolling body — separated by vertical drag sashes. Collapsed panes shrink to a slim header and freed space distributes to the expanded panes (collapsed headers pack to the bottom). Pane sizes persist across reloads.

## Confirmed grill decisions (final)

1. **Q1-A: Full port** — per-section independent scroll + drag sashes between every pair + collapsed-pack-to-bottom + persisted sizes.
2. **Q2-A: Persist** per-panel per-section sizes in `localStorage` (e.g. `hexScope.sidebarPanes.<panel>.<section>`), clamped/validated on restore, invalid entries dropped.
3. **Q3-A: All four panels** use the split container (single-section panels degrade to one pane that fills the panel, no sash). **All sections are collapsible** — the non-collapsible header variant is removed entirely (Struct Instances, Integrity, Scripts gain collapse; `.not-collapsible` CSS + `tabindex=-1` path deleted).
4. **Q4-C: Sash UX** — draggable; `tabindex=0` + `role=separator` + `aria-orientation=vertical`; ArrowUp/ArrowDown resize by 10px; double-click resets the two adjacent panes to a 50/50 split.
5. **Q5-A: Expand restores last size** — re-expanding a pane restores its saved height; other expanded panes shrink proportionally; first-time default is 50/50 among expanded panes.

## Requirements

R1. Panel root becomes a vertical flex **pane view**: `<div class="sb-pane-view">` containing one `<section class="sb-section sb-pane">` per section with `<div class="sb-pane-sash" role="separator" aria-orientation="vertical" tabindex="0">` between them. `.sb-tab-panel` stops being the single scroll container (no panel-level scroll; each expanded pane body scrolls itself).
R2. Pane sizing: expanded panes flex-grow into available space; collapsed panes are fixed at header height (22px). The collapse animation is the **outer-height flex-basis transition** (`flex-basis` 150ms ease-out, VS Code model), body clipped via `overflow:hidden`; body stays in the DOM.
R3. Collapse/expand keeps the whole-header control: click/Enter/Space/ArrowLeft/ArrowRight on `.sb-section-head`; chevron decorates; `aria-expanded` on the head; `aria-controls` → body. Up/Down still move focus between headers.
R4. Sash drag resizes the pane **above** it (delta moves flex-basis, clamped to `[min, max]`); sibling expanded panes absorb the change proportionally. Double-click = equal 50/50 split of the two adjacent panes' combined space. ArrowUp/Down = ±10px.
R5. Sizes persist on drag/arrow-resize (and on expand-restore) to `localStorage`; restore clamps to valid range and drops malformed values; defaults 50/50 among expanded.
R6. First-time expand of a collapsed pane: saved size if present, else 50/50 of the free space (all expanded panes equal).
R7. All sections collapsible; `SidebarSectionSpec.collapsible` option removed (always collapsible); non-collapsible CSS/variant deleted. Panel mounts updated: Struct Instances, Integrity, Scripts default open and collapsible.
R8. Single-section panels (Integrity, Scripts): one pane fills the panel, no sash, still collapsible.

## Acceptance Criteria

- [ ] Each panel renders panes in a split container; expanded pane bodies scroll independently; panel root does not scroll.
- [ ] Collapsing a pane animates its outer height (150ms ease-out) down to the 22px header; other expanded panes grow; collapsed headers stack below expanded content (bottom-pack).
- [ ] Sash: drag resizes the pane above; clamps to min/max; ArrowUp/ArrowDown ±10px; double-click 50/50; keyboard/semantics correct (`role=separator`, tabindex, aria-orientation).
- [ ] Expanding a pane restores its saved size or 50/50; siblings shrink proportionally.
- [ ] Sizes persist across reload (`localStorage` round-trip); invalid values dropped; reload shows persisted layout.
- [ ] All sections collapsible; no `.not-collapsible` (or `collapsible:false`) anywhere (grep clean); Struct Instances/Integrity/Scripts collapse hides their bodies.
- [ ] Whole-header toggle + chevron + keyboard (Enter/Space/Left/Right/Up/Down) unchanged and working in the split layout.
- [ ] `npm run check-types`, `npm run lint`, `npm test` green; tests cover sash resize/clamp/reset/persist, collapse distribution, expand-restore, single-pane panels.

## Out of scope

- Drag-to-reorder panes / cross-container DnD (later).
- Horizontal orientation / auxiliary bar.
- Per-view default sizes from descriptors (no such concept here).