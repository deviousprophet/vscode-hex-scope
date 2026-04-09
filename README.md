# HexScope

A VS Code custom editor for Intel HEX (`.hex`) files. Open any embedded firmware image and inspect its memory layout, analyze byte values, search the address space, patch bytes in-place, and annotate address ranges — all without leaving the editor.

## Opening a file

Right-click a `.hex` file in the Explorer and choose **Open with HexScope Viewer**, or click the button that appears in the editor title bar when a `.hex` file is open.

## Views

Switch views using the toolbar tabs at the top of the editor.

### Memory

The default view. Shows firmware data as a 16-byte hex grid with:

- **Address column** — 32-bit base address for each row
- **Hex cells** — two-digit uppercase hex; color-coded by byte class (zero, printable ASCII, high byte, control)
- **Decoded text column** — printable ASCII characters; non-printable bytes shown as `·`
- **Column hover** — hovering any cell highlights the full column and the column header
- **Gap rows** — non-contiguous address ranges are collapsed into a single separator row showing the skip size
- **Segment label banners** — named address-range annotations appear inline above the first row of each range

### Records

A table of every record parsed from the raw file, showing line number, record type badge (Data, EOF, Extended Linear Address, etc.), the 16-bit address field, the resolved 32-bit address, byte count, raw data bytes, checksum byte, and whether the checksum is valid.

### Raw

The original Intel HEX source with syntax highlighting. A TextMate grammar assigns distinct colors to the start code, byte count, address field, record type, data bytes, and checksum.

## Inspector sidebar

Click any byte in the memory grid to populate the sidebar panels.

### Single byte selected

- Large hex chip (`0xHH`), decimal value, and ASCII character (if printable) — click any chip to copy it
- Nibble-grouped binary string (e.g. `0100 0001`) — click to copy
- **Bit view** — 8-column grid, lit squares for set bits; bit index header (7→0); column hover

### Multiple bytes selected

- Raw hex byte dump (first 8 bytes, `…` if longer) — click to copy
- **Multi-byte interpreter** — reads the selection as the smallest fitting type:
  | Selection | Types shown |
  |-----------|-------------|
  | 2 bytes   | `uint16`, `int16` |
  | 4 bytes   | `uint32`, `int32`, `float32` |
  | 8 bytes   | `float64` |
  - Little-endian / Big-endian toggle; click any value to copy
- **Bit view** — one row per byte, up to 8 bytes; total set-bit count shown

## Search

Press `Ctrl+F` (`Cmd+F` on macOS) to focus the search bar.

| Mode | Input |
|------|-------|
| **Hex** | Space-separated hex bytes, e.g. `DE AD BE EF` |
| **ASCII** | Plain text string, e.g. `HELLO` |
| **Addr** | Hex or decimal address, e.g. `0x08001000` |

Navigate matches with the `‹` / `›` buttons or `Enter` / `Shift+Enter`. The active match is scrolled into view automatically.

## Edit mode

Click **✏ Edit** in the toolbar to enter edit mode.

- **Right-click → Patch** on a single byte to zero it, fill with `0xFF` (erased flash), or enter a custom hex value
- **Right-click → Fill/Patch** on a multi-byte selection applies the same operation to all selected bytes
- Edited bytes are highlighted in amber with an underline in the memory grid
- The toolbar shows the pending change count and a **💾 Save** button
- **Save** rebuilds the Intel HEX data records with updated bytes, recomputes per-record checksums, and writes the file to disk
- **✕ Cancel** discards all pending edits and restores the original values
- **Ctrl+Z** undoes the last edit operation

## Right-click context menu

### Single byte

| Submenu | Actions |
|---------|---------|
| **Copy** | Hex, Decimal, Binary, ASCII (if printable) |
| **Patch** *(edit mode only)* | Zero, Erased flash (`0xFF`), Custom hex value |

### Multiple bytes selected

| Submenu | Actions |
|---------|---------|
| **Copy** | Hex (spaces), Hex (compact), Binary, ASCII, Decimal array, Hex array, C array, Base64 — each with a value preview |
| **Analyze** | Sum, XOR, CRC-8 (poly `0x07`), CRC-16 (IBM/USB), CRC-32 (zlib/Ethernet) — computed inline, click to copy |
| **Fill/Patch** *(edit mode only)* | Zero, Erased flash (`0xFF`), Custom hex value |

## Segment labels

Label address ranges with a name and color to annotate firmware regions (e.g., interrupt vectors, application code, configuration data).

- Add a label from the sidebar form or via the **HexScope: Add Segment Label** command
- Labels appear as colored banners in the memory grid at the start of each annotated range
- Labels can be reordered, hidden, edited, or deleted from the sidebar
- Labels are persisted per workspace per file

## Commands

| Command | Description |
|---------|-------------|
| `Open with HexScope Viewer` | Open the selected or active `.hex` file in HexScope |
| `HexScope: Add Segment Label` | Open the segment label creation form |
| `HexScope: Copy Selection as Hex String` | Copy selected bytes as a hex string |
| `HexScope: Copy Selection as C Array` | Copy selected bytes as a C byte array literal |
| `HexScope: Copy Selection as ASCII` | Copy selected bytes as ASCII text |
| `HexScope: Copy Raw HEX Record` | Copy the raw Intel HEX record line(s) for the selection |

## Supported Intel HEX record types

| Type | Name |
|------|------|
| `00` | Data |
| `01` | End of File |
| `02` | Extended Segment Address |
| `03` | Start Segment Address |
| `04` | Extended Linear Address |
| `05` | Start Linear Address |

Both Extended Linear Address (type 04) and Extended Segment Address (type 02) are fully supported for 32-bit address resolution.

## Limitations

- Only Intel HEX format is supported; SREC / Motorola S-Record is not
- Edit mode modifies data record bytes only; address extension records and start-address records are preserved unchanged


## Features

### Memory View
- Full hex grid with address column and decoded-text column
- Drag-to-select across byte and text cells
- Column hover highlight
- 4-byte group spacing for easy reading
- Gap rows for non-contiguous address ranges
- Search: Hex bytes, ASCII string, or address (`Ctrl+F`)

### Inspector (sidebar)
**Single byte selected:**
- Prominent `0xHH` hex chip, decimal value, and ASCII character (if printable) — each clickable to copy
- Nibble-grouped binary string — click to copy

**Multiple bytes selected:**
- Raw hex byte dump — click to copy
- Multi-byte interpreter (see below)
- Bit grid for all selected bytes (up to 8)

### Multi-Byte Interpreter
Automatically interprets the selection as the smallest fitting type:
- 2 bytes: `uint16`, `int16`
- 4 bytes: `uint32`, `int32`, `float32`
- 8 bytes: `float64`

Unsigned types show decimal and hex stacked — click either to copy.
Signed and float types show a single value — click to copy.
Little-endian / Big-endian toggle.

### Bit View
Always-visible grid showing each byte as 8 color squares (lit = 1, dark = 0).
Bit index header (7 → 0). Column hover highlights the same bit position across all rows.
Shows up to 8 bytes for multi-byte selections.

### Right-Click Context Menu
**Single byte:**
- Copy submenu: Hex, Decimal, Binary, ASCII (if printable)
- Patch submenu *(edit mode only)*: Zero, Erased flash (0xFF), Custom hex value

**Multiple bytes:**
- Copy submenu: Hex (spaces), Hex (raw), Binary, ASCII, Decimal Array, Hex Array, C Array, Base64 — each with a live value preview
- Analyze submenu: Sum, XOR, CRC-8, CRC-16, CRC-32 — values pre-computed, click to copy
- Fill / Patch submenu *(edit mode only)*: Zero, Erased flash (0xFF), Custom hex value

### Edit Mode
Toggle `✏ Edit` in the toolbar to enter edit mode.
- Fill / Patch submenu becomes available in the right-click menu
- Edited bytes are highlighted in amber with underline in the memory grid
- Unsaved byte count and `💾 Save` button appear in the toolbar
- Clicking Save writes the patched Intel HEX back to disk with correct checksums per record

### Views
- **Memory** — hex grid (default)
- **Records** — table of all Intel HEX records with type badges, addresses, checksums
- **Raw** — syntax-highlighted source with per-field token coloring

### Segment Labels
- Add named, colored address-range labels from the sidebar
- Labels appear as banners in the memory grid
- Toggle visibility, reorder, edit, or delete labels
- Labels are persisted per workspace per file

