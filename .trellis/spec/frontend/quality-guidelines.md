# Quality and Test Contracts

## Required Gate

Run from repository root:

```text
npm run check-types
npm run lint
npm test
```

`npm test` compiles tests/extension, bundles the webview, launches VS Code, and runs core, webview, fixture, and extension suites.

## Test Placement

- Pure algorithms/models: `src/test/core/`.
- DOM rendering, model transitions, and feature interaction: `src/test/webview/` with JSDOM helpers.
- Extension registration: `src/test/extension/`.
- Realistic IHEX/SREC samples: `src/test/shared/parser-fixtures.ts` plus format sample suites.

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
