# Hex Scope

[![Visual Studio Marketplace](https://img.shields.io/badge/Visual_Studio_Marketplace-blue)](https://marketplace.visualstudio.com/items?itemName=deviousprophet.vscode-hex-scope)
[![Open VSX Registry](https://img.shields.io/badge/Open_VSX_Registry-c160ef)](https://open-vsx.org/extension/deviousprophet/vscode-hex-scope)
[![GitHub Release](https://img.shields.io/github/v/release/deviousprophet/vscode-hex-scope?label=Latest%20Release&color=brightgreen&logo=github)](https://github.com/deviousprophet/vscode-hex-scope/releases)
[![License](https://img.shields.io/github/license/deviousprophet/vscode-hex-scope?color=yellow)](https://github.com/deviousprophet/vscode-hex-scope/blob/master/LICENSE)

Firmware memory explorer and editor for VS Code. Open Intel HEX, Motorola SREC, and raw binary files as address-aware memory, inspect the data, decode C types, verify integrity values, and patch bytes without leaving the editor.

![Demo](https://raw.githubusercontent.com/deviousprophet/vscode-hex-scope/main/images/demo.gif)

## What it does

Hex Scope turns a firmware image into an address-aware hex grid. Gaps between mapped regions stay visible, and edits are applied by absolute address, so the same workflow works for Intel HEX, Motorola SREC, and raw `.bin` files. HEX/SREC files also get a Records view with per-record checksum status.

Select bytes to read them as scalar values or as a C-style type you define, with arrays, nested types, pointers, and bit fields. Search finds a byte sequence, a numeric value in either endianness, an ASCII string, or an address. Integrity checks compute CRC-16/32, MD5, or SHA-1/256/512 over a range and compare the result with the value stored in the image, highlighting mismatches and staging fixes.

Edits are undoable. Save rewrites the affected records and their checksums for HEX/SREC, while a raw binary is written byte-for-byte; Quick Repair fixes broken record checksums, and the read-only diff compares two images by address. Repetitive work can be scripted with TypeScript or JavaScript in `.hexscope/scripts/` for reading and writing bytes, computing hashes, running external tools, or calling HTTP endpoints, with confirmation for writes and external actions. See the [scripting guide](docs/SCRIPTING.md).

## Quick start

1. Right-click a supported file and choose **Open with HexScope Viewer**.
2. Choose **Edit**, change bytes, then **Save**.
3. Compare: **Set as 1st file to compare**, then **Compare with the 1st file**; or select two files and choose **Compare Two Files**.
4. For a raw `.bin`, set its base address in the profile bar. The value is stored per file and reused.

## Supported formats

| Format | Extensions |
|---|---|
| Intel HEX | `.hex`, `.ihx`, `.ihex` |
| Motorola SREC | `.srec`, `.mot`, `.s19`, `.s28`, `.s37` |
| Raw binary | `.bin` |

Raw `.bin` files contain no addresses, so they open at their stored per-file base (or `0x00000000` when none is set).

## Documentation

- [Scripting guide](docs/SCRIPTING.md) — scripts, API reference, and examples
- [Storage layout](docs/HEXSCOPE_STORAGE.md) — `.hexscope/` profiles and data
- [Changelog](CHANGELOG.md)
- [License](LICENSE)

## Issues

Found a bug or want a feature? Open an issue: [Issues](https://github.com/deviousprophet/vscode-hex-scope/issues). Include a short description, steps to reproduce, and sample files when possible.
