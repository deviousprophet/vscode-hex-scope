# Implement — Enum support for fields and bit values

Ordered checklist. Quality gate after each significant step. Assumes the `kind`
discriminator + named-type machinery from the reusable bit-field child exist.

- [ ] 1. Add `kind: 'enum'` def data (base unsigned width + name/value
      entries); widen `StructFieldType` with `'enum'`; add
      `BitFieldChild.refStructId?`. Update schema + `types.ts` +
      `STRUCT_FIELD_TYPES`.
- [ ] 2. Normalizer/validator: validate enum refs and entry range vs base
      width; drop invalid entries/refs without breaking load.
- [ ] 3. Sizing/align: `type: 'enum'` resolves to base unsigned width (extend
      the materialize seam).
- [ ] 4. Decode: carry numeric value + resolved label into the row (no
      byte-math change).
- [ ] 5. One label formatter helper `NAME (0xNN)` with numeric fallback; use
      it for scalar enum fields and for bit children with an enum ref.
- [ ] 6. Authoring: enum badge + form content (base width + entry rows with
      range validation); field type picker `enum` + def picker; bit-child enum
      picker.
- [ ] 7. C preview: enum-typed field emits faithfully with unchanged
      offsets/sizes.
- [ ] 8. Enum edit re-renders referencing instances; deletion reuses the
      pin-safe flow and strips orphan refs.

## Validation

- Unit: normalizer (bad ref, out-of-range entry), label formatting
  (matched/unmatched), bit-child enum ref, C preview golden strings, old-pool
  load.
- Manual: one enum used by a scalar field and a bit child; edit label, see both
  update; unmatched value shows number.
- Commands: `npm run check-types`, `npm run lint`,
  `npm run compile-tests && npm test`.

## Review gates

- After step 5: label-formatting review (shared helper correctness).
- After step 6: authoring + validation review.
- Before finish: full build + tests + old-pool load test.

## Rollback points

- Steps 1–3 are dark until the type picker ships (step 6); safe to stop early.
- Keep the decode change (4) purely additive so it is trivially revertible.
