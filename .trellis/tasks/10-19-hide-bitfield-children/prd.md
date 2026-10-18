# Hide individual bit-field children

## Goal

Let a user hide individual named bits inside a bit-field container, the way a
whole field can already be hidden — so a bit-field type with noisy bits shows
only the ones that matter, revealed by the existing per-profile `Show hidden`
toggle.

## Requirements

- R1. `BitFieldChild` gains an optional `hidden` flag (`hidden?: boolean`;
  absent/false = visible), persisted in `.hexscope/structs.json`.
- R2. Hidden is set from the bit-field type editor's child row (a checkbox on
  each child row).
- R3. In the Struct Instances view a hidden bit child is not rendered; the
  existing per-profile `Show hidden` toggle reveals it (no new toggle).
- R4. Hidden affects the instance view only: decode, offsets/sizes, and the C
  preview emit the bit child exactly as before.
- R5. The existing container-level `StructField.hidden` behaviour is unchanged:
  hiding a bit-field field hides its whole group (header + children).
- R6. The struct normalizer preserves `hidden` on a bit child (identity when
  absent) and drops an explicit `false`, matching the `StructField.hidden`
  handling.
- R7. `schemas/structs.schema.json` declares `hidden` on `bitFieldChild` (that
  object is `additionalProperties: false`, so it must be added explicitly).
- R8. The key is additive/optional: no `.hexscope` data-schema version bump.
- R9. Living specs and tests are updated.

## Constraints

- C1. No issue reference in artifacts, branch, commits, or comments.
- C2. Struct naming intact; no rename of `BitFieldChild`, `structs.json`, or the
  schema files.
- C3. No new persisted shape beyond the one optional key; existing pools load
  unchanged.
- C4. Gates: `npm run check-types`, `npm run lint`,
  `npm run compile-tests && npm test`. Fallow GREEN.

## Design decisions (explicit, not assumed)

- D1. **Hiding is def-level.** `BitFieldChild.hidden` lives on the reusable
  bit-field type's child, so hiding a bit hides it in **every** struct that
  references that type. This mirrors how the child's name/width/enum ref already
  work (authored on the def). A per-usage override would be a separate feature.
- D2. **A container with all children hidden keeps its header row** (the
  container value is still meaningful); only the child rows drop. To remove the
  whole container, hide the field itself.

## Dependencies / ordering

Builds on `09-27-hidden-struct-fields` (the field-level `hidden` flag, the
per-profile `Show hidden` toggle, and the decode-to-render filter seam).

## Acceptance Criteria

- [ ] A bit child marked hidden is absent from the instance view by default.
- [ ] `Show hidden` reveals it without re-expanding the card.
- [ ] Hiding a child of a reusable bit-field type hides it in every usage.
- [ ] A container with all children hidden still renders its header row.
- [ ] Decode, offsets/sizes, and the C preview are unchanged with a hidden child.
- [ ] Pre-existing `structs.json` without the flag loads unchanged.
- [ ] Unit tests cover the normalizer round-trip, the schema, the editor
      checkbox, and the render filter; lint, type-check, tests pass; fallow GREEN.
- [ ] No issue references; struct naming intact.
