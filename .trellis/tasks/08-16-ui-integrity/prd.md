# Migrate Integrity panel (child of ui-consistency)

## Goal

Migrate the Integrity panel onto shared `.sb-*` primitives from `ui-primitives`. Also removes an existing cross-component leak: `integrityPanel.css` currently reuses struct-scoped classes (`.struct-sel`, `.struct-addr-inp`, `.struct-btn`, `.si-icon-btn`) — those must become primitives, not struct-owned classes, so the two panels stop depending on each other's CSS.

## Requirements (current → primitives)

| current (integrityPanel.css) | role | → |
|---|---|---|
| `.struct-sel` (borrowed) | profile select | `.sb-select` |
| `.struct-addr-inp` (borrowed) | profile-name / address inputs | `.sb-input` |
| `.struct-btn` (borrowed) | profile CRUD buttons | `.sb-btn sb-btn-secondary` / `-danger` / `-primary` by role |
| `.si-icon-btn` (borrowed) | profile rename/delete icons | `.sb-btn sb-btn-secondary` or `.act-btn` per role |
| `.integrity-card*` | card family | `.sb-card` / `.sb-card-hdr` / `.sb-card-info` (keep `.integrity-card-selected`/`-status` as compat modifiers) |
| `.integrity-auto-fix` toggle-track/knob | switch | switch CSS is unique enough to stay local — but check unused `.sb-status-dot`/toggle primitives first |
| `.integrity-card-status` circle | status badge | align to `.sb-status-dot` OR keep local circle — decide with scripts as the "status indicator" set |

Keep local: comparison panes, value-pane match/mismatch states, form grid, profile name form, error text.

## Acceptance criteria

- [ ] `integrityPanel.css` imports no `.struct-*` / `.si-*` classes from structPanel.css — decoupled.
- [ ] All inputs/buttons/cards render via `.sb-*` primitives.
- [ ] `.integrity-card-*` migrated with class modifiers preserved → `integrityPanel.test.ts` exact-className asserts updated.
- [ ] Check/add/edit form visuals identical apart from chosen convergence deltas.
- [ ] `npm run check-types`, `npm run lint`, `npm test` green.

## Dependencies

- Requires `ui-primitives` merged. If migrated after `ui-struct`, struct's class renames must not be relied on — integrity migrates straight to primitives; if migrated first, integrity must not block struct. Order flexible; both converge to primitives only.

## Out of scope

- Integrity check algorithm, stored-value editing, highlight logic, auto-fix behavior.