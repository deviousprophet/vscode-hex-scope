# Implementation plan — struct editor preview tab

## Approach

Wrap the existing editor into two views behind a segmented `Edit`/`Preview` tab bar; make the preview flow in the section body (no fixed height, no sub-scroll, lines wrap). Pure DOM toggle, no render, no state — draft is preserved by construction.

## Checklist

1. **editorHtml** (`structPanel.ts`) — restructure to:
   - `.se-tabs` (role=tablist) with two `role=tab` buttons `Edit` (active) and `Preview`.
   - `.se-view[data-se-view=edit]` wrapping the current `.se-form` (Save/Cancel stay inside).
   - `.se-view[data-se-view=preview][hidden]` wrapping the current `#se-preview`.
   - IDs/classes of existing controls unchanged (`#se-name`, `#se-fields`, `#se-endian`, `#se-alloc`, `#se-add`, `#se-save`, `#se-cancel`, `#se-preview`).

2. **wireEditorInSec** — add tab wiring: click (and Enter/Space, ArrowLeft/Right) toggles `active`/`aria-selected` on tabs and `hidden` on the matching `.se-view`. Toggle is attribute-only (no `render()`).

3. **CSS** (`structPanel.css`):
   - Remove `.se-preview .si-c-preview` `max-height` + `overflow-y`.
   - `.si-c-preview`: `white-space: pre-wrap`, drop `overflow-x:auto`.
   - Add `.se-tabs` (compact-tabs look), `.se-tab.active`, `.se-view`, `.se-view[hidden] { display:none }`.
   - Keep `.si-editor-wrap` `min-height:100%` stretch; give `.se-view-edit` `flex:1; min-height:0`.

4. **Tests** (`structPanel.test.ts`): add regression test —
   - Open editor (Add); assert two tabs present, Edit active, `.se-view-preview` hidden.
   - Type a field name; click Preview → form `.se-view-edit` hidden, preview visible.
   - Click Edit → form visible again with the field name preserved.
   - Assert preview pre wraps (not assertable in jsdom) — instead assert no inline `max-height`/`overflow` set on `#se-preview`.

5. **Validation**:
   - `node_modules\.bin\tsc.cmd --noEmit`
   - compile (`tsc -p . --outDir out`); mocha webview suite (`--require out/test/webview/cssImportHook.js`) expect 520+; core struct 95.
   - `npx fallow --format json --quiet` expect 0/0/0.
   - Grep ensure no `overflow`/`max-height` remains on `.se-preview .si-c-preview`.

## Review gates / rollback

- Two-file commit (`structPanel.ts`, `structPanel.css`) + test file; revert by `git checkout` on those paths.
- After land: reporter visual pass (preview flows, tabs switch, draft preserved, body scrolls long preview).