# Create Label dialog redesign

## Goal

Restyle the label form (create/edit/rename) in the inspector panel to match the approved mockup: clean field structure with a segmented "Define End By" switch above the range field, bidirectional auto-calc chips, ring-indicated color swatches, right-aligned actions, and a live draft-range highlight in the hex grid while typing. No modal — the form stays inline so hex-view click/drag auto-fill keeps working.

## Requirements

- R1 Inline form in the inspector panel; no modal/backdrop is introduced.
- R2 Segmented switch ("End Address" / "Size · Length") sits **above** the range input, not inline beside it. Shared `.compact-tabs` styles in `base.css` are untouched; only placement/layout changes in `inspectorPanel.css`.
- R3 Default mode is **End Address** (was Length). New-label defaults from a hex selection fill start + end address accordingly.
- R4 Bidirectional auto-calc chips:
  - End Address mode → read-only size chip next to the input, formatted via `fmtB` (e.g. `(16 B)`, `(16 KB)`).
  - Size/Length mode → read-only end-address chip (e.g. `0x080000CF`).
  - Chips update on every keystroke; empty/invalid input clears the chip.
- R5 Visual hierarchy: Title Case labels ("Label Name", "Start Address", …), monospace font for hex inputs, 1px borders on inputs.
- R6 Color swatches become real `<button>`s with a visible selection ring on the active color and `aria-pressed` state.
- R7 Actions bottom-right: `Cancel` (secondary) left of `Add` (primary). Verb by mode: create = "Add", edit = "Update", rename = "Save".
- R8 Invalid input (end < start, bad hex, zero/negative length): Add stays enabled; clicking shows an inline error under the field; error clears on next edit. Existing `showLabelError` pattern reused.
- R9 Range-overlap two-step confirm gate preserved (first Add warns and keeps form open, second Add commits).
- R10 Same component serves create, edit, and pinned-segment rename (rename stays name-only with frozen fields).
- R11 Keyboard & a11y: Esc cancels the form, Enter submits, focus moves to the first field when the form opens.
- R12 Live draft-range highlight: while fields parse to a valid range, those bytes are painted in the hex grid using the currently chosen swatch color; invalid/partial input clears the preview. New reverse sync path (form → grid).

## Constraints

- No new modal/overlay infrastructure.
- `.compact-tabs` shared rule in `base.css` unchanged (spec: toggle groups inherit, no per-context overrides).
- Existing behaviors kept: hex-view click/drag/Shift+Click auto-fill into last-focused field, blank-name auto-naming via `nextLabelName`, outside-mapped-data warning.

## Acceptance Criteria

- [ ] Form opens with End Address selected; selection-derived default shows an end address, not a length.
- [ ] Switching modes converts the value in place and swaps which chip is shown (size vs end address); chips track keystrokes and clear on invalid input.
- [ ] Size chip text matches `fmtB` output used elsewhere (label list rows).
- [ ] Invalid range + Add → inline error appears, no label created; editing any field clears it.
- [ ] Overlapping range + first Add → warning shown, form stays open; second Add creates the label.
- [ ] Swatches are buttons; active swatch shows a ring and `aria-pressed="true"`; others `aria-pressed="false"`.
- [ ] Esc closes the form without saving; Enter submits (create/edit modes); rename unaffected except styling.
- [ ] Typing a valid start+range paints that byte range in the grid with the chosen color; clearing/invalidating input removes the paint; saving/cancelling removes it.
- [ ] Hex-view click/drag still auto-fills the last-focused field while the form is open.
- [ ] `npm run lint`, `npm run check-types`, full test suite green; unit tests added for new pure helpers (chip formatting) and updated for changed markup/default mode.
