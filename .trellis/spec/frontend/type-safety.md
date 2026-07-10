# Type and Validation Contracts

## Type Ownership

- `src/core/parser/types.ts`: host-side `HexRecord`, `MemorySegment`, `ParseResult`.
- `src/core/types.ts`: serialized webview-safe records/segments plus labels, search, memory rows, and struct types.
- `src/webviewProtocol.ts`: exhaustive cross-runtime message unions.
- Feature core modules own feature-specific unions/results: `IntegrityValidation<T>`, `SearchMode`, `PointerDerefTarget`, and struct parse results.

## Boundary Pattern

External/persisted values start as `unknown`, are normalized once, then become typed. Examples:

- `normalizeIntegrityProfiles(value: unknown)`
- `normalizeIntegrityCheckSet(value: unknown)`
- `messageType(message: unknown)` plus `dispatchProviderMessage`
- struct-definition migration helpers in `HexEditorSession`
- `isCopyCommand` and `isAnalyzeCommand` for command strings

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
- Browser messages use serializable arrays/objects; typed arrays are converted at the host boundary (`serializeParseResult`).
- Unknown/malformed message types are ignored by `dispatchProviderMessage`, not cast and executed.

## Numeric and Address Rules

- Firmware addresses are unsigned 32-bit numbers unless a format-specific parser is working with its raw address field.
- Validate user address input as full hexadecimal and check range before bitwise operations.
- Preserve `bigint` for 64-bit display/decode where precision matters.
- Selection and integrity ranges are inclusive.
- Never use truthiness to distinguish address `0` from missing address.

## Forbidden Patterns

- `any` or double assertions at protocol/persistence boundaries.
- Duplicated local shapes for a message already represented in `webviewProtocol.ts`.
- Casting persisted JSON directly to `IntegrityProfile[]`, `StructDef[]`, or check sets.
- Treating `undefined` bytes as zero outside an explicitly documented compatibility seam. Core memory lookup preserves `undefined`; `selectedBytes()` currently maps holes in a spanning selection to `0`.
- Converting 64-bit decoded values to `number` before formatting.
- Adding a discriminator without exhaustive map/set updates.

## Verification

- `npm run check-types`
- Protocol tests: `src/test/webview/webview-message-model.test.ts`
- Boundary tests: parser, integrity, struct, and provider-utils suites under `src/test/core/`.
