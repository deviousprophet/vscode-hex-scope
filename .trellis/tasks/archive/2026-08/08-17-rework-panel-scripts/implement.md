# Rework Scripts — Execution Plan

## Preconditions

Grilling decisions fixed (prd.md). Existing run/cancel state machine and streaming preserved.

## Implementation checklist

1. **Run history (scriptsPanel.ts + css)**
   - Track per-path run records `{id, at, ok}`; render latest result block expanded (existing rendering path), older runs as one-line collapsed rows: `run #2 · 14:03 ✓` with expand toggle reusing `.script-output-block.collapsed` + `.script-output-hdr::before` arrow.
   - Render order: latest first (top) or chronological — pick latest-top (recent work visible without scroll). Note in tests.
   - Cap history at 5 collapsed rows/script + per-card "Clear results" menu item/button if cap hit (or always available). Simple: always-offered small "✕ clear" in result-area header when rows>0.
   - Update `showResult`/`clearRunning` to append record + recompute rows.
2. **True disabled run buttons (scriptsPanel.ts)**
   - In `updateBtnState`: `otherRunning` → `btn.disabled = true; btn.title = 'A script is already running';` else clear.
   - Remove `setBlockedState` aria-disabled path and `.onBlockedRun`/`cb.onBlockedRun` dependency (or keep cb for toolbar status if used elsewhere — verify usage; remove if dead).
   - Keep `.running` (cancel) button enabled + morphed icon.
3. **Capability confirmation gate (scriptsPanel.ts + css)**
   - `confirmedCaps: Set<string>` session state.
   - `onRunBtnClick` → if script has capabilities and path not confirmed → render inline confirm panel (path name + caps list + Run / Cancel). Run → confirm + start; Cancel → close, no run.
   - Remove `capBadges`/`capabilities` inline rendering + `.script-cap` CSS (badges gone from cards). Keep `noTrust`/ext-ts disabling behavior.
4. **CSS cleanup + additions (scriptsPanel.css)**
   - Add `.script-run-hdr` (collapsed row), `.script-clear` button styles.
   - Disabled run uses `.sb-btn:disabled` (already present); drop `.disabled-run`/`.disabled-ts` opacity overrides if now duplicative — keep `.disabled-ts` (untrusted/typecheck) behavior.
   - Delete `.script-cap` if unused.
5. **Tests (scriptsPanel.test.ts)**
   - second run collapses first into one-line row; expand shows old block; latest-top order.
   - clear-results removes rows (optionally per cap).
   - blocked run button has `disabled` attribute + title; no click handler fires.
   - gate: first run with caps shows confirm listing caps; Run starts; second run no confirm; Cancel prevents run + stays not confirmed; remount resets.
   - existing run/cancel/stream/error-type tests pass.

## Validation

- `npm run check-types`
- `npm run lint`
- `npm test`
- Manual EDH dark+light: run script twice → history rows; run two long scripts — second's button disabled; caps script first-run confirm; decline → no run; trust off blocks run badge still absent.

## Review gates

- No `aria-disabled` fake-block path remains (code+test).
- No capability badges render on cards.
- History capped + clear affordance present.
- Disabled buttons skipped by keyboard; running/cancel still works.

## Rollback

One-commit revert restores stacked blocks, clickable-blocked buttons, inline cap badges.