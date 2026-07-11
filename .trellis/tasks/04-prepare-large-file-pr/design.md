# Prepare large-file pipeline PR design

## Flow

1. Diagnose label drift with a red-capable Memory-view harness.
2. Before replacing `vscrollState`, convert the current physical `scrollTop` through the old layout to capture its logical position. Initialize the new state with that logical position, remap it to the new physical layout, then render.
3. Add a compressed-range rerender regression proving the first visible address remains stable; retain jump and uncompressed tests.
4. Inspect tagged release range and preview exact changelog/version update.
5. Apply only after explicit preview approval; validate release extraction and versions.
6. Review `origin/main...HEAD` locally along Standards and Spec axes because inline mode forbids review subagents.
7. Commit release edits, push existing branch, preview PR title/body, then create/read back a draft PR.

## Boundaries

- Scroll preservation changes only Memory-view rerender state initialization; it does not change label or navigation models.
- Changelog considers committed evidence only; Trellis/test/CI bookkeeping is excluded from user-facing notes.
- PR body contains only `Summary` and `Main changes`.
