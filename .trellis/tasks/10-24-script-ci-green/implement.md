# Implementation plan — script-ci-green

## Preconditions

- Branch `feat/scripting-enhancements`, clean tree at `a4d97ce` (changelog commit).
- `node_modules` installed; `npx fallow` works (first run downloads to the npx cache).
- `gh` authenticated for `deviousprophet/vscode-hex-scope`.

## Ordered checklist

1. **Baseline** — run `node .agents/skills/fallow-fix/scripts/fallow-extract.mjs`; record the counts (expected `dead-code 0 | complexity 118 | duplication 11`) and keep the finding list for progress tracking.
2. **Unit-test fix** — add `FAKE_HELLO_PATH` in `src/test/extension/manageScripts.test.ts`; use it at lines 561 and 586. `npm run compile-tests` catches type errors; the full suite runs at step 7.
3. **Fallow group 1** — `src/core/overlay/overlayNormalization.ts` + shared validation for `overlayCodec.ts` / `overlayInstancesModel.ts`. Re-run extract; `npx tsc --noEmit`.
4. **Fallow group 2** — integrity pipeline: `integrityScriptRunner.ts`, `core/integrity.ts`, `integrityPanel/integrityCalculation.ts`, `integrityPanel.ts`, `integrityResultRender.ts`, `integrityCheckModel.ts`, `integrityHighlight.ts`.
5. **Fallow group 3** — scripting core/permissions: `core/scripting/{contracts,scriptRunner,scriptWorker,types}.ts`, `scriptPermissions.ts`, `instanceAddressRunner.ts`, `examples/scripts/array-size-from-header.js`.
6. **Fallow group 4** — host/webview: `hexEditorSession.ts`, `hexViewer.ts`, `overlayPanel.ts` (largest), `overlayInstancesModel.ts`, `rowRenderer.ts`, `editorFields.ts`, `cPreview.ts`.
7. **Duplication closeout** — remaining clone groups; then `npm run check-types`, `npm run lint`, `npm run check-examples`, `npm test`.
8. **Fallow gate** — extract must print `verdict: GREEN` (exit 0); run the quality-spec full scan + audit; triage remaining `targets` (in-diff only).
9. **Spec update (Phase 3.3)** — add the platform-safe path-fixture rule to `.trellis/spec/frontend/quality-guidelines.md` (Test Quality Rules); confirm no other spec drift (no behavior/contract changes).
10. **Commit (Phase 3.4)** — two commits:
    - `test(scripting): make delete-flow fixtures platform-safe`
    - `refactor(scripting): clear Fallow complexity and duplication findings`
11. **Push + PR** — `git push origin feat/scripting-enhancements`; write `.git/PR_BODY.md`; `gh pr edit 261 --title "<approved title>" --body-file .git/PR_BODY.md`; `gh pr ready 261`; read back.
12. **Verify CI** — `gh pr checks 261 --watch`; confirm Fallow + both CT jobs pass and Package VSIX runs. If anything fails, fix and repeat steps 3-7.

## Validation commands

```text
node .agents/skills/fallow-fix/scripts/fallow-extract.mjs
npx -y fallow --format json --quiet --explain
npx -y fallow audit --base origin/main --gate all --format json --quiet --explain
npm run check-types
npm run lint
npm run check-examples
npm test
gh pr checks 261 --watch
```

## Risky files / rollback points

- `src/webview/components/sidebar/overlayPanel/overlayPanel.ts` — biggest surface; checkpoint after each extracted helper group.
- `src/core/overlay/overlayNormalization.ts` / `overlayCodec.ts` — persistence-boundary sanitizers; behavior must be byte-identical.
- `examples/scripts/types/hexscope.d.ts` — public contract; no API change.
- Rollback a group with `git checkout -- <files>` before the final commits; after commit, revert the refactor commit.

## Follow-up checks before `task.py start`

- `prd.md`, `design.md`, `implement.md` present and converged.
- `implement.jsonl` / `check.jsonl` curated with real spec entries.
- User approves the final planning summary in a subsequent message.
