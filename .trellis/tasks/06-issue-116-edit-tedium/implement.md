# Direct-typing byte editing — implementation plan

## Execution order

### Step 1: Nibble buffer state + clearNibbleBuffer (hexViewer.ts)

Module-level state:
```ts
let nibbleBuffer: string | null = null
let nibbleBufferAddr: number | null = null
```

`clearNibbleBuffer()`:
```ts
function clearNibbleBuffer(): void {
    nibbleBuffer = null
    if (nibbleBufferAddr !== null) {
        const el = document.querySelector(`.data-cell[data-addr="${nibbleBufferAddr.toString(16).toUpperCase().padStart(8, '0')}"]`)
        if (el) {
            el.classList.remove('editing')
            // restore original display value from dataset
            el.textContent = parseInt(el.dataset.val, 10).toString(16).toUpperCase().padStart(2, '0')
        }
        nibbleBufferAddr = null
    }
}
```

### Step 2: Capture-phase keydown listener (hexViewer.ts)

In `setupRenderedUi()`:
```ts
document.addEventListener('keydown', onEditKeydown, { capture: true })
```

`onEditKeydown(e)` guard chain:
```
if (!S.editMode || S.lockedDueToExternalChange) → return
if (document.activeElement?.closest('#search-box, #ctx-menu')) → return
if (!singleByteSelected()) → clearNibbleBuffer(); return
```

Hex char handler (e.key matches /^[0-9a-fA-F]$/):
- `nibbleBuffer === null` → store char, `nibbleBufferAddr = S.selStart`, `showNibblePreview(el, char)`
- `nibbleBuffer !== null && nibbleBufferAddr === S.selStart` → combine `0x${nibbleBuffer}${char}`, `applyTypedEdit(addr, fullByte)`, `advanceSel(addr)`
- `nibbleBuffer !== null && nibbleBufferAddr !== S.selStart` → `clearNibbleBuffer()`, store new char (defense-in-depth)

`showNibblePreview(el, char)`: `el.classList.add('editing'); el.textContent = char`

Escape: `clearNibbleBuffer(); updateByteSelection(null, null)`

### Step 3: applyTypedEdit (hexViewer.ts)

```ts
function applyTypedEdit(addr: number, value: number): void {
    clearNibbleBuffer()
    const original = getOriginalByte(addr) // from editTransactions.ts
    if (original === undefined) return
    if (original === value) { S.edits.delete(addr); return }
    S.edits.set(addr, value)
    S.undoStack.push([[addr, original]])
    S.editMode = true
    updateDirtyBar()
    memRerender()
    updateInspector()
    renderStructPins()
    notifyIntegrityBytesChanged()
}
```

Uppercase normalization: `value` is already parsed from hex string via `parseInt(hexPair, 16)`. The display is always uppercase because `dataRowCellHtml` calls `val.toString(16).toUpperCase()`.

### Step 4: advanceSel (hexViewer.ts)

Segment-based advance. No extra state needed.

```ts
function advanceSel(addr: number): void {
    const segments = S.parseResult?.segments
    if (!segments) return
    const next = addr + 1
    // same segment?
    for (const seg of segments) {
        if (next >= seg.startAddress && next < seg.startAddress + seg.data.length) {
            updateByteSelection(next, next)
            return
        }
    }
    // next segment?
    for (const seg of segments) {
        if (seg.startAddress > addr) {
            updateByteSelection(seg.startAddress, seg.startAddress)
            return
        }
    }
    // end of file — keep current selection
}
```

### Step 5: Wire clearNibbleBuffer into existing handlers

- `onByteDown` → call `clearNibbleBuffer()` at the top (discards partial nibble silently, Q3-A)
- `updateByteSelection` → call `clearNibbleBuffer()` (arrow key, search nav, undo-triggered selection)
- `undoLastEdit()` → call `clearNibbleBuffer()`
- External change lock → call `clearNibbleBuffer()`

### Step 6: CSS (src/webview/style/)

```css
.data-cell.editing {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
}
```

## Rollback point

After Step 3 + Step 4, test manually. If anything breaks, revert `hexViewer.ts` changes.

## Validation

Manual:
1. Open `.hex` file → Edit → click byte showing `FF` → type `A` → cell shows `A` with `.editing` outline → type `B` → cell shows `AB` with `.dirty`, advances to next mapped byte
2. Type `A` → cell text changes to `A` with outline → Escape → cell reverts to `FF`, deselected, no edit
3. Type `F`, click another byte → `F` discarded, original byte unchanged
4. Undo reverts typed edit; Cancel clears all; Save persists
5. Search bar typing doesn't trigger hex editing
6. Right-click context menu fill works on range
7. 4-byte selection → typing `FF` → nothing happens
8. Last byte in file → typing completes → selection stays on last byte (no crash)
