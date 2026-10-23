# Fix script permission lifetime and visibility

## Goal

Make every permission label true and every active grant visible and revocable.

## Requirements

- Move the grant store from a per-editor-session field to a workspace-root-keyed, host-lifetime
  store. Closing and reopening the same firmware file must not lose session grants.
- Session grants end when the extension host exits. Workspace grants stay in `workspaceState`.
  Script grants remain bound to the script fingerprint.
- The Permissions section lists every grant: script path, capability, scope, and revoke.
  List session and script grants, not only workspace grants.
- Add revoke-all for a script and revoke-all for the workspace; confirm destructive bulk revokes.
- Prompt labels must name the real lifetime and consequence:
  - once
  - this script, until the editor closes
  - every script, until VS Code restarts
  - this script, in this workspace, across restarts
- `exec` remains session-only and never persists.
- Changing or deleting a script invalidates its script/workspace grants; session-wide grants are
  an explicit exception and end only with the host.
- Update docs/specs and permission tests.

## Acceptance criteria

- [ ] Select “session” for a script, close and reopen the editor, and the next call does not prompt.
- [ ] Restart the host and the session grant is gone.
- [ ] A workspace grant survives restart and appears in the list.
- [ ] Script-scoped and session-scoped grants appear in the permission center and can be revoked.
- [ ] Revoking a grant makes the next call prompt again.
- [ ] Editing/deleting a script removes its fingerprint-bound grants and the list updates.
- [ ] `exec` never offers or stores workspace scope.
- [ ] Existing tests pass, with new coverage for host-lifetime reuse and the complete list.

## Out of scope

- A separate settings page.
- Organization-wide policy.
- Changing the per-command approval model.

## Dependencies

None.

## Decisions

- The store key is the workspace root; out-of-workspace documents share the document-directory
  root as today.
