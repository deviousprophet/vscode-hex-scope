# Design — Reusable bit-field types

## Model

- `StructDef.kind?: 'struct' | 'bitfield' | 'enum'` (this child introduces
  `'struct'` default + `'bitfield'`; enum adds `'enum'`). Absent = `'struct'`.
- A `kind: 'bitfield'` def carries its base unsigned width via `baseType`
  (uint8/uint16/uint32/uint64) and its children via `bitFields:
  BitFieldChild[]`; its `fields` is `[]`.
- New `StructFieldType` value `'bitfield'`. A field with
  `type: 'bitfield'` + `refStructId` is a container whose children and base
  width come from the referenced def.

## Contract

- Schema: extend `structDef` with `kind`, `baseType`, `bitFields`; extend the
  `structFieldType` enum with `'bitfield'`. Reuse `refStructId`.
- Normalizer/validator: require `refStructId` for `type: 'bitfield'`; the
  target must exist and be `kind: 'bitfield'`; reject bitfield pointer and
  bitfield-in-bitfield. Validate the def shape (unsigned base, non-empty
  children, children total within base width).
- Sizing/align: resolve a `'bitfield'` field to its def's base width,
  honouring `count` and allocation/endian overrides exactly like an inline
  container.

## Resolution strategy

Prefer a single "materialize" seam: a pure `materializeBitFieldRefs(def, defs)`
that rewrites every `type: 'bitfield'` field into its inline container form
(base type + children copied from the def, `refStructId` cleared). Apply it at
the decode / `structByteSize` / `structToC` entry points so the intricate
sizing/decode/C code paths stay unchanged and cannot drift from the inline
path. Validation runs on the authored (referenced) form.

## Rendering

- Instance view: a referenced bit-field resolves to the same group shape an
  inline container produces today; container row is the field, children are the
  def's children. No wrapper/nested-struct level.
- C preview: materialization makes `emitBitFieldContainerC` emit the anonymous
  struct-with-bitfields form with correct offsets.

## Authoring UI

- Struct Types section lists bit-field defs with a kind badge. The bit-field
  form content is base width + child rows (see the type-kind creation child for
  the unified entry point).

## Compatibility

- Additive. Absent `kind` = struct. Inline `bitFields` on a field remain
  decodable/rendered by the same code path (the type-kind creation child later
  migrates authored inline containers to references).

## Risks / tradeoffs

- Two representations of a container (inline authored, referenced) must share
  one resolver. Materialize-at-boundary keeps them unified.
- Deleting a referenced bit-field must follow the pin-safe deletion flow and
  strip orphan field references.

## Rollback

Revert the edit set. Optional keys ignored by older builds; no migration here.

## Deliberate simplifications

`ponytail:` reuse `refStructId` instead of a new reference field name.
