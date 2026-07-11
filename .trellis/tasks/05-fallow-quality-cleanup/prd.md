# Eliminate Fallow quality warnings

## Goal

Eliminate every actionable Fallow warning before PR #94 is ready for review.

## Requirements

- Audit the whole repository for dead code, duplication, and health findings.
- Fix findings through deletion or refactoring; do not suppress findings.
- Do not change any Fallow configuration file.
- Preserve user-visible behavior and the large-file pipeline contracts.
- Record a reusable project rule that Fallow must pass before future PR creation.

## Acceptance Criteria

- [x] Full Fallow dead-code report has zero findings.
- [x] Full Fallow duplication report has zero findings.
- [x] Full Fallow health report has zero warnings at configured/default thresholds.
- [x] Changed-code Fallow audit against `origin/main` passes.
- [x] No suppression comments or Fallow configuration changes are introduced.
- [x] `npm run check-types`, `npm run lint`, `npm test`, and `npm run test:performance` pass.
- [ ] Cleanup is committed, pushed, and reflected in draft PR #94.

## Notes

- User requires this gate before every PR in this project.
