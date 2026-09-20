# Design

## Boundary

Replace the checksum-only stored-value eligibility predicate with an integrity-algorithm predicate at each existing stored-field decision point. Keep `isChecksumAlgorithm` only if another behavior is genuinely CRC-specific; this feature has no CRC-only stored-field behavior.

## Data flow

1. A user selects any supported integrity algorithm and enters an optional stored address.
2. The panel validates, persists, reloads, highlights, excludes, reads, compares, and writes the stored field using `integrityOutputByteLength(algorithm)`.
3. Core normalization retains `storedAddress` and `autoFixStoredValue` for every valid integrity algorithm.
4. Auto fix and Fix all reuse existing edit merging and transaction callbacks, including conflict handling and suppression.

## Compatibility

Existing CRC configurations retain their values and behavior. Previously saved hash configurations lacking a stored address remain valid. Stored hash configuration from future or manually authored data now normalizes instead of being removed.

## Constraints

- No protocol, schema-version, algorithm, encoding, byte-order, or storage-format change.
- Full digest lengths must be address-space safe through existing stored-field validation.
- Existing unmapped-byte, overlap, stale-result, suppression, and Fix-all conflict behavior remains authoritative.

## Rollback

Revert the eligibility expansion. Persisted hash stored fields will be safely ignored by prior normalization behavior.
