# Implement — Reusable bit-field types

Ordered checklist. Quality gate after each significant step.

- [ ] 1. Add `kind`, `baseType`, `bitFields` to `StructDef`; widen
      `StructFieldType` with `'bitfield'`. Update schema + `types.ts` +
      `STRUCT_FIELD_TYPES`.
- [ ] 2. Normalizer/validator: preserve `kind`/`baseType`/`bitFields`; validate
      a `type: 'bitfield'` ref (exists, is `kind: 'bitfield'`, not a pointer);
      validate the def shape (unsigned base, non-empty children, width total).
- [ ] 3. Add the materialize seam (`materializeBitFieldRefs` /
      list form) and apply it in `decodeStruct`, `structByteSize`, `structToC`.
- [ ] 4. Confirm sizing/alignment/decode/C are identical to an equivalent
      inline container (scalar, array, override).
- [ ] 5. Instance view: referenced bit-field renders inlined, no extra level.
- [ ] 6. Authoring: bit-field form content (base width + child rows) + kind
      badge in the type list; field type picker offers bitfield + def picker.
- [ ] 7. Deletion: pin-safe flow for referenced bit-fields; strip orphan field
      references.

## Validation

- Unit: normalizer (kind default, bad ref), size/align vs inline equivalent,
  decode rows, C preview golden strings, render has no wrapper level, delete
  stripping.
- Manual: author one def, reference from two structs, edit once, see both
  update; array + endian/allocation override.
- Commands: `npm run check-types`, `npm run lint`,
  `npm run compile-tests && npm test`.

## Review gates

- After step 3: decode/sizing review (highest blast radius).
- After step 6: authoring review.
- Before finish: full build + tests + an old-pool load test.

## Rollback points

- Steps 1–2 are dark until the type picker ships (step 6); safe to stop early.
- Size/decode changes (3–4) are the riskiest; land them together.
