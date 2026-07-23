# Direct-typing byte editing in edit mode

## Goal

Make byte patching in edit mode a single action: select a byte, type its value. Remove the multi-step right-click → Batch → Custom → enter → save dance.

## Confirmed facts

- Edit mode: `btn-edit-mode` toolbar button toggles `S.editMode`.
- Single-byte selection: click `.data-cell` sets `S.selStart`/`S.selEnd` to same address.
- Edits tracked in `S.edits` Map, undo in `S.undoStack`, dirty marker via `.dirty` CSS.
- Current fill path: context menu → `fillCommandHandler` → `fillSelectionTransaction`.
- Key files: `hexViewer.ts`, `memoryView.ts`, `editTransactions.ts`, `selection.ts`.

## Requirements

- R1: In edit mode, single byte selected → typing 2 hex chars patches that byte.
- R2: After patching, selection advances to next mapped byte.
- R3: First nibble typed updates cell's text to show the nibble (e.g., `FF` → `F`) with `.editing` outline.
- R4: Typing 1 nibble then clicking another byte discards the partial nibble silently (no edit applied).
- R5: Escape during typing clears nibble buffer and deselects.
- R6: Selection length > 1 ignores keypresses (range fill still via context menu).
- R7: Locked state (`S.lockedDueToExternalChange`) ignores keypresses.
- R8: Hex input normalized to uppercase display (matches existing convention).
- R9: Edits tracked in `S.edits`, participate in save/undo/cancel.

## Acceptance Criteria

- [ ] AC1: Select byte, type `A` then `B` → byte becomes `0xAB`, shows `AB` with `.dirty`.
- [ ] AC2: After `A` is typed, cell has `.editing` class outline.
- [ ] AC3: After `AB`, selection advances to next mapped byte (ready for next value).
- [ ] AC4: After `AB`, undo reverts the byte; Cancel clears it.
- [ ] AC5: Save persists the typed edit.
- [ ] AC6: Non-hex keys (G-Z, symbols) ignored.
- [ ] AC7: Type `F`, click another byte → partial nibble discarded, no edit applied.
- [ ] AC8: Escape during typing → deselects, no edit applied.
- [ ] AC9: Multi-byte selection → keypresses ignored.
- [ ] AC10: Locked state → keypresses ignored.
- [ ] AC11: Right-click batch fill on range still works.
- [ ] AC12: Advance skips unmapped gap addresses to next mapped byte.
