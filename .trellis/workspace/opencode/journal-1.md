# Journal - opencode (Part 1)

> AI development session journal
> Started: 2026-09-02

---



## Session 1: Reject duplicate struct field names at validation
<!-- trellis-session: v=2 fp=fbbf92a7116e7646 -->

**Date**: 2026-09-08
**Task**: Reject duplicate struct field names at validation
**Branch**: `fix/struct-duplicate-field-name`

### Summary

Session summary was not supplied.

### Main Changes

- validateStructs now rejects same-struct duplicate field names (structCodec.ts), fixing wrong group-header type/size shown for duplicate-named arrays
- Added 3 regression tests (duplicate in one struct; same name across defs; same name under different nested parents) in src/test/core/struct.test.ts
- struct-model.md: documented duplicate-name validation rule + design decision (reject at validation, skip renderer disambiguation)

### Git Commits

| Hash | Message |
|------|---------|
| `243a73f` | fix(struct): reject duplicate field names in struct validation |

### Testing

- [OK] tsc/lint green; npx mocha struct.test.js 95 passing; full npm test 964 passing

### Status

[OK] **Completed**

### Next Steps

- Merge fix/struct-duplicate-field-name
