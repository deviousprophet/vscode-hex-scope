# Migrate Scripts panel (child of ui-consistency)

## Goal

Migrate the Scripts panel onto shared `.sb-*` primitives from `ui-primitives`, **visual-only** (D3): no behavior change — the non-collapsible toolbar header stays non-collapsible. This panel is the most divergent today, so it carries the most visible convergence deltas.

## Requirements (current → primitives)

| current (scriptsPanel.css) | role | → |
|---|---|---|
| `.script-toolbar` / `.script-toolbar-title` | section header (partial `.sb-hdr` re-declaration) | use `.sb-hdr` directly (drop duplicate 10px/700/uppercase) — keep NON-collapsible: do NOT wrap in `.sb-section` collapsible wrapper, no toggle added. Document as deliberate deviation. |
| `.script-run-btn` (solid) | primary | `.sb-btn sb-btn-primary` (keep `.running`/`.disabled-*` state modifiers) |
| `.script-refresh-btn` (ghost-border) | add/secondary | `.sb-btn sb-btn-add` or `-secondary` per unified add-button spec (D4) |
| `.script-card` / `.script-card-info` | card | `.sb-card` / `.sb-card-info` |
| `.script-dot` + `#4caf50`/`#e57373` | status | `.sb-status-dot` with `.ok`→`var(--ok)`, `.err`→`var(--err)` — color shifts from hardcoded to token values (visual delta, intended) |
| `.script-ext` badge | badge | align with `.sb-badge` (badge pattern) |
| `.script-output-*` | result blocks | result headers/log rows are panel-specific → keep local. |

Keep local: result header collapsible blocks (`.script-output-hdr`, `::before ▼/▶`), error variants, log rows, output writes.

## Acceptance criteria

- [ ] Color tokens: zero hardcoded status hex colors; `.dot-ok`/`.dot-err` use `--ok`/`--err`.
- [ ] Header renders via `.sb-hdr` markup; no duplicate title rule; still not collapsible (toggle absent).
- [ ] Run/refresh buttons are `.sb-btn*`; card is `.sb-card*`.
- [ ] Result block behaviors unchanged: output appends, run/cancel states, spinning icon.
- [ ] `scriptsPanel.test.ts` exact-className asserts updated (search `.script-` button/card/dot expectations).
- [ ] `npm run check-types`, `npm run lint`, `npm test` green.

## Dependencies

- Requires `ui-primitives` merged first.

## Out of scope

- Making the header collapsible (explicitly excluded by D3).
- Script execution, worker, cancellation logic.