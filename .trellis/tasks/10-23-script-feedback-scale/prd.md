# Improve script feedback and scale

## Goal

Make approved writes understandable, keep the panel usable with many scripts, and resolve the
TypeScript dead end.

## Requirements

- After a successful write run, show the affected address range, byte count, before/after bytes,
  and `Ctrl+Z` undo guidance. A failed save is a distinct state, not “saving”.
- Add a script details surface (expandable card or popover): roles, capabilities, exported
  entries, fingerprint, active grants, last run, and usages.
- Add search and a kind filter (`All` / `Actions` / `Providers`), with a compact toolbar.
- Rescan `.hexscope/scripts/` on add/change/delete with a short debounce; keep manual Refresh.
  Preserve result areas by path.
- Resolve TypeScript support explicitly. Choose one:
  1. bundle a compiler so `.ts` runs everywhere, or
  2. keep `.ts` as an advanced local-dev path with an actionable “Convert to JS” / setup link.
  The disabled Run tooltip alone is not acceptable.
- Add last-run timestamp and terminal state to the card/details.
- Update docs/specs and tests.

## Acceptance criteria

- [ ] A successful write reports the range, bytes, and undo path.
- [ ] A failed save is visibly different from a successful save.
- [ ] Search and kind filtering narrow the list and keep action wiring intact.
- [ ] Creating/editing/deleting a script on disk updates the panel without a tab switch.
- [ ] The TypeScript decision is documented and testable.
- [ ] Existing result/history behavior survives rescans.
- [ ] Tests cover the write summary, filtering, watcher/rescan, and TS path.

## Out of scope

- Provider usage links (integration child).
- A marketplace.

## Dependencies

`10-23-script-role-actions` for kinds; `10-23-script-workspace-management` for details/manager
placement.
