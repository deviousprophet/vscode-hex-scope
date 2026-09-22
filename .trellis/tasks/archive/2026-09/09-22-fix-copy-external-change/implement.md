# Implement — suppress spurious external change on document copy

Diagnosing-bugs discipline: build the red-capable loop before the fix.

## Feedback loop (Phase 1–2, go red first)

Command: `npm test` (vscode-test) — or the faster core tier if a core-only runner is
used. The loop is the new unit test file `src/test/core/documentExternalChange.test.ts`:

1. `same content → shouldHandle returns false` (red today: no gate exists).
2. `not loaded → false`.
3. `different content → true`.
4. `self-write within horizon → false`, `after horizon → true`.
5. boundary: `now - lastSelfWriteAt === horizonMs` → handled (horizon is exclusive).

Run it once and confirm `1`/`2` fail before writing the module — that is the red state.

## Ordered checklist

- [ ] 1. Add `src/core/documentExternalChange.ts`: `createExternalChangeGate(horizonMs)`.
- [ ] 2. Add `src/test/core/documentExternalChange.test.ts` covering cases 1–5; run, watch 1–2 red.
- [ ] 3. Wire into `src/hexEditorSession.ts`:
  - replace `SELF_WRITE_HORIZON_MS` / `lastSelfWriteAt` / `markSelfWrite` with the gate;
  - `onExternalChange`: early-return on `!gate.shouldHandle(...)`;
  - inside the debounced read, early-return when content unchanged (call the gate with
    `now` from the current time, or compare `newRaw === raw` directly — one source of truth).
- [ ] 4. Leave the profile store `onSelfWrite: markSelfWrite` wiring intact via the gate.
- [ ] 5. Run the loop: green.
- [ ] 6. Manual/e2e sanity (extension host): open `a.hex`, copy it to `b.hex`, confirm
     `b.hex` opens with no external-change banner.
- [ ] 7. `npm run check-types`; `npm run lint`.
- [ ] 8. `npm test` (full).
- [ ] 9. Optional: `/fallow-fix` scan per spec quality gate.

## Validation commands

```
npm run check-types
npm run lint
npm test
```

## Review gates

- Red loop shown before the fix (step 2 output).
- Green loop after the fix (step 5).
- No message-shape or protocol diff (`git diff` review).

## Rollback points

- Single commit; revert restores prior behavior. Rollback is safe — no persisted data
  or wire format changed.

## Out of scope

- Custom-editor priority / auto-open behavior.
- `.hexscope/` profile watcher.
