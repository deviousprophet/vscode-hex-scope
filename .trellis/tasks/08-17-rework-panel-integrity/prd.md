# Rework panel: Integrity

## Goal

Rewrite the Integrity panel monitoring experience on decisions from the UX grilling session. Panel reads as a status board: imbalance visible at a glance from the header, computing observable, profile admin decluttered.

## Background (audit findings driving this work)

- Profile library renders as dropdown + 4 tiny buttons (apply/update/rename/delete) at 9px/2px6 — biggest clutter + body-space cost in the panel (integrityPanel.css:34-37).
- Header badge shows only total count — red regional mismatch らnothing at a glance; user must scroll cards.
- "Calculating" state is a color-only (blue) circle; many-checks files flicker on every byte edit with no observable "busy".
- "Fix all" is the panel's primary one-click repair action, currently below profile row.

## Accepted grilling decisions (requirements)

1. **Slimmed profile library (B)** — one profile dropdown + actions in the profile's own menu (load/save renamed/delete all inside a single select + menu). No 4-button admin cluster in the body.
2. **"Fix all" stays in body controls (B)** — not promoted to header. Keep current placement.
3. **Mismatch-count header badge (A)** — header badge shows total + mismatch count in danger color (e.g. `3 · 1!`), so "is the file corrupting?" is answered at the top without scrolling.
4. **Spinner-on-calculating (A)** — status circle shows a small spinner (value change animates) while a check recomputes instead of color-only. No layout jump.

## Out of scope

- Copy affordance/feedback on value panes — `ux-copy-affordance` task.
- Font-size floor and button target sizes — `ux-typography-density`.
- Check comparison cards layout (2-col panes) — unchanged.

## Acceptance Criteria

- [ ] Profile bar is one dropdown plus its menu; no inline apply/update/rename/delete button cluster.
- [ ] Create/rename/delete/apply profile still fully functional via the menu.
- [ ] Header badge displays total and mismatch count, mismatches in danger color; updates as checks compute.
- [ ] Each check card's status circle shows a spinner state while calculating; returns match/mismatch/error styling when done.
- [ ] "Fix all" remains a body control above the check list, same behavior.
- [ ] Existing check add/edit forms, auto-fix toggle, value comparison panes, and action-error placement unchanged.