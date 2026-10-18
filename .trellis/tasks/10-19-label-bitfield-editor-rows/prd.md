# Label the bit-field and enum editor rows

## Goal

The bit-field type editor and the enum type editor render their child rows with **no
column header**, so a first-time user sees two unlabeled text inputs (name, width),
an unlabeled dropdown (enum ref), and an unlabeled checkbox (hide) and cannot tell
what each one is. Add a column-header row above the rows in both editors, matching
the struct field grid's existing header, and add the missing `aria-label`s to the
inputs. Editor-only UI change.

## Problem (evidence)

- `kindDefEditorShellHtml` (`structPanel.ts:439`) renders the type-name label + the
  `base width` row, then injects the child rows with no header.
- The struct editor has `.se-field-hdr` (`structPanel.ts:388`) — `Type · Ptr · Name ·
  Endian · Alloc · Hide · [ ]` — so it reads clearly; the two "kind def" editors do not.
- `childFieldRowHtml` (`structEditorFields.ts:243`) renders `sfe-bf-child-name` /
  `sfe-bf-child-width` with **no** `aria-label`; `enumEntryRowHtml`
  (`structPanel.ts:608`) renders `sfe-enum-entry-name` / `sfe-enum-entry-value`
  with no `aria-label` either.

## Requirements

- R1. The bit-field editor shows a header row above the child rows labeling the
  input columns: **Name**, **Bits**, **Enum**, **Hide**; blank cells for the
  indent, `bit` unit, move, and delete columns.
- R2. The enum editor shows a header row above the entry rows labeling: **Name**,
  **Value**; blank cells for the indent, `=`, move, and delete columns.
- R3. Each header aligns 1:1 with its row's input columns (header and rows share a
  single grid template — not a hand-tuned approximation).
- R4. `sfe-bf-child-name`, `sfe-bf-child-width`, `sfe-enum-entry-name`, and
  `sfe-enum-entry-value` gain descriptive `aria-label`s.
- R5. The header lives **outside** `#se-bf-def-children` / `#se-enum-entries`, so
  existing row-count queries and the incremental refresh (`refreshBitFieldDefRows`,
  `refreshEnumDefRows`) are untouched.
- R6. The header renders on first open and is not destroyed by an incremental row
  rebuild (add / move / delete / reorder).
- R7. No behavior change: add/move/delete/reorder, inline validation, Save, Cancel,
  and the live C preview all behave exactly as before.
- R8. No persisted shape, no schema change, no data-schema version bump.

## Constraints

- C1. Match the existing house pattern: reuse the `.se-field-hdr` styling
  conventions (uppercase, 10px, 700, `var(--addr-fg)`, `letter-spacing .04em`) and
  the `grid-template-columns` shared-by-header-and-row approach used by
  `.se-field-hdr` + `.struct-field-row`. Do not invent a second visual style.
- C2. No issue reference in artifacts, code, or comments.
- C3. Editor-only: decode, offsets/sizes, and the C preview are untouched.
- C4. Gates: `npm run check-types`, `npm run lint`,
  `npm run compile-tests && npm test`; Fallow GREEN.

## Acceptance Criteria

- [ ] Bit-field editor shows `Name · Bits · Enum · Hide` aligned above the child rows.
- [ ] Enum editor shows `Name · Value` aligned above the entry rows.
- [ ] Labels stay aligned with their inputs at the panel's normal width (no wrap;
  long labels ellipsize like `.se-field-hdr > span`).
- [ ] Adding, deleting, and reordering a child/entry leaves the header intact and
  the row counts unchanged.
- [ ] The four inputs expose `aria-label`s.
- [ ] Unit tests assert both headers render (label text) and that rows still
  refresh after add/delete; existing `#se-bf-def-children .sfe-bf-child-row` /
  `#se-enum-entries .sfe-enum-entry-row` count assertions still pass.
- [ ] `check-types`, `lint`, and the suite pass; Fallow GREEN.
- [ ] No persisted/schema/decode change.

## Out of scope

- The umbrella naming discussion ("Struct Overlay" / "Struct" / `structs.json`) —
  tracked separately.
- Inline bit-field container child editing (children live on reusable
  `kind:'bitfield'` defs).
- Any change to decode, offsets, or the C preview.

## Notes

- Lightweight task — PRD-only.
- Enum rows are included because they use the same shared shell and have the
  identical defect; if you want bit-field only, trim R2/R4's enum half and the
  enum acceptance lines.
