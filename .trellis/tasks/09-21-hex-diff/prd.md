# Hex Diff View

## Goal

Read-only dedicated editor comparing two Intel HEX / SREC files in an address-aligned hex grid with byte-level diff highlighting, a summary bar, and next/previous difference navigation.

## Background

- Source requirement set: repo issue 103 (do not reference the issue number in task, branch, or artifact titles).
- Firmware files are sparse, address-addressed images (Intel HEX / SREC); the same bytes can live at different addresses, so comparison is address-keyed, not textual.
- Existing single-file viewer (`hexScope.hexEditor`) and its `HexView` grid already isolate interaction per instance root (see `.trellis/spec/frontend/components/component-hex-view.md`).

## Key Decisions

1. **Phasing.** One task, two phases. Phase A = compare command, dedicated read-only editor, side-by-side address-aligned grid, changed/added/removed highlighting, summary bar, next/prev navigation. Phase B = unified toggle, label context, SREC↔HEX edge polish.
2. **Editor mechanism.** Command opens a `WebviewPanel` in the editor column (own tab), not a `CustomReadonlyEditorProvider` (which binds a single document; this feature compares two).
3. **Entry point.** Command `HexScope: Compare with...`, available from the editor title bar and command palette when a supported file is active. Base file = active file; the second file is chosen via `window.showOpenDialog` filtered to the eight supported extensions. Two-file/multi-select entry from the explorer is out of scope.
4. **A/B semantics.** A = active file (left), B = chosen file (right). "Added" = mapped in B only; "removed" = mapped in A only.
5. **Diff semantics.** Address-keyed per resolved address across the union of both files' address spaces.
6. **Grid layout.** Side-by-side, row-aligned, single shared address column, fixed 16 bytes per row, only union range rendered.
7. **Surface.** Grid + summary bar + diff navigation only. No sidebar, Records view, editing, scripts, or integrity in the diff editor.
8. **Labels.** Read-only per-side label overlays: A's labels on A, B's labels on B. No label editing in the diff editor. (Phase B.)
9. **Compute location.** Diff is computed host-side in a typed core module; the webview receives compact diff data plus both parsed segment sets.
10. **Grid reuse.** Reuse the existing `HexView` component for the diff grid (confirmed). Requires a prerequisite de-globalization refactor: turn its remaining `#mem-scroll` / `#mem-header` id queries and id-based CSS into root-scoped class selectors, and add a horizontal-scroll sync seam so two instances can coexist.
11. **Naming.** Task "Hex Diff View", slug `hex-diff`, branch `feat/hex-diff`. No issue number anywhere.

## Requirements

- R1 — `HexScope: Compare with...` command appears for a supported active file (editor title bar + command palette) and prompts for the second file.
- R2 — Comparison opens in a dedicated read-only editor tab in the editor column; both files are shown by name.
- R3 — The grid is address-aligned: each side uses one row per 16-byte-aligned address block over the union of both files' ranges.
- R4 — Byte-level highlighting distinguishes: changed bytes, byte ranges mapped in B only (added), and byte ranges mapped in A only (removed).
- R5 — A summary bar reports total bytes changed / added / removed.
- R6 — Navigation jumps to the next and previous difference, cycling through differences in address order.
- R7 — Existing per-file segment labels render as read-only context on their own side. (Phase B.)
- R8 — Files with differing address spaces, formats, or non-contiguous records are handled without error; unmapped-but-aligned bytes render as empty cells, not as false differences.

## Acceptance Criteria

- [ ] AC1 — With a supported file active, running `HexScope: Compare with...` and choosing a second supported file opens a new read-only editor tab.
- [ ] AC2 — A file compared with itself shows zero changed, added, and removed bytes.
- [ ] AC3 — Two files differing in one byte report exactly one changed byte in the summary bar and highlight that byte on both sides.
- [ ] AC4 — A byte range present only in B is counted as added and shown as added on the B side; the corresponding A-side cells are empty.
- [ ] AC5 — A byte range present only in A is counted as removed and shown as removed on the A side; the corresponding B-side cells are empty.
- [ ] AC6 — Comparing an Intel HEX file with an SREC file resolves both to their address spaces and reports differences by resolved address.
- [ ] AC7 — Non-contiguous records and address gaps produce gap rows / empty cells, never synthetic zero bytes or false differences.
- [ ] AC8 — Next/previous difference buttons move the viewport between successive differences and wrap or stop predictably at the ends.
- [ ] AC9 — The diff editor exposes no editing, save, script, integrity, or sidebar affordances.
- [ ] AC10 — Closing the diff tab releases its panels/watchers and leaves no retained host state.

## Out of Scope

- Editing either file from the diff editor.
- Three-way / directory / merge comparison.
- Persisted diff view state (view mode, last compared files).
- Unified (interleaved) view mode in Phase A.
- Label editing in the diff editor.
- Two-file multi-select entry from the explorer.
- Reusing profiles, structs, pins, integrity checks, or scripts inside the diff editor.

## Technical Notes

- Supported extensions: `.hex`, `.ihx`, `.ihex`, `.srec`, `.mot`, `.s19`, `.s28`, `.s37`.
- Address resolution must use format-resolved addresses, not raw record address fields.
- Existing `HexView` is a presentational component with root-scoped listeners; its remaining global-id queries (`#mem-scroll`, `#mem-header`) and id-based CSS are the blocker for two simultaneous instances.

## Open Questions

- None. `HexView` reuse + prerequisite refactor confirmed by user.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
