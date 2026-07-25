# Implementation: Enhance editing ability

## Branch

```
git checkout -b feat/enhance-editing
```

## Ordered checklist

### Step 1: State tracking

- [ ] Add `lastClickColumn: 'hex' | 'char' | null` to state.ts.
- [ ] Wire `S.lastClickColumn` in `selectByteFromClick` (hex cells set `'hex'`, char cells set `'char'`).

### Step 2: Decoded text editing

- [ ] `dataRowCellHtml()` in memoryView.ts: when `S.editMode` and non-printable byte, emit `·` in char cell with class `edit-placeholder`.
- [ ] CSS: `.char-cell.cd.edit-placeholder` — `opacity: 0.2`, hover `opacity: 0.6`.
- [ ] `attachMemoryCellHandlers()`: add click → select, keydown → printable char check → `stageIntegrityEdit(addr, charCode)` → `memRerender()` → `advanceSel()`.
- [ ] Key filter: `isEditBlocked()` check + printable char only (`e.key.length === 1 && charCode >= 0x20 && charCode <= 0x7E`).
- [ ] After edit, refresh: `updateDirtyBar()`, `updateEditControls()`, `updateInspector()`, `notifyIntegrityBytesChanged()`.

### Step 3: Copy keyboard shortcut

- [ ] Add `onCopyPasteKeydown(e: KeyboardEvent)` in hexViewer.ts.
- [ ] Ctrl+C: `selectedBytes()` → `formatCopyCommand(col === 'char' ? 'ascii' : 'hex', bytes)` → `navigator.clipboard.writeText()`.
- [ ] Register with `document.addEventListener('keydown', onCopyPasteKeydown)`.

### Step 4: Paste keyboard shortcut

- [ ] Ctrl+V handler: check `S.editMode && !S.lockedDueToExternalChange` else no-op.
- [ ] Parse clipboard: strip `0x`, test hex-pair regex, parse as `[number, number][]` pairs.
- [ ] Fallback to ASCII: `[...text].map(c => [addr++, c.charCodeAt(0)])`.
- [ ] Clamp to segments: skip addresses not in any segment.
- [ ] `stageIntegrityEditTransaction(parsedEdits)` → `memRerender()` → `updateDirtyBar()` etc.
- [ ] No selection → no-op.

### Step 5: Verify

- [ ] `npm run check-types`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] Manual pass through all acceptance criteria in prd.md.

## Rollback

```
git checkout main
git branch -D feat/enhance-editing
```
