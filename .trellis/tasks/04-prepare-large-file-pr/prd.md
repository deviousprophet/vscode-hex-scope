# Prepare large-file pipeline PR

## Goal

Fix compressed Memory-view drift after label creation, then prepare the large-file pipeline branch for release review and a draft pull request.

## Background

- Label creation and deletion call `rebuildLabelsAndMemory()` and `renderMemBody()`; label jumps instead call `scrollTo()` and remain accurate.
- `renderMemBody()` recreates virtual-scroll state with physical `scrollTop` stored as logical `scrollTop`. This loses the compressed mapping until the next explicit jump.
- A deterministic 13 MiB repro moves the first visible address from `0x0067FFF0` to `0x0061A730` after the label-style rerender.

## Requirements

- Preserve the logical Memory-view scroll anchor when adding or deleting labels causes `renderMemBody()` to recreate compressed virtual-scroll state.
- Keep label jumps, uncompressed scrolling, gap-row heights, resize behavior, and virtual-height compression unchanged.
- Add regression coverage for compressed rerender stability and retain existing jump coverage.
- Update release notes and synchronized package versions from committed changes since the latest release tag, following preview approval.
- Review the complete branch against repository standards and the archived large-file task specifications.
- Resolve blocking review findings before publishing.
- Push the existing feature branch and create a draft PR against the default branch after exact title/body preview.

## Acceptance Criteria

- [x] Adding or deleting a label while viewing compressed large memory preserves the same first visible logical address.
- [x] Label jumps and uncompressed Memory scrolling remain correct.
- [ ] Changelog/version preview receives explicit approval before edits.
- [ ] Changelog extraction and package-version validation pass.
- [ ] Standards and spec review have no unresolved blocking findings.
- [ ] Draft PR is pushed, created, and read back successfully.

## Release Gate

- Changelog/review/PR publication starts only after the drift fix and regression suite pass.
