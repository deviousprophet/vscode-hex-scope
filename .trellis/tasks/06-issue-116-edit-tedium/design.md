# Direct-typing byte editing — design

## Architecture

Pure webview-side feature. No protocol changes, no extension host changes.

### Data flow

```
keydown on document (capture phase)
  → filter: editMode && !locked && single-byte selection
            && activeElement NOT inside #search-box or #ctx-menu
  → if hex char (0-9, a-f, A-F):
      buffer[0] ? applyEdit(addr, combine(buffer[0], char)) + advanceSel()
                : buffer[0] = char, add .editing class via DOM
  → if Escape:
      clearNibbleBuffer(), remove .editing, deselect
  → if anything else:
      ignore
```

### applyEdit(addr, value)

Same path as context menu fill:
```
stageIntegrityEdit(addr, value)
//   S.edits.set(addr, value) || S.edits.delete(addr) if reverting to original
//   returns [addr, previous] for undo stack
```

Then:
```
updateDirtyBar()
memRerender()
updateInspector(), renderStructPins(), notifyIntegrityBytesChanged()
```

### advanceSel(addr)

Segment-based scan. Iterates `S.parseResult.segments` to find where `addr + 1` falls:
```
for each segment:
  if addr + 1 is inside this segment → select addr + 1, return
// try next segment
for each segment where startAddress > addr:
  select that segment's startAddress, return
// end of file — keep current selection
```

O(n) on segments (usually < 1000), zero extra memory, no cap.

### clearNibbleBuffer()

Reset `nibbleBuffer = null, nibbleBufferAddr = null, remove .editing from DOM`.
Called on:
- Escape keypress
- `onByteDown` (before selecting new byte — discards partial nibble silently, per Q3-A)
- `updateByteSelection` (arrow key, search nav)
- Ctrl+Z (undo) handler
- External change lock

### Partial nibble on click-away (Q3-A)

If user types `F` (1 nibble), then clicks another byte → `clearNibbleBuffer()` runs at the top of `onByteDown`. The `F` is discarded. No edit applied. The click proceeds normally.

Rationale: applying `0xF0` silently is destructive and surprising. Discarding a partial nibble is harmless — user just types it again.

### Key filtering

```
document.addEventListener('keydown', handler, { capture: true })
```

Guard:
```
if (!S.editMode || S.lockedDueToExternalChange) return
if (!singleByteSelected()) { clearNibbleBuffer(); return }
if (document.activeElement?.closest('#search-box, #ctx-menu')) return
```

### Visual feedback on first nibble

Two in-place DOM mutations on the selected `.data-cell` element:

1. **`.editing` CSS class** — outline border
2. **Text content** — set to the typed nibble (e.g., `FF` → `A`)

On Escape: restore original hex from `dataset.val`:
```ts
el.textContent = parseInt(el.dataset.val, 10).toString(16).toUpperCase().padStart(2, '0')
el.classList.remove('editing')
```

On completion: `memRerender()` renders the full value with `.dirty` — both mutations are naturally replaced.

```css
.data-cell.editing {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
}
```

This matches Microsoft hex editor behavior — cell text updates in-place as you type.

### Nibble buffer lifecycle guard

Module-level state:
```ts
let nibbleBuffer: string | null = null
let nibbleBufferAddr: number | null = null
```

On second keypress, verify `nibbleBufferAddr === S.selStart`. If mismatch (shouldn't happen with `clearNibbleBuffer` guards, but defense-in-depth), discard buffer.

## All editing paths

| Path | Entry | Edit function | Sets editMode |
|------|-------|---------------|---------------|
| Context menu fill | Right-click → Patch/Fill | `fillSelectionTransaction` | No (already true) |
| Integrity write | Sidebar "Write expected" | `stageIntegrityEditTransaction` | Yes |
| Script apply | Script run → confirm | `stageIntegrityEditTransaction` | Yes |
| **Direct-typing (new)** | **Keydown → hex buffer** | **`stageIntegrityEdit`** | **Yes (via same path)** |

All share: `S.edits` Map, `S.undoStack`, Save/Cancel/Undo UI.

## Decisions

| Risk | Decision | Value |
|------|----------|-------|
| Key event filtering | activeElement check | A |
| `.editing` persistence | No re-render on first nibble; transient class | A |
| Advance past gaps | Pre-built `S.mappedAddresses` array, O(1) index lookup | A (segment-aware) |
| Buffer lifecycle | Central `clearNibbleBuffer()` on all invalidating actions | A |
| Partial nibble on click-away | Discard silently (no edit) | Q3-A |

## Files to modify

| File | Change |
|------|--------|
| `src/webview/hexViewer.ts` | Capture-phase keydown listener, nibble buffer, `clearNibbleBuffer`, `advanceSel`, wire into existing edit/undo/click paths |

| `src/webview/style/` | `.data-cell.editing` CSS rule |
