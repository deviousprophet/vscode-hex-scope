# Design — sidebar scroll container audit

## Problem

The struct type editor currently breaks the sidebar's container model. Committed CSS turns the editor's section body into a flex column and makes `.se-form` an inner `overflow-y:auto` scroller pinned to the pane height (`structPanel.css` `.sb-pane .sb-body:has(> .si-editor-wrap)`, `.si-editor-wrap { flex:1 }`, `.se-form { flex:1; overflow-y:auto }`). Result: the form is not scrollable in the real webview and the "section body is the scroll container" rule is violated.

## Container model (kept, all sections)

- `.sb-pane` = fixed pane: 22px header + body; `overflow:hidden` clips the pane to its flex-basis.
- `.sb-pane .sb-body` = the single scroll region per section: `flex:1; min-height:0; overflow-y:auto; overflow-x:hidden` (`sidebar.css:59-63`). `auto` → scrollbar only when content overflows (verified: no `overflow: scroll` in `src/webview`).
- All four panels mount via `SidebarSections`, so Inspector / Struct Instances / Struct Types / Integrity Checks / Scripts bodies already conform. Audit conclusion: the struct type editor was the only violator.

## Editor fix (this task)

Remove the takeover, add a fail-safe stretch:

- Delete `.sb-pane .sb-body:has(> .si-editor-wrap) { display:flex; flex-direction:column; min-height:0 }`.
- Delete `.se-form { flex:1; min-height:0; ... overflow-y:auto; overflow-x:hidden }` (no inner scroller).
- Add:
  - `.si-editor-wrap { min-height:100%; display:flex; flex-direction:column; }`
  - `.se-form { flex:1; min-height:0; display:flex; flex-direction:column; gap:5px; }` (no overflow)

Mechanics:
- Short form: `.si-editor-wrap` stretches to the pane height (`min-height:100%` of `.sb-body`'s content box), `.se-form` flex-fills → the pane area is covered (no dead space below the form); `.sb-body` does not scroll (content ≤ height).
- Long form: `.si-editor-wrap`/`.se-form` grow (min-height ≠ fixed height) → `.sb-body`'s `overflow-y:auto` scrolls the whole editor form (name → struct default → fields → Add Field → Save/Cancel → C preview). The scroller is always the section body; nothing may scroll internally except the existing bounded C preview (`max-height`).
- Fail-safe: if `min-height:100%` cannot resolve on a given machine, it degrades to natural top-aligned content — the body still scrolls. Scrolling can never regress because the body stays the only scroll region.
- Incremental editor logic (`refreshFieldRows` rebuilding only `#se-fields`, scroll container `#si-types-body` never replaced) is untouched and keeps scroll position on add/move/delete.

## Boundaries

- Only `structPanel.css` changes. `sidebar.css` untouched (the container model is already correct there).
- No JS/logic changes. No schema/format changes.

## Compatibility / risk

- CSS-only; reverting the diff restores the previous state exactly.
- Visual confirmation of the stretch requires the reporter's machine (jsdom has no layout); the change is explicitly fail-safe.

## Verification limits

- Automated css-layout checks are not possible in the jsdom suite (CSS is stubbed by `cssImportHook`). External verification: static diff guarantees the takeover removal and that `.sb-body` is the sole scroller; the existing jsdom regression test guarantees scroll-position preservation on editor mutations.