# Fast edit save: incremental serialize, no reparse, undo/redo across save

## Goal
Saving edits on large hex/SREC files must not feel like a file reload. Save
stays O(edits + one file write) and the viewer keeps working with native
undo/redo across the save boundary (text-editor feel).

## Requirements

### Save pipeline (host)
- No full-document rebuild on save:
  - Drop `materializeParseResult` (rebuilds every record) and the full-file
    reparse (`parseCompactSource`) after writing.
  - Preserve the line-splice serialization intent (only edited record lines are
    re-encoded + checksum recomputed) but driven per-line from raw text — no
    per-record materialization.
- Fold saved bytes into the in-memory `parseResult.segments` (so later script
  reads / integrity see the saved state) instead of reparsing.
- Keep whole-file `writeFile` (unchanged; trivial for accept criteria).

### Webview update
- `savedEdits` becomes light: `{ generation }` (no `parseResult` push).
- Webview folds its own `S.edits` into local segment bytes, clears only the
  overlay, re-renders — NO `loadParsedMemory`/memory-row rebuild, no
  "file reload" visuals.

### Undo / redo survives save (text-editor feel)
- Save clears the pending-overlay `S.edits` but does NOT clear undo/redo stacks
  or edit mode.
- Ctrl+Z after save restores the saved byte to its pre-edit value → document
  becomes unsaved again (dirty) → Ctrl+S writes it. Redo symmetric.
- Undo/redo transactions store absolute byte values (already true), so they
  remain correct across base shifts caused by saves.

## Acceptance Criteria

- [ ] Save of a few edits on `firmware_24mb.hex` completes without reparse and
  without the viewer reloading like an external change.
- [ ] Memory rows not rebuilt on save; only cells re-render (no flicker /
  full reload spinner).
- [ ] Undo works across saves: type → Save → Ctrl+Z → byte reverts + dirty;
  Ctrl+S persists revert. Ctrl+Y redoes and re-dirties.
- [ ] Script `hex.write` Apply & Save still works (uses same save path).
- [ ] Integrities/structs/stats live-update after save (fold, not reload).
- [ ] Existing serializer units (`serializeIntelHexAsync`/`serializeSRecAsync`)
  keep their test coverage (unchanged or re-pointed).
- [ ] `npm run check-types`, `npm run lint`, `npm test` pass.