# Implement: Mixed-endian + per-field/struct LSB-MSB overrides

## Follow-up iteration — UI hardening (post first-pass review)

Grilled decisions; revise the already-implemented UI:

1. **Chips parent-only for bit units**: `overrideBadgeHtml` returns `''` for `isBitField` child rows; `bitUnitHeaderHtml` (parent value row) becomes the chip owner driven by `g.rows[0]`'s resolved endian/allocation. Non-bit leaf + composite headers unchanged. Pointers still never chip.
2. **Controls** (struct + field level):
   - Options: `Auto` / `LE` / `BE` and `Auto` / `LSB` / `MSB` (`Auto` = inherit, `value=""`). Drop the long `Inherited (SRC)` label.
   - Struct-level selects labeled `Endian:` / `Alloc:` beside Packed; field column header `End` → `Endian`.
   - Explicit selection tints the select (subtle bg + `si-chip`-matching colored text); Auto option carries `title="Auto — inherits <SRC>"`.
   - CSS: `appearance:none` + own caret with `padding-right` so glyph never overlaps text; endian/alloc columns fit the short labels.
3. **Type select long struct names**: truncate long `struct <name>` option label (full name in `title`); widen type column for common names.
4. **No C-preview change** (grilled: leave as-is).
5. Update `.trellis/spec/frontend/components/component-sidebar-struct-panel.md` override note: children never chip; controls are Auto/LE/BE + Auto/LSB/MSB tinted selects.
6. Tests: update `structPanel.test.ts` chip assertions for bit units (chip on header, not children); editor selects assert `Auto`/`LE`/`BE` option text + explicit tint class; adjust any "Inherited (SRC)" expectations. Core tests unchanged.

## Follow-up iteration 2 — value-render fix + tint removal (confirmed via diagnosis)

User reported: changing a field/struct `endian`/`allocation` override updates the **chip** but the struct instance **value cells don't change** (scalar value stays global-endian; bit-unit header overall value + binary order unchanged). Diagnosed with diagnosing-bugs: red-capable regression test reproduced it (`override endian changes rendered values, not just chips (REGRESSION)` in `structPanel.test.ts`, 1 failing / 939 passing).

Root cause: `StructPanel.getValForType` re-derives every value from raw bytes with the panel's **global** `this._endian` instead of the row's resolved `r.endian`; the bit-unit header drops into that scalar path, and the bin display path has no allocation parameter. Fix:

1. **Thread resolved endian**: `getValForType` uses `r.endian ?? this._endian` (scalar cells, bit-unit header value, ieee, copy path).
2. **Thread resolved allocation**: bit-unit header bin / value display honors `r.allocation ?? this._bitFieldAllocation` (mirror existing `renderBinaryStorageUnit` handling) → LSB↔MSB flips header bit order.
3. **Copy** value text shares the seam — verify/wire the same resolved values.
4. **Remove explicit tint** (user instruction): `Auto`/`LE`/`BE` and `Auto`/`LSB`/`MSB` options all keep the neutral input background; drop `is-explicit` class emission in `overrideSelectHtml`, the `.is-explicit` CSS blocks (`.se-override-sel#se-endian/#se-alloc` + `.sfe-endian-sel/.sfe-alloc-sel`), and the `is-explicit` test assertions. Keep chip + tooltip.

Regression test already added (guards the fix). Run `npm run check-types` + `npm run lint` + full `npm test` green.

## Follow-up iteration 3 — struct-default row grid-aligned + field Alloc bitfield-only (planning; awaiting approval)

Decisions confirmed: Q1 struct-level Endian/Alloc become a grid-aligned "struct default" row; Q2 field-level `Alloc` control exists only on bit-field container fields.

1. **structPanel.ts `editorHtml` + `structPanel.css`**: drop the `.se-override-row` flex strip; emit a `.se-struct-default-row` using the same 8-column grid template (Type/Name/Endian/Alloc/Bits/[ ]/‹›/✕). Packed toggle in Type column (shortened label, `title` with full `__attribute__((packed))`), "struct default" label in Name column, `#se-endian` in Endian column, `#se-alloc` in Alloc column, remaining cells empty. Keep ids + existing `#se-endian, #se-alloc` change/save wiring (`syncEditorDraft`, `wireEditorInSec`) untouched.
2. **`fieldRowHtml`**: render `.sfe-alloc-sel` only when `isBitContainerField(f)`; otherwise emit an empty cell placeholder (keep grid alignment). `readEditorFieldRow` already null-safe — no change needed. Endian select remains on all rows.
3. **Tests** (`structPanel.test.ts`): assert struct-level selects still round-trip save via the new row; `Alloc` select absent on a plain scalar/pointer/struct row and present on a bit-container row; grid stays aligned (struct row shares column template). Keep the value-render regression test untouched and green.
4. Gates: `npm run check-types`, `npm run lint`, `npm test` (940 passing). No commit.

## Order

1. **Types + schema + validation** (pure, testable first)
   - `src/core/types.ts`: add `endian?: 'le' | 'be'` and `allocation?: 'lsb' | 'msb'` to `StructField` and `StructDef`.
   - `schemas/structs.schema.json`: add optional `endian` (enum `['le','be']`) and `allocation` (enum `['lsb','msb']`) to both struct-object and field-object definitions, allow absent.
   - `src/core/structCodec.ts`: extend `validateStructs` to reject bad `endian` / `allocation` on defs and fields.

2. **Decode engine** (core, no UI)
   - Rename threaded `globalEndian` param → `effectiveEndian`; add threaded `effectiveAllocation` (`'lsb' | 'msb'`).
   - `DecodeContext`: add `globalEndian` (true global, set at `decodeStructRecursive` entry) for the pointer exception.
   - `decodeStructRecursive`: `structEndian = def.endian ?? effectiveEndian`; `structAlloc = def.allocation ?? effectiveAllocation`; pass to each `decodeStructField`.
   - `decodeStructField`: `fieldEndian = field.endian ?? structEndian`; `fieldAlloc = field.allocation ?? structAlloc`. Bit-field branch passes both; nested-struct branch passes both as child inherited values; pointer branch uses `ctx.globalEndian`.
   - `decodeFieldElements` / nested path: pointer branch always `ctx.globalEndian`.
   - `decodeBitFieldContainer` / `decodeBitFieldChildren`: thread `fieldAlloc`; `bitFieldChildRow` uses threaded allocation (currently `ctx.bitFieldAllocation`). Unit read keeps threaded `fieldEndian`.
   - `DecodedField`: add resolved `endian` + `allocation` for the indicator.

3. **Core tests** (`src/test/core/struct.test.ts`)
   - Precedence endian + allocation (field > struct > global), nested inherit, nested override, pointer-global-only, bit-field unit endian + child allocation override, offset/size unchanged with overrides, invalid values rejected.
   - New mixed-endian fixture (LE global → BE nested struct → MSB children) with known bytes.
   - Existing suites must pass unchanged (parity gate).

4. **UI** (`structPanel.ts` + `structPanel.css`)
   - Editor: per-field and per-struct tri-state controls (Inherited / LE / BE; Inherited / LSB / MSB). Show effective value + explicit/inherited state; inherited shows source, explicit shows badge/chip.
   - Decoded rows: badge when effective value differs global (e.g. `BE`, `LSB` chip), incl. bit-field child rows inheriting explicit struct override.
   - Editor boundary validation → inline `se-error`, no `onStructsChange` on invalid. Wire into draft state + save.

5. **Webview tests** (`src/test/webview/components/sidebar/structPanel/structPanel.test.ts`)
   - Editor renders/sets endian + allocation; save emits new keys; badge appears for explicit override; parity suites pass.

6. **Validation commands**
   - `npm test` (or repo runner) — all suites.
   - `npm run lint` / typecheck per repo config.

## Review gates
- After (2): decode review — precedence + pointer-global correctness for both concerns.
- After (4): UI review — tri-state, badge, serialization round-trip, inline error, no dependency drift.

## Rollback
- Revert branch; absent keys everywhere = prior byte/bit behavior. No data migration.