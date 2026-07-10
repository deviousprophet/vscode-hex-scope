# Design: Trellis Struct Instance Display Code-Spec

## Boundary

Move one standalone UX design document into the existing `frontend` Trellis code-spec layer. Keep one authoritative file rather than splitting tightly coupled row, pointer, selection, and menu contracts across placeholder guideline files.

## Target Shape

- Target: `.trellis/spec/frontend/struct-instance-display.md`.
- Opening seven sections satisfy cross-layer code-spec depth and point to detailed normative sections below.
- Detailed sections preserve the source taxonomy and examples: columns, classification, parent/child behavior, pointer variants, selection/hover, shared UI, menus, accessibility, scalar, struct, bitfield, and coverage matrix.
- Source anchors name `StructField`, `StructDef`, `StructPin`, `DecodedField`, `decodeStruct`, and Struct Overlay rendering code so future work can trace contract to implementation.

## Migration Rules

- Preserve normative meaning; improve organization only where needed for Trellis executability.
- Use MUST/SHOULD language for behavior, exact labels/statuses where relevant, and explicit failure behavior.
- Keep unsupported bitfield-pointer variants explicit.
- Delete source only after target and index are complete.

## Compatibility and Rollback

No runtime impact. Rollback is documentation-only: restore `docs/design/struct-instance-display-spec.md`, remove the Trellis target/index row.

## Trade-off

One larger domain spec is preferred over scattering content: behaviors share row identity, selection, target/source context, and context-menu contracts. Cost: longer file; benefit: single executable contract and lossless migration.

## Expanded Spec Architecture

- Keep cross-cutting implementation guidance in the existing frontend guide names where applicable: directory structure, component/event rendering, state management, type safety, and quality.
- Remove `hook-guidelines.md`; this webview uses modules and DOM listeners, not React/Vue hooks.
- Add feature contracts grouped by independently testable ownership:
  - document formats and serialization;
  - editor session/protocol lifecycle;
  - memory/record navigation;
  - search, selection, Inspector, and byte tools;
  - edit transactions, save, and external changes;
  - integrity checks and profiles;
  - struct definitions, decode, pins, and persistence;
  - existing struct instance display contract.
- Avoid one spec per source file. Feature specs own cross-file data flow and point to exact implementation/test anchors.
