# Implementation Plan

1. Create `.trellis/spec/frontend/struct-instance-display.md` from the existing design contract.
   - Add seven mandatory cross-layer sections.
   - Preserve detailed row-family and interaction contracts plus examples and coverage matrix.
   - Anchor relevant current TypeScript types/functions/files.
2. Update `.trellis/spec/frontend/index.md` with the new spec and current status.
3. Delete `docs/design/struct-instance-display-spec.md`; confirm empty `docs/` tree is gone.
4. Validate:
   - Compare source topic headings/requirements against target before deletion.
   - `rg --files docs` must find no directory/files.
   - `rg` target for mandatory section names and key contracts: pointer status, selection, context menu, keyboard, scalar/struct/bitfield matrix.
   - `git diff --check`.
   - `git diff --stat` and `git status --short` show documentation/task changes only.
5. Run Trellis quality check and review final diff.
6. Inventory all source/test modules and README feature families with CodeGraph plus direct reads.
7. Replace remaining frontend templates with project-specific cross-cutting guides; delete the non-applicable hook guide.
8. Add missing feature contracts listed in `design.md`, each with boundaries, signatures/contracts, errors, tests, and anti-patterns.
9. Rebuild the frontend index and verify every linked file exists, every README feature maps to a spec, and no placeholders remain.

## Risk / Rollback Points

- Main risk: semantic loss during restructuring. Mitigation: heading/topic inventory plus source-to-target diff review before finalizing deletion.
- Rollback: reverse target/index edits and restore source doc; no runtime migration needed.
