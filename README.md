# HexScope

VS Code extension for viewing and analyzing firmware files (HEX, SREC) with hex grid, search, patching.

## Supported file types

| Format | Extensions |
|---|---|
| Intel HEX | `.hex` |
| Motorola SREC | `.srec`, `.mot`, `.s19`, `.s28`, `.s37` |

## Quick usage

| Action | How |
|---|---|
| Open | Right-click a supported file → **Open with HexScope Viewer** |
| Views | Toolbar: **Memory** (edit, search, labels, structs), **Records** (read-only record table) |
| Edit | Click **Edit** to patch bytes; **Save** writes changes and recomputes checksums |
| Repair | When errors are detected (checksum or malformed), click **Quick Repair & reload** (checksums only) or **View in text editor** (manual fix) |
| Repair (Text Editor) | Open file in text editor, then run **HexScope: Quick Repair Checksums** from command palette |
| External Changes | When file changes externally, a banner appears; unsaved edits are automatically discarded |
| Search | `Ctrl+F` — search by byte sequence, numeric value (Auto/LE/BE), ASCII string, or address |
| Labels | Add named, color-coded address-range banners; click a label to jump to it |
| Struct Overlay | Define C structs, pin them at addresses, and decode live binary data |

## Issues

Found a bug or want to request a feature? Please open an issue: [Issues](https://github.com/deviousprophet/vscode-hex-scope/issues)

Include a short description, steps to reproduce, and sample files when possible.
