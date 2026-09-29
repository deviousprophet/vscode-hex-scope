# Struct overlay review follow-ups

## Goal

Resolve every finding from the two-axis code review of `feat/struct-overlay-types`
(standards + spec), with tests and living-spec updates, so the branch can pass the
parent integration review and be declared done. Review-verified facts drive every
requirement below; nothing here is speculative.

## Review rulings (decisions taken)

- D1. Fix all small findings now. **Defer** the `structPanel.ts` module split to
  `09-29-struct-panel-module-split`. **Skip** extracting the two-site
  ref-strip pattern (reuse-guide threshold is three).
- D2. Parent R16 (per-usage allocation override) wins over the interim trim: a
  per-field `Alloc` control returns **only** on reusable bit-field-reference rows.
- D3. Deleting a referenced type keeps stripping **all** orphan `refStructId`
  refs, and the delete confirmation additionally reports the referencing-field
  count (not only pins).
- D4. Def-level C previews are kept and documented.
- D5. Enum label hex digits follow the field width (no forced 2-digit minimum);
  the `NAME (0xNN)` wording is corrected to say so.
- D6. `hidden:false` stays identity-preserving on load (no self-heal write); the
  contract becomes "the editor drops `false`; load preserves identity".
- D7. The JSON schema stays syntax-level; cross-kind shape rules are documented
  as runtime-only.
- D8. Enum width validation: clear error at authoring time; defensive drop on
  load. R23 is clarified, not strengthened.
- D9. New `9px` badges move to the `10px` floor; the stale "sole 9px exception"
  wording is corrected.
- D10. The show-hidden toggle updates instances in place (no `innerHTML` rebuild).

## Requirements

### Standards axis

- R1. One unsigned-width predicate. Export a single `isUnsignedScalarType` from
  `src/core/structCodec.ts` and consume it from `structPanel.ts`; delete the
  panel's private duplicate. (`isUnsignedEditorType` does not exist; ignore it.)
- R2. One bytes+endian→bigint fold. Export the core `bytesToBigUint` and replace
  the panel's two private clones (`bytesToValue`, `unsignedValueFromBytes`).
- R3. One `isPointerBlocked(field)` predicate, used by `fieldRowHtml`,
  `cannotPointTo`, and `fieldPointerMenuItems`.
- R4. `.sd-kind` and `.se-kind-badge` collapse to one shared badge primitive
  rule with layout-only modifiers.
- R5. `.sd-kind`/`.se-kind-badge` render at `10px` (the documented floor);
  `css-guidelines.md` no longer claims record-view tags are the *sole* 9px
  exception (reconcile `.si-chip`).
- R6. The host `saveShowHiddenFields` handler normalizes through the shared
  `showHiddenFieldsOrDefault`; no hand-rolled `typeof` boolean guard.
- R7. A `STRUCT_BASE_TYPES` runtime const mirrors the base-width union, and the
  schema drift-guard test asserts schema/type parity for it.
- R8. The show-hidden toggle updates the instances body in place, preserving
  focus and scroll (no `innerHTML` rebuild).
- R9. `materializeStructField` handles an invalid `type:'bitfield' + isPointer`
  field consistently (does not yield a pointer-typed container); validation
  remains the gate.
- R10. The `migrated_bitfield_<n>` id scan carries a comment documenting why it
  is collision-safe (seeded from the whole pool).

### Spec axis

- R11. A per-field `Alloc` select is authored on reusable bit-field-reference
  rows only; the pure-struct form stays allocation-free. Specs updated.
- R12. Deleting a referenced type strips all orphan refs (bitfield, enum, nested
  `struct`); the confirmation reports the referencing-field count in addition to
  the pin count; a nested-struct case is covered by a test.
- R13. Def-level C previews are documented in the living spec.
- R14. The enum-label acceptance wording reflects per-width hex digits.
- R15. The hidden-flag load contract is documented as identity-preserving.
- R16. The living spec states the JSON schema is syntax-level and cross-kind
  shape rules are runtime-only.
- R17. Enum width validation is documented as authoring-time error + load-time
  defensive drop.

### Tests (parent acceptance criteria + seam coverage)

- R18. Composition: one struct with a hidden field, a field typed by a reusable
  bit-field type, and an enum field/bit-child renders correctly together in one
  instance.
- R19. Parity: with every new feature unused, the instance view and the C
  preview are byte-identical to the pre-change baseline (golden).
- R20. Seam: the `saveShowHiddenFields` host handler persists, and the
  `showHiddenFieldsChanged → applyShowHiddenFieldsChanged → setShowHiddenFields`
  chain reaches the panel.

## Constraints

- C1. No issue reference (number, URL, or title) in artifacts, branch, commits,
  or comments.
- C2. Naming stays struct-termed; no rename of `StructDef`/`StructField`/
  `StructPin`, `structs.json`, `structs.schema.json`, or module/dir names.
- C3. No new persisted data shapes; R11 only re-authors an existing optional key.
- C4. No spurious self-heal writes on already-valid pools (identity preserved).
- C5. Gates: `npm run check-types`, `npm run lint`,
  `npm run compile-tests && npm test` all green; the existing suite stays green.

## Out of scope / deferred

- `09-29-struct-panel-module-split` — splitting the ~5,686-line panel.
- Extracting the two-site `refStructId` strip pattern (threshold is three).
- Surfacing load-time sanitization diagnostics to the UI.

## Acceptance Criteria

- [ ] R1–R17 each have either a passing test or a documented living-spec change.
- [ ] R18–R20 tests exist and pass.
- [ ] No `innerHTML` rebuild on the show-hidden toggle (focus/scroll preserved).
- [ ] `saveShowHiddenFields` normalizes via `showHiddenFieldsOrDefault`.
- [ ] `STRUCT_BASE_TYPES` parity is asserted.
- [ ] `.sd-kind`/`.se-kind-badge` are `10px`; css-guidelines wording corrected.
- [ ] Gates green; prior 1228 tests still pass.
- [ ] No issue references; naming unchanged.
