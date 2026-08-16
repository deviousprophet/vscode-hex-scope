# Migrate Inspector panel (child of ui-consistency)

## Goal

Migrate the Inspector panel's markup and CSS onto the shared `.sb-*` primitives from `ui-primitives`. Single-look convergence (D4): same roles render identically across all four panels.

## Requirements (current → primitives)

| current (inspectorPanel.css) | role | → |
|---|---|---|
| `.lf-input` (`--input-bg` native) | text input | `.sb-input` |
| `.lf-mode` (toggle buttons) | segmented select | `.sb-select` (or `.compact-tabs` for the mode toggle — keep `.lf-mode` as the toggle-group if it's an exclusive mode picker) |
| `.lf-save` (solid) | primary | `.sb-btn sb-btn-primary` |
| `.lf-cancel` (ghost) | secondary | `.sb-btn sb-btn-secondary` |
| `.lf-add-btn` (dashed) | add | `.sb-btn sb-btn-add` |
| `.label-act` (icon) | icon | stays `.act-btn` (base.css already owns icon reveal pattern) OR `.sb-btn` — decide with struct/integrity as a set |

Section shell already uses `.sb-section/.sb-hdr/.sb-body` — unchanged. Segments/labels list rows keep their own `.segment-item`/`.label-item` styles (component-specific, not shared).

## Acceptance criteria

- [ ] No `rgba(0,0,0,…)` inputs remain; all text inputs/selects use native input tokens via primitives.
- [ ] All add/save/cancel buttons are `.sb-btn*` primitives; no `.lf-*` button class remains.
- [ ] Exact-className test asserts updated (search `inspectorPanel.test.ts` / `inspectorLabels.test.ts` for `.lf-` / `.lf-btn` expectations).
- [ ] Visual parity for everything NOT a button/input: bit grid, chips, multi-byte, segment rows unchanged.
- [ ] `npm run check-types`, `npm run lint`, `npm test` green.

## Dependencies

- Requires `ui-primitives` merged first (primitives must exist).

## Out of scope

- Behavior changes (collapse, copy, focus flows).