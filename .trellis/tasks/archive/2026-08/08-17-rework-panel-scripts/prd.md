# Rework panel: Scripts

## Goal

Rewrite the Scripts panel runner experience on decisions from the UX grilling session. Run history stays comparable but compact, blocked buttons are honest, capabilities become a run-time trust gate.

## Background (audit findings driving this work)

- Run results stack forever: every run appends an output block; 10 runs = 10 blocks with scroll fatigue, but run-to-run comparison is a real pipeline use case.
- While one script runs, all other run buttons are aria-disabled-but-clickable (scriptsPanel.ts:309-316): keyboard users tab through inert buttons, mouse users get a status message.
- Capability badges (⚡ exec / 🌐 net) render OS-dependent emoji on every card, no legend — trust signal as decorative garnish.

## Accepted grilling decisions (requirements)

1. **Collapse-old-runs history (C)** — old run blocks collapse to a one-line expandable header ("run #2 · 12:03 ✓"); latest block stays open. History retained for comparison, clutter removed.
2. **True disabled run buttons (B)** — while another script runs, other run buttons carry the real `disabled` attribute, are removed from tab order, and show a tooltip explaining one script runs. Remove the clickable-but-aria-disabled pattern.
3. **Capabilities become a run-time confirmation gate (B)** — before the first execution of an untrusted (or capability-bearing) script, show a confirmation listing its capabilities (exec/network/write). Static emoji badges are removed from cards. Trust decision persists per-script (modifiable).

## Out of scope

- Script create/delete/rename/edit UI — not requested in grilling.
- Refresh action and play→stop→spinner morph behavior stay.
- Result log/stream rendering and error-type styling stay.

## Acceptance Criteria

- [ ] Each script card shows at most one expanded output block (latest run) + one-line collapsed headers per earlier run; clicking a header expands that run's block.
- [ ] Running and cancel behavior unchanged; a new run auto-presses older blocks into one-line headers.
- [ ] While a script is running, every other run button is truly `disabled` (tab stops skip; tooltip explains), no click-to-see-message path.
- [ ] Capability emoji badges no longer render inline on cards.
- [ ] First run of a script with capabilities shows a confirmation dialog listing capabilities; accept persists per script (state survives re-render, resets on workspace/cancel or explicit clear).
- [ ] Declined confirmation does not start the script; no partial run state.