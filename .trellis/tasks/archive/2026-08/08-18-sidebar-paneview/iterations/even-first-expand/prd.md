# PaneView: even-split first-time expand

## Goal

When a collapsed pane expands for the first time (no persisted size), default to an **even split** across all currently-expanded panes instead of keeping siblings at their saved px and giving the new pane the remainder (which makes it tiny, e.g. Labels next to a large Inspector). Only user adjustments persist.

## Requirements

1. In `SidebarSections.setCollapsed(id, false)`: if the expanding pane has `sizing.saved === null` (never user-adjusted), reset every other currently-expanded pane's `saved` to `null` too, so `allocatePanes` yields an even split for this layout. Restore previous behavior otherwise (saved px restored, siblings proportional — Q5-A).
2. Defaults are **not persisted**: `layout()`'s persist guard (`saved !== null && saved !== px`) already keeps first-time shares in memory only; keep it. A user drag/arrow/dblclick afterwards persists that panel's sizes.
3. Behavior applies to every panel (per-panel storage already exists; single-pane panels unaffected).
4. Collapse+expand of a pane that WAS user-sized still restores its saved size.

5. **Kill drag lag** — the 150ms `flex-basis` transition runs during sash drags, so panes ease behind the cursor. Add `.sb-pane-view.dragging .sb-pane { transition: none; }`, toggle `.dragging` on the pane-view for the sash `mousedown..mouseup` window (VS Code only animates collapse/expand, not sash resize). Arrow ±10 and collapse/expand keep the 150ms animation.

## Acceptance Criteria

- [ ] Sash drag tracks the cursor exactly (no 150ms ease behind it); collapse/expand arrows still animate 150ms.
- [ ] Panel with a collapsed-at-mount section (Inspector Labels): expanding it splits the pane-view roughly evenly with Inspector (|a−b| ≤ 1, minus sashes).
- [ ] Siblings' previously-tiny/huge first-time default does not persist; after a user drag the split persists and survives reload.
- [ ] User-sized pane collapse+expand restores its exact saved px (Q5-A unchanged).
- [ ] Persistence round-trip, in-place collapse, sash behavior all unchanged.
- [ ] `npm run check-types`, `npm run lint`, `npm test` green; new test: first-time expand → even split.

## Out of scope

- Changing persistence semantics; changing collapse/sash/pack behavior.