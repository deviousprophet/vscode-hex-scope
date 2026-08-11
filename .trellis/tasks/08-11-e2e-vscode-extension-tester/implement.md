# Implement â€” vscode-extension-tester E2E suite + CI/CT wiring

Ordered. Validate after each step.

## Phase A â€” local harness
- [x] `npm i -D vscode-extension-tester`
- [x] Add npm scripts `test:e2e` + `pretest:e2e` (D2/D3); add `.vscode-e2e-settings.json` (D4).
- [x] Narrow `.vscode-test.mjs` `files` glob to exclude `out/test/e2e`.
- [x] Add fixtures: `src/test/e2e/fixtures/sample.hex` (multi-segment, gap, `DE AD` repeat),
      `empty.hex` (zero records), `sample.srec`, and `workspace/.hexscope/scripts/hello.js`.
- [x] `src/test/e2e/helpers.ts`: open fixture â†’ `EditorView.openEditor` â†’ `WebView.switchToFrame()`; teardown `switchBack()`; explicit timeouts.
- [x] Validation: `npm run compile-tests` compiles e2e specs; `npm test` does NOT pick them up.

## Phase B â€” the ~12 specs (D1 list)
- [x] Write specs 1â€“12 per design.md. Spec 9 (scripts) conditional on fixture working.
- [x] Validation: `xvfb-run -a npm run test:e2e` (Linux) / `npm run test:e2e` (Windows) passes locally; fix flakes (timeouts, frame switches).

## Phase C â€” CI/CT
- [x] Add `E2E_Test` job to `ct.yml` (node 24, npm ci, compile-tests+compile, cache `./test-resources`, `xvfb-run -a npm run test:e2e`, upload logs/screenshots on failure).
- [x] Wire `E2E_Test` into `Finalize` needs + gate + `summarize-tests.mjs` summary.
- [x] Validation: push a branch â†’ PR â†’ CI/CT `E2E_Test` job runs and passes.

## Phase D â€” docs + gate
- [x] Document `npm run test:e2e` + CI coverage (quality-guidelines.md or README section).
- [x] Full gate: `npm run check-types && npm run lint && npm test` (unit suite unchanged/green).
- [x] PR vs `main` (create-pr skill), then finish-work.

