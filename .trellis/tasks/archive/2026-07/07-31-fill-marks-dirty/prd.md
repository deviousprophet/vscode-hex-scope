# Fix fill marks bytes dirty when fill value matches existing byte

## Goal

Fill Selection registers an unsaved edit for every byte in the selected range, even when the fill value equals the byte's current value. The dirty bar then reports more unsaved bytes than actually changed, and save emits no-op edits. Behavior should mirror `stageIntegrityEdit()`: revert-if-equal-original, skip-if-no-change.

## Requirements

- In `buildFillTransaction()` (`src/webview/editTransactions.ts`), do not push a `prev` entry and do not call `S.edits.set(a, fillVal)` when the byte's current value already equals `fillVal`.
- When `fillVal` equals the byte's *original* value but differs from its current value (i.e. a previous edit changed it), revert by deleting the existing `S.edits` entry — same semantics as `stageIntegrityEdit()`.
- Preserve existing undo behavior: `prev` entries must still record the prior current value (`currentIntegrityByte`-style: `S.edits.get(a)` if present, else original) for bytes that actually change, so undo restores correctly.
- No behavior change for bytes that genuinely change.

## Constraints

- Single-file change in `src/webview/editTransactions.ts` unless tests require an additional test file.
- Must not regress `fillSelectionTransaction()` undo flow (`S.undoStack.push(prev)` only when `prev.length > 0`).
- `buildFillTransaction` currently uses `getByte()` (current memory); align with `stageIntegrityEdit`'s original-vs-current comparison.

## Acceptance Criteria

- [ ] Filling a range with a value equal to the bytes' current values marks zero bytes dirty (dirty bar unchanged).
- [ ] Filling a range where some bytes already equal `fillVal` and others differ marks only the differing bytes dirty.
- [ ] Filling a range with a value equal to a byte's original value (after a prior edit changed it) reverts that byte to clean — `S.edits` entry removed.
- [ ] Undo of a fill restores the exact prior current value for every changed byte.
- [ ] A covering test exists for `buildFillTransaction`/fill flow (currently uncovered).

## Notes

- Mirrors existing `stageIntegrityEdit()` semantics in the same file (lines 17-25).
- Root cause confirmed on branch `fix/fill-marks-dirty-unchanged`.
