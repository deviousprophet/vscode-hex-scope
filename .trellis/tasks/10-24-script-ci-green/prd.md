# Wrap up scripting-enhancements: unit test fix, Fallow green, PR #261 readiness

## Goal

Ship `feat/scripting-enhancements` with a trustworthy green CI and a review-ready PR #261, so the unreleased scripting work can be merged without failing checks or refactor debt blocking review.

## Background and confirmed facts

- PR #261 (draft, base `main`, head `feat/scripting-enhancements`, `MERGEABLE`) has 3/9 failing checks: `Fallow`, `Test After Commit / Unit Test Execution`, and `Test After Commit / Finalize Workflow` (the last is downstream of the unit-test job). Benchmarks, CodeQL, and Analyze pass; Package VSIX is skipped behind the failures.
- Unit test failure: 1 of 1676 tests — `manage scripts delete flow` → `another unlink failure warns and keeps the grants` (`src/test/extension/manageScripts.test.ts:584-591`). It expects `HexScope: could not delete hello.js: …` but gets `HexScope: could not delete D:\ws\hello.js: …` on Linux.
- Root cause: the test passes the hardcoded fixture `'D:\\ws\\hello.js'` to `runPanelDeleteScript`; `deleteOneScript` (`src/manageScripts.ts:458`) derives the display name with `path.basename`, and POSIX `path.basename` does not treat `\` as a separator. The test passes on Windows and fails on Linux. Production input (`Uri.fsPath`) is platform-native, so production code is correct; the fixture is the defect.
- Fallow: the local scan via the repo's `fallow-extract.mjs` (whole project) reports `dead-code 0 | complexity 118 | duplication 11`; GREEN requires all three axes at zero (`fallow-fix` skill). Complexity split: 25 critical, 37 high, 56 moderate; the gate targets cyclomatic ≤ 4 per function (CRAP < 30 at zero coverage).
- The CI Fallow run is degraded (shallow clone → `changed-since` cannot apply, so it analyzes the whole project; `node-modules-missing`). `v3.0.0` main passed the same gates under the same degraded inputs, so green is achievable without changing the workflow.
- Repo quality contract (`.trellis/spec/frontend/quality-guidelines.md`): required gate `npm run check-types`, `npm run lint`, `npm test`; before a PR also the full Fallow scan and changed-code audit; `fallow-fix` is a required gate and must never use suppression comments or config edits.
- PR rules (`.agents/skills/create-pr/SKILL.md`): Conventional Commit title; body has exactly `## Summary` + `## Main changes`; no testing/checklist text; no single commit covers this branch, so one concise commit-style title is required. Draft unless ready-for-review is explicitly requested — the user requested undrafting as part of this wrap-up.
- Changelog was refreshed for the branch and committed separately (`a4d97ce`); this task is refactor/test/metadata only and must not change user-visible behavior, so no changelog entries are expected.

## Requirements

- **R1 — Unit test**: make the delete-flow test assert the same user-visible warning on Windows and Linux by fixing the fixture, not by changing production behavior or weakening assertions.
- **R2 — Fallow**: reach GREEN (`dead-code 0`, `complexity 0` at every severity, `duplication 0`) through behavior-preserving refactors only; no `fallow-ignore` suppressions, no `.fallowrc*`/workflow/threshold edits, no removed functions.
- **R3 — Regression safety**: keep the full existing suite and type/lint/example checks passing.
- **R4 — PR readiness**: update PR #261 title and body to represent the full branch diff, push the branch, and remove the draft flag once checks are green.
- **R5 — Hygiene**: no unrelated changes; commit messages follow Conventional Commits; working tree clean at hand-off.

## Acceptance criteria

- **AC1** — The delete-flow fixture is platform-safe (basename resolves to `hello.js` under both path semantics) and the full `npm test` suite passes locally.
- **AC2** — `node .agents/skills/fallow-fix/scripts/fallow-extract.mjs` exits 0 with `verdict: GREEN` (`dead-code 0 | complexity 0 | duplication 0`).
- **AC3** — `npm run check-types`, `npm run lint`, `npm run check-examples`, and `npm test` all pass locally.
- **AC4** — PR #261 shows Fallow and both CT jobs passing (and Package VSIX no longer skipped), is ready for review, and its title/body follow the create-pr rules and match the full branch diff.
- **AC5** — Diff contains no fallow suppressions/config edits and no user-visible behavior changes (test fixture, refactors, PR metadata only).
- **AC6** — Working tree clean; `CHANGELOG.md` unchanged by this task.

## Out of scope

- Changing the Fallow workflow, thresholds, or degraded-input behavior; making CI's Fallow run scoped.
- Any new feature, UX, or behavior change in scripting/overlay/integrity.
- Merging PR #261 (prepare only) and release/version work.
- Refactoring files outside the Fallow findings and the diff.

## Key decisions

- Single task (no parent/child split): the deliverables are small metadata/test work around one large refactor; splitting a two-line fixture fix into its own task adds bookkeeping without independent value.
- Fallow green is defined by the repo's `fallow-fix` skill (three axes zero); `health.targets`/hotspots are reported, not chased, except where a target is inside the changed diff (skill step 6 and the quality spec's audit gate).
- PR title/body are updated per `create-pr` rules; the draft flag is removed because the user explicitly selected "update and undraft PR #261".
