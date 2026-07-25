# Design: Enhance editing ability

## Files touched

| File | Change |
|---|---|
| `src/webview/memory/memoryView.ts` | `dataRowCellHtml()`: add placeholder dot for non-printable in edit mode. `attachMemoryCellHandlers()`: add char-cell click/keydown. |
| `src/webview/hexViewer.ts` | Add `onCopyPasteKeydown()` global handler. Wire `S.lastClickColumn` tracking. Export `applyTypedEdit`-like char handler. |
| `src/webview/state.ts` | Add `lastClickColumn: 'hex' \| 'char' \| null` field. |
| `src/webview/editTransactions.ts` | Reuse `stageIntegrityEditTransaction()` for paste — no changes needed. |
| `src/webview/styles/memory-view.css` | `.char-cell.cd.edit-placeholder` style. |

## Data flow

### Decoded text edit

```
char-cell click → selectByteFromClick (sets S.selStart/S.selEnd, records lastClickColumn)
char-cell keydown → isEditBlocked check → printable char? → getByte(addr) → stageIntegrityEdit(addr, charCode) → memRerender
```

### Copy

```
Ctrl+C → onCopyPasteKeydown → selectedBytes() → formatCopyCommand(lastClickColumn === 'char' ? 'ascii' : 'hex', bytes) → navigator.clipboard.writeText()
```

### Paste

```
Ctrl+V → onCopyPasteKeydown → S.editMode? → readText() → hex parse attempt → parse hex bytes → stageIntegrityEditTransaction(edits) → memRerender
```

Paste hex detection regex: `/^[0-9a-fA-F][0-9a-fA-F](?:[\s,;]*[0-9a-fA-F][0-9a-fA-F])*$/` (skip first space, match hex pairs separated by whitespace/comma/semicolon). Strip `0x` prefixes first.

## Undo model

Paste enters through `stageIntegrityEditTransaction()` which pushes a single `[addr, prevValue][]` entry to `S.undoStack`. One undo restores all pasted bytes atomically — same pattern as integrity fix and fill.

## Key decisions (grilled)

| Decision | Choice | Rationale |
|---|---|---|
| Non-printable UX | Faint `·` dot in edit mode | Industry std (HxD, 010 Editor, ImHex). Clickable, no dead zones. |
| Copy format | Context-aware (hex vs ASCII column) | Natural expectation. ASCII column copies ASCII text. |
| Paste detection | Hex-first, fallback ASCII | Hex editor users expect `DEADBEEF` to paste as 4 bytes. |
| Paste overflow | Clamp silently | No modal. Non-destructive — undoable. |
| Copy outside edit mode | Allowed | Selection exists regardless of edit mode. |
| Paste handler | Global keydown (Ctrl+V) | Separate from single-byte-guarded `onEditKeydown`. |
