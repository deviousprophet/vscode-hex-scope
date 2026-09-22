# Implement: Hashes must not be endian-reversed

Lightweight fix. Two source edits + tests + one spec contract line. No schema or
model change. Single commit, revertable in one step.

## Ordered checklist

1. **Core gate** — `src/webview/components/sidebar/integrityPanel/integrityCalculation.ts`
   - Import `isChecksumAlgorithm` from `../../../../core/integrity`.
   - `applyCalculatedResultIfCurrent` (line ~143): compute
     `const byteOrder = isChecksumAlgorithm(check.algorithm) ? hooks.endian() : 'be';`
     and pass it to `integrityValueToBytes(result.value, byteOrder)`.
   - Verify add: `endian` is already in the import block; add `isChecksumAlgorithm`.

2. **Stored pane render** — `src/webview/components/sidebar/integrityPanel/integrityResultRender.ts`
   - `storedResultHtml` (line ~138): gate the value with the same `byteOrder`
     (`'be'` for hashes) and set the header span to the endian tag only for
     checksums:
     `const label = isChecksumAlgorithm(check.algorithm) ? \`Stored (${deps.endian().toUpperCase()})\` : 'Stored';`
   - `pendingStoredResultHtml` (line ~104): same label rule (value is `0x—` there,
     but keep the header consistent so it does not flash `(LE)` for hashes).
   - Import `isChecksumAlgorithm`.

3. **Tests**
   - `src/test/webview/components/sidebar/integrityPanel/integrityPanel.test.ts`:
     add a hash (e.g. SHA-256) case with `endian() === 'le'` and correct stored
     bytes → status Match, no staged edits. Add a wrong-stored-hash case →
     Mismatch + Auto fix stages natural-order digest bytes.
   - Assert the stored header label has no `(LE)`/`(BE)` for a hash and still has
     it for a CRC check (guard against regressing checksum labeling).
   - Existing CRC `endian='le'` assertions (e.g. `integrityPanel.test.ts:344-345`)
     must stay green unchanged.

4. **Spec** — `src/test` untouched specs OK; update the contract line in
   `.trellis/spec/frontend/integrity-checks.md` so byte order is explicitly
   checksum-only (see §3 contracts 41-43). Defer to Phase 3.3.

## Validation commands

```text
npm run check-types
npm run lint
npm test
```

Targeted first (if the runner supports a filter): integrity panel + core
integrity suites, then the full `npm test` gate before handoff.

## Review gates

- Gate A (step 2 done): re-read `integrityResultRender.ts` and confirm hashes
  never reach `integrityBytesToValueHex` with `'le'`.
- Gate B (step 3 done): targeted tests green; CRC byte-order assertions
  unchanged.
- Gate C (Phase 2.2): full `npm run check-types`, `npm run lint`, `npm test`.

## Rollback

Single focused commit on `fix/integrity-hash-endianness`; revert that commit to
restore prior behavior. No data migration or persisted-state change, so rollback
has no cleanup.
