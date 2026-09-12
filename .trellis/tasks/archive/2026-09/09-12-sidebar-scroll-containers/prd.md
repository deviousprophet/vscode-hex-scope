# Sidebar scroll container audit

## Goal

Make every sidebar section behave like a VS Code PaneView container: a fixed header plus a body that is the single scroll region. The body scrolls only when its content exceeds the section height — never a permanently visible scrollbar, never an inner element that takes over scrolling. Fix the struct type-editor scroll regression that violates this model.

## Confirmed facts (from audit)

- The container model already exists in `sidebar.css` and applies to every section: `.sb-pane` (`:50-55`) is a fixed pane (`overflow:hidden`), `.sb-pane .sb-body` (`:59-63`) is `flex:1; min-height:0; overflow-y:auto; overflow-x:hidden` — the body is the scroll container and `auto` shows a scrollbar only when content overflows. No `overflow: scroll` exists anywhere in `src/webview`.
- All four panels mount sections through `SidebarSections`: Inspector (`inspectorPanel.ts:77`, sections `Inspector`/`Labels`), Struct (`structPanel.ts:252`, `Struct Instances`/`Struct Types`), Integrity (`integrityPanel.ts:119`, `Integrity Checks`), Scripts (`scriptsPanel.ts:90`, `Scripts`). Every body is `.sb-pane .sb-body` and already conforms.
- The scripts console grows naturally in its body (`.script-output-log` has no own scroll); the C preview is bounded but not a scroll takeover.
- VIOLATION: the struct type editor's committed CSS makes the editor section body a flex column (`.sb-pane .sb-body:has(> .si-editor-wrap)`) and turns `.se-form` into an inner `overflow-y:auto` scroller pinned to the pane height — the reported "form not scrollable" regression, and the only section that violates the container model.

## Requirements

- Every section keeps the header + scrollable-body model, with the section body as the only scroll region; scrollbar appears only when content overflows.
- No inner element in a section body becomes a second scroller or pins content height, except deliberately bounded sub-panels (`max-height`, e.g. the C preview).
- The struct type editor conforms: the whole editor form (name, struct default, field rows, Add Field, Save/Cancel, C preview) flows in and scrolls with the section body; `.se-form`/`#se-fields` take over no scrolling.
- A short "New Type" form stretches to fill a tall pane (`min-height:100%`, fail-safe) so there is no dead blank below the form; long forms scroll the section body.
- The incremental editor work stays intact: scroll position preserved on Add Field / Add bit / move / delete (scroll container = `#si-types-body`, never replaced).

## Acceptance Criteria

- [ ] Container rule restored for the type editor: `.sb-pane .sb-body:has(> .si-editor-wrap)` flex-column rule and the `.se-form` `overflow-y` takeover are removed; `.se-form`/`#se-fields`/`.si-editor-wrap` have no inner `overflow` (only the C preview's `max-height` remains).
- [ ] Every other section body already conforms (audit record in `design.md`) — no changes needed to Inspector/Labels/Instances/Integrity/Scripts.
- [ ] Existing jsdom regression test for editor scroll-position preservation stays green; webview + core suites green; `tsc --noEmit` clean; `npx fallow` reports no new findings.
- [ ] Reporter-machine visual pass: short editor fills the pane (no dead blank below), many fields scroll the section body, Add Field/Add bit/move/delete keep scroll position.

## Out of scope

- Scrollbar styling/theming (native browser scrollbar).
- Redesigning Inspector / Integrity / Scripts content (audit found no violation there).
- Any change to `sidebar.css` or the `SidebarSections` container model.

## Artifact status

- `design.md` — CSS mechanics, boundaries, fail-safe rationale, verification limits (jsdom cannot assert layout; CSS is stubbed by `cssImportHook`).
- `implement.md` — checklist, validation commands, rollback (one `git checkout` of `structPanel.css`).