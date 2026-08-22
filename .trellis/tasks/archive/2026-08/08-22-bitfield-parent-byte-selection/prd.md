# Fix #179: bit-field parent field selects 6 bytes instead of 2

## Goal

Issue #179: when a struct field is split into multiple bit-fields (e.g. `uint16_t` broken into 3 sub-fields `a:4 b:6 c:6`), clicking the parent field row (the `uint16_t` container itself) selects the sum of the children's storage bytes (2×3 = 6) in the hex view, instead of the parent's own storage size (2).

## Requirements

- Clicking a non-array bit-field container row selects exactly its underlying storage unit size in bytes (e.g. `uint16_t` → 2 bytes), not the sum across child bit-fields.
- Array bit-field containers must keep selecting `storageUnitSize * elementCount`.
- Bit-field child rows (a/b/c) keep their current per-row selection behavior.
- Display-side type/byte label on the parent row is already correct and must not change.

## Acceptance Criteria

- [x] Non-array bit-field container (e.g. `uint16_t` with 3 sub-fields) selects 2 bytes on click.
- [x] Array bit-field container selects storage unit size × element count (unchanged: `decodedRowByteCount(rows[0]) * count`).
- [x] Bit-field child rows still select their own storage unit.
- [x] Existing struct/structPanel tests pass (54 passing, incl. new #179 regression test).

## Notes

- Root cause: `structGroupByteCount` (src/webview/components/sidebar/structPanel/structPanel.ts) uses `sumDecodedRowBytes(rows)` for non-array bit-units, which sums each child's full storage size.
- `data-byte-cnt` drives both the click selection and the hover highlight range.
- Lightweight PRD-only task.