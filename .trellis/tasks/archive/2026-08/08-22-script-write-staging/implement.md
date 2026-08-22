# Implement — script write staging + Apply/Discard

## Checklist (ordered)

1. `src/webviewProtocol.ts` — `scriptResult` adds `pendingWrites?: Array<[number, number]>`.
2. `src/hexEditorSession.ts` — runScript posts `pendingWrites` array (keep count).
3. `scriptsPanel.ts` — callbacks `onApplyScriptWrites`/`onDiscardScriptWrites`;
   `showResult` writes param; per-path stored writes; clear on new run/Discard;
   `writesBlockHtml(writes)` actionable row (legacy count-only fallback).
   `scriptsPanel.css` — tiny button row styling if needed.
4. `hexViewer.ts` — wire both callbacks; apply = filter mapped → S.edits.set →
   editMode → saveEdits() → refreshAfterLocalEdit(); local map filter helper.
5. Tests:
   - `scriptsPanel.test.ts` — writes row renders buttons when list present,
     count-only when absent; Apply + Discard invoke callbacks; writes cleared on
     next run.
   - `webview.test.ts` — smoke: scriptResult with pendingWrites wired (if cheap).
6. Manual (sample `minimal.hex` + write-patch.js): run → row shows 3 writes →
   Apply & Save → AA 55 AA tinted, saved file updated; Discard → clean; unmapped
   address write dropped.

## Validation

- `npm run check-types`
- `npm run lint`
- `npm test` (full)

## Review gates

- Before `task.py start`: artifacts complete; acceptance all testable.
- Rollback: revert working tree; additive field/callbacks safe both ways.