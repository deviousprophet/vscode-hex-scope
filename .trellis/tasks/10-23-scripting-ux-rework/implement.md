# Implement: scripting UX rework (integration closure)

## Context

All five child deliverables are archived. This plan closes the one cross-child criterion no
child owned — **delete a script from the scripting UI** — and then performs the parent
integration review against the cross-child acceptance criteria. Everything else (create,
open, test; permissions; feedback; integration) was delivered by the archived children.

## Checklist

- [ ] 1. Manager: add a `Delete a script…` row (`delete-script`) → second pick over the script
      rows → host modal confirm → trust-gated unlink → revoke that script's grants → info.
      Reuse the existing `ManagerItem`/dispatch pattern in `src/manageScripts.ts`; revoke via
      `scriptGrantStoreFor(root, workspaceState).revokeAllForScript(absPath)`.
- [ ] 2. Panel: card context menu gains `Delete` → posts `deleteScript { scriptPath }` →
      session modal-confirms, deletes, revokes grants, and rescans (`requestScriptList`) so the
      card disappears without waiting for the watcher. The watcher keeps covering external
      deletions.
- [ ] 3. Tests: manager delete flow (confirm accepted/cancelled, untrusted, missing file,
      grant revocation), panel menu item + `deleteScript` payload, session handler rescan.
- [ ] 4. Integration review: verify every cross-child criterion with evidence (tests/specs);
      check off the parent prd list and record the review in `review.md`.
- [ ] 5. Gates: `npm run check-types`, `npm run check-examples`, `npm run lint`, `npm test`;
      changed-code Fallow audit clean (introduced findings only).
- [ ] 6. Commit the closure work; archive the parent after the review confirms.

## Validation commands

```bash
npm run check-types
npm run check-examples
npm run lint
npm test
```

Manual checks:

- manage a provider script, delete it: confirm dialog, file gone, card gone, grants gone.
- cancel the dialog: nothing changes.
- delete from the card context menu with and without an open document.

## Review gates

- Gate A after step 2: delete flow reviewed (host + panel).
- Gate B after step 4: criteria evidence reviewed.
- Gate C after step 5: gates green.

## Rollback points

- Delete is additive: removing the manager row and menu item restores the previous surfaces.
- Grant invalidation on missing scripts (`revokeMissing`) already exists, so the proactive
  revoke can be dropped without breaking stale-grant cleanup.
