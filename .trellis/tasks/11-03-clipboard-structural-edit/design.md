# Design - Full copy, cut, and paste for hex memory

## 1. Problem shape

The current editor model is a **byte overlay**:

- `S.parseResult.segments` holds the saved document (address -> bytes).
- `S.edits: Map<number, number>` stages byte replacements.
- Save sends `saveEdits { edits }`; the host splices only the affected record
  lines, so the file length can never change.
- `S.undoStack` holds arrays of `[address, priorValue]` transactions.

Cut, insert, and length-changing replace cannot be expressed as an address
overlay because bytes after the edit move to new addresses and the file length
changes. The design adds a second, still-address-based, edit layer:
**structural segment edits**.

## 2. Boundaries and ownership

| Concern | Owner |
|---|---|
| Segment insert/delete/replace math and inverse patches | `src/core/structural.ts` (new, runtime-neutral) |
| Rebuilding IHEX/SREC text from segments | `src/core/document.ts` (`rebuildTextDocument`, new) |
| Clipboard parsing and paste text formats | `src/webview/pasteUtils.ts` (existing) + `src/webview/clipboardEdit.ts` (new orchestration) |
| Applying structural edits to `S`, transaction bookkeeping | `src/webview/structuralEdit.ts` (new) + `editTransactions.ts` |
| Menu rows and command ids | `src/webview/components/menuController/menuRender.ts` |
| Prompt round-trip and file write | `src/webviewProtocol.ts`, `src/hexEditorSession.ts` |
| Toolbar dirty state | `src/webview/components/toolbar/toolbar.ts` |

The webview owns the *working document* while editing. The host owns the
*saved document* and performs the only file write.

## 3. Core structural model

```ts
export interface StructuralSegment { startAddress: number; data: Uint8Array }

export interface RemovedRun { start: number; data: Uint8Array }

/** Reversible replacement of all mapped bytes in [start, end] with `inserted` at `start`. */
export interface RangePatch {
    start: number;
    end: number;
    inserted: Uint8Array;
    removed: RemovedRun[];
}

export function insertBytes(segments, addr, bytes): StructuralSegment[];
export function deleteRange(segments, start, end): StructuralSegment[];
export function replaceRange(segments, start, end, bytes): { segments: StructuralSegment[]; patch: RangePatch };
export function applyRangePatch(segments, patch): StructuralSegment[];
export function invertRangePatch(segments, patch): StructuralSegment[];
```

Semantics:

- **Insert** at `addr`: all mapped bytes at addresses `>= addr` shift right by
  `bytes.length`; the inserted bytes occupy `[addr, addr + length)`; adjacent
  segments merge. Unmapped `addr` creates a segment.
- **Delete** `[start, end]`: every mapped byte in the inclusive range is
  removed; data after the range shifts left by the number of removed bytes.
  Bytes before `start` never move.
- **Replace** = delete the mapped bytes in `[start, end]` then insert the
  clipboard bytes at `start`; the net shift is
  `inserted.length - removedCount`.
- Patches are reversible without storing a full document snapshot: undo
  removes the inserted bytes and re-inserts the recorded removed runs at their
  original addresses.
- Segments stay sorted, non-overlapping, and adjacent segments merge. Empty
  segments disappear.

`deleteRange`/`replaceRange` operate on mapped bytes only; gaps inside the
range do not produce phantom `0x00` bytes.

## 4. Undo / redo model

`S.undoStack` / `S.redoStack` become a discriminated union:

```ts
export type EditTransaction =
    | { kind: 'bytes'; patches: Array<[number, number]> }
    | { kind: 'structure'; patch: RangePatch; editsBefore: Array<[number, number]>; editsAfter: Array<[number, number]> };
```

- Byte transactions keep the current first-seen prior-value semantics.
- A structural transaction stores the patch plus the pending byte overlay
  before and after the operation (overlay addresses are remapped by the
  structural shift). Undo restores `segments`, rebuilds the segment index and
  rows, and restores `S.edits`; redo applies the inverse.
- One user action = one transaction. Replace-with-equal-length routes through
  the byte transaction path so it behaves exactly like typing.

`S.savedSegments` is the baseline used by Cancel. Structural operations return
new segment arrays and never mutate the baseline; byte-only saves fold into the
current segments, which are also the baseline reference.

## 5. Working document and dirtiness

New state:

```ts
S.structuralDirty: boolean;                 // segments differ from the saved doc
S.savedSegments: StructuralSegment[];       // last loaded/saved segments
```

- `loadParsedMemory` sets `savedSegments = parseResult.segments`.
- `structuralEdit.apply...` sets `structuralDirty = true`, rebuilds
  `segmentIndex` / `memRows` / `totalDataBytes`, clears search matches, and
  refreshes consumers.
- `S.structuralDirty` is true while `S.parseResult.segments` differs from
  `S.savedSegments`. Structural undo/redo recompute it with `segmentsEqual`,
  so undoing the only structural edit returns to a clean document.
- `clearEditModel` restores `savedSegments` when `structuralDirty` is set,
  then clears the overlay, history, edit mode, and the flag.
- `hasUnsavedEdits()` and `hasEditsToSave()` include `structuralDirty`.
- Toolbar dirty state gains a `structural` flag so the label reads
  "structural change" and Save is enabled with zero byte edits.

## 6. Save path

New webview -> host message:

```ts
| { type: 'saveDocument'; segments: Array<{ startAddress: number; data: ArrayBuffer }> }
```

The webview folds pending byte edits into a copy of the current segments and
posts them when `structuralDirty` is true. `saveEdits` remains the fast path
for byte-only saves and script saves.

Host handling:

1. `.bin`: require exactly one segment, write its bytes, rebuild the parse
   result with `createBinParseResult(bytes, startAddress)`.
2. IHEX/SREC: `rebuildTextDocument(raw, segments, format)` produces the new
   text; parse it in the existing worker first (validation), then write it.
3. Stamp the self-write horizon, bump the generation, and post
   `savedEdits { generation, parseResult }` (the existing legacy reload path).
   The webview reloads segments, resets the baseline, and clears the edit
   model.

`rebuildTextDocument` preserves non-data records:

- IHEX: keeps type 03/05 start-address records and any unknown/malformed
  lines; drops type 01/02/04 and re-emits extended-linear-address records and
  one EOF record.
- SREC: keeps S0 and unknown/malformed lines; drops S5/S6 counts and
  S7/S8/S9 termination records; re-emits a count (when the original had one)
  and one termination record.
- Data records are regenerated from segments using the original dominant
  data-record length (default 16), the smallest SREC address width that fits,
  and the original EOL style. Trailing-newline presence is preserved.

This intentionally does not preserve the original data-record chunking; that
is documented as a non-goal.

## 7. Clipboard and interaction flow

- Copy/cut payload is plain `formatCopyCommand('hex', bytes)` text. The
  system clipboard is shared by webviews, so cross-instance copy/paste needs no
  custom protocol.
- `clipboardEdit.ts`:
  - `readClipboardBytes()` -> `parsePasteText` or ASCII fallback.
  - `copyBytesToClipboard(bytes)` -> `navigator.clipboard.writeText`.
  - `cutSelection()` -> write text, then structural delete on success.
  - `pasteSelection(mode)` -> read text, resolve the target, apply.
  - `copyRegion(from, to)` / `cutRegion(from, to)`.
- Paste target resolution:
  - Replace: selection start (mapped) or no-op.
  - Insert Before: selection start.
  - Insert After: selection end + 1.
  - At address: prompted address.
- After a structural operation the selection covers the inserted/replaced
  bytes (or the byte now at the deletion address) and the grid scrolls to it.
- `Ctrl/Cmd+X` is added next to the existing `Ctrl/Cmd+C` / `Ctrl/Cmd+V`
  handler.

## 8. Prompt round-trip

```ts
// webview -> host
| { type: 'promptAddress'; purpose: 'paste-at' | 'region-copy' | 'region-cut' }
// host -> webview
| { type: 'addressPromptResult'; purpose: ...; address?: number; from?: number; to?: number; cancelled?: boolean }
```

The host uses `vscode.window.showInputBox` (webviews cannot use
`window.prompt`) with full-hex validation, and asks `To` only for region
purposes. Cancellation posts `cancelled: true`; the webview stays silent.

## 9. Menu contract

Edit mode adds a **Paste** submenu:

```
Paste
  Replace
  Insert Before
  Insert After
  At address...
Cut
Copy Region...
Cut Region...
```

Read-only mode still shows **Copy Region...** (copy is non-destructive) but
hides Cut/Paste. Command ids: `paste-replace`, `paste-before`, `paste-after`,
`paste-at`, `cut-selection`, `copy-region`, `cut-region`.

## 10. Raw binary constraints

`.bin` has one contiguous segment. Insert/delete/replace within it change the
buffer length; the segment start address is unchanged. A paste target outside
`[start, start + length]` is refused with a status message because the raw file
has no sparse address space and extending it would silently invent a new base.

## 11. Risks and tradeoffs

- **Address shift**: labels, integrity checks, and overlay instances are
  address-anchored and are not moved. The UI warns once per structural
  operation. This keeps the feature honest and avoids silently rewriting
  persisted annotations.
- **Record layout**: structural saves rebuild data records. Non-data records
  and EOL style are preserved; chunking is not. Structural saves are explicit
  and rare.
- **Memory**: structural operations copy only the affected segment buffers;
  unaffected segments are shared. The undo patch stores only removed/inserted
  bytes.
- **External change**: a structurally dirty document behaves like a byte-dirty
  document in the conflict flow.
- **Save latency**: structural saves reparse the rebuilt text in the worker
  before writing. Byte-only saves keep the existing fast positional path.

## 12. Compatibility

- Existing `saveEdits` messages and script saves are unchanged.
- Existing copy formats and `parsePasteText` inputs are unchanged.
- Old undo stacks are not persisted, so no migration is needed.
- Protocol additions are additive; unknown messages are ignored by the
  existing dispatcher.
