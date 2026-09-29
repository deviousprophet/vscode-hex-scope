# Implement — Split structPanel into extractable modules

Pure refactor. After each step: run the three gates, confirm the suite is still
green, and commit that one module. Do not change markup, ids, classes, CSS, the
public API, or any test assertion.

- [ ] 1. Extract `structCPreview.ts` (~979–1104): move the C-preview token/line
      helpers and `renderStructCPreview`/`hydrateStructPreviews`; leave thin
      class wrappers. Gate + commit.
- [ ] 2. Extract `structBinaryView.ts` (~441–710): move the bit-span/binary
      rendering helpers; wire class call sites. Gate + commit.
- [ ] 3. Extract `structEditorFields.ts` (~712–977): move the editor field-row
      markup helpers (type options, pointer/hide/array/move cells, override
      selects, `fieldRowHtml`, child rows, bit-child enum select). Gate + commit.
- [ ] 4. Extract `structValueFormat.ts` (~2523–3053): move decoded value
      formatting + copy-text helpers; thread a narrow `StructRenderCtx` for the
      fields they read (`_fieldValTypes`, `_defaultValType`, `_endian`,
      `cb.readByte`). Gate + commit.
- [ ] 5. Extract `structRowRenderer.ts` (~3054–4317): move the decoded
      row/group renderers and pointer renderers; use the shared
      `StructRenderCtx` (`_structs`, `_pins`, `_endian`, `_showHiddenFields`,
      etc.). Gate + commit.
- [ ] 6. Specs: update `directory-structure.md`'s ownership tree and
      `component-sidebar-struct-panel.md`'s layout block with the five new
      module names; fix the `StructPanel.ts` → `structPanel.ts` casing.
- [ ] 7. Final full-suite run + parity golden; confirm `structPanel.ts` size
      dropped and the public API is unchanged.

## Validation

- Behaviour-preserving: the existing `structPanel.test.ts` (100 tests) and the
  parity golden pass **unchanged**; no assertion is weakened.
- Contract: `hexViewer.ts` and `structCallbacks` untouched; no new module
  imports `S` / `state` / `postProviderMessage` / `memory/memoryData` /
  `rerender`.
- Markup byte-identical (golden + byte-identical assertions).
- Commands: `npm run check-types`, `npm run lint`,
  `npm run compile-tests && npm test`.

## Review gates

- After each extraction: the suite must stay green with zero test edits; treat
  any needed test edit as a behaviour change and stop.
- After step 5: confirm the class only orchestrates the five modules (no
  duplicated body remains).
- Before finish: parity golden + full suite; `hexViewer.ts` diff empty.

## Rollback points

- One commit per module → revert the offending module alone.
- The extraction order is dependency-light; a module can be dropped from the
  task without affecting the others if it proves too coupled.
