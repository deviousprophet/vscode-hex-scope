# Implement — fast edit save + undo across save

## Checklist (ordered)

1. `src/core/document.ts` — `spliceEditedLines(raw, edits, format)`:
   split once, minimal line decode (reuse parsers), rebuild only lines whose
   address range intersects the edited set (reuse `buildIntelHexDataRecord` /
   `buildSRecDataRecord` + checksum), join. Ignore unmapped edits.
2. `src/hexEditorSession.ts` — `saveEdits`:
   - replace `materializeParseResult` + `serializeIntelHexAsync/SRecAsync`
     call with `spliceEditedLines(raw, edits, format)`;
   - drop `parseCompactSource` reparse; fold `editMap` into
     `parseResult.segments` in place; bump generation;
   - post light `savedEdits { generation, parseResult? undefined }`.
3. `src/webviewProtocol.ts` — `savedEdits` → `{ generation }` (+ optional
   `parseResult?` kept for backward-safe fallback).
4. `webviewMessageModel.ts` — `applySavedEditsMessage`: set generation, fold
   local `S.edits` into `S.parseResult.segments`, `S.edits.clear()` (keep
   editModel/undo/redo), invalidate dirtyBar/editControls/currentDataView —
   NO `loadParsedMemory`; keep `if (msg.parseResult)` fallback.
5. Tests:
   - core: `spliceEditedLines` ihex + srec — only changed line rewritten,
     checksum recomputed, unmapped edit ignored, CRLF preserved.
   - webview: save keeps undo stack; undo/redo across save; savedEdits without
     parseResult doesn't call loadParsedMemory (model test); with parseResult
     fallback still works.
   - webview.test.ts save-flow smoke unchanged.
6. Manual: `firmware_24mb.hex` few-edit save timing + no reload flicker; script
   write Apply&Save; Ctrl+Z/S + Ctrl+Y after save.

## Validation

- `npm run check-types`
- `npm run lint`
- `npm test` (full)

## Review gates

- Before `task.py start`: artifacts complete; acceptance testable.
- Rollback: revert; light savedEdits + optional parseResult fallback is
  backward compatible.