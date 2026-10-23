# Implement: script creation and workspace management

## Before coding

1. Read `src/core/scripting/examples.ts`, `src/addExampleScripts.ts`, `src/extension.ts`,
   the Scripts panel empty state, and the Overlay/Integrity picker empty states.
2. Reuse `scanScripts` and the existing install/copy helpers; do not add a second file copier.
3. Confirm workspace trust and no-workspace behavior in the existing add-examples command.

## Checklist

- [ ] 1. Add `src/core/scripting/templates.ts` with action/integrity/address/size templates and
      file-name suggestions; include headers, type reference, and working bodies.
- [ ] 2. Add host helpers to create a template file (trust check, duplicate refusal, write, open,
      rescan) and register `hexScope.manageScripts` plus create commands.
- [ ] 3. Implement the Manage Scripts QuickPick with Actions/Providers, open/run/usage, create,
      examples, permissions, and open-folder items.
- [ ] 4. Add the Scripts panel **New** split button and empty-state create action.
- [ ] 5. Make example installation selective (`installExampleScripts` selected list + QuickPick);
      keep Add all.
- [ ] 6. Add Create/Open-folder actions to empty Overlay and Integrity provider pickers and wire
      callbacks through `hexViewer`.
- [ ] 7. Add tests for templates, duplicates, trust, selective install, manager items, and picker
      empty actions.
- [ ] 8. Update docs/specs and run gates.

## Validation commands

```bash
npm run check-types
npm run check-examples
npm run lint
npm test
```

Manual checks:

- run `Manage Scripts` with no hex file open; create each template; file opens and appears.
- select two examples; only those copy; existing files skip.
- open an address/size/integrity picker with no matching script; create action works.

## Review gates

- Gate A after step 1: template bodies reviewed.
- Gate B after step 3: manager flow reviewed.
- Gate C after step 6: picker/panel creation wired.
- Gate D after step 8: gates and docs.

## Rollback points

- The manager command is additive; removing it leaves the panel and picker actions working.
- Selective install defaults to all, preserving the previous behavior if the picker is ignored.
