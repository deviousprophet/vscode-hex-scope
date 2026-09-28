# Type-kind creation and pure-struct trim

## Goal

Give the Struct Types section one clear creation flow with three kinds —
plain struct, bit-field type, enum — each with its own form. A plain struct is
a pure struct again: it no longer authors inline bit-fields. Bit-field
definitions live only as standalone reusable types. Legacy pools that still
carry inline bit-fields are migrated to standalone types on load.

## Requirements

### Creation flow

- R1. The Struct Types section has one creation entry point ("New Type") that
  first asks for the kind: struct / bit-field / enum.
- R2. Picking a kind opens that kind's own form; cancel/back returns to the
  type list without creating anything.
- R3. The kind is chosen once at creation and is not changeable afterwards.
- R4. The kind chooser replaces the standalone "new bit-field type" action
  introduced by the reusable bit-field child; that action is removed.
- R5. The Enum tile routes to the enum child's form (owned by that child);
  this child only wires the tile and the hand-off.

### Pure-struct form

- R6. The pure-struct form keeps name/packed/endian and the field grid
  (type, pointer, name, hidden, endian, array, reorder, delete).
- R7. Bitfield authoring is removed from the pure-struct form: no per-field
  bit toggle, no child bit rows.
- R8. Bitfield-only controls are removed from the pure-struct form: no
  per-field `Alloc` select and no struct-level `Alloc` select. `Endian`
  (struct-level and per-field) stays.
- R9. The field grid drops the `Bits` and `Alloc` columns.

### Bit-field form

- R10. The bit-field form edits name + base unsigned width + name/width child
  rows only.
- R11. Bit-field-in-bit-field nesting is not offered or permitted.

### Legacy migration

- R12. A struct field that still carries an inline bit-field container
  (unsigned base type + `bitFields`) is converted on load into a reference to a
  standalone bit-field type.
- R13. Identical inline containers (same base width + same child names/widths)
  collapse to one shared standalone type.
- R14. Migration runs in pool normalization on read, is idempotent, and
  self-heals the file (no further churn on subsequent loads).
- R15. Usage-scoped field overrides (`endian`, `allocation`, `count`, `name`,
  `hidden`) are preserved on the referencing field.
- R16. Migration never changes decoded values, offsets, or sizes: the migrated
  pool decodes byte-identically to the pre-migration pool.

## Acceptance Criteria

- [ ] "New Type" offers three kinds; each opens its own form; cancel creates
      nothing.
- [ ] The pure-struct form has no bit toggle, no child rows, no `Alloc`
      selects, and no `Bits`/`Alloc` columns; it still saves plain fields,
      arrays, pointers, hidden flags, and endian overrides.
- [ ] The bit-field form creates a `kind: 'bitfield'` def with base width and
      children; no standalone "new bit-field type" action remains.
- [ ] A pre-change `structs.json` with two identical inline bit-field
      containers loads as one shared standalone type referenced twice, and
      decodes identically to before.
- [ ] A second load is a no-op (idempotent; `changed === false`).
- [ ] Field `count`/`endian`/`allocation`/`hidden` overrides survive
      migration.
- [ ] Existing struct-only and already-reusable pools load unchanged.
- [ ] Unit tests cover the migration (dedupe, idempotence, byte-identical
      decode), the kind chooser, and the trimmed pure-struct form; lint,
      type-check, and tests pass.
- [ ] No issue reference in any artifact, branch, commit, or comment.

## Dependencies / Ordering

- Builds on the reusable bit-field child: kind discriminator,
  `type: 'bitfield'` refs, inline decode/render resolution.
- The Enum tile depends on the enum child's form. Ordering: the enum child's
  form must exist before the chooser's Enum tile can be exercised; write that
  order in both prds.
