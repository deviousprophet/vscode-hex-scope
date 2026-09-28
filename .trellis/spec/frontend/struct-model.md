# Struct Definitions, Decode, Pins, and Persistence Code-Spec

## Scenario: Define C-like layouts and apply them to firmware addresses

### 1. Scope / Trigger

Applies to shared struct types, `core/structCodec.ts`, struct editor/import/export, pin model, pointer-created pins, persistence/migration, and decode inputs. Row rendering details live in `struct-instance-display.md`.

### 2. Signatures

```typescript
interface EnumEntry { name: string; value: number; }
interface BitFieldChild { name: string; bitWidth: number; refStructId?: string; } // refStructId = optional enum ref
interface StructField {
    name: string;
    type: StructFieldType;          // scalar | 'struct' | 'bitfield' | 'enum'
    isPointer?: boolean;
    refStructId?: string;           // target def for 'struct'/'bitfield'/'enum' fields
    bitFields?: BitFieldChild[];    // inline container children (authored form)
    count: number;
    endian?: 'le' | 'be';        // override; absent = inherit
    allocation?: 'lsb' | 'msb';  // override; absent = inherit (bit-field units)
}
interface StructDef { id: string; name: string; fields: StructField[]; packed?: boolean; endian?: 'le' | 'be'; allocation?: 'lsb' | 'msb';
                      kind?: 'struct' | 'bitfield' | 'enum'; // absent = plain struct
                      baseType?: 'uint8'|'uint16'|'uint32'|'uint64'; // storage width for kind:'bitfield'/'enum'
                      bitFields?: BitFieldChild[];                // kind:'bitfield' children (fields is [])
                      entries?: EnumEntry[]; }                    // kind:'enum' entries (fields is [])
interface StructPin { id: string; structId: string; addr: number; name: string; pointerSources?: StructPointerSource[]; }
function matchEnumEntry(def: StructDef, value: bigint): EnumEntry | undefined;
function formatEnumLabel(label: string, value: bigint, hexDigits: number): string;   // "NAME (0xNN)"
function enumHexDigits(width: number): number;
function enumValueBound(baseType: string | undefined): number;

function structDefKind(def: StructDef): 'struct' | 'bitfield' | 'enum';  // absent kind = 'struct'
function materializeBitFieldRefs(def: StructDef, defs?: readonly StructDef[]): StructDef;
function migrateInlineBitFields(defs: StructDef[]): { defs: StructDef[]; changed: boolean };
function validateStructs(defs: StructDef[], maxDepth = 32): string[];
function structByteSize(def: StructDef, defs?: readonly StructDef[]): number;
function decodeStruct(def, baseAddr, getByte, endian, bitAllocation?, defs?): DecodedField[];
function parseStructText(text: string, defs?: readonly StructDef[]): ParseStructTextResult;
function fieldsToText(fields: StructField[], defs?: readonly StructDef[]): string;
function structToC(def: StructDef, defs?: readonly StructDef[]): string;
```

### 3. Contracts

- Struct definitions are global/shared; pins are per file/address.
- Named types carry a `kind` discriminator on the def (`'struct'` default, `'bitfield'`, `'enum'`); a def without `kind` is a plain struct and loads/sizes/decodes exactly as before. A `kind: 'bitfield'` def owns `baseType` (unsigned) + `bitFields[]` and has `fields: []`. A field references it with `type: 'bitfield'` + `refStructId`; the children/base width come from the def. Bit-field-in-bit-field nesting and bitfield pointers are rejected by validation.
- **Materialize seam**: authored defs keep the reference; `decodeStruct` / `structByteSize` / `structToC` (and `resolveStructFieldByPath`) rewrite every `type: 'bitfield'` field into its inline container form (`baseType` + copied children, `refStructId` cleared) via `materializeBitFieldRefs` before the size/decode/C paths run. Sizing, alignment, decoding, and C output are therefore byte-identical to the equivalent inline container; validation runs on the authored (referenced) form.
- **Inline → reusable migration**: `migrateInlineBitFields(defs)` rewrites every legacy inline bit-field container (non-pointer unsigned `type` + non-empty `bitFields[]`) into a `type: 'bitfield'` + `refStructId` reference and appends the standalone `kind: 'bitfield'` defs. Pool-wide dedupe collapses identical containers (same base type + ordered child `{name,bitWidth}` list + each child's optional enum ref) onto one shared def — including pre-existing reusable defs with the same signature. Generated defs get the lowest unused `migrated_bitfield_<n>` id and a unique name derived from the first matching field; usage-scoped `count`/`endian`/`allocation`/`name` (plus any extra keys a legacy pool carries, e.g. a stale `hidden`) stay on the referencing field while `bitFields`/`bitFieldsCollapsed` are cleared. Idempotent (a second run returns `changed:false` and the same array reference); the migrated pool materializes back to the inline form so decode/size/C are byte-identical. `normalizeStructDefsValue` runs it after identity dedupe and ORs its `changed` into the returned flag, so legacy pools self-heal once on load.

- A `kind: 'enum'` def owns `baseType` (unsigned) + `entries: { name, value }[]` and has `fields: []`. A scalar field references it with `type: 'enum'` + `refStructId`; a bit-field child may carry its own `refStructId` enum ref. Decode is **presentation-only**: `type: 'enum'` sizes/aligns as its base unsigned width (same materialize discipline) and the row carries an additive `DecodedField.enumLabel` (matched entry name); `bytesHex`/offset/endianness/allocation stay byte-identical to a plain integer of that width. `matchEnumEntry` + `formatEnumLabel` + `enumHexDigits` are the one shared label path — matched `NAME (0xNN)`, unmatched (or non-default display mode) falls back to numeric; used by scalar enum rows and enum-ref bit children. `enumValueBound` (exported) is the single base-width→value-bound map shared by `structNormalization` and validation. Enum pointers are rejected (like bit-field pointers).

> **Gotcha**: a `kind: 'bitfield'` def's own optional `endian`/`allocation` keys pass schema/validation but are **not** applied by `materializeBitFieldRefs` — usage-scoped overrides live on the referencing `StructField`. Do not add def-level bitfield defaults without defining precedence. Also, sizing a `kind: 'bitfield'` def **directly** returns `0` (its `fields` is `[]`): always size/decode through a referencing field, and keep non-`'struct'` kinds out of `pinnableStructs()` / pin-card creation.
- Field `count` is at least one and has **no upper cap** — the struct editor accepts any positive integer (element count is layout metadata, never allocated up front). Validators only reject `count < 1` / non-integer. Keep it that way: do not reintroduce a hard clamp (e.g. `Math.min(v, 256)`) in editor or parser paths. `isPointer` changes storage to pointer-width/address semantics while `type`/`refStructId` describe target.
- `normalizeStructField` handles legacy shapes before layout/decode. The optional `endian`/`allocation` keys pass through every normalizer untouched (identity metadata, not dropped).
- `decodeStruct` resolves both concerns per field as `field.<x> ?? containing-struct.<x> ?? nested parents.<x> ?? global` (first explicit value up the chain wins; field beats struct beats global) — combined with global `endian` + `bitFieldAllocation`. Bit-field unit reads use effective `endian`; child packing uses effective `allocation`. **Pointer values always decode with the global overlay endian** regardless of overrides. Overrides affect value interpretation only — never offsets/sizes/alignment.
- Legacy per-field `endian` annotations pass through `migrateStructDefinitions` untouched (first-class override again, not stripped); absent keys = inherit = prior behavior.
- Natural layout aligns fields and total size unless `packed` is true. Nested definitions participate in size/alignment.
- Validation rejects missing names, duplicate field names (same struct, same level), invalid counts/types/references, illegal bitfield bases/widths, cycles, and nesting beyond `MAX_NESTED_DEPTH`.
- Bitfields use unsigned integer storage, declaration-order allocation, and cannot be arrays in imported C text.
- `decodeStruct` returns flattened typed rows with byte/bit metadata, data availability, pointer target metadata, resolved `endian`/`allocation`, and decoded values.
- Missing bytes produce `hasData: false`; never decode them as zero.
- Text parser accepts supported fixed-width/common C scalar aliases, arrays, pointers, bit widths, qualifiers/comments, and typedef/struct wrappers. Unknown pointer targets degrade to `void*`; unknown non-pointer types error.
- `fieldsToText` and `parseStructText` round-trip supported fields; `structToC` emits padding comments/fields that explain aligned vs packed layout.
- Pin address input is full hexadecimal. Pin create/edit/remove functions are immutable and IDs are injected.
- Pointer-created pins reuse an existing target pin when identity matches, add source metadata once, and otherwise create a unique name.
- Deleting a struct type is safe across the shared workspace pool: the host scans `structPins[]` in **every** registry profile (not just the open file's bound profile); when any pin references the type, a modal confirm names the pin count + affected-profile count, and on confirm the pool entry **and** the orphaned pins are removed from every affected profile. A declined delete writes nothing (webview is reverted).

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Unknown referenced struct | Validation error; no unsafe size/decode recursion. |
| Recursive/cyclic nesting or depth > 32 | Validation error. |
| Invalid count / duplicate or empty names | Validation error. |
| Bit width exceeds/overflows unsigned storage | Validation error. |
| Bitfield ref to unknown/non-bitfield type, bitfield pointer, bitfield + inline children | Validation error. |
| `kind: 'bitfield'` def with non-unsigned base, empty children, over-width children, or non-empty `fields` | Validation error. |
| Enum ref to unknown/non-enum type, or an enum pointer | Validation error. |
| `kind: 'enum'` def with non-unsigned base, non-empty `fields`, or an entry outside the base width | Validation error (no silent wraparound). |
| Dangling scalar enum field ref on load | Field dropped (load never breaks). |
| Dangling bit-child enum ref on load | Ref cleared, child kept. |
| Deleting a referenced type | Pin-safe flow; orphan pins removed and referencing fields stripped. |
| `endian` / `allocation` value outside `'le'/'be'` / `'lsb'/'msb'` | Validation error (field or def); schema enum. |
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

- `src/test/core/struct.test.ts`: byte sizes, align/packed, validation/cycles/depth, nested arrays, endian decode, per-field/per-struct endian+allocation overrides (precedence, nested inherit, pointer-global, bitfield unit/child), bitfields, pointers, path resolution, parser/text/C export round-trips, enum sizing/decode (presentation-only, byte-identical to an integer of the base width), enum label formatting (matched/unmatched), enum C preview, inline→reusable migration (dedupe, idempotence, decode/size/C byte-identical).
- `src/test/core/structNormalization.test.ts`: clean pools preserved (identity, no spurious self-heal); inline bit-field migration (shared def per signature, override preservation, second-run no-op, reuse of an existing signature); enum entry range sanitization; dangling scalar enum / bit-child enum refs handled without breaking load.
- `src/test/webview/structPinsModel.test.ts`: full address parsing, injected IDs, uniqueness, immutable edit/remove, dependent removal, pointer reuse/source dedupe.
- `src/test/webview/structPanel.test.ts` plus `struct-instance-display.md`: visible rendering/action matrix.
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

### Design Decision: duplicate field names rejected at validation

**Context**: decode walks `def.fields` by offset/index (`decodeStructRecursive`, `src/core/structCodec.ts`) so duplicates decoded correctly, but the display layer re-resolves each row-group's declaration by **name** — `groupRowsByBase` → `describeStructGroup` → `resolveStructFieldByPath` → `findStructField` (first name match, `structPanel.ts`). Two same-named fields in one struct therefore corrupted every duplicate group's header (type/size/count from the *first* declaration) while bytes/expanded rows stayed correct.

**Options considered**:
1. Renderer disambiguation (could fix pre-saved defs, keep duplicates legal; more display surface).
2. Reject duplicates in `validateStructs` (matches C semantics, minimal surface).

**Decision**: Option 2. Same-struct same-level field names are a validation error (`Struct "<name>": duplicate field name "<name>".`). Nested reuse (same name under different parents) and cross-def reuse remain valid because those groups resolve through full dotted-path keys. Pre-saved defs with duplicates keep current behavior until re-saved (then blocked) — accepted.

**Extensibility**: any future def writer must route through `validateStructs`; the editor save path (`structPanel.ts:1497`) already gates on its errors.
