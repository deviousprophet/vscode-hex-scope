# Tolerate trailing SUB (0x1A) in firmware file parse

## Goal

Legacy toolchains append the SUB character (0x1A) as an end-of-file marker to
generated firmware files. Hex Scope must load such files instead of failing
with "Could not open file" — while leaving any other use of 0x1A an error.

## Problem

A file ending with `\x1A` parses into an extra line (e.g. `...\n\x1A` -> a line
containing only `\x1A`) that fails with `Missing start code ":"` (ihex) /
`Missing "S" start code` (srec). That increments `malformedLines`, and
`hasParseErrors` (`src/hexEditorSession.ts:30`) forces
`redirectInvalidDocument` — the webview never loads.

## Requirements

- Strip a trailing run of one-or-more SUB (0x1A) characters from the source
  before line splitting: `source.replace(/\u001A+$/, '')`.
- Applies only when 0x1A is truly trailing — nothing after the run except EOF.
  A SUB followed by trailing whitespace (e.g. `\x1A `) is still an error.
- Fix lives in the shared record layer (`src/core/parser/records.ts`), so both
  the sync (`parseSourceRecords`) and async (`parseSourceRecordsAsync`) entry
  points behave the same, covering ihex + srec, initial load + live reload.
- Tolerance is read-only: silently accepted, no diagnostics added
  (`malformedLines` must not increase). Save/repair round-trip preserves the
  original bytes (SUB kept on disk).
- Any 0x1A not in the trailing-run position (mid-file, inside a record line,
  on a non-final SUB-only line) remains a parse error — behavior unchanged.

## Acceptance Criteria

- [ ] Unit regressions: trailing `\n\x1A`, trailing `\x1A` (no newline),
      multi-SUB trailing run, and (existing parser tests) pass — all produce
      the same parse result as the SUB-free source; `malformedLines` is 0.
- [ ] Unit regression: mid-file SUB-only line (not trailing) still yields a
      malformed line; count stays 1.
- [ ] SREC variant covered (trailing SUB on an SREC source also tolerated).
- [ ] Manual smoke: real legacy firmware file with trailing SUB opens in the
      hex viewer (no error redirect); saving leaves the file's trailing SUB
      intact.

## Out of Scope

- Stripping SUB anywhere but the trailing run.
- Writing clean output on save.
- Any change to format detection (`detectFormatFromParts` is unaffected —
  already verified it reads `raw.trimStart().slice(0, 4)`).