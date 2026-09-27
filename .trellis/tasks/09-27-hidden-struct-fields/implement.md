# Implement — Hide struct fields in the instance view

Ordered checklist. Run the quality gate after each significant step.

- [ ] 1. Add `hidden?: boolean` to `StructField` in `src/core/types.ts`; add
      the property to `schemas/structs.schema.json` `structField`.
- [ ] 2. Preserve/drop `hidden` in the struct normalizer consistently with
      existing optional flags.
- [ ] 3. Add the "Hidden" checkbox to the Struct Types field editor row; wire
      draft read (on save) and draft write (on load/edit).
- [ ] 4. Add `showHiddenFields` to `ProfileRecord` (empty default false +
      normalizer) and `schemas/profiles.schema.json`.
- [ ] 5. Thread `showHiddenFields` through `showHiddenFieldsOrDefault`, the
      `init` + `perFileDataChange` messages, `S.showHiddenFields`,
      `appModel`/`webviewMessageModel`, a `saveShowHiddenFields` message + host
      handler, a panel setter, and a `showHiddenFieldsChanged` invalidation
      effect.
- [ ] 6. Add the global "show hidden fields" toggle to the Struct Instances
      header; report the change and re-render instances without reopening the
      editor.
- [ ] 7. Filter hidden fields at the decode-to-render seam for leaf, composite,
      array, and bit-unit groups; skip hidden containers with their subtree.

## Validation

- Unit: normalizer round-trip keeps `hidden`; old file without it is unchanged
  and visible; storage round-trips `showHiddenFields`.
- Unit/render: hidden field absent by default, present when toggle on; hidden
  bit-field container hides children.
- Manual: C preview and field offsets identical with the flag set.
- Commands: `npm run check-types`, `npm run lint`,
  `npm run compile-tests && npm test`.

## Review gates

- After step 2: schema/normalizer review.
- After step 7: render-filter review.
- Before finish: full build + tests; verify composed behaviour unchanged when
  no field is hidden.

## Rollback points

- Steps 1–2 are dark until the editor checkbox ships; safe to stop early.
