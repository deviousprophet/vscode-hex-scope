# Firmware Document Formats Code-Spec

## Scenario: Parse, display, edit, and repair IHEX/SREC documents and raw binary images

### 1. Scope / Trigger

Applies to `src/core/parser/`, `src/core/document.ts`, format handling in `HexEditorSession`, record view, and any change to Intel HEX or Motorola SREC semantics.

Data flow:

```text
file text -> detect format -> format parser -> ParseResult
          -> serialized protocol form -> records + mapped segments
edits -> format serializer -> rewritten data records + recomputed checksums

.bin bytes -> stored per-file base (bindings.json binBases) or 0 -> createBinParseResult
           -> one contiguous segment -> the same serialized protocol form
edits -> applyBinEdits -> raw buffer write (no records, no checksums)
```

### 2. Signatures

```typescript
type HexScopeTextFormat = 'ihex' | 'srec';
type HexScopeFormat = HexScopeTextFormat | 'bin';

function isTextFormat(format: HexScopeFormat): format is HexScopeTextFormat;
function isRawBinaryExtension(ext: string): boolean;
function detectFormatFromParts(ext: string, raw: string): HexScopeFormat;

function parseIntelHex(source: string): ParseResult;
function parseSRec(source: string): ParseResult;
function parseIntelHexCompact(source: string, options?: CompactParserOptions): Promise<CompactParseResult>;
function parseSRecCompact(source: string, options?: CompactParserOptions): Promise<CompactParseResult>;
function serializeIntelHex(raw: string, result: ParseResult, edits: Map<number, number>): string;
function serializeSRec(raw: string, result: ParseResult, edits: Map<number, number>): string;
function serializeIntelHexAsync(raw: string, result: ParseResult, edits: Map<number, number>, options?: WorkBudgetOptions): Promise<string>;
function serializeSRecAsync(raw: string, result: ParseResult, edits: Map<number, number>, options?: WorkBudgetOptions): Promise<string>;
function spliceEditedLines(raw: string, edits: Map<number, number>, format: HexScopeFormat): string;
function repairChecksums(raw: string, result: ParseResult): string;
function serializeCompactParseResult(result: CompactParseResult): SerializedCompactParseResult;
function hydrateCompactParseResult(payload: SerializedCompactParseResult): CompactParseResult;
function compactTransferList(payload: SerializedCompactParseResult): ArrayBuffer[];
function wireSegments(segments: MemorySegment[]): Array<{ startAddress: number; data: ArrayBuffer }>;

// Raw binary image (src/core/parser/binImage.ts)
const DEFAULT_BIN_BASE_ADDRESS = 0;
function parseBinBaseAddress(input: string, byteLength: number): { ok: true; value: number } | { ok: false; error: string };
function validateBinBaseAddressInput(input: string, byteLength: number): string | null;
function formatBinBaseAddress(value: number): string;             // 0x%08X
function isValidBinBaseAddress(value: unknown): value is number;  // 0..0xFFFFFFFF
function binAddressRangeFits(baseAddress: number, byteLength: number): boolean;
function createBinParseResult(bytes: Uint8Array, baseAddress: number): CompactParseResult;
function applyBinEdits(segment: MemorySegment, edits: ReadonlyMap<number, number>): { applied: Array<[number, number]>; previous: Array<[number, number]> };
function revertBinEdits(segment: MemorySegment, previous: ReadonlyArray<[number, number]>): void;
```

`ParseResult` owns `records`, checksum/malformed counts, contiguous valid `segments`, total bytes, and optional execution `startAddress`.

### 3. Contracts

- Recognized SREC extensions (`srec`, `mot`, `s19`, `s28`, `s37`) override content sniffing. Otherwise leading `S[0-9]` selects SREC; default is IHEX. A `bin` extension (case-insensitive) selects `'bin'` **before** any content sniffing, so a raw image whose bytes look like `:` or `S1` is never parsed as text.
- Parsers retain every nonblank source record, including malformed/checksum-invalid rows, for Record view and repair UI.
- Compact parsers retain every nonblank record as typed source-offset metadata, materializing record objects only for requested pages or edit/repair compatibility paths.
- `serializeCompactParseResult` / `hydrateCompactParseResult` are the cloneable bridge for the parse worker: the serialized result carries the typed record-metadata pages plus exact segment `ArrayBuffer` slices (`wireSegments`), `compactTransferList` returns every page + segment buffer for zero-copy `postMessage` transfer, and hydrate rebuilds a `CompactParseResult` whose `materialize()` round-trips against the same source. `wireSegments` is the one segment→wire projection shared with `serializeParseResult`.
- Async parsing and compact metadata construction scan in bounded batches without `split`, check cancellation, report monotonic parse/build progress, and yield within the configured 24 ms work budget.
- Only valid-checksum, non-malformed data records contribute to memory segments.
- Adjacent data records merge only when the next `resolvedAddress` equals current end; gaps create new segments.
- Segment assembly allocates typed buffers directly; boxed `number[]` accumulation is forbidden on the large-file path.
- IHEX supports data, EOF, extended segment/linear address, and start segment/linear records with required byte counts.
- SREC supports S0-S3 and S5-S9; S4 is reserved; S1/S2/S3 alone carry memory data; S7/S8/S9 provide execution start address.
- Serializers rewrite only affected valid data records. Preserve non-data records, blank lines, surrounding line whitespace, untouched lines, and original LF/CRLF style.
- Async serializers use the shared 24 ms work budget and yield between record batches on large edited documents; save flows must await them.
- Fast save: `buildSplicePlan(raw, edits, format)` scans lines with a minimal regex decode (no `HexRecord` materialize) and rebuilds only data records whose absolute address range overlaps the edit set (checksum recomputed). Returns `newRaw` + per-line byte `patches` (byte offsets); `spliceEditedLines` = `plan.newRaw`. The save path writes positionally (only patch ranges via `node:fs` fd) when the plan is ASCII/same-length safe, else falls back to a whole-file write. A few edits on a 70 MB file cost O(edits + split/join + one small write), not a full serialize/reparse.
- Assert reparsing serialized output produces expected bytes and zero new checksum errors.
- Empty edit maps return original text exactly.
- Checksum repair changes the final checksum byte of invalid, otherwise parseable records; malformed records remain unchanged.
- A trailing run of SUB (0x1A) — the legacy EOF marker some toolchains append — is stripped from the source before line splitting (`source.replace(/\u001A+$/, '')`) in the shared record layer, so it never becomes a record. Tolerance is read-only: no diagnostics, `malformedLines` unchanged, serializers keep the original bytes. A 0x1A not in the trailing position (mid-file, inside a record, SUB followed by trailing whitespace) is still a malformed line.
- **Raw binary**: `createBinParseResult(bytes, baseAddress)` is the only producer. It returns zero records (`CompactRecordStore.fromSerialized([], 0)`), zero checksum/malformed counts, no execution `startAddress`, and one segment `{ startAddress: baseAddress, data: bytes }` when the file is non-empty (zero segments for an empty file). The input `Uint8Array` is kept by identity — no copy.
- **Raw binary base resolution**: the effective base is the file's stored `binBases` entry (explicit `0` included) when `binAddressRangeFits(base, fileSize)` holds, else `0x00000000`. `effectiveBinBaseAddress` is that one predicate; `resolveOpenBinBaseAddress` and `resolveCompareBinBaseAddress` both return it and never prompt or write `.hexscope`. Only an explicit profile-bar field commit persists a new value (`saveBinBaseAddress` → `writeBinBase`) and rebuilds the parse result at that base; the file bytes and length never change, and no profile/binding is created.
- `parseBinBaseAddress` trims text and accepts an optional `0x`/`0X` prefix with 1–8 hex digits (case-insensitive). It rejects signs, separators, decimal-only conventions, values above `0xFFFFFFFF`, and `base + byteLength > 0x1_0000_0000`. `binAddressRangeFits` is the shared range predicate used by the field validation, the session loader, and the diff worker/reload path.
- `applyBinEdits` writes only integer byte values (`0..255`) at addresses inside the segment, records the prior bytes, and reports the applied pairs. Unmapped, non-integer, or out-of-range values are ignored; the segment length never changes. `revertBinEdits` restores exactly the recorded prior bytes after a failed write.
- `.bin` files never use `buildSplicePlan`, `spliceEditedLines`, `repairChecksums`, or the record serializers. HEX/SREC save and repair behavior is unchanged.

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Blank line | Skip; not malformed. |
| Trailing SUB (0x1A) run at EOF | Stripped pre-split; not malformed, no diagnostics. |
| Non-trailing 0x1A (mid-file, inside record, SUB + trailing whitespace) | Normal malformed error. |
| Missing start code / non-hex / short line | Record with `error`; increment `malformedLines`. |
| Length or required byte count mismatch | Record with precise error; exclude from segments. |
| Checksum mismatch | Keep record, increment `checksumErrors`, exclude from segments, allow quick repair. |
| Unknown IHEX type | Malformed error. |
| SREC S4 | `Reserved record type: S4`. |
| SREC count smaller than address + checksum | Malformed error. |
| Address gap | New segment, never zero-fill. |
| Edit address not owned by valid data record | Leave source unchanged at that address. |
| `.bin` file | Raw bytes; one segment at the effective per-file base (stored when it fits, else 0); zero records/checksum/malformed counts. |
| Empty `.bin` file | Zero segments, zero bytes; the editor opens at the effective base. |
| Base address + file size overflows `0xFFFFFFFF` | Stored value is ignored and the image maps at 0; field input is rejected with an inline error. |
| Bin edit at an unmapped address | Ignored by `applyBinEdits`; never grows the file. |

### 5. Good/Base/Bad Cases

- Base: one valid IHEX data record plus EOF yields one record-backed segment.
- Good: mixed S1/S2/S3 data retains 16/24/32-bit addresses and forms separate segments across gaps.
- Good: edit one byte in a whitespace-padded CRLF record; preserve whitespace/EOL and recompute record checksum.
- Bad: include checksum-invalid data in memory using its declared bytes.
- Bad: serialize the whole document from segments and lose headers, start records, comments/malformed lines, or record layout.

### 6. Tests Required

- `src/test/core/parser/ihex-parser.test.ts`, `srec-parser.test.ts`: line grammar, checksums, address modes, malformed cases, segment rules.
- `src/test/core/binImage.test.ts`: base parsing (0x/bare/uppercase/0/max, sign/empty/9 digits/file-size overflow), formatting, `isValidBinBaseAddress` / `binAddressRangeFits`, `createBinParseResult` (nonzero base, empty, zero records, byte identity, no start address), and edit apply/revert (mapped, unmapped, byte bounds, length preservation).
- Compact parser tests assert cancellation and cooperative yielding during source scan, segment assembly, and record-metadata compaction.
- `ihex-samples.test.ts`, `srec-samples.test.ts`: real multi-record fixtures, gaps, address widths, start addresses, cross-format equivalence.
- `src/test/core/providerUtils.test.ts`: format detection, `.bin`/`.BIN` overriding content sniffing, IHEX/SREC serialization, whitespace/EOL preservation, record preservation, checksum repair.
- Assert reparsing serialized output produces expected bytes and zero new checksum errors.

### 7. Wrong vs Correct

#### Wrong

```typescript
const segments = records.filter(isData).map(toSegment); // includes corrupt records
```

#### Correct

```typescript
const segments = buildContiguousSegments(records, isDataRecord);
// helper excludes malformed/checksum-invalid records and preserves gaps
```

Format-neutral consumers depend on this normalization seam; do not add format branches to Memory view.
