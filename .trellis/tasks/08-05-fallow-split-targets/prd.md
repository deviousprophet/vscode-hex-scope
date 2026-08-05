# Split high-impact files flagged by fallow

## Goal

Split the three fallow health.targets split_high_impact files: memoryData.ts (38 LOC/11 deps), SearchBar.ts (260 LOC), HexView.ts (627 LOC). Behavior-preserving splits; reduce per-change blast radius.

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
