# Sidebar section framework — Execution Plan

## Preconditions

- All-panel rollout.
- Generic `actionsSlot` + `collapsible:false` API lands and all panels adopt framework headers.
- Preserve Inspector default collapse states and no-persistence lifecycle; Struct/Integrity/Scripts remain always visible (`collapsible:false`).

## Implementation checklist

1. Read current `Sidebar`, Inspector render methods, `inspectorLabelForm.ts`, sidebar/Inspector tests, and the sidebar component spec.
2. Add `SidebarSectionSpec` and `SidebarSections` in `sidebar.ts`:
   - validate unique IDs in the supplied section list;
   - render semantic `h3` section titles, nesting a native `<button>` disclosure for collapsible sections;
   - retain per-mounted-instance collapse state in a map;
   - provide `body`, `setLabel`, `setBadge`, `setCollapsed`, `isCollapsed`;
   - mount action slots once after shell creation;
   - use document-local roots (no global selectors).
3. Add shared CSS in `sidebar.css` for `.sb-section-head`, `.sb-section-title`, `.sb-section-toggle`, `.sb-section-label`, `.sb-section-actions`, and compact `.sb-section-action`; migrate all existing top-level headers off legacy `.sb-hdr`. `.sb-section-actions` must not wrap; `.sb-section-action` is 10px/2px8/1.2/22px max so actions cannot enlarge headers. Non-collapsible headers use 8px body gap and no border; remove the Scripts toolbar border.
4. Migrate all existing top-level headers while preserving panel body architectures:
   - Inspector: create a `SidebarSections` instance; update all four render paths to body-only rendering; route dynamic badges through `setBadge`; remove `applyCollapsibleSection`; expose narrow expand-labels bridge to `inspectorLabelForm.ts`.
   - Struct: framework headers for Instances/Types inside the existing slide-track; Instances keeps Add as the sole compact header action; Types keeps ← Back/Cancel as its sole compact navigation action; bit-order, Types/manage, and New type controls stay in body.
   - Integrity: framework header title/count only; profile selector/Fix All/Add stay body controls.
   - Scripts: framework static header (`collapsible:false`) with compact Refresh action; preserve its list/result hierarchy and local result collapse.
5. Update panel + Sidebar tests:
   - shell renders labels, body IDs, default collapsed states;
   - button `aria-expanded` reflects toggles; click/keyboard toggles work;
   - actions slot does not toggle section;
   - Inspector body rerenders preserve collapse state;
   - adding a label expands Labels; full remount restores defaults;
   - existing selection/endian/segments/labels/copy behavior remains.
6. Refresh `component-sidebar.md` and `css-guidelines.md` with framework ownership, header/action placement rule, accessibility contract, staged migration note.

## Validation

- `npm run check-types`
- `npm run lint`
- `npm test`
- Manual Extension Development Host: Inspector on dark + light themes; mouse/keyboard disclosure; dynamic badge changes; label-add opens Labels; switch tabs/full rerender resets per current behavior.

## Review gates

- Verify every top-level panel header uses the framework; panel body architecture/state stays intact.
- Verify no panel-owned top-level collapse listener remains in Inspector; Scripts result-block collapse remains local.
- Verify Struct/Integrity/Scripts are `collapsible:false` and add no hide/show behavior.
- Verify action-slot sibling click does not change collapse state and no action expands a header beyond its compact size contract.

## Rollback

One commit revert restores Inspector-local section markup/collapse. No persistent state or external API protocol changes.