# Implement: script permission lifetime and visibility

## Before coding

1. Read `src/scriptPermissions.ts`, the permission section of the Scripts panel, and the
   `scriptPermissions`/`revokeScriptPermission` protocol rows.
2. Confirm `HexEditorSession` currently creates the store per panel (`_scriptGrants`).
3. Read the permission tests and update the fake memento if the store factory needs one.

## Checklist

- [ ] 1. Add a module-level, workspace-root-keyed store registry with a `scriptGrantStoreFor`
      factory; keep the memento injectable for tests.
- [ ] 2. Replace per-session `_scriptGrants` with the registry in `hexEditorSession.ts`.
- [ ] 3. Add `ScriptGrantView`, `listGrants`, `revokeGrant`, `revokeAllForScript`, and
      `revokeAll`; map session entries to `script`/`session` scopes.
- [ ] 4. Extend the protocol with the full grant list and the two revoke messages; update the
      message dispatch and panel callbacks.
- [ ] 5. Render scope, script, capability, revoke, and revoke-all in the Permissions section;
      two-step confirm for bulk revoke.
- [ ] 6. Update prompt labels/help to the real lifetimes; keep the option values unchanged.
- [ ] 7. Test store reuse across editor sessions, root isolation, restart behavior, all-scope
      listing, revocation, and `exec` scope rules.
- [ ] 8. Update docs/specs and run gates.

## Validation commands

```bash
npm run check-types
npm run lint
npm test
```

Manual checks:

- allow write for this session, close/reopen the file, write again: no prompt.
- restart the extension host: prompt again.
- allow workspace, restart: no prompt; row visible.
- revoke the row: next call prompts.
- session-wide row reads “All scripts”; `exec` has no workspace row.

## Review gates

- Gate A after step 3: store lifetime and scope mapping reviewed.
- Gate B after step 5: full list/revoke UX reviewed.
- Gate C after step 8: gates and specs.

## Rollback points

- The registry is a wrapper; reverting to the per-session field restores the previous behavior.
- The richer protocol can fall back to workspace rows if the webview is older; keep a tolerant
  default for missing scopes.
