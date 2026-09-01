# Implement — Test suite cleanup & README rewrite

Owner: deviousprophet · Branch: `feat/test-suite-cleanup` · Base: `main` · Status: planning (start at review gate)

## Gate before start

- [ ] User review of `prd.md` + `design.md` (review gate) → `task.py start`
- [ ] Full suite green on branch before any edit: `npm test`

## Execution checklist (low risk → high)

### Pre-cleanup baseline
1. Record exact per-file `test()` counts + duplicate-title scan (survey outputs, copied into this file's "Baseline" section below).
2. `git stash`-safe: baseline commit? No — branch already clean; record counts only.

### Phase A — Mechanical merges (delete echo tests, dedupe)
3. Within-file duplicate-title same-body → merge; log every merge in `implement-delta.md` (file, old title → new).
4. Extend `src/test/shared/helpers.ts` for copy-pasted assertion blocks used ≥3 places.

### Phase B — Parametric consolidation
5. Convert same-path/different-input echo `test()` blocks to `for`-loop tables. Per file keep a row in the delta log: `file | N before → N after | behaviors preserved`.
6. Remove redundant coupons; keep loops readable (comment each table's intent per policy: comments allowed when they explain the table).

### Phase C — Verify
7. `npm run check-types` && `npm run lint` (incl. eslint-rule test).
8. `npm test` full green.
9. Re-run redundancy scan: count ≥ 880; no semantically-identical dup titles left; no distinct-behavior removal (diff assertion bodies per merged group against baseline).

### README update (scoped: items 1, 2, 8)
10. Add TOC; extend Quick reference table (rows: open, search, edit byte, batch fill, save/recompute checksums, struct pin, integrity profile, run script); add Documentation section linking `docs/SCRIPTING.md`, `docs/HEXSCOPE_STORAGE.md`, `CHANGELOG.md`, `LICENSE`.
11. Validate all links resolve; confirm no other README sections changed.

### Finish
12. `trellis-check` review of test diffs + README.
13. Spec update (if wisdom worth persisting: e.g. "fold echo tests, keep per-format samples") → `trellis-update-spec`.
14. Commit (single logical commit or one per phase). Message style: conventional, subject ≤ 72.
15. `task.py archive` after all acceptance criteria green.

## Validation commands

```
npm run check-types
npm run lint
npm test            # pretest runs compile-tests+compile+lint then vscode-test
```

## Rollback points

- After Phase A: counts + ASuite green keys off `npm test`; revert = `git revert HEAD` (branched off main, nothing shared).
- After Phase B: same; delta log makes collateral review trivial.

## Baseline (survey 2026-09-01)

Per-file `test()` counts:
```
core\byteTools\crc.test.ts 3 | core\disposableStore.test.ts 3 | core\document.test.ts 9
core\integrity.test.ts 21 | core\parsePerformance.test.ts 2 | core\parser\compactParser.test.ts 8
core\parser\ihexParser.test.ts 31 | core\parser\ihexSamples.test.ts 27 | core\parser\srecParser.test.ts 29
core\parser\srecSamples.test.ts 61 | core\providerUtils.test.ts 45 | core\scriptingRunner.test.ts 36
core\search.test.ts 10 | core\searchPerformance.test.ts 1 | core\struct.test.ts 103
extension\extension.test.ts 2 | extension\hexScopeStorage.test.ts 37 | schemas\schemaValidation.test.ts 11
webview\components\externalChange.test.ts 12 | webview\components\hexView.test.ts 36
webview\components\menuController\menuController.test.ts 56 | webview\components\recordView.test.ts 14
webview\components\searchBar.test.ts 18 | webview\components\sidebar.test.ts 34
webview\components\sidebar\inspectorPanel\inspectorPanel.test.ts 42 | ...\integrityPanel.test.ts 29
...\scriptsPanel.test.ts 41 | ...\structPanel.test.ts 55 | webview\components\toast.test.ts 6
webview\components\toolbar.test.ts 16 | webview\contextCommands.test.ts 2 | webview\integrityCheckModel.test.ts 8
webview\lock.test.ts 3 | webview\recordPageCache.test.ts 4 | webview\searchEngine.test.ts 6
webview\structPinsModel.test.ts 7 | webview\utils.test.ts 11 | webview\virtualScroll.test.ts 3
webview\webview.test.ts 91 | webview\webviewMessageModel.test.ts 11
TOTAL = 944
```
Dup-title groups (accept: cross-format shared titles are intentional; fix only within-file same-body):
```
8x "no parse errors" (ihexSamples×3, srecSamples×5) — KEEP (sample loops)
blank lines / trailing SUB / sentinel bytes / first segment / 2 checksum errors — cross-format echoes — KEEP
render is idempotent — integrityPanel vs scriptsPanel — KEEP (distinct panels, cosmetic)
```