# Labels rework: renamable pinned segments + selection-driven form

## Goal

Close the actionable parts of issue #189 on the merged Labels list: pinned segments become renamable (name-only), all rows display ranges in segment style (start – end · size), and the label form mirrors hex-view selections focus-aware (click + drag fill, including auto-switch to End addr mode).

## Confirmed grill decisions

1. **Q1-A: Pinned segments are name-only editable** — row stays permanent (no delete/color/hide). A custom name is stored as an override bound to the segment.
2. **Q2-A: Rename persistence rides the labels payload** — `saveLabels` gains a `segmentNames` map (`startAddress → name`). One channel, survives reload, invalidated with labels. Keyed by **start address**.
3. **Q3-A: Edit affordance = existing label form** — ✎ on a pinned row opens the same inline form; **Name editable**; Start/Range/Color shown read-only; Save/Cancel unchanged. Validation reuses existing machinery.
4. **Q4-B(+user clarification): unified range display** — every row (user label AND pinned segment) renders `0xSTART – 0xEND · SIZE` exactly like current segment rows. End = start + length − 1 (computed; no model change). Driver: consistency during this labels rework.
5. **Q5-C: selection-driven form fill** —
   - Last-focused field receives hex-view clicks: Start focused → fills Start (today); **Range focused → auto-switch to End addr mode and fill the clicked address**.
   - Dragging a multi-byte selection while the form is open updates Start **and** Range per its mode (Length → length; End addr → end).
   - Never stomps manually typed values — auto-fill only on *selection change* events, never on keystrokes.

## Requirements

R1. Pinned rows render an edit affordance (✎) opening the shared form in "rename segment" mode.
R2. Saving a pinned rename writes `segmentNames[startAddress] = name` through the existing `onLabelsChange`/`saveLabels` flow; display shows the custom name; original parsed name moves to the tooltip; pinned glyph stays.
R3. `segmentNames` persists across reload (host save/load path) and applies on merge (`mergeForDisplay` uses override name when present).
R4. All label/pinned rows show `start – end · size`.
R5. Form fill rules per decision 5 (focus-aware click fill incl. End-addr auto-switch; drag-fill for both modes; manual input protected).
R6. Out of scope: max-length labels (#189 pt 1), delete/hide/color for pinned rows, drag-to-reorder.

## Acceptance Criteria

- [ ] Pinned row ✎ opens the form with Name prefilled (override or parsed name) and Start/Range/Color read-only.
- [ ] Save persists the name via labels payload; reload keeps it; row displays it with pinned glyph; tooltip shows original parsed name.
- [ ] Every row shows `start – end · size`.
- [ ] With Range focused, clicking a hex address switches the form to End addr and fills it; with Start focused, behavior unchanged.
- [ ] Dragging a selection with the form open updates Start + Range per current mode; typed values are never overwritten by keystrokes (only by selection changes).
- [ ] Existing label CRUD/validation/recolor tests pass; new tests cover rename persist/reload/display and fill rules.
- [ ] `npm run check-types`, `npm run lint`, `npm test` green.

## Out of scope

- Max-length labels (#189 pt 1) — separate design pass.
- Delete/hide/color editing for pinned segments.
- Segment-boundary edits from the Labels panel.