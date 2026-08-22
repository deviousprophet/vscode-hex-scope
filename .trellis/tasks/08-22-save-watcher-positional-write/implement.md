# Implement — watcher horizon + positional writes

## Checklist (ordered)

1. `src/core/document.ts`:
   - add `SplicePatch`/`SplicePlan` + `buildSplicePlan(raw, edits, format)`;
     refactor `spliceEditedLines` to return `plan.newRaw`;
   - cumulative byte-offset tracking + same-length + ASCII checks (fallback →
     `patches: null`).
2. `src/hexEditorSession.ts`:
   - replace `suppressReload` with `lastSelfWriteAt` + `SELF_WRITE_HORIZON_MS`
     + `markSelfWrite()`; `onExternalChange` uses the horizon;
   - `saveEdits`: plan → positional `writeSplices` or whole `writeFile`
     fallback; keep raw/segments/generation/light-savedEdits; `markSelfWrite()`;
   - `repairAndReload` + `writeRawAndReparse`: `markSelfWrite()` (drop flag).
3. Tests (`src/test/core/document.test.ts`):
   - `buildSplicePlan`: ihex/srec patch count + offsets (CRLF); newRaw ==
     `spliceEditedLines`; non-ASCII line → `patches: null`;
   - parity: reassemble patches into newRaw equals whole result.
4. Manual:
   - save edited record → `git diff`/hexdump confirms only edited bytes in
     file, no banner/reload;
   - edit file externally after 1 s → change banner still works;
   - repair after a checksum fix → no banner;
   - 70 MB file: save latency (~write only), watch produced events.

## Validation
- `npm run check-types`
- `npm run lint`
- `npm test` (full)

## Review gates
- Before `task.py start`: artifacts complete; acceptance testable.
- Rollback: revert working tree (internal-only changes).