# Quality and Test Contracts

## Required Gate

Run from repository root:

```text
npm run check-types
npm run lint
npm test
```

Before creating or updating a pull request, also run the full Fallow analyzer and the changed-code audit:

```text
npx -y fallow --format json --quiet --explain
npx -y fallow audit --base origin/main --gate all --format json --quiet --explain
```

Both reports must contain zero dead-code issues, clone groups, health findings, and refactor targets. Fix findings using the [`fallow-fix` skill](../../.agents/skills/custom/fallow-fix/SKILL.md) — refactors source code, never uses suppression comments or config edits.

`npm test` compiles tests/extension, bundles the webview, launches VS Code, and runs core, webview, fixture, and extension suites.

`npm run test:e2e` runs the ExTester E2E smoke suite (`src/test/e2e/`): opens fixture files in the real HexScope custom-editor webview and drives the real-browser behaviors the jsdom suite cannot (webview render, search divergence, grid keyboard selection, context-menu nav, panels, resize re-slice). It downloads VS Code 1.125.0 + ChromeDriver into `./test-resources` (cached in CI). Runs in the `E2E_Test` job of `ct.yml` (xvfb) and is reported by `Finalize`. Some webview-keyboard/clipboard/reload specs are skipped under ChromeDriver (documented in-file) — their logic is unit-covered.

## Test Placement

- Pure algorithms/models: `src/test/core/`.
- DOM rendering, model transitions, and feature interaction: `src/test/webview/` with JSDOM helpers.
- Extension registration: `src/test/extension/`.
- Realistic IHEX/SREC samples: `src/test/shared/parserFixtures.ts` plus format sample suites.

## Required Coverage by Change

- Parser/document change: clean, malformed, checksum-invalid, address-width, gap, CRLF, round-trip, and source-preservation cases.
- Protocol/state change: unknown-message handling, model transition, all invalidations, and host/browser discriminator sync.
- Memory/search change: mapped gaps, pending edits, cancellation/latest-query behavior, address zero, selection range, and large-file chunk/virtualization behavior.
- Edit/save change: transaction atomicity, undo, serialization, checksum recompute, and external-change lock/conflict paths.
- Integrity change: canonical vectors, address/range validation, unmapped bytes, stored byte order, overlap exclusion, profile normalization, and fix conflict atomicity.
- Struct change: validation, layout/alignment, arrays/nesting, pointers, bitfields, parse/text/export round-trip, persistence, and UI contract matrix.

## Test Quality Rules

- Assert public output/state/action, not a duplicate implementation inside the test.
- Mentally delete the behavior: if test still passes, strengthen it.
- Use injected ID factories/read-byte callbacks for deterministic core tests.
- Keep source fixtures representative; do not replace format tests with only synthetic one-line records.
- Verify review claims against actual trust boundaries and design comments.

## Anti-patterns

- Snapshot-only tests for complex interactive rows.
- Testing a helper while leaving its orchestration unobserved.
- Silencing type/lint errors to land a feature.
- Adding feature behavior with no failure-path assertion.
- Running only a narrowed suite before final handoff.

## Review Checklist

- One module owns each contract and derived state.
- No DOM/VS Code dependency leaked into core logic.
- Protocol/persistence inputs normalized once.
- All mapped/unmapped, empty, zero-address, and stale-state paths considered.
- `.trellis/spec/frontend/index.md` and relevant feature spec updated when contracts change.
