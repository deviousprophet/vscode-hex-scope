# Implement — Hide individual bit-field children

Ordered checklist. Gates after the wiring step; fallow at the end.

- [ ] 1. `src/core/types.ts`: add `hidden?: boolean` to `BitFieldChild`.
- [ ] 2. `schemas/structs.schema.json`: add `"hidden": { "type": "boolean" }` to
      `definitions.bitFieldChild.properties` (the object is
      `additionalProperties: false`).
- [ ] 3. `src/core/struct/structNormalization.ts` (+ `structBitChildren.ts`):
      preserve `hidden` on a bit child, drop an explicit `false` (same
      identity-preserving pattern as the field flag); confirm
      `withoutBitChildRef` keeps `hidden` when it drops `refStructId`.
- [ ] 4. Editor: add a hidden checkbox cell to `childFieldRowHtml`
      (`structEditorFields.ts`), `checked` from `child.hidden`; wire a `change`
      listener in `wireBitFieldDefChildRows` (sync draft + refresh preview); read
      it in `readEditorBitFieldChild` (`hidden: checked || undefined`).
- [ ] 5. Render filter (`structRowRenderer.ts`): in `renderBitUnitLeafRows` /
      `renderBitUnitArrayElements`, resolve the container's declared field by the
      group path, collect its hidden child names (unless the `Show hidden` toggle
      is on), and drop matching rows before rendering. The container header row
      stays (all-hidden container included).
- [ ] 6. Specs: `struct-model.md` (bit-child `hidden`), `struct-instance-display.md`
      (hidden bit-child render rule), `component-sidebar-struct-panel.md` (child
      row checkbox).
- [ ] 7. Tests:
      - `structNormalization.test.ts`: round-trip keeps `hidden`; explicit
        `false` dropped; old pool without it unchanged.
      - `struct.test.ts`: decode/offsets/size/C identical with a hidden child.
      - `schemaValidation.test.ts`: `bitFieldChild.hidden` accepted; non-boolean
        rejected.
      - `structPanel.test.ts`: editor checkbox load/save round-trip; hidden child
        absent by default, revealed by the toggle; container header still renders
        when all children are hidden; reusable-type usage hides the child.
- [ ] 8. Gates + fallow:
      - `npm run check-types`
      - `npm run lint`
      - `npm run compile-tests && npm test`
      - `node .agents/skills/fallow-fix/scripts/fallow-extract.mjs` → GREEN

## Validation

- Normalizer round-trip + schema accept/reject proven.
- Render filter proven both ways (off → absent, on → present) with the container
  header intact; decode/offsets/C unchanged.
- Commands: `npm run check-types`, `npm run lint`,
  `npm run compile-tests && npm test`; fallow GREEN.

## Review gates

- After step 3: model/schema/normalizer review.
- After step 5: render-filter review (container header, arrays, all-hidden case).
- Before finish: full suite + fallow; old-pool load unchanged.

## Rollback points

- Steps 1–3 are dark until the editor checkbox ships.
- Step 5 is render-only; revert alone to restore prior rendering.

## Out-of-scope guard

No per-usage hidden override, no container auto-hide, no data-schema version
bump, no decode/offset/C change.
