# Implementation plan — struct type editor fixes

## Approach

Full incremental-DOM editor for #2 (#222 scroll jump): mutation handlers rebuild only the `#se-fields` row container (`refreshFieldRows`) and never replace the section-body scroll container, so scrollTop survives. #3 (#225) fixed in two places: editor-open draft preservation and core pointer endian resolution.

> #1 (#221 "New Type section too small / void") was SCOPED OUT after two "fill pane" CSS layouts broke the form's scrollability in the real sidebar (definite-height chain does not hold). CSS is fully reverted to the original scrollable flow. Tracked separately.

## Ordered checklist (done)

1. **Repro harness**
   - Core: regression test in `src/test/core/struct.test.ts` — pointer field `Auto` inside a `BE` struct decodes big-endian; explicit per-field endian still beats struct.
   - Webview: regression tests in `structPanel.test.ts` — (a) editing an existing struct shows and persists its predefined `endian`/`allocation`; (b) Add Field / Add bit keep the `#si-types-body` scroll container node + its `scrollTop` (120) intact.

2. **Core endianness (2 edits)** — `structCodec.ts`
   - `decodeAsciiField`: `decodePointerElements(..., ctx.globalEndian)` → resolved `endian`.
   - `decodeFieldElements`: `decodePointerElements(..., ctx.globalEndian)` → resolved `endian`.
   - Updated the stale `pointer fields always decode with the global overlay endian` test to assert the corrected cascade.

3. **Editor-open default preservation (1 edit)** — `wireTypesPanelControls`
   - Draft for existing struct now includes `endian: existing.endian`, `allocation: existing.allocation`.

4. **Incremental mutation handlers** — `wireEditorInSec` / new helpers
   - `fieldRowsHtml(draft)`: shared row markup for full render + incremental rebuild.
   - `refreshFieldRows(sec, draft)`: rebuilds only `#se-fields`, re-wires rows, refreshes preview. Never touches `.sb-body`.
   - `wireFieldRows(fieldsEl, sec, draft)`: all row-scoped controls (type, pointer, array, bit toggle, child add/del/move, move/delete, endian/alloc select, name blur); called on mount and after each rebuild.
   - Add Field: push → `refreshFieldRows` → `scrollEditorRowIntoView` + focus new name input.
   - Bit toggle/child ops/move/delete/pointer toggle: mutate draft → `refreshFieldRows` → restore view of touched row.
   - Struct `#se-endian`/`#se-alloc` change: `syncEditorDraft` + in-place `updateEditorOverrideTitles` (no rebuild).
   - `scrollIntoView` guarded with `typeof === 'function'` (jsdom parity).
   - Removed every `this.render()` from mutation handlers (only save/cancel/validation-error still full-render, intentionally).

5. **Layout (#221) — REVERTED / scoped out**
   - `structPanel.css` has NO diff vs main. Original `.sb-body` scroll container restored; whole form (name, struct default, rows, Add Field, Save/Cancel, preview) scrolls in normal flow. No `.si-editor-wrap` height/flex and no `#se-fields` flex/overflow rules.

6. **Quality gates (done)**
   - `tsc --noEmit` clean; `tsc -p . --outDir out` clean.
   - ESLint clean.
   - Core suite: 95 passing. Webview suite: 520 passing (67 structPanel).

## Validation commands

- `npm run check-types`
- `npm run lint`
- `node_modules\.bin\mocha.cmd --ui tdd out/test/core/struct.test.js`
- `node_modules\.bin\mocha.cmd --ui tdd --require out/test/webview/cssImportHook.js "out/test/webview/**/*.test.js"`

## Rollback

- Single-thread branch; work is two independent fixes (core endian + editor incremental). Revert either cleanly; no parser/migration changes.