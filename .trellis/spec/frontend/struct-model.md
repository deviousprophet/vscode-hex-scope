# Struct Definitions, Decode, Pins, and Persistence Code-Spec

## Scenario: Define C-like layouts and apply them to firmware addresses

### 1. Scope / Trigger

Applies to shared struct types, `core/struct-codec.ts`, struct editor/import/export, pin model, pointer-created pins, persistence/migration, and decode inputs. Row rendering details live in `struct-instance-display.md`.

### 2. Signatures

```typescript
interface StructField {
    name: string;
    type: StructFieldType;
    isPointer?: boolean;
    refStructId?: string;
    bitFields?: BitFieldChild[];
    count: number;
}
interface StructDef { id: string; name: string; fields: StructField[]; packed?: boolean; }
interface StructPin { id: string; structId: string; addr: number; name: string; pointerSources?: StructPointerSource[]; }

function validateStructs(defs: StructDef[], maxDepth = 32): string[];
function structByteSize(def: StructDef, defs?: readonly StructDef[]): number;
function decodeStruct(def, baseAddr, getByte, endian, bitAllocation?, defs?): DecodedField[];
function parseStructText(text: string, defs?: readonly StructDef[]): ParseStructTextResult;
function fieldsToText(fields: StructField[], defs?: readonly StructDef[]): string;
function structToC(def: StructDef, defs?: readonly StructDef[]): string;
```

### 3. Contracts

- Struct definitions are global/shared; pins are per file/address.
- Field `count` is at least one. `isPointer` changes storage to pointer-width/address semantics while `type`/`refStructId` describe target.
- `normalizeStructField` handles legacy shapes before layout/decode.
- Natural layout aligns fields and total size unless `packed` is true. Nested definitions participate in size/alignment.
- Validation rejects missing names, invalid counts/types/references, illegal bitfield bases/widths, cycles, and nesting beyond `MAX_NESTED_DEPTH`.
- Bitfields use unsigned integer storage, declaration-order allocation, and cannot be arrays in imported C text.
- `decodeStruct` returns flattened typed rows with byte/bit metadata, data availability, pointer target metadata, and decoded values using shared endian.
- Missing bytes produce `hasData: false`; never decode them as zero.
- Text parser accepts supported fixed-width/common C scalar aliases, arrays, pointers, bit widths, qualifiers/comments, and typedef/struct wrappers. Unknown pointer targets degrade to `void*`; unknown non-pointer types error.
- `fieldsToText` and `parseStructText` round-trip supported fields; `structToC` emits padding comments/fields that explain aligned vs packed layout.
- Pin address input is full hexadecimal. Pin create/edit/remove functions are immutable and IDs are injected.
- Removing a definition removes dependent pins. Pointer-created pins reuse an existing target pin when identity matches, add source metadata once, and otherwise create a unique name.

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Unknown referenced struct | Validation error; no unsafe size/decode recursion. |
| Recursive/cyclic nesting or depth > 32 | Validation error. |
| Invalid count / duplicate or empty names | Validation error. |
| Bit width exceeds/overflows unsigned storage | Validation error. |
| Bitfield array in C text | Parse error. |
| Unknown pointer target | Normalize as `void*`. |
| Unknown direct field type | Parse error. |
| Missing mapped byte | `hasData: false`, UI `??`. |
| Pin address partial/non-hex/overflow | Reject (`null` from pin input parser). |
| Pointer target pin already exists | Reuse; deduplicate identical source metadata. |

### 5. Good/Base/Bad Cases

- Base: aligned `uint8` then `uint32` includes interior padding and aligned total size.
- Good: packed equivalent has no padding and exports a packed layout explanation.
- Good: known `Header*` retains target definition; unknown `VendorType*` becomes storage-only `void*`.
- Good: fields -> C-like text -> parse returns identical supported field model.
- Bad: renderer recalculates field alignment independently from `structByteSize`/decode.
- Bad: delete definition but leave pins referring to its ID.

### 6. Tests Required

- `src/test/core/struct.test.ts`: byte sizes, align/packed, validation/cycles/depth, nested arrays, endian decode, bitfields, pointers, path resolution, parser/text/C export round-trips.
- `src/test/webview/struct-pins-model.test.ts`: full address parsing, injected IDs, uniqueness, immutable edit/remove, dependent removal, pointer reuse/source dedupe.
- `src/test/webview/struct-ui.test.ts` plus `struct-instance-display.md`: visible rendering/action matrix.
- `src/test/core/provider-utils.test.ts`: legacy/global definition migration.

### 7. Wrong vs Correct

#### Wrong

```typescript
const size = fields.reduce((n, field) => n + fieldByteSize(field.type) * field.count, 0);
```

This ignores alignment, nested definitions, pointers, and bitfield storage grouping.

#### Correct

```typescript
const errors = validateStructs(defs);
if (errors.length === 0) {
    const size = structByteSize(def, defs);
    const rows = decodeStruct(def, base, getByte, endian, allocation, defs);
}
```

Codec is the deep layout/decode module; UI consumes its contract.
