# Save: self-write watcher horizon + positional byte writes

## Goal
Saving edits must never re-trigger the external-change/reload path (no
"file changed" banner after your own save — even on multi-event FS watchers)
and, on large files, the write itself becomes positional (only the edited
record byte ranges hit the disk) instead of rewriting the whole file.

## Requirements

### Q2 — Self-write watcher horizon
- Replace the one-shot `suppressReload` flag with a time horizon:
  `markSelfWrite()` stamps `Date.now()`; `onExternalChange` ignores any event
  arriving within `SELF_WRITE_HORIZON_MS` (1000 ms) of a self-write.
- Every host write (saveEdits, repair/`writeRawAndReparse`) marks itself; the
  flag is fully removed.
- Result: saving never shows the external-change banner or a reload — however
  many FS events VS Code emits per write.

### Q3 — Positional byte writes
- `buildSplicePlan(raw, edits, format)` returns the patched text **plus** byte
  patches `{ offset, bytes }` for each rebuilt record line (offsets =
  cumulative line byte offsets; ASCII-only files guarantee char==byte).
- Save path: when patches are available and the plan is ASCII/same-length safe,
  write only those byte ranges via `node:fs` fd (`open r+` / `write` at offset /
  close); the whole-file `writeFile` becomes a fallback.
- Fallbacks (never an error to the user):
  - a rebuilt line's length differs from the original;
  - any file byte is non-ASCII (comments/malformed lines);
  - `fs.open`/`write` throws.
  In each case: fall back to writing `plan.newRaw` whole.
- In-memory state stays identical to the splice save: `raw` = new patched text,
  `parseResult.segments` folded, generation bumped, light `savedEdits`.

## Acceptance Criteria

- [ ] Saving edits never triggers the external-change banner/reload (multi-event
  watchers included; 1 s horizon).
- [ ] Repair (`repairAndReload`) also consumes the horizon (no banner after
  repair reload).
- [ ] Save on a file with 1 edited record writes only that record's byte range
  (verified by test on the splice plan), whole-file write only in fallback cases.
- [ ] Non-ASCII byte or length-mismatch → fallback whole-file write, file
  identical, no user-facing error.
- [ ] File written by positional path is byte-identical to the splice path
  (parity test).
- [ ] Record view / scripts / integrity read the saved state (raw + segments
  patched as today).
- [ ] `npm run check-types`, `npm run lint`, `npm test` pass.