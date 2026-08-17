# UX copy: feedback + no silent truncation

## Goal

Fix: multi-byte raw dump copies only first 8 bytes + literal ellipsis silently (inspectorRender.ts:38-41) - copy full selection or add explicit length; add copy feedback (toast/flash) everywhere (inspector chips, mi-dec/mi-hex, raw dump, integrity value panes); add visible copy affordance beyond title tooltip; endian indicator in multi-byte panel (values are endian-dependent, indicator only in 9px global strip).

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
