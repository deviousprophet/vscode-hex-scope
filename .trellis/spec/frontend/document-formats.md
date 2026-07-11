# Firmware Document Formats Code-Spec

## Scenario: Parse, display, edit, and repair IHEX/SREC documents

### 1. Scope / Trigger

Applies to `src/core/parser/`, `src/core/document.ts`, format handling in `HexEditorSession`, record view, and any change to Intel HEX or Motorola SREC semantics.

Data flow:

```text
file text -> detect format -> format parser -> ParseResult
          -> serialized protocol form -> records + mapped segments
edits -> format serializer -> rewritten data records + recomputed checksums
```

### 2. Signatures

```typescript
type HexScopeFormat = 'ihex' | 'srec';

function detectFormatFromParts(ext: string, raw: string): HexScopeFormat;
function parseIntelHex(source: string): ParseResult;
function parseSRec(source: string): ParseResult;
function parseIntelHexCompact(source: string, options?: CompactParserOptions): Promise<CompactParseResult>;
function parseSRecCompact(source: string, options?: CompactParserOptions): Promise<CompactParseResult>;
function serializeIntelHex(raw: string, result: ParseResult, edits: Map<number, number>): string;
function serializeSRec(raw: string, result: ParseResult, edits: Map<number, number>): string;
function repairChecksums(raw: string, result: ParseResult): string;
```

`ParseResult` owns `records`, checksum/malformed counts, contiguous valid `segments`, total bytes, and optional execution `startAddress`.

### 3. Contracts

- Recognized SREC extensions (`srec`, `mot`, `s19`, `s28`, `s37`) override content sniffing. Otherwise leading `S[0-9]` selects SREC; default is IHEX.
- Parsers retain every nonblank source record, including malformed/checksum-invalid rows, for Record view and repair UI.
- Compact parsers retain every nonblank record as typed source-offset metadata, materializing record objects only for requested pages or edit/repair compatibility paths.
- Async parsing and compact metadata construction scan in bounded batches without `split`, check cancellation, report monotonic parse/build progress, and yield within the configured 24 ms work budget.
- Only valid-checksum, non-malformed data records contribute to memory segments.
- Adjacent data records merge only when the next `resolvedAddress` equals current end; gaps create new segments.
- Segment assembly allocates typed buffers directly; boxed `number[]` accumulation is forbidden on the large-file path.
- IHEX supports data, EOF, extended segment/linear address, and start segment/linear records with required byte counts.
- SREC supports S0-S3 and S5-S9; S4 is reserved; S1/S2/S3 alone carry memory data; S7/S8/S9 provide execution start address.
- Serializers rewrite only affected valid data records. Preserve non-data records, blank lines, surrounding line whitespace, untouched lines, and original LF/CRLF style.
- Empty edit maps return original text exactly.
- Checksum repair changes the final checksum byte of invalid, otherwise parseable records; malformed records remain unchanged.

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Blank line | Skip; not malformed. |
| Missing start code / non-hex / short line | Record with `error`; increment `malformedLines`. |
| Length or required byte count mismatch | Record with precise error; exclude from segments. |
| Checksum mismatch | Keep record, increment `checksumErrors`, exclude from segments, allow quick repair. |
| Unknown IHEX type | Malformed error. |
| SREC S4 | `Reserved record type: S4`. |
| SREC count smaller than address + checksum | Malformed error. |
| Address gap | New segment, never zero-fill. |
| Edit address not owned by valid data record | Leave source unchanged at that address. |

### 5. Good/Base/Bad Cases

- Base: one valid IHEX data record plus EOF yields one record-backed segment.
- Good: mixed S1/S2/S3 data retains 16/24/32-bit addresses and forms separate segments across gaps.
- Good: edit one byte in a whitespace-padded CRLF record; preserve whitespace/EOL and recompute record checksum.
- Bad: include checksum-invalid data in memory using its declared bytes.
- Bad: serialize the whole document from segments and lose headers, start records, comments/malformed lines, or record layout.

### 6. Tests Required

- `src/test/core/parser/ihex-parser.test.ts`, `srec-parser.test.ts`: line grammar, checksums, address modes, malformed cases, segment rules.
- Compact parser tests assert cancellation and cooperative yielding during source scan, segment assembly, and record-metadata compaction.
- `ihex-samples.test.ts`, `srec-samples.test.ts`: real multi-record fixtures, gaps, address widths, start addresses, cross-format equivalence.
- `src/test/core/provider-utils.test.ts`: detection, IHEX/SREC serialization, whitespace/EOL preservation, record preservation, checksum repair.
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
