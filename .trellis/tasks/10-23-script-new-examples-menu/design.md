# Design: consolidate the New menu and example actions

## Panel (`src/webview/components/sidebar/scriptsPanel/`)

- `scriptsPanel.ts` `newBarHtml()`: after the `SCRIPT_TEMPLATES` rows, append a separator row
  (`.script-new-sep`, `role="separator"`) and two fixed rows carrying `data-example-action`:
  - `browse` → label "Browse examples…", title "Copy selected bundled examples"
  - `all` → label "Add all examples", title "Copy the whole bundled catalog"
- `wireNewBar`: `[data-example-action="browse"]` closes the menu and calls
  `cb.onBrowseExampleScripts?.()`; `="all"` closes and calls `cb.onAddExampleScripts?.()`
  (the existing bulk callback).
- Callbacks: add optional `onBrowseExampleScripts?: () => void`; keep `onAddExampleScripts`.
- `mountToolbarActions`: drop the `scripts-add-examples` button; keep `scripts-refresh`.
- Empty state (`scriptListHtml`): replace the `[data-add-examples]` bulk button with
  `[data-browse-examples]` "Browse examples…" wired to `onBrowseExampleScripts`.
- `scriptsPanel.css`: add the `.script-new-sep` row style; remove the now-unused
  `.script-add-examples` rules (no dead surface).

## Webview (`src/webview/hexViewer.ts`)

- Wire `onBrowseExampleScripts: () => postProviderMessage({ type: 'browseExampleScripts' })`.

## Protocol (`src/webviewProtocol.ts`)

- Add `| { type: 'browseExampleScripts' }` to `WebviewToProviderMessage` — additive, no payload.
  `addExampleScripts` stays and now backs only the "Add all examples" row.

## Host (`src/hexEditorSession.ts`)

- New handler `browseExampleScripts`: `await runBrowseExampleScripts(extensionBrowseDeps(this._context, root))`,
  then rescan through the existing `requestScriptList` handler when
  `installed?.added.length > 0` — mirroring the `addExampleScripts` handler exactly.
- Import `runBrowseExampleScripts, extensionBrowseDeps` from `./addExampleScripts`.

## Compatibility

- Additive message only; older webviews are unaffected (they simply never send it).
- Manager flow untouched (already selective + bulk via `runBrowseExampleScripts` /
  `runAddExampleScripts`).
- No persistence or schema impact.

## Tests

- `scriptsPanel.test.ts`: New caret menu renders the 4 templates + separator + the two example
  rows; browse row reports `onBrowseExampleScripts`; all row reports `onAddExampleScripts`;
  header no longer exposes `scripts-add-examples`; empty state offers Create script + Browse
  examples… and reports browse; update the existing header/empty-state/follow-the-list tests.
- Command-message handling follows the `createScript` precedent (union member + handler; no
  passive model entry expected — confirm against `webviewMessageDispatcher`/model tests).
- Host coverage: `runBrowseExampleScripts` behavior is already covered in
  `addExampleScripts.test.ts`; session glue stays on the existing (untested) pattern.

## Rollback

- Re-add the toolbar button and the empty-state bulk button; remove the message and menu rows.
  Nothing persisted, so rollback is pure UI/protocol.
