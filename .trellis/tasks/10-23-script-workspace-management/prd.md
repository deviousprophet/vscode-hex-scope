# Add script creation and workspace management

## Goal

Let users create, open, and manage scripts without first opening a firmware file or knowing the
`.hexscope/scripts` path.

## Requirements

- Add `HexScope: Manage Scripts` as a command that works without an open hex document.
- The manager lists Actions and Providers, opens a script, reveals it in Explorer, starts a
  template, and opens the Permissions center.
- Add a **New script** split button in the Scripts panel and manager with templates:
  blank action, integrity check, instance address, array size.
- Templates open the new file immediately, with the correct `@script`/`@requires` header, JSDoc
  types, placeholder comments, and a working minimal body.
- “Add example scripts” becomes a selective dialog with checkboxes and a copy-only note; keep an
  “Add all” secondary action.
- Empty provider pickers in Overlay/Integrity get a **Create … script** action and an
  **Open scripts folder** action instead of a dead option.
- A created script is discovered immediately (rescan) and selected/opened in the editor.
- Never overwrite an existing file from creation or example installation.
- Update docs/specs and tests.

## Acceptance criteria

- [ ] `Manage Scripts` opens with no hex document open.
- [ ] Creating an action/integrity/address/size template writes the file and opens it.
- [ ] The new script appears in the matching section without a manual refresh.
- [ ] Selective install copies only checked examples and skips existing files.
- [ ] An empty address/size/integrity picker offers a create action.
- [ ] Duplicate filenames are refused with a clear message.
- [ ] Workspace trust is respected for writes.
- [ ] Tests cover templates, selective install, empty pickers, and manager actions.

## Out of scope

- A full Explorer tree view (the command is the first release).
- Remote templates.
- Renaming/deleting scripts from the manager (can follow later).

## Dependencies

`10-23-script-role-actions` for the action/provider model and ordering.
