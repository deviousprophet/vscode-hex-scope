# Extract Scripts panel into self-contained component

## Goal

Extract the Scripts sidebar panel from `src/webview/sidebar/scripts/` into a self-contained component at `src/webview/components/Scripts/{ScriptsPanel.ts,ScriptsPanel.css,scriptListRender.ts,resultDisplay.ts}`. Pure behavior-preserving refactor; no functional or visual change.

## Requirements

- Component owns the full `#s-scripts` shell: toolbar (count badge + refresh), script cards (name/ext/capability badges/status dot/run-cancel button state machine), embedded result areas (output streaming with batching, collapse/expand, error-type headers, writes-pending notice), and all UI state (`currentScripts`, `trusted`, `scriptStatus`, `runningPath`, `pendingTimer`, output batching state).
- Colocated styles: all `.script-*` rules (42) move from `src/webview/styles/sidebar.css` to `ScriptsPanel.css`, imported by the component.
- Component never imports `S`, `state.ts`, `postProviderMessage`, `memory/memoryData`, or `rerender`. Cross-boundary effects exit via callbacks: list request, run/cancel script, copy/selection snapshot.
- Host (`hexViewer.ts`) owns `S.*`, `currentSelectionRange`, `S.documentGeneration`, and `postProviderMessage` for `requestScriptList`/`runScript`/`cancelScript`; host message handlers fan into component setters.
- Host wiring reuses the established panel-shell contract (`SidebarPanel` descriptor `{ id, label, mount }`); lazy activation (was `activateScripts`) maps to `setTabActive`.
- The old cross-module callback seam (`setRunStartCallback` from resultDisplay→scriptList) collapses inside the component (single class instance owns both).

## Acceptance Criteria

- [ ] `src/webview/components/Scripts/ScriptsPanel.ts` + `ScriptsPanel.css` exist; component class exposes `mount`, `render`, `setScripts`, `showResult`, `appendOutput`, `setTabActive` per design.
- [ ] `sidebar/scripts/` (index.ts, scriptList.ts, resultDisplay.ts) deleted after host rewire; script rules removed from `styles/sidebar.css`.
- [ ] No functional or visual change: script markup/ids/classes byte-identical; existing protocol-model tests (`webview-message-model.test.ts` script rows) pass unchanged.
- [ ] New `src/test/webview/components/scripts.test.ts` covers: mount/render (toolbar, empty state), `setScripts` (cards: name/ext/caps/status dots, trusted vs untrusted disabled buttons, `.ts` disabled), run/cancel button state machine (play→spinner→stop→play), run/cancel → callbacks, `showResult` (success/error/timeout/compile/cancel headers, results table, log, writes notice, auto-expand), `appendOutput` (realtime + batch flush), `setTabActive` lazy-init gate.
- [ ] Host gates: no `renderScripts|activateScripts|updateScriptList|updateScriptResult|updateScriptOutput` in `hexViewer.ts`; `handleActivateScriptsTabMessage` routes to component.
- [ ] `npm run lint`, `npm run check-types`, `npm run compile-tests`, webview mocha suite, `npm test` all green. Fallow 0 findings.

## Notes

- Mirror the archived Integrity task (`archive/2026-08/08-04-webview-integrity-panel-component/`) and Struct task — same seam, same artifact set, same review gates.
- `scripting.md` spec is the behavior authority (UI Component States, button state machine, output streaming, error-type headers, Windows-backslash gotcha).
- This is the last child of the `08-03-webview-component-refactor` parent; after merge the parent can be archived.
