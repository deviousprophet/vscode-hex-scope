# Enum support for fields and bit values

## Goal

Show meaningful names instead of raw numbers for enumerated fields and
enumerated bit values, without losing the numeric value.

## Requirements

- R1. A named enum type can be defined once in the struct pool and referenced
  by many fields and bit-field children.
- R2. Named enums are distinguished by the `kind` discriminator (absent =
  struct). The def owns a base unsigned width plus name/value entries.
- R3. A scalar field references an enum via a new field type value
  (`type: 'enum'`) plus a reference id (`refStructId`).
- R4. A bit-field child gains an optional enum reference.
- R5. The instance view shows a matched value as `NAME (0xNN)` — label plus
  numeric value. Unmatched values fall back to the plain numeric rendering.
- R6. Enums are authored/managed in the Struct Types section with a kind badge
  (entry point unified by the type-kind creation child); each bit-field child
  row gains an enum picker.
- R7. An enum base width is validated against the value range; oversized
  entries are rejected rather than silently wrapped.
- R8. The C preview renders an enum-typed field faithfully with correct
  offsets/sizes.
- R9. Deleting an enum that fields/bit children reference follows the pin-safe
  deletion behaviour; orphaned references are stripped.

## Acceptance Criteria

- [ ] Define one enum, reference it from a scalar field and from a bit-field
      child; both render `NAME (0xNN)` for matched values.
- [ ] An unmatched value renders as a plain number.
- [ ] Enum labels update everywhere when the enum def is edited.
- [ ] Enum width vs value range is enforced with a clear error, not wraparound.
- [ ] C preview offsets/sizes unchanged for enum-typed fields.
- [ ] Existing struct-only `structs.json` loads and behaves unchanged.
- [ ] Deleting a referenced enum follows the existing pin-safe delete flow.
- [ ] Unit tests cover the discriminator normalizer, value-range validation,
      label formatting, bit-child enum ref, and C preview; lint, type-check,
      tests pass.
- [ ] No issue reference in any artifact, branch, commit, or comment.

## Dependencies / Ordering

Independent. Recommended third: reuses the `kind` discriminator and named-type
machinery introduced by the reusable bit-field child.
