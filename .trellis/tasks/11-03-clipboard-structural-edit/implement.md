# Implement - Full copy, cut, and paste for hex memory

## Validation commands

```powershell
npm run check-types
npm run lint
npm test
```

Run the full gate before finishing. Use targeted suites during the work by
compiling with `npm run compile-tests` and running the relevant `out/test`
file through the VS Code test harness; the final gate is always the full
`npm test`.

## Ordered checklist

### 1. Core structural math

- [ ] Add `src/core/structural.ts` with `StructuralSegment`, `RemovedRun`,
      `RangePatch`, `insertBytes`, `deleteRange`, `replaceRange`,
      `applyRangePatch`, `invertRangePatch`.
- [ ] Keep segments sorted, non-overlapping, merged when adjacent, and drop
      empty segments.
- [ ] Add `src/test/core/structural.test.ts`: insert inside/at start/into a
      gap, delete single/multi/gap-spanning ranges, replace grow/shrink/equal,
      patch round-trip, zero-length no-ops, address 0.

### 2. Text rebuild

- [ ] Add `rebuildTextDocument(originalRaw, segments, format)` to
      `src/core/document.ts` (plus a `buildIntelHexDataRecord` export or local
      helper).
- [ ] IHEX: regenerate data + ELA records, preserve start-address records and
      unknown lines, emit one EOF, keep EOL/trailing newline.
- [ ] SREC: regenerate S1/S2/S3 data, preserve S0/unknown lines, re-emit the
      original count kind when present and one termination record, keep
      EOL/trailing newline.
- [ ] Add tests in `src/test/core/document.test.ts` for both formats:
      round-trip bytes, zero checksum/malformed errors, gaps, >64 KiB IHEX
      addresses, SREC width selection, header/termination preservation, CRLF.

### 3. Protocol + host save

- [ ] Add `saveDocument` (webview -> host) and `promptAddress` /
      `addressPromptResult` pairs to `src/webviewProtocol.ts`.
- [ ] Implement `saveDocument` in `src/hexEditorSession.ts`:
      `.bin` single-segment write + `createBinParseResult`; text rebuild,
      worker parse, write, generation bump, `savedEdits { generation,
      parseResult }`; script-owned failures keep the existing reporting path
      (structural saves are user-only, so propagate).
- [ ] Implement `promptAddress` with `vscode.window.showInputBox`, full-hex
      validation, `From`/`To` for regions, and a cancellation result.
- [ ] Add protocol dispatch coverage in the webview message dispatcher/model
      maps so the new provider message is not treated as unknown.

### 4. Webview working-document state

- [ ] Add `S.structuralDirty` and `S.savedSegments`; update `loadParsedMemory`
      to set the baseline.
- [ ] Convert `S.undoStack` / `S.redoStack` to `EditTransaction[]`; update
      `editStaging.ts`, `editSelection.ts`, `hexViewer.ts` (`applyTypedEdit`),
      and `editTransactions.ts` for both kinds.
- [ ] Add `src/webview/structuralEdit.ts`: apply insert/delete/replace,
      remap `S.edits`, rebuild index/rows, push the transaction, clear redo,
      set `structuralDirty`, and expose `restoreSavedSegments`.
- [ ] Update `clearEditModel`, `hasUnsavedEdits`, `hasEditsToSave`,
      `saveEdits`, `cancelEdits`, and the dirty-bar paths.
- [ ] Warn once per structural operation that labels/types are not moved.

### 5. Clipboard orchestration

- [ ] Add `src/webview/clipboardEdit.ts` with clipboard read/write, paste-mode
      target resolution, cut, region copy/cut, and status messages.
- [ ] Route equal-length replace through the byte transaction path.
- [ ] Reject `.bin` targets outside the single segment and empty clipboard
      parses.
- [ ] Update the keyboard handler for `Ctrl/Cmd+X`; keep `Ctrl/Cmd+C` and
      `Ctrl/Cmd+V` behavior.
- [ ] Wire `addressPromptResult` handling in `hexViewer.ts`.

### 6. Menu

- [ ] Extend `MenuState` / `renderMenuHtml` with Cut, the Paste submenu, and
      Copy/Cut Region rows (edit-mode gating).
- [ ] Add `CONTEXT_ACTIONS` entries and the prompt commands in `hexViewer.ts`.
- [ ] Update `src/test/webview/components/menuController/menuController.test.ts`
      and any menu render assertions.

### 7. Toolbar dirty state

- [ ] Add a `structural` flag to `Toolbar.setDirty` / render state so Save is
      enabled and the label distinguishes a structural change.
- [ ] Update toolbar tests.

### 8. Save / discard / external-change integration

- [ ] `saveEdits` posts `saveDocument` with effective segments when
      `structuralDirty`; otherwise keeps `saveEdits`.
- [ ] `savedEdits` legacy reload clears `structuralDirty` and resets the
      baseline.
- [ ] External-change conflict counts structural dirtiness; Cancel restores
      the saved segments.
- [ ] Update `webviewMessageModel` / `appModel` tests.

### 9. Tests

- [ ] Core: structural math and text rebuild.
- [ ] Webview: paste modes, cut, region copy/cut, undo/redo, discard, bin
      refusal, prompt result handling.
- [ ] Menu: new rows and gating.
- [ ] Toolbar: structural dirty label/Save enablement.
- [ ] Protocol: `saveDocument` / `promptAddress` dispatch and host handler
      validation where unit-testable.

### 10. Specs

- [ ] Update `.trellis/spec/frontend/editing-save-external-change.md`
      (transactions, structural save, discard, external conflict).
- [ ] Update `.trellis/spec/frontend/document-formats.md`
      (`rebuildTextDocument`, structural save).
- [ ] Update `.trellis/spec/frontend/selection-inspect-copy.md`
      (cut, paste modes, region copy/cut).
- [ ] Update `.trellis/spec/frontend/components/component-menu-controller.md`
      and `component-toolbar.md` for the new rows/state.
- [ ] Update `.trellis/spec/frontend/type-safety.md` for the new protocol
      messages and transaction union if the contract section needs it.

## Review gates

1. Core math + text rebuild reviewed before host/webview wiring.
2. Full `npm run check-types` + `npm run lint` after each layer.
3. Full `npm test` before the code review.
4. Two-axis code review, then changelog, then commit/push/PR.

## Rollback points

- Core modules are additive; deleting them restores the old behavior.
- Protocol additions are additive; the host handler and webview sender can be
  removed independently.
- The transaction union change is the riskiest edit; keep the byte-kind
  behavior byte-identical and update the existing tests in the same commit.
