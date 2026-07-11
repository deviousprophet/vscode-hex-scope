# Large-file search regression

## Goal

Restore large-file search performance after the compact/lazy rendering pipeline while preserving cancellation, progressive results, and UI responsiveness.

## Requirements

- Build a deterministic timing harness against the real `SearchEngine` large-segment path before forming or applying a fix.
- Compare current chunked search with a minimal equivalent byte scan so scheduling and scan costs are separable.
- Identify and fix the measured regression without disabling cancellation or monopolizing the webview thread.
- Preserve byte, numeric-value, ASCII, and address search behavior over `Uint8Array` segment data.

## Acceptance Criteria

- [x] A fast automated regression test fails on the slow path before the fix and passes afterward.
- [x] Large-file harness shows a material speedup with identical matches.
- [x] Search progress remains monotonic and pending searches remain cancellable/latest-query-wins.
- [x] Type-check, lint, full tests, and relevant performance checks pass.

## Out of Scope

- Parser, record paging, or file-loading redesign unless measurement proves them causal.
