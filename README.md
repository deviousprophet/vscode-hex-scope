# HexScope

[![Marketplace](https://img.shields.io/badge/VS_Code-Marketplace-blue?logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=deviousprophet.vscode-hex-scope)
[![GitHub](https://img.shields.io/badge/GitHub-Repository-brightgreen?logo=github)](https://github.com/deviousprophet/vscode-hex-scope)
[![License](https://img.shields.io/badge/License-MIT-yellow)](https://github.com/deviousprophet/vscode-hex-scope/blob/master/LICENSE)

Firmware memory explorer and editor for VS Code. Open Intel HEX and Motorola SREC files as address-aware memory, inspect binary data, decode C structs, verify integrity values, and patch bytes without leaving the editor.

## Core features

### View and navigate

- Address-aware Memory view with mapped segments and gaps
- Record view for raw firmware records
- Search by byte sequence, numeric value, ASCII text, or address

### Inspect and decode

- Inspector for selected bytes using a shared per-file LE/BE byte order
- Struct Overlay for C-style structs, arrays, nested structs, pointers, and bit fields
- Live decoding updates as selection, byte order, or pending edits change

### Integrity and editing

- Multiple CRC16, CRC32, MD5, SHA-1, SHA-256, and SHA-512 checks
- Stored CRC comparison, range highlighting, Auto fix, Fix all, and reusable profiles
- Undoable byte patching with explicit Save and automatic record-checksum updates

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
| Edit | Click **Edit** to patch bytes; **Save** writes changes and recomputes checksums |
| Search | `Ctrl+F` — search by byte sequence, numeric value (Auto/LE/BE), ASCII string, or address |
| Struct Overlay | Define C structs, pin them at addresses, and decode live memory |
| Integrity Checks | Configure checks, compare stored CRC values, and reuse saved profiles |

## Issues

Found a bug or want to request a feature? Please open an issue: [Issues](https://github.com/deviousprophet/vscode-hex-scope/issues)

Include a short description, steps to reproduce, and sample files when possible.
