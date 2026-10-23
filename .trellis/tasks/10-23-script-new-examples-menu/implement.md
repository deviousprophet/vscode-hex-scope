# Implement: consolidate the New menu and example actions

## Before coding

1. Read `scriptsPanel.ts` `newBarHtml`/`wireNewBar`/`mountToolbarActions`/`scriptListHtml` and
   the `.script-new-*` / `.script-add-examples` CSS.
2. Read the `addExampleScripts` handler in `hexEditorSession.ts` and the
   `runBrowseExampleScripts` / `extensionBrowseDeps` exports in `addExampleScripts.ts`.
3. Read the existing scriptsPanel tests around the header action and empty state — they change.

## Checklist

- [x] 1. Panel: add the separator + `data-example-action="browse"|"all"` rows to `newBarHtml`,
      wire both in `wireNewBar`, add `onBrowseExampleScripts` to the callbacks.
- [x] 2. Panel: remove the `scripts-add-examples` toolbar button; replace the empty-state bulk
      button with `[data-browse-examples]` "Browse examples…".
- [x] 3. CSS: add `.script-new-sep`; remove the dead `.script-add-examples` rules.
- [x] 4. Protocol + webview: add `browseExampleScripts` and wire
      `onBrowseExampleScripts` in `hexViewer`; check dispatcher/model against the
      `createScript` precedent.
- [x] 5. Host: add the `browseExampleScripts` handler (run picker, rescan when installed).
- [x] 6. Tests: update the changed header/empty-state assertions; add menu-row and
      browse-callback coverage.
- [x] 7. Docs/specs: component spec (toolbar, New menu, empty state, tests, matrix),
      `docs/SCRIPTING.md` (panel entry points), `CHANGELOG.md` (unreleased wording).
- [x] 8. Gates.

## Validation commands

```bash
npm run check-types
npm run check-examples
npm run lint
npm test
```

Manual checks:

- open a workspace with no scripts: empty state offers Create script + Browse examples…; the
  picker copies only checked rows.
- New ▾ menu shows 4 templates + Browse examples… + Add all examples; each works.
- header has no `＋` examples button; Refresh and New remain.
- `Manage Scripts` is unchanged.

## Review gates

- Gate A after step 3: panel surface reviewed (menu, header, empty state, no dead CSS).
- Gate B after step 8: tests/docs and full gates.

## Rollback points

- Pure UI + additive message; revert the panel rows/buttons and the message to restore the
  previous entry points (see `design.md`).
