# Migrate Struct panel (child of ui-consistency)

## Goal

Migrate the Struct panel's markup and CSS onto the shared `.sb-*` primitives from `ui-primitives`. Largest panel — highest churn. Keep all struct-specific complexity (field grids, bit layout, C preview) intact; only buttons/inputs/cards/status converge.

## Requirements (current → primitives)

| current (structPanel.css) | role | → |
|---|---|---|
| `.struct-addr-inp` (`rgba(0,0,0,.25)` dark) | address input | `.sb-input` (with optional size modifier, e.g. `.sb-input-sm` if 2px ≠ 3px padding needed) |
| `.struct-sel` (native) | select | `.sb-select` |
| `.se-name-inp` / `.sa-name-inp` / `.sfe-*-inp` (dark) | text inputs | `.sb-input` |
| `.struct-btn-apply` | primary | `.sb-btn sb-btn-primary` |
| `.struct-btn-secondary` / `.struct-btn-cancel` / `.si-icon-btn` | secondary/ghost | `.sb-btn sb-btn-secondary` |
| `.struct-btn-danger` | danger | `.sb-btn sb-btn-danger` |
| `.si-add-btn` / `.struct-add-field-btn` | add | `.sb-btn sb-btn-add` |
| `.si-card` / `.si-card-hdr` / `.si-card-info` | card | `.sb-card` / `.sb-card-hdr` / `.sb-card-info` |
| `.sfe-ptr-btn` / `.sfe-arr-toggle` / `.sfe-bit-btn` (dashed state toggles) | context toggles | keep dashed style but source from a shared `.sb-toggle` primitive if that lands in primitives — otherwise keep local |

Keep local (struct-specific): `.sd-row`, `.se-field-hdr`, `.struct-field-row`, `.si-f*` field rows, `.si-arr-*` tree, `.sa-preview`/`.si-c-preview`, `.si-col-*` grid vars, `.si-bit` bit rendering.

## Acceptance criteria

- [ ] All buttons/inputs/cards/status in Struct render via `.sb-*` primitives; no `.struct-btn-*`, `.si-add-btn`, `.si-icon-btn`, dark-bg inputs remain.
- [ ] `.si-card` markup migrated to `.sb-card*` — verify `.si-card-selected`/`.si-expanded` border-override states translate (carry as `.sb-card.si-expanded` etc. modifier classes; check `structPanel.test.ts` exact-className asserts, e.g. `'si-card'`).
- [ ] All struct-specific rows/grids/previews visually identical (manual + jsdom class asserts).
- [ ] `npm run check-types`, `npm run lint`, `npm test` green (structPanel.test.ts is ~2000 lines — class renames WILL break asserts; budget for updating tests).

## Dependencies

- Requires `ui-primitives` merged first.

## Out of scope

- Any change to struct decode logic, bit-field math, persistence, pointer-follow.
- Record/memory grid — untouched elsewhere in the tree.