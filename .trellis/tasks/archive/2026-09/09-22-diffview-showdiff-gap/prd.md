# DiffView: separator line between diff addresses in Show diff

## Goal

In `Show diff` mode, draw a thin separator line between consecutive diff rows
that are not address-contiguous, so the user can see that the listed diffs are
separated by skipped (identical and/or unmapped) address space.

## Problem

`diffGrid.filterRows('diff')` keeps only `data` rows with at least one diff byte;
it drops both identical mapped rows and `kind:'gap'` rows. Two consecutive diff
rows are therefore rendered edge-to-edge even when their addresses are far apart,
with nothing indicating the skipped span. It reads as if the diffs are adjacent.

## Requirements

1. In `Show diff` only, insert a separator row between two consecutive kept diff
   rows when their addresses are not contiguous (i.e. the next row does not start
   immediately after the previous row's 16 bytes).
2. The separator is a **bare thin line**: no label, no address text, no byte count.
3. It occupies a real row in the shared row model so it has a height, renders in
   both panes, and stays aligned under existing virtual scroll / scroll sync.
4. It is inert (not focusable, not interactive).
5. No change to `Show all`: existing `kind:'gap'` rows keep their current text
   rendering there.
6. No leading separator before the first diff row and no trailing separator after
   the last (the feature is only *between* diff addresses). A list with zero or one
   diff row shows no separator.
7. Reuse the existing gap-row height/geometry rather than adding a new row kind or
   new virtual-scroll metric.

## Acceptance Criteria

- [ ] `Show diff` with two non-contiguous diff rows renders a thin separator line
      between them, in both panes, at the same position.
- [ ] Contiguous diff rows (next row starts at previous row + 16) render with no
      separator.
- [ ] A single diff row, or an identical pair (`No differences`), renders no
      separator.
- [ ] `Show all` behavior is unchanged, including the existing gap-row text.
- [ ] The separator has no text content and is not focusable/interactive.
- [ ] Scrolling, virtual-scroll slice computation, and sync-scroll alignment are
      unchanged (separator rows scroll like any other row).
- [ ] `npx tsc --noEmit -p .` clean.
- [ ] `npm run lint`, `npm test`, and fallow (`--explain` + `audit --base origin/main
      --gate all`) clean.

## Notes

- Classified lightweight: one visual affordance built on the existing row
  mechanism. PRD-only planning (no `design.md`/`implement.md`).
- Approach (for the implementer, not a design artifact): `filterRows('diff')`
  inserts a `kind:'gap'` row carrying a `line: true` marker between non-contiguous
  kept rows; `renderGapRow` returns a bare `<div>` line when the marker is set
  (otherwise unchanged); the existing gap height is reused, so no new row kind,
  metric, or CSS geometry.
- Out of scope: leading/trailing separators, labels/address ranges/byte counts,
  unmapped-vs-identical breakdown, interaction, `Show all` changes.
