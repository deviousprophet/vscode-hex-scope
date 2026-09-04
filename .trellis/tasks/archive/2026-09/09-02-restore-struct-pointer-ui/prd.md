# Restore struct editor typed pointer toggle

## Goal

Return a visible, one-click `*` pointer toggle per struct field in the Struct Overlay definition editor, restoring the pointer-declaration UX removed in v2.18.0. Users must again see and set "this field is a pointer" without a hidden right-click.

## Background

- Typed pointer capability (field ↔ address, typed labels `u16*`, jump-to-address, create struct instance) shipped in #78 (`29f693f`, v2.11.0) and is **still fully present in `main`**: `StructField.isPointer` (`src/core/types.ts:102`), decode (`src/core/structCodec.ts:715-720`), jump (`structPanel.ts:4762`), pointer pin create (`:4832`).
- The **visible editor control** was removed by #192 (`922b4df`, "feat(ui): sidebar sections…", released **v2.18.0 2026-08-22**). The per-field `*` button and its `Ptr` column header (`src/webview/sidebar/struct/index.ts`, v2.17.1) were deleted; pointer declaration now lives only in a per-field context menu ("Attach pointer", `structPanel.ts:1585`) — undiscoverable.
- Since #192 the editor grid gained per-field `endian`/`alloc` columns (#213), so the button must slot into the current 8-column `.struct-field-row` grid (→ 9 columns), not a verbatim revert.

## Requirements

- R1: Every struct field-editor row shows a visible `*` pointer toggle button (no gesture required).
- R2: Clicking the button toggles `field.isPointer` (true/undefined); the change flows through the existing editor draft → save pipeline and persists via `onStructsChange`.
- R3: The button respects existing rules: disabled on bit-field container rows (`cannotPointTo`, `structPanel.ts:1565`); a `void`-typed field is pointer by default (`fieldTypeSelectionIsPointer` semantics preserved).
- R4: The per-field context-menu pointer path ("Attach pointer" / "Clear pointer") keeps working.
- R5: Row markup stays grid-aligned: add a `Ptr` column (header + one cell per row) to `.struct-field-row`/`.se-field-hdr`, matching the pixel-width style of sibling toggle cells.
- R6: Instance rendering, decode, jump-to-address, and pointer-pin creation are unaffected (regression-only).

## In scope

- Re-add `sfe-ptr-btn` button + `Ptr` column (header + cell) in `structPanel.ts` (`fieldRowHtml`/`se-field-hdr`) and its CSS in `structPanel.css`.
- Restore row click/keyboard toggle handling (matching pre-#192 handler semantics, adapted to current editor API `syncEditorDraft`/`draft.fields`).
- Update struct-editor tests to cover the visible button.

## Out of scope

- Changing pointer data model, decode, jump, or pointer-pin create.
- Altering the context-menu pointer path.
- Persistence/migration (`structs` JSON shape unchanged: still `{ type, isPointer }`).
- Instance-display rendering (already pointer-aware).

## Acceptance criteria

- [ ] AC1: In the struct editor, every field row shows an enabled `*` button; a `Ptr` column header is present; rows stay grid-aligned (no overlap after render).

- [ ] AC2: Clicking `*` toggles pointer state; saving the struct persists `isPointer` on that field (verify via `onStructsChange` payload / test).

- [ ] AC3: A field with pointer on reports a typed pointer type (e.g. `u16*` target type label) in decoded instance rows (existing decode path, no code change needed — confirms R2 plumbing).

- [ ] AC4: Bit-field container rows show the `*` button disabled; `void`-typed fields render with pointer active (existing semantics preserved).

- [ ] AC5: `structPanel.test.ts` covers: button renders on each row, click toggles field `isPointer`, disabled on bit containers, grid alignment unchanged (no layout regressions); existing pointer tests still pass.

- [ ] AC6: Manual debug run — new struct → add field → click `*` → field decodes as `<type>*` at an instance address.

## Key decisions

- Affordance: per-field `*` toggle button (user decision; matches pre-v2.18.0 UX).
- Context menu kept as secondary path (R4).

## Risks / deferred

- Low. Revert surface is small and localized; the capability already exists under the hood. Deferred: no change to jump/create UX, no docs update beyond CHANGELOG entry at finish.