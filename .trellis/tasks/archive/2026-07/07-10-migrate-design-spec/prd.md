# Migrate Struct Instance Display Spec into Trellis

## Goal

Make `.trellis/spec/frontend/` a source-backed description of the full Hex Scope product: migrate the existing Struct Overlay display contract, define missing feature contracts from code/tests, remove template placeholders, then remove the obsolete `docs/` tree from this branch.

## Background

- Source contract: `docs/design/struct-instance-display-spec.md`.
- Trellis currently exposes one code-spec layer: `.trellis/spec/frontend/`.
- Existing frontend spec files are template placeholders and the frontend index has no Struct Overlay contract.
- Current implementation centers on `src/webview/sidebar/struct/index.ts`, with decoded field contracts in `src/core/struct-codec.ts` and shared struct types in `src/core/types.ts`.
- Working tree was clean before this task.

## Requirements

1. Preserve all user-visible behavior from the source design spec in a dedicated frontend Trellis code-spec.
2. Express the material as actionable implementation contracts, including row classification, rendering, interaction, pointer behavior, menus, accessibility, errors, examples, and required tests.
3. Include the seven cross-layer code-spec sections required by `trellis-update-spec`: Scope / Trigger, Signatures, Contracts, Validation & Error Matrix, Good/Base/Bad Cases, Tests Required, and Wrong vs Correct.
4. Link the new code-spec from `.trellis/spec/frontend/index.md` and mark it filled/current.
5. Delete the complete `docs/` directory after the content is represented in Trellis.
6. Do not change runtime code.
7. Scan source and tests to document every current user-visible feature family: document formats, editor lifecycle, memory/record navigation, search/selection/Inspector/copy, editing/save/external changes, integrity checks, struct definitions/pins, and struct instance display.
8. Replace generic frontend templates with repository-specific architecture, component/event wiring, state/persistence, type-boundary, and quality guidance.
9. Delete template files that do not apply to this non-framework webview; specifically, do not preserve a hooks guide when the codebase has no hook abstraction.
10. Keep all claims anchored to current source symbols, tests, or README behavior. Do not change runtime code.

## Acceptance Criteria

- [x] `.trellis/spec/frontend/struct-instance-display.md` exists and preserves every behavioral topic from the source document.
- [x] New spec contains concrete source type/signature anchors and all seven required cross-layer sections.
- [x] Frontend spec index links the new file with non-placeholder status.
- [x] `docs/` no longer exists on this branch.
- [x] No runtime source files changed.
- [x] Diff review confirms no source-design requirement was silently dropped.
- [x] Every README feature family has a linked Trellis feature spec.
- [x] Generic frontend guides contain concrete project paths, patterns, anti-patterns, and verification commands.
- [x] No `To be filled`, placeholder comments, or template-only sections remain under `.trellis/spec/`.
- [x] Frontend index matches the final spec file set; non-applicable hook template is removed.

## Out of Scope

- Implementing or changing Struct Overlay behavior.
- Adding bitfield-pointer support or other future behavior excluded by the source design.
- Inventing desired behavior not evidenced by current code, tests, or product docs.
