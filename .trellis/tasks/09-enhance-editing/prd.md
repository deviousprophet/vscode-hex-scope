# Enhance editing ability

## Goal

Add three capabilities to Hex Scope's edit mode: edit decoded text directly, copy/paste via keyboard shortcuts, and improve non-printable byte UX.

Resolves issue #122 items 1–2. Item 3 (unsaved changes highlight) is confirmed working — dropped.

## Requirements

### R1: Edit decoded text directly (item 1)

- In edit mode, clicking a `.char-cell` (decoded text cell) selects the underlying address.
- Typing a printable ASCII character replaces the byte at that address with the char's char code (`0x20–0x7E`).
- After typing, selection advances to the next byte (same segment, or next segment).
- Non-printable bytes (`< 0x20` or `>= 0x7F`) show a faint `·` placeholder dot in edit mode, making them clickable.
- Typing on a non-printable cell still replaces the byte (dot is cosmetic only).
- Hex cell editing (nibble buffer) is unchanged.

### R2: Copy/paste keyboard shortcuts (item 2)

- **Ctrl+C**: Copy selected bytes to clipboard.
  - If selection started in hex column → hex format (`AA BB CC`).
  - If selection started in decoded-text column → ASCII format (raw chars).
  - Falls back to hex format when origin is ambiguous.
- **Ctrl+V** (edit mode only): Paste clipboard content into bytes at selection.
  - Hex detection first: if clipboard matches hex pattern (`AABBCC`, `AA BB CC`, `0x...`), parse as raw bytes.
  - Fallback: paste clipboard text as ASCII char codes.
  - Paste clamps to file boundary (remaining bytes dropped silently).
  - No selection → no-op.
  - Executed through `stageIntegrityEditTransaction()` for undo support.
- Copy works regardless of edit mode; paste requires edit mode.
- Both are global keydown handlers (not inside single-byte guard).

### R3: Selection tracking for context-aware copy

- Track whether the last click was in hex column or decoded-text column.
- Used only by copy format selection. Cleared on new file load.

## Constraints

- All operations work on the existing undo/transaction system (`S.edits`, `S.undoStack`).
- No new npm dependencies.
- Webview-only changes; no extension host modifications needed.
- Existing hex editing behavior unchanged.

## Acceptance Criteria

- [ ] Click decoded text cell in edit mode → address selected. Type `A` → cell shows `A`, byte value is `0x41`.
- [ ] Non-printable cells show `·` dot in edit mode, are clickable, and accept typed chars.
- [ ] Non-printable cells return to empty display when exiting edit mode.
- [ ] Ctrl+C with hex-column selection copies `AA BB` format.
- [ ] Ctrl+C with decoded-text selection copies raw ASCII text.
- [ ] Ctrl+V in edit mode pastes hex `0A 1B` as bytes.
- [ ] Ctrl+V in edit mode pastes `ABC` as bytes `0x41 0x42 0x43`.
- [ ] Ctrl+V with no selection → no-op.
- [ ] Ctrl+V outside edit mode → no-op.
- [ ] Paste overflow clamps silently to file boundary.
- [ ] All paste transactions are undoable via Ctrl+Z / Cancel edits.
- [ ] Existing hex cell nibble editing still works identically.
