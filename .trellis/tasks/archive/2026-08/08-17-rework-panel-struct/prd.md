# Rework panel: Struct

## Goal

Rewrite the Struct panel navigation and card chrome on decisions from the UX grilling session. Instances and Types become stacked sections; instance actions move into a per-card menu; instance editing unifies with the type editor.

## Background (audit findings driving this work)

- Slide-track hides the Types list entirely behind a "☰" hamburger; Types only reachable if you remember it exists and find the icon.
- Card actions (edit ✎ / delete 🗑 / type-view ?) are hover-only (`opacity:0` until `.sb-card:hover`, structPanel.css:342-360) — invisible to touch and keyboard users.
- Instance editing today expands inline inside the card, a different shape from the full-width type editor — two mental models.
- LSB/MSB toggle wording is incomprehensible outside bit-field contexts.
- Pointer (→) cross-reference feature hidden behind a tiny dashed affordance in the 7-column field grid.

## Accepted grilling decisions (requirements)

1. **Stacked layout (B)** — replace the slide-track: "Struct Instances" on top, "Struct Types" a collapsible section below. No more slide transform; no "☰" button. Types collapses like any framework section; the type editor remains full-width within the Types section.
2. **Per-card "⋮" menu (B)** — always-visible overflow menu on each instance card holds edit / delete / view-type. No hover-only controls on cards; touch + keyboard operable.
3. **LSB/MSB toggle stays in the Struct body (A)** — unchanged position, near bit-field/decode context.
4. **Unified full-width editor (B)** — editing an instance opens the same full-width editor used for types (one editor pattern). The inline card-edit form (`si-pin-edit-form`) is removed.
5. **Pointer/reference feature moves to a per-field context menu (B)** — no dashed "→" row button; the field's context menu exposes the reference toggle.

## Out of scope

- Field-grid microtype (8px) and general density — `ux-typography-density` task.
- LSB/MSB wording/labels copy — typography task.
- Auto-sort or other ordering behavior of instance cards.

## Acceptance Criteria

- [ ] No slide-track/transform remains; Instances and Types are stacked framework sections in the Struct panel.
- [ ] Types is collapsible via its section header; expanding shows the type list; editor is full-width inside it.
- [ ] No hamburger "☰" manage-types control exists.
- [ ] Each instance card shows an always-visible "⋮" control opening a menu with edit/delete/view-type; all reachable by keyboard.
- [ ] No hover-only (`opacity:0`) controls remain on cards.
- [ ] Editing an instance uses the full-width editor (same component/shape as type editing); no inline card edit form.
- [ ] Field pointers/references reachable via per-field context menu; no dashed "→" remove control on the row.
- [ ] Existing add-instance, type CRUD, bit-field editing, packed toggle, C-preview, and decode-click behaviors unchanged.