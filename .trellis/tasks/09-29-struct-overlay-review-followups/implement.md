# Implement — Struct overlay review follow-ups

Ordered checklist. Run the quality gate after each significant step. Pure
refactors land first so later behaviour edits sit on shared helpers.

- [ ] 1. Shared helpers (R1, R2, R3, R10). Export `isUnsignedScalarType` and
      `bytesToBigUint` from `src/core/structCodec.ts`; import them in
      `structPanel.ts` and delete the private `isUnsignedScalarType`,
      `bytesToValue`, `unsignedValueFromBytes`; add `isPointerBlocked(field)` and
      use it at the three disjunction sites; comment the migrated-id scan.
- [ ] 2. Materialize hardening (R9): a rewritten `type:'bitfield'` field never
      keeps `isPointer`.
- [ ] 3. CSS (R4, R5): one shared badge primitive at `10px`; correct
      `css-guidelines.md` (drop "sole 9px exception"; reconcile `.si-chip`).
- [ ] 4. Show-hidden seam (R6, R8, R20): `saveShowHiddenFields` normalizes via
      `showHiddenFieldsOrDefault`; `refreshInstances` updates in place (no
      `innerHTML` rebuild); add host-handler + invalidation-chain tests.
- [ ] 5. Restored allocation authoring (R11): per-field `Alloc` select on
      reusable bit-field-reference rows only, read on save; panel test; spec.
- [ ] 6. Deletion confirmation (R12): count referencing fields; surface next to
      the pin count; nested-`struct` deletion test.
- [ ] 7. Edge rulings + living specs (R13–R17): document def-level C previews,
      per-width hex digits, hidden load identity, schema syntax-level + runtime
      shape rules, enum authoring-vs-load validation.
- [ ] 8. Composition + parity tests (R18, R19).
- [ ] 9. Repo-wide gates + first-run of the full suite on the branch.

## Validation

- Unit (core): shared predicate/fold parity; materialize drops `isPointer`;
  `STRUCT_BASE_TYPES` ↔ schema parity (R7).
- Unit (panel): bit-field-ref row authors `Alloc`; pure rows do not; in-place
  toggle preserves focus/scroll; composition render (hidden + bitfield ref +
  enum) with toggle off/on; parity golden for instance view + C preview.
- Unit (host/storage): `saveShowHiddenFields` normalizes + persists;
  `showHiddenFieldsChanged` reaches the panel; deletion confirmation counts
  referencing fields.
- Commands: `npm run check-types`, `npm run lint`,
  `npm run compile-tests && npm test`.

## Review gates

- After step 1: pure-refactor review (no behaviour change; suite still green).
- After step 4: seam review (host handler + in-place toggle).
- After step 5: allocation-authoring review (only bit-field-ref rows).
- Before finish: full build + tests; fallow audit if available; old-pool load
  unchanged.

## Rollback points

- Step 1 is a pure refactor — revert alone if the suite regresses.
- Steps 5–6 are the interactive-behaviour changes; land after the refactors are
  green so a regression localises.
- Steps 7–8 are docs/tests and cannot break runtime.
