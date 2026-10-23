# Implement: script integration polish

## Before coding

1. Read the Integrity panel's check selection API and the Overlay panel's instance expansion API.
2. Read the Scripts panel card/details surface and the existing attached menu controller.
3. Confirm where `S.activeChecks` and `S.pins` are available in `hexViewer`.

## Checklist

- [ ] 1. Derive `ScriptUsage[]` per script path from the bound profile and push it to the panel.
- [ ] 2. Rebuild usages on profile switch, per-file data changes, check edits, and pin edits.
- [ ] 3. Render `Used by` counts/labels on provider cards and details.
- [ ] 4. Wire usage clicks to Integrity selection/highlight and Overlay instance expansion.
- [ ] 5. Make the filename open the script; keep the pencil.
- [ ] 6. Add the card context menu (Open, Copy path, Reveal, Details, Permissions) with keyboard
      and focus behavior.
- [ ] 7. Show last-run state/time in details/tooltip; keep the status dot.
- [ ] 8. Handle missing scripts in usage rows without dropping the configured path.
- [ ] 9. Add tests and update docs/specs.
- [ ] 10. Run gates.

## Validation commands

```bash
npm run check-types
npm run check-examples
npm run lint
npm test
```

Manual checks:

- a provider used by an integrity check lists it and jumps there.
- an address/size provider lists its instance and expands it.
- filename click opens; context menu actions work.
- deleting a used script updates the destination row and card.
- last-run state survives a rerender.

## Review gates

- Gate A after step 2: usage derivation reviewed.
- Gate B after step 6: navigation/context menu reviewed.
- Gate C after step 10: gates/docs.

## Rollback points

- Usages are derived and additive; disabling the push restores the previous cards.
- Context menu/name click are additive UI.
