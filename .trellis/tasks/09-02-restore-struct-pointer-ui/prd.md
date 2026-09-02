# Restore visible pointer option in struct field editor

## Goal

Struct Overlay users can again see and use a pointer option on each field row in the struct definition editor, without needing to discover a hidden context-menu action.

## Background / confirmed facts

- Typed pointer feature (field↔address, jump-to-address, create struct instance) shipped in #78 / v2.11.0 and is NOT removed from source or runtime rendering.
- Since v2.18.0 (`922b4df`, #192, 2026-08-22) the per-field `*` pointer toggle button (`sfe-ptr-btn`) was removed from the struct definition editor as part of the sidebar/panel rework. Pointer declaration now lives only in the per-field context menu (`structPanel.ts:1585` "Attach pointer"; row wiring `:1312-1323`).
- Struct panel test shows 62/62 passing at HEAD, incl. "editor field rows expose pointer via context menu, not row button".
- Files/changes in play:
  - `src/webview/components/sidebar/structPanel/structPanel.ts` — field row render (`:898` `data-ptr`), context-menu wiring (`:1311-1323`), pointer menu items (`:1585-1618`).
  - `src/test/webview/components/sidebar/structPanel/structPanel.test.ts` — pointer editor tests (`:2247-2283`).
  - `src/webview/styles/sidebar/structPanel.css` (formerly `sfe-ptr-btn` styles, removed in #192).

## Requirements

- R1: Struct field editor shows a visible, per-field pointer control — restore the per-row `*` toggle button (as pre-v2.18.0).
- R2: Existing context-menu pointer actions keep working (right-click / Shift+F10).
- R3: Behavior parity: toggling pointer on a bit-field container field stays disabled; toggling pointer clears bit children (existing rules, `structPanel.ts:1574-1582`).

## Acceptance criteria

- [ ] AC1: In the struct definition editor, every field row shows the `*` pointer toggle button (no gesture needed).
- [ ] AC2: Clicking it marks/clears the field `isPointer`, reflected in saved struct (`data-ptr`, `readEditorFieldType`, decode output `u16*`/`void*` etc. unchanged).
- [ ] AC3: Bit-field container fields keep pointer disabled (AC preserves current guard).
- [ ] AC4: Context-menu pointer entry still present and functional.
- [ ] AC5: All `structPanel.test.ts` pointer tests pass; updated where the current assertion encodes "not row button".
- [ ] AC6: Manual debug run shows the control on a freshly created struct field (UAT).

## Out of scope

- Pointer decode/jump/create-instance runtime behavior (works; only regression-tested).
- Any change to persisted struct JSON schema or migration.
- Restyling beyond re-adding the pointer control affordance.

## Notes

- Regression introduced deliberately by #192; treating as UX regression (hidden feature), not a runtime break.