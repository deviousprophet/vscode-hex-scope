# Changelog

## [2.1.0] — 2026-05-01

### Added

- **Slide-in Struct Types panel** — a dedicated types panel now slides in from the right of the Struct Overlay section, opened via a hamburger button (☰) in the Struct Instances header; lists all defined types with edit and delete action buttons
- **Inline confirm popover** for destructive actions — deleting a struct type or a segment label now shows a small "Delete?" popover anchored above the button instead of deleting immediately
- **`updateLabelFormSel`** — the Add/Edit Label form auto-fills its address and range fields when the byte selection changes while the form is open
- **Auto-fill for empty names** — saving a struct type with a blank name generates a unique `MyStruct` / `MyStruct1` … name automatically; saving a label with a blank name generates `Label_0` / `Label_1` …; empty struct field names fall back to `field0`, `field1` …
- **`actionBtnsHtml` / `wireActionBtns` / `inlineConfirm`** helper functions extracted to `utils.ts` and shared across the Labels and Struct Types panels

### Changed

- Struct type editor no longer replaces the full section — it now renders inside the types slide-in panel; the separate "Edit Type" / "New Type" header row inside the editor form has been removed
- "Delete type" button removed from inside the type editor; deletion is now done from the types list with an inline confirm
- Add-Instance form reordered: instance name field now appears before the address field
- Switching away from the Struct Overlay sidebar tab resets the panel view state (slide-in panel closes, editing cancelled)
- Segment label delete action now uses the shared inline confirm popover instead of deleting on first click
- `struct-btn-danger` "Delete type" button removed from the editor toolbar

## [2.0.0] — 2026-05-01

### Added

- **Struct Overlay** — define named C-style struct types and pin them at any address in the memory view to decode live binary data field-by-field
  - Field types: `uint8`, `uint16`, `uint32`, `uint64`, `int8`, `int16`, `int32`, `int64`, `float32`, `float64`; optional array count per field
  - Inline type editor directly inside the Struct Overlay panel — create, edit, and delete struct types without leaving the sidebar
  - **C natural alignment** by default: fields are padded to their natural alignment boundary, trailing padding rounds the struct to its maximum field alignment
  - **`__attribute__((packed))` toggle button**: disable alignment/padding for packed structs
  - **Live C code preview** while editing: updates in real time as you change the struct name, fields, types, array counts, and packed toggle
  - Syntax highlighting in the C preview: `typedef`/`struct` in blue, field types and struct name in teal, `__attribute__((packed))` in purple, offset comments in green, padding lines rendered as `/* N bytes padding */` comments
  - **Move up / move down** arrow buttons on each field row to reorder fields during editing
  - Per-instance type preview button (⧉) that shows the C typedef of the assigned struct type
  - Per-field value display with selectable format: Hex, Decimal, ASCII, Binary — switchable globally or per-field via right-click context menu
  - Array fields collapse into a group header; expand to see individual element values
  - Field rows in expanded instances highlight the corresponding bytes in the memory grid on hover/click
  - **Repair checksums** action available per struct instance

- **Sidebar collapsible sections** — all sidebar panels (Labels, Inspector, Bit View, Multi-byte, Struct Overlay) are now individually collapsible and persist their collapsed state

- **Binary display type** in multi-byte interpreter and struct field values

- **Click label to jump**: clicking a label row in the Labels panel switches to the Memory view and scrolls smoothly to that label's start address

- **Error display and live reload**: parse errors and checksum warnings are surfaced in the UI; files are automatically reloaded when changed externally with a confirm prompt

- **Quick repair**: one-click recompute and rewrite of all record checksums for corrupted files

### Changed

- Struct Overlay tab renamed from "Struct" to "Struct Overlay"; section header renamed to "Struct Instances"
- All struct type management is now inline within the Struct Instances panel — the separate struct types panel has been removed
- Padding in aligned structs is shown as `/* N bytes padding */` comment lines instead of explicit `uint8_t _padX[N]` pseudo-fields
- Raw view and Records view styling improvements (per-field token colors, type badges)
- Intel HEX TextMate grammar cleaned up for more precise per-field token scopes

### Fixed

- Null-dereference crash when opening the struct type preview before any type was created

---

## [1.1.0] — 2026-04-10

### Added

- **Motorola SREC / S-Record support** — full parser for S0–S9 record types with one's-complement checksum validation, 2/3/4-byte address resolution (S1/S2/S3), and contiguous segment assembly; all five common file extensions registered (`.srec`, `.mot`, `.s19`, `.s28`, `.s37`)
- **SREC serializer** — Edit mode Save correctly rebuilds S1/S2/S3 data records preserving the original record type and address width, with recomputed one's-complement checksums
- **Format detection** — automatic IHEX/SREC detection by file extension with content-sniff fallback (`S[0-9]` prefix) for ambiguous extensions
- **SREC-aware Records view** — record type badges and color-coding for all nine SREC record types (Header S0, Data S1/S2/S3, Count S5/S6, End S7/S8/S9); format-aware `isData` classification
- **SREC Raw view tokenizer** — per-field syntax coloring for SREC lines in the Raw view (start code, type, byte count, address, data bytes, checksum)
- **Format badge** in the stats bar (`IHEX` or `SREC`) identifying the active parser
- **SREC TextMate grammar** (`syntaxes/srec.tmLanguage.json`) with per-field token scopes and default token colors registered in `package.json`
- **Shared parser types** (`src/parser/types.ts`) — `HexRecord`, `MemorySegment`, and `ParseResult` interfaces extracted so neither parser depends on the other

### Changed

- `SerializedParseResult` extended with `format: 'ihex' | 'srec'` discriminant field
- Parser comment style made consistent across `IntelHexParser.ts` and `SRecParser.ts`; `SRecParser.ts` no longer imports from `IntelHexParser.ts`
- Sample files reorganised into `sample/ihex/` and `sample/srec/` subdirectories; `sample/README.md` renamed to `sample/SAMPLE.md`

### Added (tests and samples)

- `src/test/srec-parser.test.ts` — 30+ unit tests for the SREC parser
- `src/test/ihex-samples.test.ts` — sample-file integration tests for all five Intel HEX samples
- `src/test/srec-samples.test.ts` — sample-file integration tests for all six SREC samples plus cross-format parity checks
- Six new SREC sample files: `minimal.srec`, `firmware_s1.srec`, `firmware_s3.srec`, `stm32_s3.srec`, `mixed_addr.srec`, `errors.srec`

---

## [1.0.0] — 2026-04-09

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

