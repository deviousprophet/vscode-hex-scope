# Support hash stored values

## Goal

Allow users to configure, inspect, compare, and update stored values for MD5 and SHA integrity checks, matching checksum behavior.

## Confirmed facts

- The integrity panel offers stored-value controls only when `isChecksumAlgorithm` accepts CRC16 or CRC32 (`src/core/integrity.ts:15`, `src/webview/components/sidebar/integrityPanel/integrityPanel.ts:495`).
- All supported algorithms have byte lengths, including MD5 (16), SHA-1 (20), SHA-256 (32), and SHA-512 (64) (`src/webview/components/sidebar/integrityPanel/integrityCalculation.ts:85`).
- Storage normalization currently discards stored addresses and disables automatic updates for non-checksum algorithms (`src/core/integrity.ts:190`, `src/webview/components/sidebar/integrityPanel/integrityCheckModel.ts:80`).
- The calculation pipeline already excludes a configured stored field from input and can read its bytes for comparison, but only for checksum algorithms (`src/webview/components/sidebar/integrityPanel/integrityCalculation.ts:77`).

## Requirements

- Extend stored-value support to MD5, SHA-1, SHA-256, and SHA-512.
- Preserve existing checksum behavior and persisted configurations.
- Respect each algorithm's full digest byte length when excluding, reading, highlighting, comparing, and writing the stored field.
- Validate malformed or unmapped stored fields using existing user-visible behavior.

## Acceptance Criteria

- [ ] Users can enter a stored-value address for each hash algorithm.
- [ ] A configured hash field is excluded from the hash input, read, highlighted, and compared against the calculated digest.
- [ ] Stored hash bytes are shown as match or mismatch using the existing integrity UI.
- [ ] Persisted hash stored-address and automatic-update settings round-trip without removal.
- [ ] Automatic-update and fix-all update full MD5/SHA digest bytes without altering CRC behavior.
- [ ] Targeted core and integrity-panel tests cover hash stored-field behavior.

## Out of scope

- New algorithms, alternate digest encodings, truncation, or endian semantics changes.

## Key decision

- Automatic-update and Fix all apply to hash checks, matching checksum behavior.
