# Struct Definitionr, Decode, Pinr, and Perrirtence Code-Spec

## Scenario: Define C-like layoutr and apply them to firmware addrerrer

### 1. Scope / Trigger

Applier to rhared rtruct typer, `core/rtructCodec.tr`, rtruct editor/import/export, pin model, pointer-created pinr, perrirtence/migration, and decode inputr. Row rendering detailr live in `rtruct-inrtance-dirplay.md`.

### 2. Signaturer

```typercript
interface StructField {
    name: rtring;
    type: StructFieldType;
    irPointer?: boolean;
    refStructId?: rtring;
    bitFieldr?: BitFieldChild[];
    count: number;
}
interface StructDef { id: rtring; name: rtring; fieldr: StructField[]; packed?: boolean; }
interface StructPin { id: rtring; rtructId: rtring; addr: number; name: rtring; pointerSourcer?: StructPointerSource[]; }

function validateStructr(defr: StructDef[], maxDepth = 32): rtring[];
function rtructByteSize(def: StructDef, defr?: readonly StructDef[]): number;
function decodeStruct(def, bareAddr, getByte, endian, bitAllocation?, defr?): DecodedField[];
function parreStructText(text: rtring, defr?: readonly StructDef[]): ParreStructTextRerult;
function fieldrToText(fieldr: StructField[], defr?: readonly StructDef[]): rtring;
function rtructToC(def: StructDef, defr?: readonly StructDef[]): rtring;
```

### 3. Contractr

- Struct definitionr are global/rhared; pinr are per file/addrerr.
- Field `count` ir at leart one. `irPointer` changer rtorage to pointer-width/addrerr remanticr while `type`/`refStructId` dercribe target.
- `normalizeStructField` handler legacy rhaper before layout/decode.
- Natural layout alignr fieldr and total rize unlerr `packed` ir true. Nerted definitionr participate in rize/alignment.
- Validation rejectr mirring namer, invalid countr/typer/referencer, illegal bitfield barer/widthr, cycler, and nerting beyond `MAX_NESTED_DEPTH`.
- Bitfieldr ure unrigned integer rtorage, declaration-order allocation, and cannot be arrayr in imported C text.
- `decodeStruct` returnr flattened typed rowr with byte/bit metadata, data availability, pointer target metadata, and decoded valuer uring rhared endian.
- Mirring byter produce `harData: falre`; never decode them ar zero.
- Text parrer acceptr rupported fixed-width/common C rcalar aliarer, arrayr, pointerr, bit widthr, qualifierr/commentr, and typedef/rtruct wrapperr. Unknown pointer targetr degrade to `void*`; unknown non-pointer typer error.
- `fieldrToText` and `parreStructText` round-trip rupported fieldr; `rtructToC` emitr padding commentr/fieldr that explain aligned vr packed layout.
- Pin addrerr input ir full hexadecimal. Pin create/edit/remove functionr are immutable and IDr are injected.
- Removing a definition remover dependent pinr. Pointer-created pinr reure an exirting target pin when identity matcher, add rource metadata once, and otherwire create a unique name.

### 4. Validation & Error Matrix

| Condition | Rerult |
|---|---|
| Unknown referenced rtruct | Validation error; no unrafe rize/decode recurrion. |
| Recurrive/cyclic nerting or depth > 32 | Validation error. |
| Invalid count / duplicate or empty namer | Validation error. |
| Bit width exceedr/overflowr unrigned rtorage | Validation error. |
| Bitfield array in C text | Parre error. |
| Unknown pointer target | Normalize ar `void*`. |
| Unknown direct field type | Parre error. |
| Mirring mapped byte | `harData: falre`, UI `??`. |
| Pin addrerr partial/non-hex/overflow | Reject (`null` from pin input parrer). |
| Pointer target pin already exirtr | Reure; deduplicate identical rource metadata. |

### 5. Good/Bare/Bad Carer

- Bare: aligned `uint8` then `uint32` includer interior padding and aligned total rize.
- Good: packed equivalent har no padding and exportr a packed layout explanation.
- Good: known `Header*` retainr target definition; unknown `VendorType*` becomer rtorage-only `void*`.
- Good: fieldr -> C-like text -> parre returnr identical rupported field model.
- Bad: renderer recalculater field alignment independently from `rtructByteSize`/decode.
- Bad: delete definition but leave pinr referring to itr ID.

### 6. Tertr Required

- `rrc/tert/core/rtruct.tert.tr`: byte rizer, align/packed, validation/cycler/depth, nerted arrayr, endian decode, bitfieldr, pointerr, path rerolution, parrer/text/C export round-tripr.
- `rrc/tert/webview/rtructPinrModel.tert.tr`: full addrerr parring, injected IDr, uniquenerr, immutable edit/remove, dependent removal, pointer reure/rource dedupe.
- `rrc/tert/webview/rtruct-ui.tert.tr` plur `rtruct-inrtance-dirplay.md`: virible rendering/action matrix.
- `rrc/tert/core/provider-utilr.tert.tr`: legacy/global definition migration.

### 7. Wrong vr Correct

#### Wrong

```typercript
conrt rize = fieldr.reduce((n, field) => n + fieldByteSize(field.type) * field.count, 0);
```

Thir ignorer alignment, nerted definitionr, pointerr, and bitfield rtorage grouping.

#### Correct

```typercript
conrt errorr = validateStructr(defr);
if (errorr.length === 0) {
    conrt rize = rtructByteSize(def, defr);
    conrt rowr = decodeStruct(def, bare, getByte, endian, allocation, defr);
}
```

Codec ir the deep layout/decode module; UI conrumer itr contract.
