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

Raw binary files have no embedded addresses. Open one with **Open with HexScope Viewer**; the first open asks for the hexadecimal base address where byte 0 maps (for example `0x08000000`) and stores it on the bound `.hexscope` profile. Later opens reuse the stored value silently while it still fits the file (a grown file re-prompts). Change it any time from the **Base** stat in the stats bar or with **Set Raw Binary Base Address** — the profile is updated and the open grid re-anchors without rewriting the file. Files bound to the same profile share one memory map — duplicate the profile when you need a different base address. Closing the first-open prompt cancels the open; comparison-only base addresses are never written to `.hexscope`.

## Quick usage

| Action | How |
|---|---|
| Open | Right-click a supported file → **Open with HexScope Viewer** (a `.bin` prompts for its base address on first open, then reuses the stored value) |
| Views | Toolbar: **Memory** or **Records** (`Records` is hidden for raw binaries) |
| Search | `Ctrl+F`/`Cmd+F` — byte sequence, numeric value (Auto/LE/BE), ASCII string, or address |
| Edit | Click **Edit**, click a byte and type a hex value; right-click for batch fill; **Save** writes changes and recomputes checksums (raw `.bin` saves only the bytes) |
| Save & checksums | **Save** rewrites records and recomputes record checksums (raw `.bin` writes the buffer as-is) |
| Base address | Raw binary: click the **Base** value in the stats bar or run **Set Raw Binary Base Address**; save or discard edits and resolve any external change first |
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
