# Consolidate the New menu and example actions

## Goal

Give the Scripts panel one entry point for starting work: the **New** menu owns templates *and*
example installation (selective by default, bulk secondary), and the separate bulk
"Add example scripts" buttons disappear.

## Requirements

- The panel's **＋ New** caret menu lists, after the four templates and a separator:
  - **Browse examples…** — the existing selective (checkbox) picker; copies only checked rows
    and skips existing files.
  - **Add all examples** — the existing bulk copy, as the secondary action.
- Remove the panel header's **＋ (Add example scripts)** bulk button; the header keeps Refresh.
- The empty state shows **Create script** + **Browse examples…** (replacing "Add example
  scripts").
- The primary **＋ New** button keeps opening the host template picker.
- `HexScope: Manage Scripts` keeps its current additions (Browse examples… / Add all examples);
  no protocol removals.
- Existing guarantees stay: never overwrite a file, workspace-trust gate, rescan so new cards
  appear without a manual refresh.
- Update docs/specs and tests.

## Acceptance criteria

- [ ] The header shows the New split button and Refresh, with no separate examples `＋`.
- [ ] The New caret menu renders 4 templates + separator + Browse examples… + Add all examples;
      each row reports its own callback.
- [ ] Browse examples… from the panel opens the selective picker (checked-only copy, existing
      skipped).
- [ ] The empty state offers Create script + Browse examples… and no bulk button.
- [ ] The manager is unchanged; the new protocol message is additive.
- [ ] `check-types`, `check-examples`, `lint`, and the full test suite pass.

## Out of scope

- Consolidating the hand-rolled New popup onto the shared MenuController (tracked from the
  branch review; separate task).
- Renaming/deleting scripts, template content changes, manager changes.

## Decisions

- Selective is the panel default and bulk is secondary — this restores the original
  workspace-management intent ("becomes a selective dialog with checkboxes… keep an 'Add all'
  secondary action") that shipped as a separate bulk button instead.
- One discovery surface: the New menu, rather than a second toolbar button.
