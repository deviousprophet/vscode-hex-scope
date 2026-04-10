# HexScope — Roadmap

This file tracks planned features. Work through this list one branch at a time.

---

## Planned Features

### 1. Entropy Heatmap

Visualize byte entropy (Shannon entropy, sliding window) as a color overlay on the memory grid.
Highlights compressed/encrypted regions, padding (`0x00` / `0xFF` floods), and code vs. data boundaries.
- Toggle via toolbar button
- Configurable window size (16, 64, 256 bytes)
- Color gradient: blue (low entropy) → red (high entropy)
- Per-cell tooltip showing entropy value

---

### 2. Diff View / Hex Compare

Side-by-side comparison of two firmware images (Intel HEX or SREC).
- Open via command palette: `HexScope: Compare Two Files`
- Highlights added, removed, and changed bytes
- Address-aligned layout; shows both addresses when segments differ
- Export diff summary (CSV or plain text)

---

### 3. Struct / Type Overlay

Define C-like struct layouts and project them onto a selected address.
- Struct definition panel (inline editor): field name, type (`uint8`, `uint16`, `uint32`, `float`, array), endianness
- Apply to address: renders a decoded table in the sidebar
- Save/load struct definitions per workspace
- Built-in presets: ARM Cortex-M vector table, common MCU peripheral register blocks

---

### 4. Address-Space Minimap

A narrow, vertically-scrollable panel showing the full 32-bit address space.
- Colored blocks for occupied segments
- Segment label overlays
- Viewport indicator (current scroll position)
- Click to jump to an address range

---

### 5. Jump-to-Address Input

Quick navigation bar (or dedicated button near the toolbar search area) to scroll to an arbitrary address.
- Accepts hex (`0x08000000`, `08000000`) or decimal
- Highlights the target byte briefly on arrival
- Keyboard shortcut: `Ctrl+G` inside the memory view

---

### 6. Map File / Symbol Overlay

Import GCC / IAR / Keil `.map` files to annotate addresses with function and variable names.
- Auto-detects a `.map` file alongside the opened `.hex` / `.srec`
- Renders symbol names as banners in the memory grid (similar to segment labels)
- Searchable symbol list in the sidebar

---

### 7. Multi-File Merge

Merge two or more `.hex` / `.srec` files into one combined image.
- Overlap detection with configurable conflict resolution (keep first, keep last, error)
- Useful for bootloader + application workflows
- Export as Intel HEX or SREC

---

### 8. Raw Binary (`.bin`) Import

Load flat binary files with a configurable load address.
- Input dialog for base address
- Full support in memory grid, sidebar, search, and segment labels
- Export back as Intel HEX or SREC
