# Design — struct editor preview tab

## Current editor DOM (baseline)

```
.si-editor-wrap                       min-height:100%; display:flex; flex-direction:column
└─ .se-form                          flex:1 ...  (name, struct-default, field-hdr, #se-fields,
                                               #se-add, .se-error, .se-btns, #se-preview)
```

`#se-preview > pre.si-c-preview` is the C preview; today it is the last child of `.se-form`, bounded by `max-height:160px; overflow-y:auto` and `white-space:pre; overflow-x:auto`.

## New editor DOM

```
.si-editor-wrap                       min-height:100%; display:flex; flex-direction:column
├─ .se-tabs                          role=tablist (segmented Edit | Preview, .compact-tabs style)
│   ├─ button.se-tab[role=tab][aria-selected]  Edit
│   └─ button.se-tab[role=tab][aria-selected]  Preview
├─ .se-view[data-se-view=edit]       flex:1; min-height:0; display:flex; flex-direction:column
│   └─ .se-form                      flex:1 ... (name, struct-default, field-hdr, #se-fields,
│                                        #se-add, .se-error, .se-btns)   ← Save/Cancel live here only
└─ .se-view[data-se-view=preview][hidden]
    └─ #se-preview > pre.si-c-preview[data-struct-preview-id]
```

`.si-editor-wrap` keeps the fail-safe stretch (short form fills the pane). The active view is the one without `hidden`; the other view is `display:none` via `.se-view[hidden] { display:none }`. Preview flows in the section body — the section body (`.sb-pane .sb-body`) remains the single scroll container, and `#se-fields`/`.se-form`/`.si-editor-wrap` take over no scrolling.

## CSS changes (`structPanel.css`)

- `.se-preview .si-c-preview`: remove `max-height:160px` and `overflow-y:auto`.
- `.si-c-preview`: replace `white-space:pre; overflow-x:auto` with `white-space: pre-wrap` (long lines wrap; no horizontal scrollbar). Keep the code font and `sc-*` token colors.
- `.se-tabs`: reuse the `.compact-tabs` segmented-control look (css-guidelines: toggle groups inherit `.compact-tabs button`; do not restate font-size). Tabs are `role=tab` buttons; `.se-tab.active` mirrors `.compact-tabs button.active`.
- `.se-view[hidden] { display: none; }`; `.se-view{ min-height:0 }`.
- Ensure nothing new pins height or scrolls inside the section.

## Behavior

- **State:** no JS view state needed. `editorHtml` renders Edit active + Preview `hidden` (default Edit, always). View toggling is pure DOM class/attribute flip in `wireEditorInSec` — no render, so section-body scroll and draft are untouched. Full renders (save/cancel/validation error) rebuild the editor to the Edit default, matching "always Edit".
- **Preview currency:** `buildStructCPreviewNodes`/`renderStructCPreview` and `hydrateStructPreviews` keep updating the (possibly hidden) `<pre>` on every edit and render — cheap and keeps Preview current when switched to.
- **Incremental editor:** `refreshFieldRows` rebuilds only `#se-fields` inside the Edit view; the tab bar and Preview pane are outside `#se-fields` and untouched. Scroll-preservation regression test (`#si-types-body` node + scrollTop) still applies.
- **Keyboard/ARIA:** tabs are `role=tablist`/`role=tab` with `aria-selected`; ArrowLeft/ArrowRight move focus between the two tabs; Enter/Space activate (standard tab pattern). Minimal wiring in `wireEditorInSec`.

## Compatibility / rollback

- JS + CSS change confined to `structPanel.ts` / `structPanel.css`. Reverting to the pre-change commit restores the always-visible bounded preview.
- No schema, format, or host changes.
- jsdom cannot assert layout; the preview-scroll removal is CSS-verifiable by grep, visual behavior needs a real-webview pass.