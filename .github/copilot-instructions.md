# Copilot repository instructions — vscode-hex-scope

Short summary
-------------
- TypeScript VS Code extension: custom editor for Intel HEX (.hex) and Motorola SREC (.srec/.mot/.s19) files.

Key files
---------
- `src/HexEditorProvider.ts` — custom editor provider; primary message contract with the webview.
- `src/parser/` — parsing logic (`IntelHexParser.ts`, `SRecParser.ts`, `types.ts`).
- `src/webview/` — web UI source (built by `esbuild` to `dist/webview.js`).
- `test/` and `sample/` — tests and sample input files.

Build & test (quick)
--------------------
- Install dependencies: `npm install`
- Build: `npm run compile`
- Dev watch: `npm run watch` (runs esbuild + tsc watch)
- Tests: `npm test`

Guidance for Copilot / automated agents
--------------------------------------
- Keep changes small and module-scoped.
- When editing TypeScript, run `npm run check-types` or `npm run compile` and `npm test` after edits.
- For UI changes in `src/webview/`, rebuild with `npm run watch:esbuild` (or `npm run compile`).
- Do not edit `syntaxes/*.json` unless you are explicitly improving highlighting.
- Add or update tests in `test/` when changing parser or provider behavior.

Message contract (high level)
-----------------------------
- Extension → webview: `init` (initial data), `externalChange`, `savedEdits`.
- Webview → extension: `copyText`, `saveLabels`, `saveStructs`, `saveStructPins`, `updateLabelVisibility`, `reorderLabel`, `saveEdits`, `repairChecksums`, `reloadAccepted`.

Quick pointers
--------------
- Inspect `src/HexEditorProvider.ts` and `src/webview/hexViewer.ts` for exact message shapes and edit/save flows.
- Prefer focused commits and include tests for parsing or provider-interface changes.
