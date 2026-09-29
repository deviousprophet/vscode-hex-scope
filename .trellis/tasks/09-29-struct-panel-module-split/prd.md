# Split structPanel into authoring and rendering modules

## Goal

Deferred from the struct-overlay review: structPanel.ts is ~5,686 lines serving five concerns (type authoring, decoded instance rendering, pins, footer actions, CSS). Split into a type-authoring module and an instance-rendering module with shared helpers, and update directory-structure.md's ownership tree.

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
