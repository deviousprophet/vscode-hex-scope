# UI/UX: Integrity profile delete + apply need confirmations

## Goal

From ui-ux-review.md (M): deleteSelectedProfile (integrityProfiles.ts:172-176) has no inlineConfirm unlike all other destructive actions; applySelectedProfile overwrites checks without warning when drafts are open. Route through inlineConfirm + confirm on overwrite.

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
