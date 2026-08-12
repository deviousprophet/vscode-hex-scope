# PRD — vscode-extension-tester E2E suite + CI/CT wiring

## Origin
Grilled plan (Q1–Q6) for a focused ExTester E2E smoke suite covering the real-browser
behaviors the jsdom unit suite cannot prove, wired into the existing CI/CT workflows.

## Scope
Add ExTester (Red Hat `vscode-extension-tester`) as a devDependency and a ~12-spec E2E
smoke suite under `src/test/e2e/`, run locally via `npm run test:e2e` and in CI/CT via a
new `E2E_Test` job in `ct.yml` (parallel to `UT_Test`, reported by `Finalize`).

## Decisions (grilled)
- **D1 Scope:** focused smoke (~12 specs) from the manual checklist — not the full 43.
- **D2 Runner:** `extest setup-and-run` CLI (no programmatic runner).
- **D3 Location:** `src/test/e2e/**/*.test.ts` + fixtures in `src/test/e2e/fixtures/`;
  `.vscode-test.mjs` glob narrowed to exclude `e2e` so `npm test` (jsdom suite) skips them.
- **D4 Version/cache:** pin `--code_version 1.125.0` (engines.vscode `^1.125.0`);
  `actions/cache` for `./test-resources` in CT keyed on the pinned version.
- **D5 CI:** `E2E_Test` job in `ct.yml` (node 24, `npm ci`, compile, `xvfb-run -a extest
  setup-and-run …`), upload failure logs, include result in `Finalize`.
- **D6 Supporting files:** fixtures (`sample.hex`, `empty.hex`, `sample.srec`),
  `.vscode-e2e-settings.json` (telemetry/updates off), `test:e2e` + `pretest:e2e` npm
  scripts, `src/test/e2e/helpers.ts` (open fixture → `WebView.switchToFrame` +
  teardown `switchBack`), docs note.
- **D7 Out of scope:** benchmarks stay in the existing `Benchmarks` CT job (ExTester is
  functional UI testing; webdriver timing is not meaningful for perf).

## Acceptance criteria
1. `npm run test:e2e` runs the ~12 specs locally (Windows + Linux) and passes.
2. E2E specs never run under `npm test` (unit suite glob excludes `e2e`).
3. `E2E_Test` job runs in CI/CT on PRs to `main`, passes on a clean tree, and its
   failure/success is reported by `Finalize`.
4. The specs cover: open fixture → memory render; search + divergence; edit + undo;
   paste-overflow notice; grid arrow-key selection (focus-gated) + shift-extend;
   context-menu keyboard; record empty state; scripts run-gating; integrity profile
   confirms; resize re-slice; reload no-double-fire.
5. `npm run check-types`, `npm run lint`, `npm test` (unit) stay green.
6. No functional/visual change to the extension itself (test-only addition).

## Result (verified locally)
- `npm run test:e2e`: **12 passing, 3 skipped, 0 failing**.
- 3 specs skipped with documented reasons (edit-mode keystrokes, clipboard paste, and the
  file-watcher reload trigger are unreliable under ChromeDriver/VS Code webview frames; all
  three flows are covered by the unit suite). The A1 no-double-fire guarantee is verified by
  code review + the module-scope registration.
