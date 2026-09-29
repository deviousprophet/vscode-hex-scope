# Split structPanel into extractable modules

## Goal

Reduce `structPanel.ts` (5,712 lines, one class + a few helpers) by extracting
five self-contained clusters into sibling modules, so each concern has its own
file while `StructPanel` stays the orchestrator. This is a **pure move**: no
behaviour change, markup/ids/classes/render order stay byte-identical, and the
existing test suite plus the parity golden is the proof.

## Requirements

- R1. Extract `structCPreview.ts` — C-preview token/line builders and the
  `renderStructCPreview` / `hydrateStructPreviews` render entry points
  (source ~979–1104).
- R2. Extract `structBinaryView.ts` — bit-span / binary rendering helpers
  (source ~441–710).
- R3. Extract `structEditorFields.ts` — editor field-row markup helpers: type
  option groups, pointer/hide/array/move cells, override selects,
  `fieldRowHtml`, child rows, bit-child enum select (source ~712–977).
- R4. Extract `structValueFormat.ts` — decoded value formatting + copy-text
  helpers (source ~2523–3053).
- R5. Extract `structRowRenderer.ts` — decoded row/group renderers and pointer
  renderers (source ~3054–4317).
- R6. `StructPanel` remains the orchestrator. Its public API is unchanged:
  `constructor`, `mount`, `render`, `setData`, `setEndian`,
  `setBitFieldAllocation`, `setShowHiddenFields`, `setSelection`,
  `setTabActive`, `resetViewState`; `StructCallbacks` is unchanged;
  `hexViewer.ts` is not modified.
- R7. Extracted functions take explicit parameters; where a cluster reads many
  panel fields (`_structs`, `_pins`, `_endian`, `_bitFieldAllocation`,
  `_showHiddenFields`, `_fieldValTypes`, `_defaultValType`, `cb.readByte`) pass
  one narrow `StructRenderCtx` value built per call/render.
- R8. Behaviour-preserving: markup, ids, classes, and render order are
  byte-identical. The existing suite (100 panel tests) and the parity golden
  pass **without weakening any assertion**. No new behaviour tests.
- R9. One CSS file (`structPanel.css`) unchanged; no new CSS.
- R10. Update `directory-structure.md`'s ownership tree and
  `component-sidebar-struct-panel.md`'s layout block with the five module names,
  and fix the documented `StructPanel.ts` casing to `structPanel.ts`.
- R11. Land one module per commit (staged), in the order
  C preview → binary view → editor fields → value format → row renderer.

## Constraints

- C1. No issue reference in artifacts, branch, commits, or comments.
- C2. Naming stays struct-termed; no rename of `StructDef`/`StructField`/
  `StructPin`, `structs.json`, `structs.schema.json`, or module/dir names.
- C3. The new modules must not import `S`, `state.ts`, `postProviderMessage`,
  `memory/memoryData`, or `rerender` (component contract).
- C4. No behaviour change; no persisted-shape change; `structPinsModel.ts`
  unchanged.
- C5. Gates: `npm run check-types`, `npm run lint`,
  `npm run compile-tests && npm test` all green (except the known pre-existing
  environmental clipboard failure).

## Out of scope

- Splitting the `StructPanel` class itself (authoring class vs rendering class).
- Instance cards, field-value menus, editor wiring/chooser, and pins — they stay
  in `structPanel.ts` (candidates for a later pass).
- Splitting `structPanel.css`.

## Acceptance Criteria

- [ ] The five modules exist with the stated responsibilities, and
      `structPanel.ts` is materially smaller.
- [ ] `StructPanel`'s public API and `StructCallbacks` are unchanged;
      `hexViewer.ts` and `structPanel.test.ts` are not modified.
- [ ] The full suite passes; the parity golden passes; markup is
      byte-identical.
- [ ] `directory-structure.md` and `component-sidebar-struct-panel.md` list the
      new modules; the `structPanel.ts` casing is corrected.
- [ ] Gates green; no issue references; struct naming intact.
