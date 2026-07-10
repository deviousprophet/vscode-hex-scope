# Search, Selection, Inspector, and Byte Tools Code-Spec

## Scenario: Find, select, decode, analyze, and copy bytes

### 1. Scope / Trigger

Applies to `core/search.ts`, `webview/search/`, memory selection/drag behavior, Inspector, context commands/menu, and `core/byte-tools/`.

### 2. Signatures

```typescript
type SearchMode = 'bytes' | 'value' | 'ascii' | 'addr';
type SearchEndianness = 'auto' | 'be' | 'le';

class SearchEngine {
    search(req: SearchRequest, handlers: SearchHandlers): void;
    clear(): void;
}

function buildNeedles(mode, raw, endianness): number[][];
function canonicalizeQuery(mode: SearchMode, raw: string): string;
type SelectionRange = { start: number; end: number };
function selectedBytes(): number[];
function formatCopyCommand(cmd: CopyCommand, bytes: number[]): string;
function formatAnalyzeCommand(cmd: AnalyzeCommand, bytes: number[]): AnalyzeResult;
```

### 3. Contracts

- Empty/whitespace query completes with no matches.
- Search supports byte sequences, numeric values, ASCII, and direct address.
- Value mode honors Auto/LE/BE and may build multiple candidate needles where Auto requires it.
- Search is debounced, chunked across segments, streams progress, and uses a monotonically changing token so stale work cannot publish results.
- A changed query/mode cancels current work immediately; same completed query navigates existing matches.
- Search never bridges unmapped segment gaps.
- Selection ranges are inclusive and normalized. Shift-click/drag expands selection; context commands read bytes through the edit-aware byte accessor. `selectedBytes()` currently substitutes `0` for an unmapped address inside a spanning selection.
- Inspector decodes selected bytes using shared per-file endian and updates when selection, endian, or pending edits change.
- Copy commands are closed unions (`hex`, raw hex, binary, ASCII, decimal/hex arrays, Base64, decimal, C array). Analyze commands are validated before dispatch.
- Copy output is deterministic and context menu actions operate on the explicit current selection/target.

### 4. Validation & Error Matrix

| Condition | Behavior |
|---|---|
| Empty search | Clear matches; complete immediately. |
| Invalid bytes/value/address | No unsafe parse; show no match/input feedback through UI owner. |
| New query during chunked search | Cancel old token; old callbacks publish nothing. |
| Address `0` | Valid address, never treated as absent. |
| Match crosses segment gap | Reject. |
| Selection spans an unmapped byte | `selectedBytes()` contributes `0` for that address; keep this compatibility behavior explicit in copy/analyze tests. |
| Unknown copy/analyze command | Type guard rejects it. |
| 64-bit Inspector value | Preserve precision with `bigint` formatting. |

### 5. Good/Base/Bad Cases

- Base: byte query `DE AD BE EF` finds exact sequence in one segment and selects four bytes.
- Good: changing query while scanning cancels old results; first streamed current match may jump once, final match list remains current.
- Good: selected edited byte copies/decodes the edited value.
- Bad: concatenate all segments then search, producing matches across gaps.
- Bad: use `Number` for unsigned 64-bit Inspector values.

### 6. Tests Required

- Search: every mode, endian candidate construction, canonicalization, empty/invalid input, gap isolation, progress, cancellation/latest-token, match navigation.
- Selection: click, shift, drag, context target, inclusive range, edited/unmapped reads.
- Byte tools: every command format, ASCII substitutions, Base64, arrays, CRC/analyze outputs, invalid command guards.
- Inspector/UI assertions live in `src/test/webview/webview.test.ts`; formatting in `utils.test.ts`.

### 7. Wrong vs Correct

#### Wrong

```typescript
const bytes = segments.flatMap(s => s.data);
return findAll(bytes, needle); // loses addresses and bridges gaps
```

#### Correct

```typescript
engine.search({ segments, mode, raw, endianness }, handlers);
// scans each addressed segment, chunks work, cancels by token
```

Search engine is a deep module; UI owns query/navigation state, not scan mechanics.
