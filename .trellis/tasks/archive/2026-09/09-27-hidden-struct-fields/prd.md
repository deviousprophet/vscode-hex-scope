# Hide struct fields in the instance view

## Goal

Let users mark fields they never want to see (reserved bytes, padding-like
fields) so the Struct Instances view only shows what matters, with a global
escape hatch to reveal them when needed.

## Requirements

- R1. A `StructField` gains a hidden flag, persisted in `structs.json`.
- R2. Hidden is toggled from the field's row in the Struct Types editor
  (a checkbox next to the existing per-field controls).
- R3. The Struct Instances section header has one global "show hidden fields"
  toggle. Default off: hidden fields are not rendered. On: they render like
  normal fields.
- R4. The toggle state persists per profile (survives reload).
- R5. Hidden affects the instance view only. Decode, offset/address math, and
  the C preview emit the field exactly as before.
- R6. Hidden is field/container level. Individual bit-field children are not
  individually hideable; hiding a bit-field container hides its children too.

## Acceptance Criteria

- [ ] A field marked hidden is absent from the instance view by default.
- [ ] Toggling "show hidden fields" reveals it (and its children, for a
      container) without re-expanding the card.
- [ ] Toggling the switch, reloading the window, and reopening the instance
      shows the same visibility state (persisted per profile).
- [ ] A hidden field still appears in the Struct Types editor and the C
      preview; its offset/bytes are unchanged.
- [ ] A hidden bit-field container hides all of its bit children; there is no
      per-bit-child hidden control.
- [ ] Pre-existing `structs.json` without the flag loads unchanged and every
      field is visible.
- [ ] Unit tests cover the normalizer/persistence round-trip and the render
      filter; lint, type-check, and tests pass.
- [ ] No issue reference in any artifact, branch, commit, or comment.

## Dependencies / Ordering

None. Recommended first child (smallest, independent).
