# Reusable bit-field types

## Goal

Stop forcing users to repeat the same bit-field definition or wrap it in a
throwaway struct that adds an extra hierarchy level. Define a bit-field type
once, reference it from fields, and render its children inline.

## Requirements

- R1. A named bit-field type can be defined once in the struct pool and
  referenced by many fields.
- R2. Named types are distinguished from plain structs by a `kind`
  discriminator on the def. Absent discriminator = plain struct.
- R3. The bit-field def owns its base unsigned width
  (uint8/uint16/uint32/uint64) and its name/width child list.
- R4. A field references a bit-field type via a new field type value
  (`type: 'bitfield'`) plus a reference id (`refStructId`).
- R5. The instance view renders a referenced bit-field type's children inline:
  one row per child, no wrapper row, no extra hierarchy level.
- R6. A usage may be an array (`count > 1`) and may override allocation and/or
  endianness at the field. Bit-field-in-bit-field nesting is rejected.
- R7. Named bit-field types are authored/managed in the Struct Types section
  with a kind badge. (The creation entry point is unified into the type-kind
  creation child; this child provides the bit-field form content: base width +
  name/width child rows.)
- R8. The C preview emits referenced types faithfully with correct
  offsets/sizes (named struct type or equivalent inline form).
- R9. Deleting a bit-field type that fields reference follows the pin-safe
  deletion behaviour, and orphaned references are stripped.

## Acceptance Criteria

- [ ] Define one bit-field type, reference it from two different structs; a
      single edit to the def is reflected in both instances.
- [ ] Referenced bit-field renders with exactly one row per child, no extra
      wrapper level, no parent row.
- [ ] Array usage (`count > 1`) renders each element; allocation/endian
      override on the field takes effect.
- [ ] Attempting to nest a bit-field type inside a bit-field type is refused
      (UI and/or normalization).
- [ ] C preview offsets/sizes match a hand-written equivalent for scalar,
      array, and override cases.
- [ ] Existing struct-only `structs.json` loads and behaves unchanged.
- [ ] Deleting a referenced bit-field type follows the existing pin-safe
      deletion behaviour.
- [ ] Unit tests cover the discriminator normalizer, sizing/align, decode,
      render inline, and C preview; lint, type-check, tests pass.
- [ ] No issue reference in any artifact, branch, commit, or comment.

## Dependencies / Ordering

Independent. Recommended second: introduces the `kind` discriminator and
named-type machinery the enum and type-kind-creation children reuse.
