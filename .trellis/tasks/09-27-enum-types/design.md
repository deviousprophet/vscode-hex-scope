# Design — Enum support for fields and bit values

## Model

- `StructDef.kind: 'enum'` in the same pool (kind discriminator introduced by
  the reusable bit-field child). An enum def carries a base unsigned width and
  an ordered list of entries `{ name: string; value: number }` (new def field,
  e.g. `entries`).
- New `StructFieldType` value `'enum'`; a field with `type: 'enum'` +
  `refStructId` decodes as its base unsigned width and resolves labels from the
  referenced def.
- `BitFieldChild` gains `refStructId?: string` (references an enum def).

## Contract

- Schema: extend `structDef` with enum entries; extend `structFieldType` with
  `'enum'`; extend `bitFieldChild` with `refStructId`.
- Normalizer: validate `type: 'enum'` has a resolvable enum `refStructId`; drop
  invalid refs gracefully; validate entries fit the base width.

## Decode (must not change byte values)

- Decode the numeric value exactly as an integer of the base width. Enum is a
  presentation concern: carry the numeric value plus an optional resolved label
  into the row. Do not alter `bytesHex`, offset, endianness, or allocation.
- Sizing/align: `type: 'enum'` sizes/aligns exactly like its base unsigned
  width (same materialize-at-boundary discipline as bit-field refs).

## Rendering

- Matched: `NAME (0xNN)`. Unmatched: current numeric rendering.
- Scalar enum field: apply at the value cell.
- Bit child: apply at the bit-value cell; the child's optional enum ref
  supplies labels for that bit field's value (and each element of a bit
  container array).
- One shared formatter used by both scalar and bit paths.

## Authoring UI

- Enum defs shown with a kind badge; form content = base width + entry rows
  (name + value) with range validation. Field type picker offers `enum` + def
  picker; bit-field child row gains an enum picker. The creation entry point is
  unified by the type-kind creation child.

## C preview

- Emit a typedef'd enum (or an integer field with label comments) sized to the
  base width; offsets/sizes identical to an integer field.

## Compatibility

- Additive. Old pools unaffected. Decode output unchanged.

## Risks / tradeoffs

- Label lookup must resolve on edit; editing an enum must re-render instances
  that reference it.
- Scalar and bit-child label sites must share the formatter.

## Rollback

Revert the edit set. Optional keys ignored by older builds.

## Deliberate simplifications

`ponytail:` first-match integer labels only; no ranges/masks on entries. Add
ranges only if users need multi-value labels.
