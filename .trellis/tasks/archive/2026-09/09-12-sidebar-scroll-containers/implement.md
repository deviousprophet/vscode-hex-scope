# Implementation plan — sidebar scroll container audit

## Scope

One CSS change in `structPanel.css` restores the container model for the struct type editor. Everything else in the sidebar already conforms (audited).

## Checklist

1. **Audit (done)** — all sections: Inspector, Labels, Struct Instances, Struct Types, Integrity Checks, Scripts. All bodies are `.sb-pane .sb-body` (`overflow-y:auto`). Only the struct type editor violates (inner `.se-form` scroller). No `overflow: scroll` anywhere.

2. **CSS edit** — `src/webview/components/sidebar/structPanel/structPanel.css`:
   - Remove `.sb-pane .sb-body:has(> .si-editor-wrap) { ... }`.
   - Remove `overflow-y:auto; overflow-x:hidden` from `.se-form`.
   - Add `.si-editor-wrap { min-height:100%; display:flex; flex-direction:column; }` and keep `.se-form { flex:1; min-height:0; display:flex; flex-direction:column; gap:5px; }`.

3. **Verify no inner scroll remains** — grep `structPanel.css` for `overflow` on `.se-form`/`#se-fields`/`.si-editor-wrap`; expect only the C preview's bounded `max-height` rule.

4. **Validation** — `npm run check-types`; compile + run webview + core mocha suites (structPanel editor regression test for scroll preservation must stay green); `npx fallow` no new findings.

5. **User-machine visual pass** — reporter must confirm: short New Type form fills the pane (no dead blank below), many fields scroll the section body, Add Field/Add bit keep scroll position.

## Validation commands

- `node_modules\.bin\tsc.cmd --noEmit`
- `node_modules\.bin\mocha.cmd --ui tdd --require out/test/webview/cssImportHook.js "out/test/webview/**/*.test.js"`
- `node_modules\.bin\mocha.cmd --ui tdd out/test/core/struct.test.js`
- `npx fallow --format json --quiet` (expect issues/findings/clones = 0)

## Review gates / rollback

- One CSS commit; `git checkout -- src/webview/components/sidebar/structPanel/structPanel.css` fully reverts.
- No JS, schema, or migration changes.