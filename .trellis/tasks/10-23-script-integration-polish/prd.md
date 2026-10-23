# Polish script integration surfaces

## Goal

Close the loop between a provider script and the places that use it, and make every script card
feel like a first-class workspace object.

## Requirements

- Provider cards and details show **Used by** entries derived from the bound profile:
  integrity checks and instances/parameters, with links that select the check or instance.
- Make the script name itself open the file; keep the pencil as a secondary affordance.
- Add a card context menu: Open, Copy path, Reveal in Explorer, Show details, Manage permissions.
- Show last-run timestamp and terminal state in the card tooltip/details.
- When a used script is missing or changed, the Integrity/Overlay row links back to the script
  and offers Refresh; the Scripts card shows the affected destination.
- Keep usage derivation transient; do not persist it into the script or profile.
- Update docs/specs and tests.

## Acceptance criteria

- [ ] A script used by an integrity check lists that check and selecting it jumps to it.
- [ ] A script used by an address/size instance lists the instance and jumps to it.
- [ ] Clicking the filename opens the file.
- [ ] Context-menu actions work with keyboard and mouse.
- [ ] Last-run state appears after a run and survives a panel rerender.
- [ ] Deleting a used script updates the provider card and destination row.
- [ ] Tests cover usage derivation, links, filename click, context menu, and last-run state.

## Out of scope

- Cross-workspace usage.
- Persisting a usage index.
- Automatic refactors of profile data.

## Dependencies

`10-23-script-role-actions` for provider metadata, `10-23-script-feedback-scale` for details and
last-run state.
