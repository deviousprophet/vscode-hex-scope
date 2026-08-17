# Rework Struct — Execution Plan

## Preconditions

Grilling decisions fixed (prd.md). Types section default open for discoverability; framework Collapse available. No slide-track.

## Implementation checklist

1. **Stacked sections (structPanel.ts mount)**
   - Replace `si-panel-clip`/`si-panel-track` slide markup with direct `SidebarSections` on panel root: `instances` (collapsible:false header? no — instances non-collapsible header, body always shows; Types `collapsible:true, defaultCollapsed:false`).
   - Remove `_managingTypes`, `si-showing-types`, slide transforms, `#si-track` assumptions.
   - Back/Cancel header action now slides n/a — becomes "collapse Types / resume list" or editor back control in Types header.
2. **Instance card "⋮" menu (structPanel.ts + css)**
   - Add always-visible `⋮` button (`si-card-menu`, `aria-haspopup=menu`, `aria-expanded`).
   - Menu: Edit (→ editor), Delete (confirm), View type (expand type preview). Keyboard: open on Enter/Space, Escape/RoW close, click-outside close.
   - Remove `.si-type-btn`/`.si-edit-type-btn` hover-only opacity rules + wiring.
3. **Unified editor (structPanel.ts)**
   - One editor mount inside Types body. Instance edit opens it (`_editingPin` draft flows through existing draft/save/cancel + validation).
   - Delete `si-pin-edit-form` inline expansion path + its CSS.
   - Save instance: update `_pins`, re-render, collapse Types back (or resume), keep selection.
4. **Field pointer → context menu (structPanel.ts)**
   - Remove `sfe-ptr-btn` row control.
   - Add per-field context menu (reuse `.si-val-menu` popover pattern extended or new `.si-field-menu`): open via field-row focus + Enter / right-click / Shift+F10.
   - Items: "Attach pointer → (select address)" / "Clear pointer" based on current state; keep existing pointer decode.
5. **CSS cleanup (structPanel.css)**
   - Delete slide rules (`si-panel-clip/track`, `.si-page + .sb-section` padding hack), `.si-del-btn` dead rule, hover-only blocks.
   - Add `.si-card-menu`, menu list, `.si-field-menu` styles; ensure editor reuses shared shape (padding/actions consistent).
6. **Tests (structPanel.test.ts)**
   - stacked: both section headers present; Types collapses/expands;
   - menu present per card, not hover-gated; edit/delete/view-type actions work; delete confirm;
   - instance edit via editor (not inline expansion);
   - pointer via field menu (attach/clear) without row button;
   - bit-order toggle + add form flows unchanged.

## Validation

- `npm run check-types`
- `npm run lint`
- `npm test`
- Manual EDH dark+light: add instance; edit via ⋮→editor; manage types; edit a type; bit-field editor; pointer attach/clear; collapse Types; resize sidebar narrow (no slide artifacts).

## Review gates

- No `.si-panel-track`/`-clip`/`si-showing-types`/`si-pin-edit-form` remnants (code + test).
- No hover-only card controls.
- Both sections stacked visible; Types collapsible.
- Pointer only via field menu.

## Rollback

One-commit revert restores slide-track + hover buttons + inline card edit.