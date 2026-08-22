# Design — fast edit save + undo across save

## Save data flow (host, hexEditorSession.ts `saveEdits`)

```
webview saveEdits { edits } 
  → decode lines once (raw.split(/\r?\n/))
  → for each line, minimal decode (address, count, type) — no record materialize
  → if line's address range ∩ edited-address set: rebuild line from raw text
       + edits + checksum (Intel `:`/SREC `S` builder reuse)
  → join lines, writeFile
  → fold edits into parseResult.segments (byte patch, O(edits))
  → generation++
  → post savedEdits { generation }            (light — no parseResult)
```

### New core helper (src/core/document.ts)
- `spliceEditedLines(raw, edits, format): string` — targeted line splice.
  Minimal per-line decode reuses `parseIntelHexLine` / `parseSRecRecordLine`
  records; rebuilds via existing `buildIntelHexDataRecord` /
  `buildSRecDataRecord`. Edits with no owning data line are ignored (unmapped).
- Keep existing `serializeIntelHexAsync`/`serializeSRecAsync` + tests intact
  (still used by `repairAndReload` / externally), or re-point saveEdits to the
  new helper. Prefer: saveEdits uses `spliceEditedLines`; old serializers stay
  for repair path + tests.

### Host fold (no reparse)
- `parseResult.segments` holds live byte arrays (already passed to
  `VSCodeScriptHost`). Apply `editMap` in place. Segment geometry unchanged
  (addresses/lengths fixed by byte patches).
- Generation bump: `currentGeneration++` (or `loaded.generation` semantics from
  a counter); record-page (`recordPage`) reads still come from `raw` (now
  patched text) → fresh automatically.

## Webview savedEdits message (light)

### Protocol (src/webviewProtocol.ts)
- `savedEdits` → `{ type: 'savedEdits'; generation: number }` (± keep
  parseResult field optional for back-compat; webview ignores when absent).

### webviewMessageModel.ts `applySavedEditsMessage`
- Keep `S.documentGeneration = msg.generation`.
- Fold local `S.edits` into `S.parseResult.segments` (byte patch) — mirrors the
  host fold; keeps `getOriginalByte`/script/read consistent.
- `S.edits.clear()`; do NOT `clearEditModel()`.
- Invalidation: dirtyBar/editControls (edit overlay gone, still `S.editMode`),
  currentDataView re-render only — no `loadParsedMemory`, no buildMemRows.

## Undo/redo across save (webview, editTransactions flow)

- Save no longer calls `clearEditModel` (which clears undo/redo/editMode).
- Transactions are absolute values: `[addr, byte]`. After save + fold,
  `getOriginalByte(addr)` = saved byte; `restoreEditedByte` deletes from overlay
  when value == original → a redo back to the saved state stays clean.
- `hasUnsavedEdits()` unchanged (`editMode && S.edits.size>0`) — undo after save
  repopulates overlay → dirty → Ctrl+S saves.
- Edge: edits to the same address in separate txn/epochs — absolute values make
  each txn self-contained; base-shift fold keeps getOriginalByte truthful.
- `cancelEdits`/discard path (editMode off) unchanged.

## Files touched
- `src/core/document.ts` — `spliceEditedLines` (+ tests in `providerUtils.test.ts`
  or `document.test.ts`).
- `src/hexEditorSession.ts` — saveEdits rework (fold + light post).
- `src/webviewProtocol.ts` — savedEdits light shape.
- `src/webview/webviewMessageModel.ts` — applySavedEditsMessage rewrite.
- `src/test/webview/webviewMessageModel.test.ts` — savedEdits no-reload assert.
- `src/test/webview/webview.test.ts` — save flow smoke.

## Compatibility / Rollback
- old webview + new host: savedEdits w/o parseResult → old webview expects
  parseResult; make savedEdits keep optional `parseResult?` and webview keeps a
  fallback `if (msg.parseResult) loadParsedMemory(...)` — safe during rollout.
- Rollback: revert; behavior additive.