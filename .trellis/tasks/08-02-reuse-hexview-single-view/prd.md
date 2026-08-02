# Reuse HexViewComponent in single hex view

Child task of `08-02-reuse-ui-components-single-view`. Status: **planning — NOT yet fully specified; needs its own brainstorm (grill) before `design.md`/`implement.md`.**

## Goal

Adopt the reusable `HexViewComponent` (built for the diff view, `src/webview/ui-components/hex-view/`) as the single-file hex editor's memory grid — replacing the hand-rolled grid in `memory-view.ts` / `memoryView.ts`. Scope still open: interaction layer only vs full grid rebuild (previously B/C of the search-bar task).

## Open Questions (brainstorm before planning artifacts)

- Grid rebuild depth: reuse rendering only, or also selection/scroll/virtualization/editing interplay?
- How the single-view grid features that diff doesn't have map onto the component: byte edit, gaps, drag-selection, context menu, record view integration.
- State/event bridge between `memoryView` (S + selection + scroll + highlights) and the component's API.
- Match-highlight styling (`.search-row`) ownership — result rendering vs component.
- `hex-view-component.test.ts` moves to `src/test/webview/ui-components/` (parent cross-child C1).

## Constraints

- Parent cross-child: component owns its CSS; never writes `S` directly; diff view unchanged.
- Depends on the host+component / seed+callbacks pattern established by `reuse-searchbar-single-view` (do that child first).

## Acceptance Criteria

- [ ] TBD (after brainstorm)

## Notes

- This task is in scope now (was previously deferred). Parent `08-02-reuse-ui-components-single-view` holds the task map and cross-child acceptance criteria.
