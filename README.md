# Hex Scope

[![Visual Studio Marketplace](https://img.shields.io/badge/Visual_Studio_Marketplace-blue)](https://marketplace.visualstudio.com/items?itemName=deviousprophet.vscode-hex-scope)
[![Open VSX Registry](https://img.shields.io/badge/Open_VSX_Registry-c160ef)](https://open-vsx.org/extension/deviousprophet/vscode-hex-scope)
[![GitHub Release](https://img.shields.io/github/v/release/deviousprophet/vscode-hex-scope?label=Latest%20Release&color=brightgreen&logo=github)](https://github.com/deviousprophet/vscode-hex-scope/releases)
[![License](https://img.shields.io/github/license/deviousprophet/vscode-hex-scope?color=yellow)](https://github.com/deviousprophet/vscode-hex-scope/blob/master/LICENSE)

Firmware memory explorer and editor for VS Code. Open Intel HEX and Motorola SREC files as address-aware memory, inspect binary data, decode C structs, verify integrity values, and patch bytes without leaving the editor.

![Demo](https://raw.githubusercontent.com/deviousprophet/vscode-hex-scope/main/images/demo.gif)

## Features

### View

- **Memory view** — address-aware grid mapped from firmware segments, with gaps rendered between mapped regions
- **Records view** — raw record table with type labels, addresses, byte counts, and per-record checksum status; jump from a record to its address in the Memory view

### Inspect

- **Inspector** — decode selected bytes as common scalar types in the shared per-file LE/BE byte order
- **Struct Overlay** — define C-style structs with arrays, nested structs, pointers, and bit fields; pin them at an address and re-decode live as selection or data changes
- **Search** — `Ctrl+F` / `Cmd+F`: byte sequence, numeric value (Auto/LE/BE), ASCII string, or address; matches highlight and jump in the Memory view

### Verify

- **Checks** — CRC-16, CRC-32, MD5, SHA-1, SHA-256, SHA-512 over any address range
- **Stored values** — compare computed vs. stored checksums, with mismatch and range highlighting
- **Auto fix / Fix all / Profiles** — stage corrections to stored values; reuse saved check setups

### Edit

- **Byte patching** — undoable edits (type, paste, batch fill); **Save** rewrites records and recomputes checksums
- **Quick Repair Checksums** — bulk-repair broken record checksums from the Explorer context menu
- **Copy & export** — selection as hex string, C array, ASCII, or the raw HEX/SREC record; add segment labels for navigation

### Script

TypeScript or JavaScript scripts in `.hexscope/scripts/` read/write hex data (writes confirm), compute CRC/hash values, run external processes, and fetch web services (SSRF-guarded). Operations that modify data or run external commands require explicit user confirmation. See [docs/SCRIPTING.md](docs/SCRIPTING.md) for the full guide, API reference, and examples.

## Supported file types

| Format | Extensions |
|---|---|
| Intel HEX | `.hex`, `.ihx`, `.ihex` |
| Motorola SREC | `.srec`, `.mot`, `.s19`, `.s28`, `.s37` |

## Quick usage

| Action | How |
|---|---|
| Open | Right-click a supported file → **Open with HexScope Viewer** |
| Views | Toolbar: **Memory** or **Records** |
| Search | `Ctrl+F`/`Cmd+F` — byte sequence, numeric value (Auto/LE/BE), ASCII string, or address |
| Edit | Click **Edit**, click a byte and type a hex value; right-click for batch fill; **Save** writes changes and recomputes checksums |
| Struct Overlay | Define C structs in the sidebar, pin them at addresses, decode live memory |
| Integrity | Configure checks in the sidebar, compare stored CRC values, reuse saved profiles |
| Scripts | Open the Scripts sidebar tab, pick a script from `.hexscope/scripts/`, run it |

## Issues

Found a bug or want to request a feature? Please open an issue: [Issues](https://github.com/deviousprophet/vscode-hex-scope/issues)

Include a short description, steps to reproduce, and sample files when possible.
