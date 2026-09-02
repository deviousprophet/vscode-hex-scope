# Mixed-endian + per-field/struct LSB-MSB overrides

## Goal

Allow selecting byte-order (LSB/MSB = little/big-endian) and bit-field allocation representation on a **per-field** and **per-structure** basis, so one overlay can describe mixed-endian data (e.g. a little-endian struct containing a big-endian sub-structure parsed by separate firmware). Also visibly flag fields/bit-fields that carry an explicit (non-inherited) representation.

## Requirements

- Two independent overridable settings, each supported at both **structure** (`StructDef`) and **field** (`StructField`) level:
  - `endian?: 'le' | 'be'` — byte order of multi-byte scalar values and bit-field units.
  - `allocation?: 'lsb' | 'msb'` — bit allocation of bit-field container units (which bit is `bitOffset 0` + packing side).
- Optional → absent means **inherit**. Values limited to `'le'/'be'` and `'lsb'/'msb'`; validation rejects anything else.
- Per-field and per-struct tri-state controls (`Auto` = inherited / `LE` / `BE` for endian; `Auto` / `LSB` / `MSB` for allocation). Struct-level Endian/Alloc gather into a **grid-aligned "struct default" row** sharing the field-column widths (Endian 58px / Alloc 52px), Packed toggle in the Type column; per-field editor column headers read `Endian` / `Alloc`. The field-level `Alloc` control renders **only on bit-field container fields** (unsigned scalar with named `bitFields`, not pointer); plain scalar, pointer, and struct-typed rows render an empty Alloc cell. Nested-struct bitfield allocation is overridden on the nested `StructDef` itself (its struct-level Alloc), not on the referencing field. No tint on explicit selections — all options share the neutral input background; inherited source available via tooltip (`Auto — inherits BE`).
- Precedence for each concern independently: **field beats struct beats nested parents beats global overlay**. First explicit value up the chain wins.
- A per-struct override **inherits into nested sub-structs** referenced inside it unless a nested struct declares its own.
- **Pointer fields always use global overlay endian** for their pointer value; allocation is N/A. Endian override on a pointer field is accepted in the UI but ignored for value decode.
- Bit-field children: unit read uses effective struct endian; child packing uses effective struct allocation. Overrides are set at the container-unit field level (not per child) — sufficient and correct since children share the unit.
- Settings are orthogonal to layout/alignment/padding: overriding never changes offsets, sizes, or alignment, only value interpretation.
- **Explicit-override indicator**: decoded struct rows show a chip when a field's effective endian/allocation differs from global. For bit-field units the chips appear only on the **parent unit's value row** (bit-unit header) — bit child rows never chip. If a struct has an explicit override, its non-bit leaf rows chip. The struct editor shows effective value + explicit/inherited state.

## Constraints

- `core/structCodec.ts` stays a pure, shared decode engine (no DOM, no `S`). The frontend spec's "structCodec unchanged" note is amended.
- No new dependency; global overlay endian + global bit-allocation control remain the root defaults.
- Persistence via existing struct-definition save/load pipeline (no new channel). JSON schema updated to match.

## Acceptance Criteria

- [ ] `StructDef` and `StructField` accept optional `endian` and `allocation`; absent = inherit; invalid values rejected by validation and JSON schema.
- [ ] Decode resolves both concerns per field: field beats struct beats nested parents beats global.
- [ ] Nested sub-struct inherits containing struct's override unless it declares its own (both concerns).
- [ ] Pointer fields always decode pointer value with global overlay endian regardless of overrides.
- [ ] Bit-field unit read uses effective endian; child packing uses effective allocation.
- [ ] Known mixed-endian struct (LE global, BE nested struct with MSB children) decodes byte-correctly per new unit tests.
- [ ] Overrides never change offsets/sizes/alignment — existing size/alignment tests pass unchanged.
- [ ] Struct editor exposes per-field and per-struct tri-state (Auto/LE/BE and Auto/LSB/MSB) with no tint on explicit selections; invalid editor input produces inline `se-error` and no `onStructsChange`.
- [ ] Struct-level Endian/Alloc sit in a grid-aligned row sharing field grid widths/labels, Packed in the Type column; field-level `Alloc` appears only on bit-field container rows (empty cell otherwise).
- [ ] Decoded rows show explicit-override chip when effective value differs global; **bit-unit chips appear only on the parent value row, never on bit child rows**.
- [ ] Control text is never clipped/overlapped by the drop caret: endian/alloc selects fit their columns; long nested-struct names in the type select are truncated with full name in a tooltip.
- [ ] Struct defs round-trip through save/load with new keys; existing panel parity tests pass.

## Notes

- Grilled consensus: both concerns at both levels; field beats struct beats global; struct inherits into nested unless overridden; pointers always global; indicator = badge on decoded rows + editor (bit-unit chips parent-only).
- Two concerns must stay independent (LSB-allocation ≠ little-endian byte order).
- Post-review decisions: value cells must render with resolved overrides (not global); explicit selections are not tinted; struct-level Endian/Alloc use a grid-aligned struct-default row; field-level `Alloc` control exists only on bit-field container fields.