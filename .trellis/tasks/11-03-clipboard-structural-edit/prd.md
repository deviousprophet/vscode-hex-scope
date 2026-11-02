# Full copy, cut, and paste for hex memory

## Goal

Make the hex memory grid a complete clipboard surface: copy, cut, and paste
(overwrite, insert before/after, at an explicit address), plus address-range
copy/cut, with clipboard payloads that round-trip between HexScope editor
instances. Structural pastes and cuts may change the firmware size, so the
save path must support length-changing documents for Intel HEX, Motorola SREC,
and raw `.bin` files.

## Requirements

### R1 - Cut

- `Ctrl/Cmd+X` and a context-menu **Cut** action copy the selected mapped
  bytes to the system clipboard and remove them from the document.
- Cut is available only in edit mode and while the document is not locked by
  an external change.
- A cut with no mapped selected byte is a no-op with a status message.

### R2 - Paste modes

In edit mode, the hex-grid context menu exposes **Paste** with:

- **Replace** - replace the selected mapped bytes with the clipboard bytes.
  When the clipboard length differs from the selected byte count the document
  grows or shrinks; equal lengths stay a plain byte edit.
- **Insert Before** - insert the clipboard bytes at the selection start.
- **Insert After** - insert the clipboard bytes immediately after the
  selection end.
- **At address...** - prompt for a hexadecimal address, then insert the
  clipboard bytes there. For Intel HEX/SREC an unmapped address creates a new
  mapped segment automatically.
- `Ctrl/Cmd+V` keeps its current meaning (paste/replace at the selection).
- Pasting requires a non-empty clipboard parse and a valid target.

### R3 - Region copy/cut

- **Copy Region...** and **Cut Region...** prompt for `From` and `To`
  hexadecimal addresses and operate on the inclusive range without requiring
  a prior selection.
- Region copy leaves the selection unchanged; region cut removes the mapped
  bytes in the range after copying them.
- Invalid or reversed ranges are rejected with a status message.

### R4 - Cross-instance clipboard

- Copy and cut write plain hexadecimal byte text to the system clipboard so a
  copy in one HexScope editor can be pasted into another HexScope editor (or
  an external editor) and vice versa.
- Paste accepts the existing spaced/raw/`0x`-prefixed hexadecimal forms and
  falls back to raw ASCII bytes.

### R5 - Length-changing saves

- Structural edits update the in-memory document immediately (grid, search,
  inspector, integrity consumers read the new segments).
- Saving a structurally changed document rewrites the data records and keeps
  non-data records (headers, start-address records, termination records) and
  the original line-ending style. The rebuilt file must parse with zero new
  checksum or malformed-line errors.
- Raw `.bin` structural edits stay inside the single contiguous image: insert
  and delete change the file length; a target outside the current image range
  is rejected with a status message.
- The Save button, dirty indicator, discard flow, and external-change conflict
  flow all treat structural changes as unsaved work.
- While structural changes are unsaved, the Records view, script runs, and
  script-backed integrity checks are unavailable because the host still holds
  the pre-edit document.

### R6 - Undo / redo / discard

- Each structural operation is one undoable transaction; undo restores the
  previous segments and the pending byte overlay, redo reapplies it. Undoing
  back to the saved baseline clears structural dirtiness.
- Discard (Cancel) restores the last saved document exactly, including
  length.
- Structural edits never leave the document in a partially applied state.

### R7 - Guardrails

- Cut/paste/insert are edit-mode-only; copy and region copy remain available
  read-only.
- Pasting or cutting while an external change lock is active is refused.
- Structural edits may shift absolute addresses; the UI warns once per
  operation that labels and type instances are not moved.

## Non-goals

- Rich clipboard formats (HTML, binary CF_HTML, custom MIME) beyond plain
  text.
- Moving labels, integrity checks, or overlay instances when addresses shift.
- Recovering the original data-record chunking after a structural save.
- Pasting into the read-only diff surface.

## Acceptance Criteria

- [ ] `Ctrl/Cmd+X` copies and removes the selected bytes; undo restores them.
- [ ] Context-menu Paste offers Replace, Insert Before, Insert After, and At
      address..., and each produces the documented document.
- [ ] Replace with a longer/shorter clipboard changes the saved file length
      and re-parses cleanly.
- [ ] At address... on an unmapped Intel HEX/SREC address creates mapped
      memory and keeps later data reachable.
- [ ] Copy Region.../Cut Region... accept From/To addresses and operate on the
      inclusive range.
- [ ] Copy in one editor instance and paste in another instance reproduces
      the bytes.
- [ ] Raw `.bin` insert/delete change the file length and save correctly;
      out-of-range paste is refused.
- [ ] Structural undo/redo and Cancel restore the expected document.
- [ ] `npm run check-types`, `npm run lint`, and `npm test` pass.
- [ ] The owning specs (`editing-save-external-change.md`,
      `document-formats.md`, `selection-inspect-copy.md`,
      `component-menu-controller.md`) describe the new contracts.

## Notes

- Existing copy behavior and formats must not regress.
- Keep clipboard parsing in `src/webview/pasteUtils.ts` and byte formatting in
  `src/core/byteTools/`.
- Do not mention the originating issue number in the branch, commits, or PR.
