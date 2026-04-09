# Changelog

## [0.0.1] — 2026-04-09

### Added

- Custom editor for Intel HEX (`.hex`) files, registered for `*.hex` via VS Code's custom editor API
- Intel HEX parser supporting all six record types: Data, End of File, Extended Segment Address, Start Segment Address, Extended Linear Address, and Start Linear Address
- 32-bit address resolution for both Extended Linear Address (type 04) and Extended Segment Address (type 02) modes
- Per-record checksum validation with error and malformed-line counters
- Contiguous memory segment assembly from valid data records
- **Memory view**: 16-byte hex grid with address column, decoded-text column, 4-byte group spacing, and column hover highlight
- **Records view**: table of all parsed HEX records with type badges, address fields, byte counts, and checksum status
- **Raw view**: syntax-highlighted Intel HEX source using a bundled TextMate grammar
- **Inspector sidebar**: single-byte display (hex chip, decimal, ASCII, nibble-grouped binary — each click-to-copy); multi-byte raw hex dump
- **Bit view** sidebar panel: 8-column bit grid per byte; supports up to 8 bytes for multi-byte selections; bit index header (7→0); column hover highlight
- **Multi-byte interpreter**: interprets selection as smallest fitting type — `uint16`/`int16` (2 bytes), `uint32`/`int32`/`float32` (4 bytes), `float64` (8 bytes); little-endian / big-endian toggle; click-to-copy values
- **Search** (`Ctrl+F`): hex-byte sequence, ASCII string, and address search modes with next/previous match navigation
- **Edit mode**: toolbar toggle; in-place byte patching; undo (`Ctrl+Z`); edited bytes highlighted in amber; `💾 Save` writes a corrected Intel HEX file to disk with recomputed per-record checksums
- **Right-click context menu** — single byte: Copy (Hex, Decimal, Binary, ASCII) and Patch submenus; multi-byte: Copy (8 formats with live preview), Analyze (Sum, XOR, CRC-8, CRC-16, CRC-32), and Fill/Patch submenus
- Gap rows in the memory grid indicate non-contiguous address ranges with the unmapped byte count
- **Segment labels**: named, color-coded address-range banners rendered inline in the memory grid; persisted per workspace per file via `workspaceState`; supports add, edit, delete, reorder, and visibility toggle
- `Open with HexScope Viewer` command available in Explorer context menu and editor title button for `.hex` files
- Commands: `hexScope.openInHexScope`, `hexScope.addSegmentLabel`, `hexScope.copyAsHexString`, `hexScope.copyAsCArray`, `hexScope.copyAsAscii`, `hexScope.copyRawRecord`
- Intel HEX syntax highlighting via TextMate grammar with per-field token coloring (start code, byte count, address, record type, data, checksum)
- Drag-to-select bytes across hex cells and decoded-text cells in the memory grid

