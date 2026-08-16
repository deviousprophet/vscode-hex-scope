# Harmonize sidebar panel spacing

## Goal

Fix the gap/margin/padding drift between the four sidebar panels (Inspector, Struct, Integrity, Scripts) reintroduced by the component refactor. Spacing moves INTO the shared `.sb-*` primitives so panels stop hand-rolling their own values and future panels can't drift again.

## Confirmed decisions (grill)

- D1: Spacing lives in the primitives (`components/sidebar/sidebar.css`), panels delete redundant local overrides.
- D2: Canonical spacing spec (approved table below).
- D3: Single task (no parent/children).
- D4: Panels + primitives only. Shell chrome (`#sidebar-common-settings`, `#side-tabs`/`.stab`, resizer) untouched.

## Canonical spacing spec (D2)

| token | value | applies to |
|---|---|---|
| panel padding | `10px 12px` | panel roots / `.sb-section` |
| header→body | `8px` margin-bottom | every `.sb-hdr` incl. struct `-hdr-row`, integrity `-hdr-row`, scripts toolbar |
| section separator | `1px` border-bottom | all sections |
| card stack gap | `4px` margin-bottom | `.sb-card` (scripts card 6px→4px) |
| `.sb-btn` padding | `2px 8px` | primary/secondary/danger |
| `.sb-btn-add` | `5px` vertical; full-width rows keep `width:100%` | add buttons |
| list rows | keep per-role value | rows (`3px 2px` horizontal, `5px 0` stacked) — not the same role |
| struct dense field grid | documented tighter exception | `.struct-field-row`, `.sfe-*` cells, `.si-field` grid — density intentional |

## Requirements

- `.sb-btn` gains `padding: 2px 8px`; `.sb-btn-add` gains `5px` vertical padding; `.sb-card` gains `margin-bottom: 4px`. Panel roots/sections already at `10px 12px` (no change).
- Each panel deletes now-redundant local overrides:
  - **Struct**: `.se-btns/.sa-btn-row/.sa-no-types-row .sb-btn { padding: 2px 9px }`, `#si-add-btn` 2px7, `#si-types-btn/#sm-close-btn` 2px5, `#sm-new-btn` 2px9 → rely on primitive (keep only non-padding props, e.g. `flex-shrink`, `margin-left:auto`). Header rows (`.si-hdr-row`/`.sb-hdr-row` `margin-bottom: 6px`) → 8px (drop override or align to primitive).
  - **Integrity**: `.integrity-hdr-row` `margin-bottom: 7px` → 8px; `#integrity-fix-all` 2px9, `#integrity-add-btn` 2px7 → primitive.
  - **Scripts**: `.script-card` `margin: 6px 0` → `margin: 0 0 4px` (or rely on `.sb-card`); `.script-refresh-btn` 2px6 → primitive (keep margin-left:auto, font-size 13px if that's a deliberate sizing difference). **Toolbar exception (pinned):** `.script-toolbar` rides `.sb-hdr` which now carries `margin-bottom: 8px`; the toolbar ALSO has `border-bottom` — set `.script-toolbar { margin-bottom: 0 }` so the border is the separator, no double-gap. Parenthesize with a comment.
  - **Inspector**: no button/header overrides to fix (already primitives at defaults); verify nothing contradicts.
- No `.sb-input`/`.sb-input-sm`/`.sb-select` padding changes (inputs already token-consistent; size modifier is legit).
- Shell chrome untouched (D4).

## Acceptance criteria

- [ ] Primitive spacing values in `components/sidebar/sidebar.css` match the D2 table exactly (`.sb-btn` 2px8, `.sb-btn-add` 5px, `.sb-card` mb 4px, headers 8px).
- [ ] Grep audit: no panel file contains a redundant padding/margin override for a role now owned by the primitive — each remaining `padding:`/`margin:` in panel files is either struct-dense-grid (documented exception) or a legit non-spacing-prop. Every deleted override has a line-level reason in the commit/diff.
- [ ] Header→body 8px across all four panels (struct 6px→8, integrity 7px→8, scripts toolbar 0→8 applied consistently, inspector already 8).
- [ ] No visual regression on non-spacing properties (colors, borders, fonts, hover states unchanged).
- [ ] `npm run check-types`, `npm run lint`, `npm test` green (753 tests).
- [ ] Manual VS Code check on dark + light themes: panels read as one consistent rhythm top-to-bottom; struct dense grid still readable (tight, not broken).

## Out of scope

- Shell chrome (`#sidebar-common-settings`, `#side-tabs`, `.stab`, resizer) — D4.
- Input/select paddings (token-consistent already).
- Any color/border/font/hover changes — spacing only.
- Adding spacing tokens to `base.css` (primitive-scoped values suffice; revisit only if a 5th panel needs it).

## Dependencies

- Requires all five ui-consistency children merged (primitives + 4 panel migrations).