# Type and Validation Contracts

## Type Ownership

- `src/core/parser/types.ts`: host-side `HexRecord`, `MemorySegment`, `ParseResult`.
- `src/core/document.ts`: `HexScopeTextFormat` / `HexScopeFormat` (`'ihex' | 'srec' | 'bin'`) plus `isTextFormat` / `isRawBinaryExtension`; the widened format propagates to `SerializedParseResult` / `WireParseResult` and the diff protocol.
- `src/core/parser/binImage.ts`: raw-image base-address parsing/validation (`isValidBinBaseAddress`, `binAddressRangeFits`), formatting, parse-result construction (including the optional `baseAddress` carried through compact/wire serialization), and edit application/revert.
- `src/core/types.ts`: hydrated webview records/segments, `WireParseResult` binary boundary types, labels, search, memory rows, and overlay types.
- `src/webviewProtocol.ts`: exhaustive cross-runtime message unions (single-file editor), including the base-field pair (`focusBinBaseAddress` host→webview, `setBinBaseAddress { value }` webview→host).
- `src/webview/baseAddressChange.ts`: `baseAddressChangeRefusal(state)` (toast text or null) and `baseAddressFieldState(state)` (visible/disabled/tooltip) — the shared webview guards used by the field and the Base stat/command focus path.
- `src/hexScopeStorage.ts`: `BinBase` / `BindingTable` (the `bindings.json` payload: profile bindings plus per-file raw-binary bases).
- `src/diffProtocol.ts`: the diff panel's own host↔webview union + `diffMessageType`/`diffCopyText` parsers.
- Feature core modules own feature-specific unions/results: `IntegrityValidation<T>`, `SearchMode`, `PointerDerefTarget`, and overlay parse results.

## Boundary Pattern

External/persisted values start as `unknown`, are normalized once, then become typed. Examples:

- `normalizeIntegrityProfiles(value: unknown)`
- `normalizeIntegrityCheckSet(value: unknown)`
- `messageType(message: unknown)` plus `dispatchProviderMessage`
- `isDiffSide` / `isDiffModel` / `isDiffInit` for the diff protocol (structural, shallow — enough that hydration never throws on a malformed payload); `DIFF_FORMATS` accepts `ihex`, `srec`, and `bin`
- type-definition migration helpers in `HexEditorSession`
- `isCopyCommand` and `isAnalyzeCommand` for command strings

`TypeDef`/`TypeField` carry optional `endian?: 'le' | 'be'` and `allocation?: 'lsb' | 'msb'` overrides. Absent = inherit (field beats type beats nested parents beats global overlay); validation rejects any other value (`validateTypes` + types JSON schema enums). Legacy per-field `endian` annotations pass through `migrateTypeDefinitions` untouched — that key is a first-class override again, not stripped. Loaded defs stay lenient: normalization preserves the keys, pointers always resolve to the global overlay endian for value decode. `TypeDef.params?: TypeParam[]` (`{ name, kind: 'size', default? }`), `TypeField.countParam?: string`, and `TypeInstance.paramValues?: Record<string, number>` are additive and optional: absent keys keep the literal layout, so older data loads unchanged and no data-schema bump is needed. `resolveTypeParams`/`resolvedFieldCount` are the single resolution rule (instance value → default; missing = validation error, never 0/1), and `validateInstanceParamValues` is the instance-form boundary validator (positive safe integers only). `TypeField.hidden?: boolean` is a display-only flag: it normalizes/persists like the other optional keys (load is identity-preserving — a persisted `false` is kept; the editor omits `false` on save) and never influences size/decode/C. The bound profile's `showHiddenFields: boolean` is normalized once by `showHiddenFieldsOrDefault` (the shared boundary normalizer). `TypeBaseType` has a runtime mirror, `TYPE_BASE_TYPES` (exported from `src/core/types.ts`), asserted against `types.schema.json` by the drift-guard test; the schema stays syntax/shape-level, and cross-kind structural rules are runtime-only (`validateTypes`).

Use discriminated result unions for expected validation failures:

```typescript
type Validation<T> =
    | { ok: true; value: T }
    | { ok: false; error: string };
```

Callers must branch on `ok`; do not throw for user-correctable input.

## Protocol Rules

- Every message has a literal `type` discriminator.
- Add new message fields to the owning union, host sender/handler, webview dispatcher/applier, and tests in one change.
- A base-address commit is validated in the field (`parseBinBaseAddress`), then re-validated by the host (format, live bytes, range, pending reload) before `writeBinBase`. `focusBinBaseAddress` is passive in `webviewMessageModel`, and `postToActive` returns whether a panel received the request.
- Provider messages use exact `ArrayBuffer` segment payloads. `appModel.ts` is the single hydration boundary that wraps them in `Uint8Array`; browser feature code consumes only hydrated segments.
- Record-page request counts and 512-record alignment are validated by the host; responses and document summaries carry one generation owner.
- Unknown/malformed message types are ignored by `dispatchProviderMessage`, not cast and executed.

## Numeric and Address Rules

- Firmware addresses are unsigned 32-bit numbers unless a format-specific parser is working with its raw address field.
- Raw-binary base addresses are validated once at the persistence boundary: `isValidBinBaseAddress` accepts integer `0..0xFFFFFFFF`; `binAddressRangeFits(baseAddress, byteLength)` additionally requires `base + byteLength <= 0x1_0000_0000`. `normalizeBindingTable` drops invalid `binBases` entries through the same predicate, so persisted and field-committed values share one rule; the effective open/compare base uses the same range check.
- Validate user address input as full hexadecimal and check range before bitwise operations.
- Preserve `bigint` for 64-bit display/decode where precision matters.
- Selection and integrity ranges are inclusive.
- Never use truthiness to distinguish address `0` from missing address.

## Forbidden Patterns

- `any` or double assertions at protocol/persistence boundaries.
- Duplicated local shapes for a message already represented in `webviewProtocol.ts`.
- Casting persisted JSON directly to `IntegrityProfile[]`, `TypeDef[]`, or check sets.
- Treating `undefined` bytes as zero outside an explicitly documented compatibility seam. Core memory lookup preserves `undefined`; copy/analyze paths (`selectedBytes()`, keyboard `collectSelectedBytes()`) skip unmapped addresses instead of zero-filling.
- Converting 64-bit decoded values to `number` before formatting.
- Adding a discriminator without exhaustive map/set updates.

## Verification

- `npm run check-types`
- Protocol tests: `src/test/webview/webviewMessageModel.test.ts`
- Boundary tests: parser, integrity, overlay, and provider-utils suites under `src/test/core/`.
