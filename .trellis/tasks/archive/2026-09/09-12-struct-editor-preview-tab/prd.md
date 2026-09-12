# Struct editor preview tab

## Goal

Inside the Struct Types section's type editor, replace the always-visible, height-bounded C preview with a switchable `Edit` / `Preview` tab (markdown raw/preview style). The preview loses its fixed `max-height` and any sub-scroll — its C code flows in the section body and scrolls with it.

## Confirmed facts (from code)

- The type editor renders in `editorHtml` (`structPanel.ts`): `.si-editor-wrap > .se-form` = name input, struct-default row, field header, `#se-fields`, `#se-add`, Save/Cancel (`.se-btns`), then `#se-preview` with `<pre.si-c-preview data-struct-preview-id>`.
- Preview content is live-rendered by `renderStructCPreview` / `buildStructCPreviewNodes` (syntax-highlighted spans); `hydrateStructPreviews` runs on every `render()`.
- `structPanel.css`: `.se-preview .si-c-preview { max-height:160px; overflow-y:auto }` (the sub-scroll to remove) and `.si-c-preview { white-space:pre; overflow-x:auto }` (horizontal sub-scroll to remove via wrapping).
- The section body (`.sb-pane .sb-body`) is the single scroll container for the editor; the preview must flow in it (no inner scroll).
- `.sa-preview` (instances add-pin form preview) is a different, out-of-scope bound.

## Requirements

- The editor has a visible `Edit` / `Preview` switch (segmented control at the top of the editor, full-swap markdown style).
- Preview view: C code flows in the section body with no fixed height, no vertical or horizontal sub-scroll; long lines wrap (`white-space: pre-wrap`).
- Full swap: when Preview is active the form (incl. Save/Cancel) is hidden; when Edit is active the preview is hidden. Draft state is never lost when switching.
- Default view on every editor open: `Edit`.
- The editor's container scroll rules stay intact (section-body scroller; incremental add/move/delete keeps scroll position).

## Acceptance Criteria

- [ ] Editor opens on `Edit`; a segmented `Edit`/`Preview` control is visible.
- [ ] Selecting `Preview` hides the form and shows the C code flowing to the pane (no inner scrollbar on the preview).
- [ ] Selecting `Edit` restores the form with all entered draft fields intact (name, field values, moves, pointer/bit state).
- [ ] `.se-preview .si-c-preview` `max-height`/`overflow-y` rule removed and `.si-c-preview` wraps long lines (`pre-wrap`, no `overflow-x:auto` takeover).
- [ ] Full webview + core suites green; `tsc --noEmit` clean; fallow no new findings.

## Out of scope

- `.sa-preview` in the instances add-pin form and the nested struct preview in instance cards.
- Other panels and the instances/types section structure.

## Decisions (from grilling)

1. Full-swap markdown model: segmented `Edit` | `Preview` at top; content below swaps entirely; Save/Cancel live only in the Edit view.
2. Default view on editor open: always `Edit`.
3. Long C lines: wrap at pane width (`pre-wrap`) — zero preview scrollbars.