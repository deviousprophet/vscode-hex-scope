# Design — script write staging + Apply/Discard

## Data flow

```
worker 'hex.write' → helper DISPATCH → host.writeBytes (stages host-only:
  edits map + pendingWrites)          [existing, unchanged]
runScript handler → scriptResult { …, pendingWrites: pendingWrites.map(w => [w.address, w.value]) }
webview scriptResult → scriptsPanel.showResult(…, writes)  → card row "Writes: N → [Apply & Save] [Discard]"
Apply & Save → onApplyScriptWrites(writes) → hexViewer: filter mapped → S.edits.set → editMode → refreshAfterLocalEdit() → saveEdits() (posts saveEdits → host writes file)
Discard      → onDiscardScriptWrites() → panel clears the run's writes
```

## Contracts

### Protocol (src/webviewProtocol.ts)
- `scriptResult` gains `pendingWrites?: Array<[number, number]>` (address,
  value). Keep `pendingWriteCount` for back-compat display.

### Host (src/hexEditorSession.ts runScript, ~:749)
- Post `pendingWrites: host.pendingWrites.map(w => [w.address, w.value])`.

### Panel (scriptsPanel.ts)
- `ScriptsCallbacks` adds:
  - `onApplyScriptWrites?: (writes: Array<[number, number]>) => void`
  - `onDiscardScriptWrites?: () => void`
- `showResult` gains `writes: Array<[number, number]> | undefined`; stored per
  script path (`storedWrites` map); cleared on new run (`resetOutputState` path)
  and on Discard. `writesBlockHtml(writes)` renders:
  - count-only row when list absent/empty (legacy/zero)
  - actionable row otherwise: `Writes: N →` + Apply & Save (primary, compact)
    + Discard (secondary).
- Discard: no host action (bytes never left the host) — panel state only.

### hexViewer.ts wiring
- `onApplyScriptWrites(writes)`:
  1. filter to mapped: keep addr where some segment `startAddress ≤ addr ≤ startAddress + data.length - 1`.
  2. `S.edits.set(addr, value)` for each surviving write; compute prior-change
     set from `S.parseResult.segments` for undo symmetry (optional; push
     `[addr, prev]` onto `S.undoStack` like `applyTypedEdit`).
  3. `S.editMode = true; toolbar.setEditMode(true);`
  4. `saveEdits();` then `refreshAfterLocalEdit();`
  - if 0 survivors → no-op (panel shows note via result).
- `onDiscardScriptWrites()` → no-op (panel clears).
- Helper `mappedSegmentIndex(addr)` / filter local to hexViewer.

### Back-compat
- Old provider (count only): `pendingWrites` undefined → plain count row,
  current behavior. Old webview (no handler): provider field ignored.

## Files touched
- `src/webviewProtocol.ts`
- `src/hexEditorSession.ts`
- `src/webview/components/sidebar/scriptsPanel/scriptsPanel.ts` (+css)
- `src/webview/hexViewer.ts`
- tests: `scriptsPanel.test.ts` (writes row + callbacks), `webview.test.ts`
  smoke, `scriptingRunner.test.ts` (pendingWrites shape unchanged host-side).

## Compatibility / Rollback
- Additive message field + optional callbacks. Revert = drop the field +
  callbacks; old payloads unaffected.