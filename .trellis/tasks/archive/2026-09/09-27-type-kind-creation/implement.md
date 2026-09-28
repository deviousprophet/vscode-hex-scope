# Implement — Type-kind creation and pure-struct trim

Ordered checklist. Quality gate after each significant step.

- [ ] 1. `migrateInlineBitFields(defs)` in `structCodec.ts`: signature dedupe,
      stable ids/names, preserve `count/endian/allocation/name/hidden`, clear
      `bitFields`/`bitFieldsCollapsed`, append generated `kind:'bitfield'`
      defs. Export it.
- [ ] 2. Wire migration into `normalizeStructDefsValue` (after identity dedupe;
      OR `changed`). Verify idempotence and byte-identical decode.
- [ ] 3. Add `'enum'` to the type-kind union used by the editor; keep
      `kind?` on the draft (enum form owned elsewhere).
- [ ] 4. Kind chooser: `#sm-add-btn` opens a three-tile picker in the Types
      body (`_choosingKind`); tiles seed the kind draft; cancel returns to the
      list. Remove `#sm-add-bitfield-btn`.
- [ ] 5. `editorHtml` dispatch by `draft.kind`; add `enumEditorHtml` /
      `wireEnumDefEditor` seam with a placeholder body for the enum child.
- [ ] 6. Trim the pure-struct form: drop `Alloc` + `Bits` field columns and
      the struct-level `Alloc`; keep `Endian`. Remove struct-row bit-child /
      alloc read paths and dead helpers.
- [ ] 7. CSS: 10-column field grid -> 8-column (header, field row,
      struct-default row); remove dead alloc/bit-cell rules.
- [ ] 8. Keep the bit-field form reachable only via the chooser; reuse the
      landed `bitFieldDefEditorHtml`.

## Validation

- Unit (core): migration dedupes identical containers; second run
  `changed === false`; `decodeStruct`/`structByteSize`/`structToC` output
  identical before vs after migration; overrides preserved.
- Unit (panel): chooser renders three tiles; each opens its form; cancel
  creates nothing; plain-struct grid has 8 columns and no bit toggle/alloc;
  bit-field form still saves; no `#sm-add-bitfield-btn`.
- Regression: existing reusable-type and struct-only pools load unchanged.
- Commands: `npm run check-types`, `npm run lint`,
  `npm run compile-tests && npm test`.

## Review gates

- After step 2: migration review (byte-identical + idempotent is the gate).
- After step 6: pure-struct form review (no orphaned helpers/CSS).
- Before finish: full build + tests + fallow gates.

## Rollback points

- Steps 1–2 are additive and safe before the UI change.
- The UI trim (6–7) is the highest-churn part; land after migration is green.
