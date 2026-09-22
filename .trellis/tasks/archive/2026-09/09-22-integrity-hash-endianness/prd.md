# Hashes must not be endian-reversed in integrity compare/display

## Goal

Stored-value handling for integrity checks applies the panel's endian toggle to
every algorithm. That is correct for CRC16/CRC32 (genuine little-endian integers
serialized to memory) but wrong for MD5/SHA digests, which are fixed byte
sequences with no integer endianness. When the panel endian is LE, a byte-perfect
hash match is reported as Mismatch, and Auto fix / Fix all overwrite the correct
stored digest with a reversed one.

## Confirmed facts

- `isChecksumAlgorithm()` correctly classifies CRC16/CRC32 as `true` and
  MD5/SHA-1/SHA-256/SHA-512 as `false`, but is only referenced by its own test
  (`src/core/integrity.ts:15`; `src/test/core/integrity.test.ts`).
- Expected bytes are built with the raw endian toggle for every algorithm:
  `check.expectedBytes = integrityValueToBytes(result.value, hooks.endian())`
  (`src/webview/components/sidebar/integrityPanel/integrityCalculation.ts:143`).
- The stored pane reverses stored bytes for display and labels the pane with the
  endian tag for every algorithm (`.../integrityResultRender.ts:142`, `:144`,
  plus the pending twin at `:106`).
- The calculated pane already shows `result.value` in natural order
  (`.../integrityResultRender.ts:131`), so only the stored/expected side is off.
- Comparison, status, highlight and writeback all derive from `expectedBytes`:
  `integrityBytesEqual` (`.../integrityResultRender.ts:53,58,70`),
  `storedValueUpdate` → highlight (`.../integrityHighlight.ts:60`), and Auto fix
  writeback (`.../integrityPanel.ts:685`). Fixing `expectedBytes` fixes all of
  them; the stored-pane reversal must be fixed separately.

## Requirements

- Hashes (MD5/SHA-*) must always use natural byte order (`'be'`, no reversal)
  when computing expected bytes, comparing, displaying the stored pane, and
  writing Auto fix / Fix all.
- Checksums (CRC16/CRC32) must keep honoring the panel endian toggle exactly as
  today.
- The stored-pane endian tag must not be shown for hash checks (only checksums
  have a meaningful byte order).
- No changes to persisted schema, stored-digit encoding, or algorithm set.

## Acceptance Criteria

- [ ] With endian=LE and a correct stored SHA-256/MD5 digest, the check reports
      Match (not Mismatch) and no auto-fix is staged.
- [ ] With endian=LE and a genuinely wrong stored hash, the check reports
      Mismatch and Auto fix / Fix all write the natural-order digest bytes.
- [ ] With endian=LE, CRC16/CRC32 comparison/display/writeback behave exactly as
      before (regression-covered by existing tests).
- [ ] The stored pane shows the `(LE)`/`(BE)` tag for checksums and no endian tag
      for hashes.
- [ ] Targeted tests cover hash expected/stored bytes under endian=LE.

## Out of scope

- New algorithms, digest truncation, alternate hash encodings, or changing what
  the endian toggle means.
- Changing the calculated-pane formatting.

## Key decision

- Reuse the existing, tested `isChecksumAlgorithm()` predicate as the single
  byte-order gate rather than duplicating algorithm checks.
