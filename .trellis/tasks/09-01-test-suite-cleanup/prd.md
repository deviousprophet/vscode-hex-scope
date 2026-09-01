# Test suite cleanup & README rewrite

## Goal

Near ~1000 unit tests (currently 944 `test()` cases / 40 files). Clean up, optimize, and combine redundant "echo" tests **without losing release validation value**, then rewrite `README.md` in the style of `microsoft/vscode-livepreview` (richer structure, tables, FAQ, development links). Work happens on branch `feat/test-suite-cleanup`.

## Requirements

### R1 — Test suite cleanup
- Identify and collapse redundant tests: near-identical assertion bodies, duplicate titles, echoed parameter sets that check the same path.
- Convert repetitive echo-cases into table-driven `test()` loops so coverage of distinct inputs is preserved with fewer duplicated blocks.
- Keep genuinely different behaviors intact: per-format (Intel HEX vs SREC), parser edge cases, perf assertions, script security checks, panel/menu interactions, storage, schema validation.
- Test-only changes: no production source (`src/`) semantics change. If a cleanup exposes a real bug, file it as a note, do not silently fix source in this task.
- Keep the suite fast to run; perf tests remain clearly separated.

### R2 — README update (scoped: items 1, 2, 8 only)
- **TOC** at top (links to sections: Features, Quick reference, Supported file types, Issues).
- **Quick reference table** extended with practical rows (open, search, edit byte, batch fill, save/recompute checksums, struct pin, integrity profile, run script) — accurate to real actions.
- **Doc links** section: `docs/SCRIPTING.md`, `docs/HEXSCOPE_STORAGE.md`, `CHANGELOG.md`, `LICENSE`.
- Keep everything else as-is (badges, tagline, demo, 5 feature groups, formats table, Issues).

## Acceptance Criteria

- [ ] **Run `npm test` (runs pretest → compile-tests + compile + lint, then vscode-test) → full suite green.**
- [ ] **`npm run check-types` and `npm run lint` pass.**
- [ ] Test count after cleanup ≥ 880 (i.e., only genuine redundancy merged; distinct-input variants preserved).
- [ ] Every test file with `test()` still exercises the same distinct behaviors: enumerate per-file baseline of unique assertion groups in `design.md`; diff shows no distinct behavior removed.
- [ ] Lint rule test (`eslint-rules/require-escaped-html.test.mjs`) passes (part of `npm run lint`).
- [ ] No production source files modified (all src/ tests + README only). Any incidental src bug found during cleanup is logged in the task `notes`, not fixed here.
- [ ] `src/test` has zero duplicate test() titles that are semantically identical (shared-title groups allowed only across formats where titles stay legible, e.g. the sample loops).
- [ ] README: adds TOC + extended quick-reference table + doc links (`docs/SCRIPTING.md`, `docs/HEXSCOPE_STORAGE.md`, `CHANGELOG.md`, `LICENSE`). No other sections changed; no dead links.

## Notes

- Perf test files exist (`parsePerformance`, `searchPerformance`) — treat as sensitive, only touch if clearly redundant.
- Shared helpers already exist (`src/test/shared/helpers.ts` — `assertParsedRecordPayload`). Consolidate new shared logic there when collapsing duplicated assertion blocks.
- Reference README: https://github.com/microsoft/vscode-livepreview (main branch README).