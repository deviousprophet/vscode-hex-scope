# Type Definitions, Decode, Instances, and Persistence Code-Spec

## Scenario: Define C-like layouts and apply them to firmware addresses

### 1. Scope / Trigger

Applies to shared types, `core/overlay/overlayCodec.ts`, type editor/import/export, pin model, pointer-created pins, persistence/migration, and decode inputs. Row rendering details live in `overlay-instance-display.md`.

### 2. Signatures

```typescript
interface EnumEntry { name: string; value: number; }
interface BitFieldChild { name: string; bitWidth: number; refTypeId?: string; hidden?: boolean; } // refTypeId = optional enum ref; hidden = instance-view only
interface TypeField {
    name: string;
    type: TypeFieldType;          // scalar | 'struct' | 'bitfield' | 'enum'
    isPointer?: boolean;
    refTypeId?: string;           // target def for 'struct'/'bitfield'/'enum' fields
    bitFields?: BitFieldChild[];    // inline container children (authored form)
    count: number;
    endian?: 'le' | 'be';        // override; absent = inherit
    allocation?: 'lsb' | 'msb';  // override; absent = inherit (bit-field units)
    hidden?: boolean;            // instance-view only; absent/false = visible
}
interface TypeDef { id: string; name: string; fields: TypeField[]; packed?: boolean; endian?: 'le' | 'be'; allocation?: 'lsb' | 'msb';
                      kind?: 'struct' | 'bitfield' | 'enum'; // absent = plain struct
                      baseType?: 'uint8'|'uint16'|'uint32'|'uint64'; // storage width for kind:'bitfield'/'enum'
                      bitFields?: BitFieldChild[];                // kind:'bitfield' children (fields is [])
                      entries?: EnumEntry[]; }                    // kind:'enum' entries (fields is [])
interface TypeInstance { id: string; typeId: string; addr: number; name: string; pointerSources?: TypePointerSource[]; }
function matchEnumEntry(def: TypeDef, value: bigint): EnumEntry | undefined;
function formatEnumLabel(label: string, value: bigint, hexDigits: number): string;   // "NAME (0x<hexDigits digits>)"
function enumHexDigits(width: number): number;
function enumValueBound(baseType: string | undefined): number;

function typeDefKind(def: TypeDef): 'struct' | 'bitfield' | 'enum';  // absent kind = 'struct'
function materializeBitFieldRefs(def: TypeDef, defs?: readonly TypeDef[]): TypeDef;
function migrateInlineBitFields(defs: TypeDef[]): { defs: TypeDef[]; changed: boolean };
function validateTypes(defs: TypeDef[], maxDepth = 32): string[];
function typeByteSize(def: TypeDef, defs?: readonly TypeDef[]): number;
function decodeType(def, baseAddr, getByte, endian, bitAllocation?, defs?): DecodedField[];
function parseTypeText(text: string, defs?: readonly TypeDef[]): ParseTypeTextResult;
function fieldsToText(fields: TypeField[], defs?: readonly TypeDef[]): string;
function typeDefToC(def: TypeDef, defs?: readonly TypeDef[]): string;
```

### 3. Contracts

- Type definitions are global/shared; instances are per file/address.
- **Persisted key names**: `typeInstances` / `typeId` / `refTypeId` / `sourceTypeId` (data-schema v2). The back-compat read window is retired: the general readers (`normalizeTypeDefsValue`, `candidateTypeInstances`) accept only these keys. The pre-rename aliases (`structPins` / `structId` / `refStructId` / `sourceStructId`) are migration-internal — applied explicitly to the one-time legacy inputs only — see `hexscope-storage.md`; writers emit only the new names.
- Named types carry a `kind` discriminator on the def (`'struct'` default, `'bitfield'`, `'enum'`); a def without `kind` is a plain struct and loads/sizes/decodes exactly as before. A `kind: 'bitfield'` def owns `baseType` (unsigned) + `bitFields[]` and has `fields: []`. A field references it with `type: 'bitfield'` + `refTypeId`; the children/base width come from the def. Bit-field-in-bit-field nesting and bitfield pointers are rejected by validation.
- **Materialize seam**: authored defs keep the reference; `decodeType` / `typeByteSize` / `typeDefToC` (and `resolveTypeFieldByPath`) rewrite every `type: 'bitfield'` field into its inline container form (`baseType` + copied children, `refTypeId` cleared) via `materializeBitFieldRefs` before the size/decode/C paths run. Sizing, alignment, decoding, and C output are therefore byte-identical to the equivalent inline container; validation runs on the authored (referenced) form.
- **Inline → reusable migration**: `migrateInlineBitFields(defs)` rewrites every legacy inline bit-field container (non-pointer unsigned `type` + non-empty `bitFields[]`) into a `type: 'bitfield'` + `refTypeId` reference and appends the standalone `kind: 'bitfield'` defs. Pool-wide dedupe collapses identical containers (same base type + ordered child `{name,bitWidth}` list + each child's optional enum ref and hidden flag) onto one shared def — including pre-existing reusable defs with the same signature. Generated defs get the lowest unused `migrated_bitfield_<n>` id and a unique name derived from the first matching field; usage-scoped `count`/`endian`/`allocation`/`name` (plus any extra keys a legacy pool carries, e.g. a stale `hidden`) stay on the referencing field while `bitFields`/`bitFieldsCollapsed` are cleared. Idempotent (a second run returns `changed:false` and the same array reference); the migrated pool materializes back to the inline form so decode/size/C are byte-identical. `normalizeTypeDefsValue` runs it after identity dedupe and ORs its `changed` into the returned flag, so legacy pools self-heal once on load.

- A `kind: 'enum'` def owns `baseType` (unsigned) + `entries: { name, value }[]` and has `fields: []`. A scalar field references it with `type: 'enum'` + `refTypeId`; a bit-field child may carry its own `refTypeId` enum ref. Decode is **presentation-only**: `type: 'enum'` sizes/aligns as its base unsigned width (same materialize discipline) and the row carries an additive `DecodedField.enumLabel` (matched entry name); `bytesHex`/offset/endianness/allocation stay byte-identical to a plain integer of that width. `matchEnumEntry` + `formatEnumLabel` + `enumHexDigits` are the one shared label path — a matched value renders `NAME (0x<digits>)` where the digit count follows the value width (`enumHexDigits(bitWidth)` for a bit child, the field byte width for a scalar enum; no forced 2-digit minimum); unmatched (or non-default display mode) falls back to numeric; used by scalar enum rows and enum-ref bit children. `enumValueBound` (exported) is the single base-width→value-bound map shared by `overlayNormalization` and validation. Enum pointers are rejected (like bit-field pointers).

- A field whose type references a reusable `kind: 'bitfield'` type may carry a per-field `allocation` override; this usage-scoped control is the **only** editor path that authors `allocation` (the pure-struct field grid stays allocation-free). The override lives on the referencing `TypeField`, never on the def.
- **Def-level C preview**: `typeDefToC` emits the typedef of a plain-struct def as before. A `kind: 'bitfield'` def previews as `typedef struct { <children as bitfields> } Name;` over its storage unit, and a `kind: 'enum'` def previews as `typedef enum { NAME = 0x... } Name;` sized to its base width. A referencing field's C output is produced through materialization, so it is byte-identical to the equivalent inline container.
- **Schema scope**: `types.schema.json` is syntax/shape-level only (keys, enums, `required`, `additionalProperties`). Cross-kind structural rules — kind ↔ `baseType`/`fields`/`bitFields`/`entries` coupling, reference resolution, and width bounds — are runtime-only, enforced by `validateTypes` (kept in sync by the drift-guard test). The optional `hidden` key is declared on **both** `typeField` and `bitFieldChild` (each object is `additionalProperties: false`, so it must be listed explicitly).

> **Gotcha**: a `kind: 'bitfield'` def's own optional `endian`/`allocation` keys pass schema/validation but are **not** applied by `materializeBitFieldRefs` — usage-scoped overrides live on the referencing `TypeField`. Do not add def-level bitfield defaults without defining precedence. Also, sizing a `kind: 'bitfield'` def **directly** returns `0` (its `fields` is `[]`): always size/decode through a referencing field, and keep non-`'struct'` kinds out of `pinnableTypes()` / pin-card creation.
- Field `count` is at least one and has **no upper cap** — the struct editor accepts any positive integer (element count is layout metadata, never allocated up front). Validators only reject `count < 1` / non-integer. Keep it that way: do not reintroduce a hard clamp (e.g. `Math.min(v, 256)`) in editor or parser paths. `isPointer` changes storage to pointer-width/address semantics while `type`/`refTypeId` describe target.
- `normalizeTypeField` handles legacy shapes before layout/decode. The optional `endian`/`allocation` keys pass through every normalizer untouched (identity metadata, not dropped). The optional `hidden` display flag likewise passes through unchanged: **load is identity-preserving** (a persisted `hidden:false` is kept as-is — no self-heal rewrite), while the **editor omits `false` on save** so saved pools stay minimal (absent = visible). `hidden` is **instance-view only** — it never affects size, offsets, decode, address math, or the C preview. Legacy inline-container migration keeps `hidden` on the referencing field via the same usage-scoped pass-through.
- A `BitFieldChild` carries the same optional `hidden` flag (`hidden?: boolean`; absent/false = visible) with the same discipline: preserved identity on load, an explicit `false` dropped by `sanitizeBitChild` (the bit-child counterpart of `normalizeOptionalFieldFlags`), and instance-view only. It is **def-level** — authored on the reusable `kind: 'bitfield'` type (or a legacy inline container) so hiding a bit hides it in every referencing type; there is no per-usage override. Materialization spreads the child, so `hidden` survives the `type:'bitfield'` → inline-container rewrite and the pin-safe `withoutBitChildRef` strip (both `...rest`), keeping decode/size/C byte-identical. The render seam drops a hidden child's row (see `overlay-instance-display.md`); a container with all children hidden still renders its header row.
- `decodeType` resolves both concerns per field as `field.<x> ?? containing-type.<x> ?? nested parents.<x> ?? global` (first explicit value up the chain wins; field beats type beats global) — combined with global `endian` + `bitFieldAllocation`. Bit-field unit reads use effective `endian`; child packing uses effective `allocation`. **Pointer values always decode with the global overlay endian** regardless of overrides. Overrides affect value interpretation only — never offsets/sizes/alignment.
- Legacy per-field `endian` annotations pass through `migrateTypeDefinitions` untouched (first-class override again, not stripped); absent keys = inherit = prior behavior.
- Natural layout aligns fields and total size unless `packed` is true. Nested definitions participate in size/alignment.
- Validation rejects missing names, duplicate field names (same type, same level), invalid counts/types/references, illegal bitfield bases/widths, cycles, and nesting beyond `MAX_NESTED_DEPTH`.
- Bitfields use unsigned integer storage, declaration-order allocation, and cannot be arrays in imported C text.
- `decodeType` returns flattened typed rows with byte/bit metadata, data availability, pointer target metadata, resolved `endian`/`allocation`, and decoded values.
- Missing bytes produce `hasData: false`; never decode them as zero.
- Text parser accepts supported fixed-width/common C scalar aliases, arrays, pointers, bit widths, qualifiers/comments, and typedef/struct wrappers. Unknown pointer targets degrade to `void*`; unknown non-pointer types error.
- `fieldsToText` and `parseTypeText` round-trip supported fields; `typeDefToC` emits padding comments/fields that explain aligned vs packed layout.
- Pin address input is full hexadecimal. Pin create/edit/remove functions are immutable and IDs are injected.
- Pointer-created pins reuse an existing target pin when identity matches, add source metadata once, and otherwise create a unique name.
- Deleting a struct type is safe across the shared workspace pool: the host scans `typeInstances[]` in **every** registry profile (not just the open file's bound profile); when any pin references the type, a modal confirm names the pin count + affected-profile count + the pool's referencing-field count (`countTypeFieldRefs`, i.e. fields/bit-children whose `refTypeId` the deletion will strip), and on confirm the pool entry **and** the orphaned pins are removed from every affected profile. All orphan references across the pool are stripped regardless of kind (nested `type:'struct'`, reusable bit-field, enum, and bit-child enum refs). A declined delete writes nothing (webview is reverted).

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Unknown referenced type | Validation error; no unsafe size/decode recursion. |
| Recursive/cyclic nesting or depth > 32 | Validation error. |
| Invalid count / duplicate or empty names | Validation error. |
| Bit width exceeds/overflows unsigned storage | Validation error. |
| Bitfield ref to unknown/non-bitfield type, bitfield pointer, bitfield + inline children | Validation error. |
| `kind: 'bitfield'` def with non-unsigned base, empty children, over-width children, or non-empty `fields` | Validation error. |
| Enum ref to unknown/non-enum type, or an enum pointer | Validation error. |
| `kind: 'enum'` def with non-unsigned base, non-empty `fields`, or an entry outside the base width | **Authoring** error (inline, blocks Save; no silent wraparound). |
| Enum entry value outside the base width on load | **Defensive drop/sanitize** so load never breaks (runtime, not a schema rule). |
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
- Bad: renderer recalculates field alignment independently from `typeByteSize`/decode.
- Bad: delete definition but leave pins referring to its ID.

### 6. Tests Required

- `src/test/core/typeDef.test.ts`: byte sizes, align/packed, validation/cycles/depth, nested arrays, endian decode, per-field/per-type endian+allocation overrides (precedence, nested inherit, pointer-global, bitfield unit/child), bitfields, pointers, path resolution, parser/text/C export round-trips, enum sizing/decode (presentation-only, byte-identical to an integer of the base width), enum label formatting (matched/unmatched), enum C preview, inline→reusable migration (dedupe, idempotence, decode/size/C byte-identical).
- `src/test/core/overlayNormalization.test.ts`: clean pools preserved (identity, no spurious self-heal); inline bit-field migration (shared def per signature, override preservation, second-run no-op, reuse of an existing signature); a legacy inline bit-child enum ref aliased explicitly on the migration path before the container migration (no stale key re-emitted); a negative test proving the general reader no longer aliases pre-rename refs; enum entry range sanitization; dangling scalar enum / bit-child enum refs handled without breaking load; bit-child `hidden` round-trip (kept, explicit `false` dropped, old pool unchanged, migration keeps containers that differ only by it distinct).
- `src/test/webview/overlayInstancesModel.test.ts`: full address parsing, injected IDs, uniqueness, immutable edit/remove, dependent removal, pointer reuse/source dedupe.
- `src/test/webview/overlayPanel.test.ts` plus `overlay-instance-display.md`: visible rendering/action matrix.
- `src/test/core/provider-utils.test.ts`: legacy/global definition migration.

### 7. Wrong vs Correct

#### Wrong

```typescript
const size = fields.reduce((n, field) => n + fieldByteSize(field.type) * field.count, 0);
```

This ignores alignment, nested definitions, pointers, and bitfield storage grouping.

#### Correct

```typescript
const errors = validateTypes(defs);
if (errors.length === 0) {
    const size = typeByteSize(def, defs);
    const rows = decodeType(def, base, getByte, endian, allocation, defs);
}
```

Codec is the deep layout/decode module; UI consumes its contract.

### Design Decision: duplicate field names rejected at validation

**Context**: decode walks `def.fields` by offset/index (`decodeTypeRecursive`, `src/core/overlay/overlayCodec.ts`) so duplicates decoded correctly, but the display layer re-resolves each row-group's declaration by **name** — `groupRowsByBase` → `describeFieldGroup` → `resolveTypeFieldByPath` → `findTypeField` (first name match, `overlayPanel.ts`). Two same-named fields in one type therefore corrupted every duplicate group's header (type/size/count from the *first* declaration) while bytes/expanded rows stayed correct.

**Options considered**:
1. Renderer disambiguation (could fix pre-saved defs, keep duplicates legal; more display surface).
2. Reject duplicates in `validateTypes` (matches C semantics, minimal surface).

**Decision**: Option 2. Same-type same-level field names are a validation error (`Type "<name>": duplicate field name "<name>".`). Nested reuse (same name under different parents) and cross-def reuse remain valid because those groups resolve through full dotted-path keys. Pre-saved defs with duplicates keep current behavior until re-saved (then blocked) — accepted.

**Extensibility**: any future def writer must route through `validateTypes`; the editor save path (`overlayPanel.ts:1497`) already gates on its errors.
