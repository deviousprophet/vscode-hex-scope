# Struct Instance Display Design Spec

This is a user-visible UX checklist for Struct Overlay instance rendering and behavior.

Scope:
- Struct instance body rows in the Struct Overlay panel.
- What users can see/click/right-click.
- Focus on what the user sees, understands, clicks, and right-clicks.

## Column Contract

Every struct instance row should read as:

    Offset | Type | Name | Value

- Offset answers: "where is this?"
- Type answers: "what kind of data is this?"
- Name answers: "what field/element is this?"
- Value answers: "what does it currently decode to?"
- Leaf rows should fill all four columns whenever possible.
- Composite headers may leave Type blank when Value is a summary (`u16[3]`, `Header`, `ChildNode[2]`).
- Pointer rows should prefer Type = target pointer type (`Header*`, `u16*`) and Name = local field/index only (`hdr`, `[0]`). Avoid repeating the type in both Type and Name unless the Type column is intentionally blank.
- Collapsed previews and expanded previews should be labeled separately so users can tell which state is being shown.

## Classification Model

Classify every struct instance field with two axes:

1. Value Kind: what the field ultimately represents.
2. Shape / Access Variant: how the value is stored or reached.

Value kinds:
- Scalar: integer, float, ascii/char/string-like direct bytes.
- Struct: nested named struct value.
- Bitfield: storage integer with named logical bit children.

Shape / access variants:
- Single: one direct value.
- Array: repeated direct values.
- Pointer: one pointer storage value that references one target value.
- Pointer array: repeated pointer storage values; each element references one target value.

Pointer is a variant, not a value kind:
- `u16*` is Scalar + Pointer.
- `Header*` is Struct + Pointer.
- `u8*[4]` is Scalar + Pointer array.
- `Header*[2]` is Struct + Pointer array.

Bitfield pointer variants are intentionally out of scope unless a future design adds pointer-to-bitfield-storage semantics.

| Value kind | Single | Array | Pointer | Pointer array |
|---|---|---|---|---|
| Scalar | `u16 count` | `u16 data[3]` | `u16* next` | `u16* next[2]` |
| Struct | `Header header` | `Header nodes[2]` | `Header* hdr` | `Header* hdrs[2]` |
| Bitfield | `u8 control { bits }` | `u8 regs[2] { bits }` | Unsupported / future | Unsupported / future |

## Parent/Child Interaction Contract

- Parent row summary answers: "what group/object/storage unit is this?"
- Child rows answer: "what exact element/member/bit/target field is inside?"
- Expand/collapse button only toggles visibility. It should not change selection by itself.
- Right-clicking a parent applies group-level actions.
- Right-clicking a child applies row-level actions.
- Expanded children should be visually indented under the parent.
- When parent and first child start at the same offset, expanded parent may hide its duplicate offset; child rows keep precise offsets.
- Pointer expansion is a target preview, not physical nesting inside pointer storage. Its child rows are decoded from the pointed address.

## Shape / Access Variant Details

Pointer rules apply to Scalar + Pointer, Scalar + Pointer array, Struct + Pointer, and Struct + Pointer array.

- Pointer storage row represents bytes that store the address.
- Pointer target preview represents bytes at the target address.
- Pointer target preview must visually preserve source context (`from <field> -> <addr>` or equivalent) so jumping to target does not hide where the target came from.
- Pointer target preview header should show target identity (`Header @ 0x00000020` or equivalent).
- Pointer target member rows should show offsets relative to the pointed target base, not relative to the pointer storage field.
- Pointer storage offset and pointer target offsets must be visually separable so users do not confuse where the pointer is stored with where target data lives.
- If a pointer target is unmapped, null, missing, or otherwise not followable, the pointer row should render like a normal scalar field row: no expand button, no composite connector, and no child preview. Show the stored address plus a status note on the pointer value instead.
- Pointer target preview rows should not use a generic visible name like `target`; the pointer row already establishes that context.
- Scalar pointer target preview should be a compact target-value row, not an empty expandable object:
  - Parent row keeps the pointer type (`u32*`) and stored address value (`-> 0x...`).
  - Expanded child row uses the pointed scalar type (`u32`), a dereference label (`*`), and normal scalar value formatting.
  - Expanded child row hides the visible target-relative `+000` offset because every scalar dereference starts at the target base; keep byte selection and target address available through row metadata/tooltip/accessibility text instead.
  - Expanded child row must not render an expand button, blank field name, or `{ }` object root.

        +001 | u16*   | ▾ next         | -> 0x00001000
              | u16    | *              | 0x002A

- Struct pointer target preview should use `{ }` as the target object root, then show struct member children:

        +001 | Header*| ▾ hdr          | -> 0x00000020
              |        | ▾ { }          | Header @ 0x00000020
        +000 | u8     | tag            | 0xAB
        +001 | u16    | size           | 0x0010

- Pointer array parent should show array summary; pointer element rows own pointer actions.
- Pointer array element expansion follows the same scalar/struct target preview rules.

## Hover And Selection Contract

- Hovering a row previews the bytes/bits that row represents in Memory view.
- Hover is transient and must not change persistent selection.
- Moving the pointer away clears hover preview.
- Selecting a row makes that row visually selected and syncs Memory view/Inspector to the same range.
- Only one primary struct row, group header, array element, bit row, or instance card should appear selected at a time.
- Expand/collapse button click only opens/closes children; it must not select the parent or child range.
- Context menu open should not change selection by itself.
- Scalar row click selects that scalar byte range.
- Scalar array parent click selects the full array byte range.
- Scalar array child click selects that element byte range.
- Struct parent click selects the full nested struct byte range.
- Struct child row click selects the child byte range.
- Struct array parent click selects the full struct-array byte range.
- Struct array element header click selects that element byte range.
- Bitfield parent click selects the storage unit bytes.
- Bitfield child click selects the bit range inside the storage unit and highlights matching bits in the parent value.
- Bitfield child hover previews the bit range inside the parent storage value.
- Pointer row click selects pointer storage bytes.
- Pointer value click follows the pointer and selects target bytes.
- After pointer value click, target selection should keep source context visible through source row highlight, breadcrumb, subtitle, or equivalent UI.
- Pointer inline target child click selects target preview range, not pointer storage.
- Created pointer instance selection should move focus to the new/existing target instance card and target bytes.
- Selection state should survive re-render when the selected row/card still exists.
- If selected bytes disappear because data becomes unmapped or struct layout changes, selection should clear rather than point at a stale row.

## Shared UI Surface (applies to all row families)

- Offset column:
  - Row-level offsets display as `+XYZ` (hex).
  - Bit-field child rows display bit offsets as `.N`, relative to the containing storage unit.
- Data type column:
  - Abbreviated type label is shown (examples: `u16`, `i32`, `f32`, `char`, `bit:3`, `Header*`).
  - The type column should be adaptively wide enough for common struct names before yielding space to name/value.
  - Long type labels must stay inside the type column. Compact the visible label with middle ellipsis (for example `VeryLong...erStruct*`) and clip with CSS ellipsis if needed.
  - Full type appears as tooltip on the type cell.
- Value column:
  - Missing bytes or undecodable direct field data display as `??`.
  - Pointer target status appears as a note such as `(unmapped)` or `(null)`; do not use `??` for a known pointer value whose target cannot be followed.
  - Value rendering can be changed per row/group via context menu (`View as`).
- Field name column:
  - Leaf names are local names (not full dotted path).
  - Duplicate local leaf names are disambiguated with suffixes (`#2`, `#3`, ...).
- Selection/hover behavior:
  - Hovering rows highlights corresponding bytes in Memory view.
  - Clicking rows/headers selects corresponding byte ranges and syncs inspector/memory selection.
  - Pointer value click is the special case: it follows the target address instead of selecting storage.

## Context Menu Contract

| Row role | Menu model |
|---|---|
| Scalar leaf | `Copy as` + `View as` |
| Array parent | `Copy address` + `View as` for direct value children |
| Struct/composite parent | `Copy address` + `View as` only when direct value children exist |
| Array element parent | Same as parent role for that element; no action if it has no direct value rows |
| Pointer storage row | `Copy value` + `Jump to Address` + optional `Create Struct Instance` |
| Pointer target preview | Same pointer actions as its source pointer storage row |
| Bitfield storage parent | `Copy address` + bitfield-aware `View as` |
| Bitfield child | `Copy as` + `View as` |

Disabled menu items should stay visible with a short reason (`unmapped`, `null`, `missing`, `non-struct target`, `max depth`) when that teaches the user why an action is unavailable.

## Keyboard And Accessibility Contract

- Expand/collapse controls must be keyboard-focusable.
- Enter/Space on expand/collapse toggles children.
- Row focus must be visually distinct from row selection.
- Selected row must have a visible selected state independent from hover.
- Keyboard context menu should open the same menu as right-click.
- Type/value tooltips should have accessible text equivalents.
- Pointer follow and create actions should be reachable without mouse-only value clicks.

## Scalar

### Scalar (single field / leaf row)

- Render shape:
  - Leaf row (`.si-field`) with: offset, type, name, value.
  - Preview:

        +000 | u16    | count          | 0x1234
- Offset display:
  - `+XYZ` (byte offset from instance base).
- Data type display:
  - Numeric scalar abbreviations (`u8/u16/u32/u64`, `i8/i16/i32/i64`, `f32/f64`), or `str[N]` for ascii.
- Value display defaults:
  - Integers: Hex by default.
  - Floats: Decimal by default.
  - Ascii fields: ASCII by default.
- Value display menu options (`View as`):
  - Integer-like: Hex, Decimal, Binary, ASCII.
  - `float32/float64`: Hex, Decimal, IEEE754, Binary.
  - `ascii`: ASCII, Hex, Binary.
- Context menu (right-click row):
  - `Copy as` submenu (same type options as available display modes).
  - `View as` submenu.

### Scalar array

- Render shape:
  - Collapsible array group header (`.si-arr-grp-hdr`) for the parent field.
  - Expanded body shows index-only child rows (`[0]`, `[1]`, ...).
  - Preview:

        Collapsed:
        +020 |        | ▸ data         | u16[3]

        Expanded:
              |        | ▾ data         | u16[3]
        +020 | u16    | [0]            | 0x0011
        +022 | u16    | [1]            | 0x0022
        +024 | u16    | [2]            | 0x0033
- Offset display:
  - Collapsed: header shows first child offset.
  - Expanded: header hides duplicate offset; child rows keep their own offsets.
- Data type display:
  - Header summary shows `<type>[count]`.
  - Child rows show scalar type abbreviations.
- Value display:
  - Header itself is summary-like; child rows carry actual scalar values.
  - `View as` on header applies to direct child value rows.
- Field name display:
  - Header uses field name.
  - Children use index-only labels (`[i]`).
- Context menu (right-click array header):
  - `Copy address`.
  - `View as` submenu (based on sampled child row type).

### Scalar pointer

- Classification: Scalar + Pointer.
- The pointer storage row uses pointer variant behavior.
- Target preview, when shown, decodes one scalar target value.
- Example: `u16* next`.

### Scalar pointer array

- Classification: Scalar + Pointer array.
- Parent row represents an array of pointer storage values.
- Expanded parent shows pointer element rows (`[0]`, `[1]`, ...).
- Each pointer element may expose a target preview for one scalar target.
- Example: `u16* next[2]`.

## Struct

### Struct (single struct field)

- Render shape:
  - Collapsible composite group header (`.si-arr-grp-hdr`) with nested child rows/groups.
  - Preview:

        Collapsed:
        +040 |        | ▸ header       | Header

        Expanded:
              |        | ▾ header       | Header
        +040 | u8     | tag            | 0xAB
        +041 | u16    | size           | 0x0010
- Offset display:
  - Collapsed: header shows first child offset.
  - Expanded: header offset is removed to avoid duplication; children show offsets.
- Data type display:
  - Header summary shows struct type name (declared target struct name).
  - Child rows/groups show their own types.
- Value display:
  - Header shows summary/meta text.
  - Child rows/groups carry actual values.
- Field name display:
  - Header uses local field name.
  - Nested headers/rows also use local names.
- Context menu (right-click struct header):
  - `Copy address`.
  - `View as` submenu for directly addressable value children.

### Struct array

- Render shape:
  - Parent collapsible array group for the struct field.
  - Expanded list of element headers (`[i]`), each expandable into that element's child rows/groups.
  - Preview:

        Collapsed:
        +080 |        | ▸ nodes        | ChildNode[2]

        Expanded:
              |        | ▾ nodes        | ChildNode[2]
        +080 |        | ▸ [0]          | ChildNode
        +090 |        | ▸ [1]          | ChildNode

        Element expanded:
              |        | ▾ nodes        | ChildNode[2]
        +080 |        | ▾ [0]          | ChildNode
        +080 | u8     | tag            | 0xAB
        +081 | u16    | size           | 0x0010
        +090 |        | ▸ [1]          | ChildNode
- Offset display:
  - Parent follows collapsed/expanded offset rule.
  - Element headers show own offsets (unless inherited hidden context in pointer-inline rendering).
- Data type display:
  - Parent summary: `<StructName>[count]`.
  - Element summary: struct type name.
- Value display:
  - Primarily via nested child rows.
- Field name display:
  - Parent uses field name.
  - Elements use `[i]` labels.
- Context menu:
  - Parent/element headers behave as array headers where direct value rows exist:
    - `Copy address`.
    - `View as`.

### Struct pointer

- Classification: Struct + Pointer.
- The pointer storage row uses pointer variant behavior.
- Target preview, when expanded, renders the pointed struct's children inline.
- Example: `Header* hdr`.

### Struct pointer array

- Classification: Struct + Pointer array.
- Parent row represents an array of pointer storage values.
- Expanded parent shows pointer element rows (`[0]`, `[1]`, ...).
- Each pointer element may expand into a target preview for the pointed struct.
- Example: `Header* hdrs[2]`.

## Bitfields

### Bitfield container (single bitfield parent field)

- Render shape:
  - Scalar-like collapsible header row (`.si-bitunit-hdr.si-field`) with type/name/value columns.
  - Expanded body shows bitfield child rows.
  - Preview:

        Collapsed:
        +000 | u8     | ▸ control      | 0011 0011

        Expanded:
        +000 | u8     | ▾ control      | 0011 0011
        .0   | bit:2  | mode           | 11
        .2   | bit:3  | code           | 001
        .5   | bit:3  | flags          | 011
- Offset display:
  - Header shows byte offset (like scalar).
  - Child rows show bit offsets (`.N`).
- Data type display:
  - Header type uses underlying storage scalar type (for example `u8`).
  - Child type cells show `bit:<width>`.
- Value display defaults:
  - Header defaults to full binary (`bin`).
  - Child bit rows default to binary.
- Value display options (`View as` on header):
  - `Binary`, `Hex`, `Decimal`.
  - `Binary (bit fields only)` appears only when used bit width is less than full storage width.
- Context menu:
  - Header (array-header style): `Copy address`, `View as`.
  - Child rows (scalar style): `Copy as`, `View as`.

### Bitfield array

- Render shape:
  - Parent array group for bitfield container field.
  - Expanded array elements are scalar-like bitunit headers (`[i]`) with expandable child bit rows.
  - Preview:

        Collapsed:
        +010 |        | ▸ regs         | u8[2]

        Expanded:
              |        | ▾ regs         | u8[2]
        +010 | u8     | ▸ [0]          | 1010 1100
        +011 | u8     | ▸ [1]          | 0011 0101

        Element expanded:
              |        | ▾ regs         | u8[2]
        +010 | u8     | ▾ [0]          | 1010 1100
        .0   | bit:4  | lo             | 1100
        .4   | bit:4  | hi             | 1010
        +011 | u8     | ▸ [1]          | 0011 0101
- Offset display:
  - Parent and element headers follow same collapsed/expanded offset rules as array/composite rows.
  - Child rows keep own bit offsets.
- Data type/value/name:
  - Element header type reflects storage scalar type.
  - Element header value defaults to binary.
  - Element header name is `[i]`.
- Context menu:
  - Element header uses array-header style (`Copy address`, `View as`) with bitfield-aware view options.
  - Child bit rows use scalar-style menu (`Copy as`, `View as`).

### Bitfield pointer

- Classification: Bitfield + Pointer.
- Unsupported in this design.
- Rationale: bitfields are logical children of a storage scalar; pointer-to-bitfield needs an explicit target storage layout contract before it can be user-visible.

### Bitfield pointer array

- Classification: Bitfield + Pointer array.
- Unsupported in this design for the same reason as Bitfield + Pointer.

## Additional User-Visible Behaviors Worth Tracking

- Endianness affects decode/value output but binary value view represents decoded numeric value consistently for LE/BE (not raw byte order display).
- Pointer rows can show disabled actions with clear reason text in menu.
- Missing direct field bytes display as `??`; pointer follow problems display as status text or disabled action reasons.
- Struct instances created from pointer menu are visible as new pins/cards and include source subtitle (`from <pin>.<field> @<addr>`).
- Pointer jump action selects bytes at pointed target without necessarily creating a new instance.
- Context menus differ by row family:
  - Scalar row: `Copy as` + `View as`.
  - Array/composite header: `Copy address` + `View as`.
  - Pointer row/header: `Copy value` + jump/create actions.
- `View as` is sticky per row identity/key, so different rows in the same instance can display different value modes simultaneously.

## Quick Coverage Matrix

| Value kind | Single model | Array model | Pointer model | Pointer array model |
|---|---|---|---|---|
| Scalar | Scalar leaf row | Scalar array parent -> element rows `[i]` | Pointer storage parent -> scalar target value preview | Pointer array parent -> pointer element parents `[i]` -> scalar target value preview |
| Struct | Struct parent -> member rows/groups | Struct array parent -> element parents `[i]` -> member rows/groups | Pointer storage parent -> struct target preview `{ }` -> member rows/groups | Pointer array parent -> pointer element parents `[i]` -> struct target preview `{ }` -> member rows/groups |
| Bitfield | Bitunit parent -> bit child rows | Bitfield array parent -> bitunit element parents `[i]` -> bit child rows | Unsupported / future | Unsupported / future |
