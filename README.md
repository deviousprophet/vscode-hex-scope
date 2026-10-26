# Hex Scope

[![Visual Studio Marketplace](https://img.shields.io/badge/Visual_Studio_Marketplace-blue)](https://marketplace.visualstudio.com/items?itemName=deviousprophet.vscode-hex-scope)
[![Open VSX Registry](https://img.shields.io/badge/Open_VSX_Registry-c160ef)](https://open-vsx.org/extension/deviousprophet/vscode-hex-scope)
[![GitHub Release](https://img.shields.io/github/v/release/deviousprophet/vscode-hex-scope?label=Latest%20Release&color=brightgreen&logo=github)](https://github.com/deviousprophet/vscode-hex-scope/releases)
[![License](https://img.shields.io/github/license/deviousprophet/vscode-hex-scope?color=yellow)](https://github.com/deviousprophet/vscode-hex-scope/blob/master/LICENSE)

Firmware memory explorer and editor for VS Code. Open Intel HEX, Motorola SREC, and raw binary files as address-aware memory, inspect binary data, decode C types, verify integrity values, and patch bytes without leaving the editor.

![Demo](https://raw.githubusercontent.com/deviousprophet/vscode-hex-scope/main/images/demo.gif)

## Table of Contents

- [Features](#features)
- [Quick usage](#quick-usage)
- [Supported file types](#supported-file-types)
- [Documentation](#documentation)
- [Issues](#issues)

## Features

### View

- **Memory view** — address-aware grid mapped from firmware segments, with gaps rendered between mapped regions; raw `.bin` images map as one contiguous segment at a chosen base address
- **Records view** — raw record table with type labels, addresses, byte counts, and per-record checksum status; jump from a record to its address in the Memory view (Intel HEX / SREC only)

### Inspect

- **Inspector** — decode selected bytes as common scalar types in the shared per-file LE/BE byte order
- **Type Overlay** — define C-style types with arrays, nested types, pointers, and bit fields; pin them at an address and re-decode live as selection or data changes
- **Search** — `Ctrl+F` / `Cmd+F`: byte sequence, numeric value (Auto/LE/BE), ASCII string, or address; matches highlight and jump in the Memory view

### Verify

- **Checks** — CRC-16, CRC-32, MD5, SHA-1, SHA-256, SHA-512 over any address range
- **Stored values** — compare computed vs. stored checksums, with mismatch and range highlighting
- **Auto fix / Fix all / Profiles** — stage corrections to stored values; reuse saved check setups

### Edit

- **Byte patching** — undoable edits (type, paste, batch fill); **Save** rewrites records and recomputes checksums, or writes raw `.bin` bytes with no checksum work
- **Quick Repair Checksums** — bulk-repair broken record checksums from the Explorer context menu (Intel HEX / SREC only)
- **Copy & export** — selection as hex string, C array, ASCII, or the raw HEX/SREC record; add segment labels for navigation

### Script

TypeScript or JavaScript scripts in `.hexscope/scripts/` read/write hex data (writes confirm), compute CRC/hash values, run external processes, and fetch web services (SSRF-guarded). Operations that modify data or run external commands require explicit user confirmation. See [docs/SCRIPTING.md](docs/SCRIPTING.md) for the full guide, API reference, and examples.

## Supported file types

| Format | Extensions |
|---|---|
| Intel HEX | `.hex`, `.ihx`, `.ihex` |
| Motorola SREC | `.srec`, `.mot`, `.s19`, `.s28`, `.s37` |
| Raw binary | `.bin` |

Raw binary files have no embedded addresses. Open one with **Open with HexScope Viewer**: it maps at its stored per-file base address, or `0x00000000` when none is stored. Opening never prompts and never writes `.hexscope`. For `.bin` files the profile bar shows a **Base Address** field after the profile picker: an always-visible text box with a fixed `0x` prefix and eight hex digits. The text box is disabled until you choose **Edit**, then it is enabled and **Save** and **Cancel** replace **Edit**; type the hexadecimal address where byte 0 maps (for example `08000000`) and choose **Save** (or press Enter), or choose **Cancel** (or press Escape) to restore the current value and disable the text box again. Clicking away from the field never commits. Invalid, empty, or overflowing input shows an inline error and stays in edit mode. The value is stored per file in `.hexscope/bindings.json`, independent of the annotation profile, so the file stays **No Profile** until you pick one and switching, duplicating, or deleting a profile never changes the base. **Edit** is disabled while edits are unsaved or an external change is unresolved. A stored value that no longer fits a grown file maps at `0x00000000` until you commit a new one. The field is the only place the base is displayed; the stats bar shows only `BIN`, bytes, and segments. The **Set Raw Binary Base Address** palette command enters edit mode and is not listed in the HexScope submenu. The open grid re-anchors without rewriting the file, and comparison/diff never writes `.hexscope`.

A raw side's base can also be changed for the open comparison only. Each raw side head shows its effective **Base**; choose **Edit base**, type the eight hex digits (the `0x` prefix is fixed), and press **Apply** or Enter. The diff re-aligns immediately and the head shows an `override` marker plus **Reset**, which returns to the file's stored base. The override is never saved to `.hexscope` or the profile bar, and closing the diff discards it. The diff toolbar actions share one uniform size and use the editor theme's secondary/primary button colors, so the active view and **Sync scroll** state stay readable in light and dark themes.

## Quick usage

| Action | How |
|---|---|
| Open | Right-click a supported file → **Open with HexScope Viewer** (a `.bin` opens at its stored per-file base, else `0x00000000`) |
| Views | Toolbar: **Memory** or **Records** (`Records` is hidden for raw binaries) |
| Search | `Ctrl+F`/`Cmd+F` — byte sequence, numeric value (Auto/LE/BE), ASCII string, or address |
| Edit | Click **Edit**, click a byte and type a hex value; right-click for batch fill; **Save** writes changes and recomputes checksums (raw `.bin` saves only the bytes) |
| Save & checksums | **Save** rewrites records and recomputes record checksums (raw `.bin` writes the buffer as-is) |
| Base address | Raw binary: choose **Edit** in the **Base Address** field in the profile bar (or run **Set Raw Binary Base Address**), type the eight hex digits where byte 0 maps (the `0x` prefix is fixed), then **Save**/Enter to commit or **Cancel**/Escape to revert; save or discard edits and resolve any external change first |
| Quick Repair | Right-click broken file → **Quick Repair Checksums** (Intel HEX / SREC only) |
| Compare | **Set as 1st file to compare** then **Compare with the 1st file**, or select two files → **Compare Two Files**; `.bin` files compare by absolute address against `.bin`, `.hex`, or `.srec` |
| Type Overlay | Define C types in the sidebar, pin them at addresses, decode live memory |
| Integrity | Configure checks in the sidebar, compare stored CRC values, reuse saved profiles |
| Scripts | Open the Scripts sidebar tab, pick a script from `.hexscope/scripts/`, run it |

## Documentation

- [Scripting guide](docs/SCRIPTING.md) — scripts, API reference, and examples
- [Storage layout](docs/HEXSCOPE_STORAGE.md) — `.hexscope/` profiles and stored data
- [Changelog](CHANGELOG.md)
- [License](LICENSE)

## Issues

Found a bug or want to request a feature? Please open an issue: [Issues](https://github.com/deviousprophet/vscode-hex-scope/issues)

Include a short description, steps to reproduce, and sample files when possible.
