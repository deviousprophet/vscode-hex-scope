# Design: Mixed-endian + per-Field/Struct LSB-MSB overrides

## Core concepts

Two **independent** overridable concerns (they were wrongly collapsed as one):

| Concern | Unit | Values | Meaning |
|---|---|---|---|
| **Byte order** | multi-byte scalar value | `'le' | 'be'` | order of the bytes that form a value / bitfield unit |
| **Bit allocation** | bit-field container unit (`uint8..64` with named children) | `'lsb' | 'msb'` | which bit of the unit is `bitOffset 0` + declaration-order packing side |

They are orthogonal: a big-endian unit with LSB-first children is legal. Both follow the **same precedence + inheritance** model; both get a per-field and per-struct override.

## Data model (`src/core/types.ts`)

Add to both `StructDef` and `StructField`:

```ts
endian?: 'le' | 'be';          // default: inherit
allocation?: 'lsb' | 'msb';    // default: inherit (only meaningful on a bitField container field / a struct that holds them)
```

- Absent / `undefined` = inherit.
- Present = explicit override.
- `StructFieldType` / `STRUCT_FIELD_TYPES` unchanged.

## Precedence & inheritance (one shared rule, applied independently to each concern)

Resolution walks the chain and takes the **first explicit value**:

```
field.<concern>  →  containing struct.<concern>  →  nested parent structs.<concern>  →  global
```

- Field beats struct beats global.
- A struct's override inherits into nested sub-structs unless a nested struct declares its own.
- **Pointer fields**: byte order of the pointer VALUE always uses **global** overlay endian; allocation doesn't apply. (Endian override on a pointer field itself is ignored for value decode; kept per required behavior).

## Decode threading (`src/core/structCodec.ts`)

Rename the threaded `globalEndian` param to `effectiveEndian` and add the same for allocation:

- `decodeStructRecursive(def, …, effectiveEndian, effectiveAllocation, …)` →
  - `structEndian = def.endian ?? effectiveEndian`
  - `structAlloc = def.allocation ?? effectiveAllocation`
  - each field: `decodeStructField(..., structEndian, structAlloc)`
- `decodeStructField(..., inheritedStructEndian, inheritedStructAlloc)`:
  - `fieldEndian = field.endian ?? inheritedStructEndian`
  - `fieldAlloc = field.allocation ?? inheritedStructAlloc`
  - **pointer branch**: always uses `ctx.globalEndian` (true global endian, stashed in `DecodeContext` at first entry) — ignores `fieldEndian`; allocation N/A.
  - bit-field container: `decodeBitFieldContainer(ctx, field, offset, align, fieldEndian, fieldAlloc)`.
  - nested struct field: pass **both** resolved values as the child struct's inherited values (same as endian threading).
- `DecodeContext` gains `globalEndian` (set once from the entry param) for the pointer exception.
- `extractBitFieldValue` already takes `allocation: BitFieldAllocation` — the per-field resolved `fieldAlloc` feeds it directly (currently it reads `ctx.bitFieldAllocation`; switch to the threaded value). `bytesToBigUint` already takes `endian`.

## Where each concern flows vs. ignored

| Use | Byte order source | Allocation source |
|---|---|---|
| scalar multi-byte decode | field-effective chain | — (N/A) |
| bit-field **unit read** (`readBitFieldUnit` → `bytesToBigUint`) | field-effective chain | — |
| bit-field **child layout** (`extractBitFieldValue`) | — | field-effective chain |
| pointer value decode | `ctx.globalEndian` | — |
| ascii (valid-data flag) | field-effective chain (no byte-order effect) | — |
| offsets, sizes, alignment | never | never |

## Explicit-override indicator (new requirement)

1. **Decoded rows** (`structPanel.ts` instance cards): rows whose effective `endian`/`allocation` differs from the global value show a small chip (`BE`/`LE`, `LSB`/`MSB`). **Bit-field units chip only on the parent unit's value row (bit-unit header)** — bit child rows never show chips; `overrideBadgeHtml` suppresses them for `isBitField` rows, and `bitUnitHeaderHtml` becomes the chip owner for the unit, driven by `g.rows[0]`'s resolved values. Non-bit leaf rows keep per-row chips (field/struct explicit). Pointers never chip.
2. **Struct editor**:
   - Options text: `Auto` / `LE` / `BE` (endian), `Auto` / `LSB` / `MSB` (allocation) — `Auto` = inherited (`value=""`). Short enough for the 52px columns; CSS reserves caret space (`padding-right`) and uses `appearance:none` + custom caret so the glyph never overlaps text.
   - **Struct-default row grid-aligned**: replace the flex strip with one leading row sharing the 8-column field grid template — Packed toggle in the Type column, the struct's Endian select in the Endian column (58px), its Alloc select in the Alloc column (52px); Name column carries a "struct default" label; remaining cells empty. Keeps `#se-packed`/`#se-endian`/`#se-alloc` ids and their change/save wiring unchanged. Packed button label shortened to fit the 96px Type column (`packed`, full `title`).
   - **Field-level `Alloc` only on bit-field containers**: `fieldRowHtml` renders `.sfe-alloc-sel` only when `isBitContainerField(f)` (unsigned scalar + named `bitFields`, not pointer); other rows emit an empty placeholder cell so the grid keeps alignment. `readEditorFieldRow` is already null-safe (`?.value`). Nested-struct bitfield allocation override → set on the nested `StructDef` (its struct-level Alloc); referencing field rows get no Alloc control.
   - **No tint on explicit selections** (user decision): `Auto`/`LE`/`BE` and `Auto`/`LSB`/`MSB` all share the neutral input background; no `is-explicit` class. Inherited source shows as a `title` tooltip on the Auto option: `Auto — inherits BE`.
   - Type select with a long nested-struct name: option label truncated (keeps `struct <name>` flavor) with full name in `title`; column widened so common names fit.

No C-preview changes (grilled decision: leave C preview as-is — overrides not representable, no comment emitted).

## Validation

`validateStructs` rejects `endian` not in `{'le','be'}` and `allocation` not in `{'lsb','msb'}` on both fields and defs. Absent allowed. Mirrors the JSON-schema enums.

## Compatibility / rollback

- Absent everywhere ⇒ today's behavior (global endian drives endian, global `bitFieldAllocation` drives allocation). Old saved structs have no new keys → inherit → global. No migration.
- Rollback: revert branch; drop type + decode changes. No data migration.

## Files touched

- `src/core/types.ts` — two optional props on `StructDef`, `StructField`.
- `src/core/structCodec.ts` — resolution, `ctx.globalEndian`, param threading for both concerns, pointer exception, validation, `DecodedField` resolved values.
- `src/webview/components/sidebar/structPanel/structPanel.ts` + `structPanel.css` — editor tri-state controls + decoded-row badges.
- `schemas/structs.schema.json` — `endian` + `allocation` enum (absent allowed) on struct + field objects.
- Tests: `src/test/core/struct.test.ts`, `src/test/webview/components/sidebar/structPanel/structPanel.test.ts`.