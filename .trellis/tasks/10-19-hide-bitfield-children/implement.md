# Implement — Hide individual bit-field children

Ordered checklist. Gates after the wiring step; fallow at the end.

- [x] 1. `src/core/types.ts`: add `hidden?: boolean` to `BitFieldChild`.
- [x] 2. `schemas/structs.schema.json`: add `"hidden": { "type": "boolean" }` to
      `definitions.bitFieldChild.properties` (the object is
      `additionalProperties: false`).
- [x] 3. `src/core/struct/structNormalization.ts` (+ `structBitChildren.ts`):
      preserve `hidden` on a bit child, drop an explicit `false` (same
      identity-preserving pattern as the field flag); confirm
      `withoutBitChildRef` keeps `hidden` when it drops `refStructId`.
- [x] 4. Editor: add a hidden checkbox cell to `childFieldRowHtml`
      (`structEditorFields.ts`), `checked` from `child.hidden`; wire a `change`
      listener in `wireBitFieldDefChildRows` (sync draft + refresh preview); read
      it in `readEditorBitFieldChild` (`hidden: checked || undefined`).
- [x] 5. Render filter (`structRowRenderer.ts`): in `renderBitUnitLeafRows` /
      `renderBitUnitArrayElements`, resolve the container's declared field by the
      group path, collect its hidden child names (unless the `Show hidden` toggle
      is on), and drop matching rows before rendering. The container header row
      stays (all-hidden container included).
- [x] 6. Specs: `struct-model.md` (bit-child `hidden`), `struct-instance-display.md`
      (hidden bit-child render rule), `component-sidebar-struct-panel.md` (child
      row checkbox).
- [x] 7. Tests:
      - `structNormalization.test.ts`: round-trip keeps `hidden`; explicit
        `false` dropped; old pool without it unchanged.
      - `struct.test.ts`: decode/offsets/size/C identical with a hidden child.
      - `schemaValidation.test.ts`: `bitFieldChild.hidden` accepted; non-boolean
        rejected.
      - `structPanel.test.ts`: editor checkbox load/save round-trip; hidden child
        absent by default, revealed by the toggle; container header still renders
        when all children are hidden; reusable-type usage hides the child.
- [x] 8. Gates + fallow:
      - `npm run check-types` → 0
      - `npm run lint` → 0
      - `npm run compile-tests && npm test` → 1227 passing / 45 failing (the same
        45 pre-existing JSDOM context-menu/toast failures as the untouched
        baseline 1217/45; the +10 are this task's new tests)
      - `node .agents/skills/fallow-fix/scripts/fallow-extract.mjs` → GREEN
        (dead-code 0 | complexity 0 | duplication 0)

### Implementation notes / deviations

- Step 3: `structNormalization.ts` `sanitizeBitChild` now splits into
  `dropDanglingBitChildEnumRef` + `normalizeBitChildFlags` (the bit-child mirror
  of `normalizeOptionalFieldFlags`). `structBitChildren.ts` needed no change —
  `withoutBitChildRef` already spreads `...rest`; the enum-delete test now asserts
  the flag survives the strip.
- Step 4: the checkbox input carries a distinct `.sfe-bf-child-hidden` class
  (reusing the `.sfe-hidden-chk` sizing rule) plus a
  `.sfe-bf-child-hidden-cell` wrapper; `readEditorBitFieldChild` was kept simple
  (mutate-then-assign, `readBitChildHiddenFlag` helper) so fallow's CRAP gate
  stays green.
- Review fix (check agent): `bitFieldContainerSignature` (inline→reusable migration
  dedupe, `structCodec.ts`) now includes each child's `hidden` flag, so two legacy
  inline containers differing only by that flag no longer collapse onto one
  generated def (which would silently have hidden the other container's bits).
  Mirrors the existing enum-ref rule; the `struct-model.md` migration line was
  updated and a `structNormalization.test.ts` case added. The signature is
  internal, so decode/size/C and idempotence are unaffected.
- Review addition (check agent): a bit-unit-array render case (per-element hidden
  filter) in `structPanel.test.ts`.

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
