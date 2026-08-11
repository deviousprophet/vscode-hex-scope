# Design — vscode-extension-tester E2E suite + CI/CT wiring

Decisions D1–D7 (see prd.md). No changes to the extension's product code.

## D2/D3 — Runner + spec layout
- `npm i -D vscode-extension-tester` (+ it pulls its own webdriver deps).
- Specs: `src/test/e2e/**/*.test.ts`, compiled by the existing `tsc -p .` → `out/test/e2e/`.
- `.vscode-test.mjs` `files` glob narrowed from `out/test/**/*.test.js` to
  `out/test/{webview,core,extension,shared,benchmarks}/**/*.test.js` so the unit suite
  (vscode-test) never executes E2E specs (they need the webdriver harness).
- npm scripts:
  - `"test:e2e": "extest setup-and-run 'out/test/e2e/**/*.test.js' --code_version 1.125.0 --code_settings .vscode-e2e-settings.json"`
  - `"pretest:e2e": "npm run compile-tests"`

## Specs (D1, ~12)
All specs use `helpers.ts`:

```ts
async function openHexEditor(file: string): Promise<WebView> {
    await new Workbench().executeCommand('file.openFile'); // or open via workspace file
    // → EditorView.openEditor(title) → switchToFrame() per spec; switchBack() in teardown
}
```

1. memory-view renders: `.data-row` count > 0, header cells, after opening `sample.hex`
2. search: type `DE AD` in `#search-input` + Enter → `#match-count` non-empty, `.match` cells
3. search divergence: after a completed search, change `#search-mode` → highlights + count clear; empty the input → clear
4. edit: enable edit mode, type a hex digit pair into a cell → dirty count `#edit-dirty-count` updates; Ctrl+Z undoes
5. paste overflow: select end-of-segment bytes, paste hex via clipboard → `#edit-status` shows "Pasted N of M"
6. grid keyboard: focus grid (`#memory-view`), ArrowRight moves selection, Shift+Right then Shift+Left shrinks; arrows with focus elsewhere do NOT move selection
7. context menu keyboard: right-click a cell → first item focused; ArrowDown/Enter runs; non-printable byte (`0x00`) hides Copy ASCII
8. record empty: open `empty.hex` → Records tab shows "No Records"
9. scripts run-gating: run a script → other Run buttons disabled; after finish re-enabled (uses a script fixture or skips if none — see note)
10. integrity profile: delete → inline confirm popover; apply-with-draft → confirm
11. resize: resize the editor group / window → grid slice refreshes (compare rendered rows before/after a resize)
12. reload double-fire: trigger an external-change reload, then press an arrow/Ctrl+Z once → fires exactly once (no duplicate)

> Scripts spec (9): needs a `.hexscope/scripts/*.js` fixture in the E2E workspace; add
> `src/test/e2e/fixtures/workspace/.hexscope/scripts/hello.js`. If fixture setup proves
> brittle, drop spec 9 from v1 and note it.

## D4 — Version + caching
- Pin `--code_version 1.125.0` (matches `engines.vscode ^1.125.0`).
- CT: `actions/cache` on `./test-resources` with key `extest-1.125.0-${{ runner.os }}`.
- `.vscode-e2e-settings.json`: `{ "telemetry.telemetryLevel": "off",
  "update.mode": "none", "workbench.enableExperiments": false }`.

## D5 — CT job (ct.yml)
New `E2E_Test` job (mirrors `UT_Test`):
- checkout → node 24 + npm ci → `npm run compile-tests` → `npm run compile`
- `actions/cache` restore/save `./test-resources`
- run: `xvfb-run -a npm run test:e2e 2>&1 | tee e2e-test-output.log`
- always(): upload `e2e-test-output.log` + `./test-resources/**/console.log`/screenshots
- add `E2E_Test` to `Finalize` needs + failure gate + summary via `summarize-tests.mjs`.

## Risks
- ExTester webview `switchToFrame` can be slow/flaky → generous explicit timeouts;
  specs isolated (each opens its own fixture).
- ChromeDriver/VS Code download on first CI run (~150MB) → mitigated by the cache.
- Webview iframe selection: our editor is a custom HTML webview; `EditorView.openEditor`
  → `WebView.switchToFrame()` is the supported path (verify in impl, fall back to
  `WebviewView`/frame locators if the editor API differs).
- CI Linux needs xvfb (already used by UT job) and `--disable-gpu`/`--headless` webdriver
  args if needed.
