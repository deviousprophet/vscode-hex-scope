# Implement — user-activated "edit selected bytes" session

## Ordered Checklist

1. **Locate current context-menu wiring** (read-only survey)
   - Identify the hex memory-view context menu construction (menuController + `contextCommands.ts` + menu HTML) and its current enable/visible rules. All command entries are added here.

2. **Add pure module** `src/webview/editSelection.ts`
   - `advanceWithinRange(addr, start, end, isMapped)` → next mapped addr inside range, else null.
   - `countMappedInRange(start, end, isMapped)` → mapped-byte count (menu enable: ≥2).
   - No webview globals; `isMapped` injected.

3. **Unit tests** in `src/test/webview/webview.test.ts`
   - `advanceWithinRange`: next-in-range, skip unmapped/gap, null at/past range end, empty/1-byte range.
   - `countMappedInRange`: 0/1/≥2, gap skipping.
   - Table style matching existing `editTransactions` tests.

4. **Wire session in `src/webview/hexViewer.ts`**
   - Add `selEditSession` module state + activation helper (guard: Edit Mode on, not locked, range ≥2 mapped bytes).
   - `onEditKeydown`: when session active → nibble/ASCII typing targets `session.cursor`; otherwise keep existing single-byte/blocked behavior unchanged.
   - Full byte: push to `session.buffer`; `session.cursor = advanceWithinRange(...) ?? session.cursor`.
   - Commit helper: discard nibble, `stageIntegrityEditTransaction(session.buffer)`, `refreshAfterLocalEdit()`, clear session, restore pill.
   - Wire exit: Escape (session branch — exit + commit, keep selection), `updateByteSelection`, grid-arrow selection handlers, mouse-down-outside, file-load/view-switch reset.
   - Single-byte path (`advanceSel`, `handleEditEscape`, guard check) untouched.

5. **Context-menu command**
   - Register **Edit selected bytes** in the memory-view menu; visible iff current selection has ≥2 mapped bytes; disabled+tooltip when Edit Mode off / locked (reuse `.menu-disabled`).
   - On invoke → activation helper.

6. **Toolbar pill**
   - Add setter for session message ("editing selection (N bytes)"); call on activate/commit/exit.

7. **Integration tests** (JSDOM, `webview.test.ts`/`memoryGrid` harness)
   - Activate → type across range → Escape → assert single undo entry + dirty bytes.
   - Escape keeps selection; incomplete nibble discarded.
   - Selection change mid-session commits then applies new selection.
   - Paste during session does not end it; single-byte typing regresses to legacy behavior.

8. **Spec updates**
   - `editing-save-external-change.md`: key-filter contract (session-gated range typing), commit-at-exit single-transaction rule, new signatures, deviation note for Edit Escape.
   - Hex-view / menu-controller component specs if their contracts change (visible/enable rules for the new item).

## Validation Commands

```
npm run check-types
npm run lint
npm test
```

## Risky Files / Rollback Points

- `src/webview/hexViewer.ts` — entry module, import-time side effects; keep orchestration thin, pure logic in `editSelection.ts`.
- Existing menu construction code — verify where the memory-view menu list is built before adding the entry (possibly not only `contextCommands.ts`).
- Rollback: revert branch to `main` returns legacy behavior (inert multi-byte typing, single-byte path untouched).

## Follow-Up Before `task.py start`

- [ ] Survey (step 1) done; menu site confirmed.
- [ ] Steps 2-3 done; puré helpers unit-green.
- [ ] All 9 decisions traceable to code paths (prd.md Key Decisions).
- [ ] Final planning summary approved by user.