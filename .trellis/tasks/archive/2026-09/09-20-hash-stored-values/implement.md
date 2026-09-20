# Implementation Plan

1. Locate and replace checksum-only stored-value gates in core normalization, form visibility/validation, model persistence, calculation, rendering, highlighting, and auto-fix paths.
2. Keep algorithm output length centralized in `integrityOutputByteLength`; use it for all stored-field operations.
3. Update core and panel/model tests for MD5 and SHA stored-field persistence, exclusion, comparison, automatic updates, and Fix all.
4. Update the Integrity Checks and Profiles spec plus Integrity Panel component spec to remove the checksum-only rule.
5. Run `npm run check-types`, `npm run lint`, and `npm test`.

## Risk checks

- Verify full SHA-512 fields respect the unsigned 32-bit address boundary.
- Verify Fix all remains atomic on overlapping digest writes.
- Verify CRC behavior and byte-order handling remain unchanged.
