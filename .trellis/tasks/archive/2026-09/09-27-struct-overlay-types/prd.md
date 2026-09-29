# Struct overlay: type kinds and instance clutter

## Goal

Make the Struct Instances view less noisy and the Struct Types pool clearer.
Users need three kinds of named type in one pool — plain struct, reusable
bit-field type, and enum — each created through its own form, and they need
fields they never care about (reserved bytes) to stay out of the way.

This is a parent task. It owns the requirement set, the child-task map,
cross-child acceptance criteria, and the final integration review. It does not
itself implement product code.

## Requirements

### Shared / cross-cutting

- R1. All new persisted data stays inside the workspace struct pool
  (`structs.json`) and its JSON schema. No new files, no new top-level arrays,
  no version bump unless the schema genuinely requires one.
- R2. Existing `structs.json` files (struct-only pools with no new keys) load
  unchanged. New keys are optional and default to the current behaviour.
- R3. Named-type defs are distinguished by a `kind` discriminator; a def
  without it is a plain struct.
- R4. The instance view rendering stays driven by the existing decode pipeline
  (offsets, alignment, endianness, allocation). New features affect
  presentation, not byte math, except where a new kind legitimately changes how
  a field is decoded/sized.
- R5. A plain struct is a pure struct: it does not author inline bit-fields.
  Bit-field definitions live as reusable named types.
- R6. No issue reference (number, URL, or title) anywhere: not in task
  artifacts, branch name, commit messages, or code comments.
- R7. Naming stays struct-termed: no rename of `StructDef`/`StructField`/
  `StructPin`, `structs.json`, `structs.schema.json`, module/dir names, or the
  "Struct Overlay" / "Struct Types" / "Struct Instances" labels.

### Child 1 — Hidden fields

- R8. A `StructField` can be marked hidden (persisted in `structs.json`).
- R9. Hidden is set from the field's row in the struct type editor.
- R10. The Struct Instances section has one global "show hidden fields" toggle,
  off by default, persisted per profile.
- R11. Hidden affects the instance view only: decode, offsets, and the C
  preview are unchanged.
- R12. Hidden is field/container level; bit-field children are not individually
  hideable, and hiding a container hides its children.

### Child 2 — Reusable bit-field types

- R13. A named bit-field type is defined once and referenced by many fields.
- R14. Named bit-field types live in the same struct pool with
  `kind: 'bitfield'`, owning a base unsigned width and a name/width child list.
- R15. A field references one via a new `type: 'bitfield'` value plus a
  reference id; in the instance view its children render inline (no extra
  hierarchy level, matching a today's inline container).
- R16. Each usage may be an array and may override allocation/endianness.
  Bit-field-in-bit-field nesting is refused.
- R17. The C preview emits referenced types faithfully with correct
  offsets/sizes.
- R18. Deleting a referenced bit-field type follows the existing pin-safe
  deletion behaviour.

### Child 3 — Enum display

- R19. A named enum type is defined once and referenced by fields and by
  bit-field children.
- R20. Enum types live in the same pool with `kind: 'enum'`, owning a base
  unsigned width plus name/value entries.
- R21. Scalar fields reference one via `type: 'enum'` + a reference id;
  bit-field children gain an optional enum reference.
- R22. The instance view shows matched values as `NAME (0xNN)`; unmatched
  values fall back to the plain numeric rendering.
- R23. Enum base width is validated against the value range (no silent
  wraparound).
- R24. Deleting a referenced enum follows the existing pin-safe deletion
  behaviour.

### Child 4 — Type-kind creation and pure-struct trim

- R25. The Struct Types section has one creation entry point ("New Type") that
  first asks for the kind: struct / bit-field / enum; the kind is chosen once
  and is not changeable afterwards.
- R26. Picking a kind opens that kind's own form; cancel returns to the list
  without creating anything.
- R27. The pure-struct form keeps name/packed/endian and the field grid, but
  drops all inline bitfield authoring (bit toggle, child rows) and
  bitfield-only controls (per-field `Alloc`, struct-level `Alloc`).
- R28. The bit-field form edits name + base unsigned width + child rows only.
- R29. A legacy struct field with an inline bit-field container is migrated on
  load into a reference to a standalone bit-field type.
- R30. Identical inline containers collapse to one shared standalone type;
  migration is idempotent and self-heals the file once.
- R31. Migration preserves usage-scoped overrides (`count`, `endian`,
  `allocation`, `name`, `hidden`) and is byte-identical on decode.

## Ordering (not a dependency system)

Children are independently verifiable. Recommended implementation order,
written into each child's `implement.md`:

1. Hidden fields (smallest, independent).
2. Reusable bit-field types (introduces the `kind` discriminator and named-type
   authoring that enums reuse).
3. Enums (reuses the kind + reference machinery; adds a bit-child enum ref).
4. Type-kind creation + pure-struct trim (consumes children 2 and 3: the
   chooser's Bit-field and Enum forms).

## Child Task Map

- `09-27-hidden-struct-fields` — Child 1 (R8–R12).
- `09-27-reusable-bitfield-types` — Child 2 (R13–R18).
- `09-27-enum-types` — Child 3 (R19–R24).
- `09-27-type-kind-creation` — Child 4 (R25–R31).
- `09-29-struct-overlay-review-followups` — resolves the two-axis code-review
  findings and adds the composition / parity / host-seam tests that close the
  parent acceptance criteria below. (A deferred `structPanel` module split is
  tracked separately, outside this parent.)

## Acceptance Criteria

Cross-child / parent-level:

- [x] All four child tasks are implemented, checked, and archived.
- [x] A struct-only `structs.json` from before this work loads with no loss.
- [x] A legacy pool with inline bit-field containers migrates to standalone
      bit-field types on load and decodes byte-identically.
- [x] The Struct Types section offers one creation entry point with three
      kinds (struct / bit-field / enum), each opening its own form.
- [x] With every new feature unused, the instance view and C preview are
      byte-for-byte identical to the pre-change behaviour.
- [x] New features compose: in one struct, a hidden field, a field typed by a
      reusable bit-field type, and a field/bit-child using an enum all render
      correctly together in one instance.
- [x] No issue reference appears in any artifact, branch, commit, or comment.
- [x] Naming stays struct-termed (no typedef rename).
- [x] Full lint, type-check, and test suite pass on the integration branch
      (1238 passing; the sole failure is the pre-existing environmental
      clipboard test, reproduced on the stashed baseline).

## Notes

- Requirements, constraints, and acceptance criteria only. Technical design and
  execution checklists live in each task's `design.md` / `implement.md`.
- Decisions were consolidated from earlier planning on a separate branch; this
  branch is the fresh implementation base.
