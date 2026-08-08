# Implement — Scripts self-contained component

Task: `.trellis/tasks/08-04-webview-scripts-panel-component`. Behavior-preserving extraction at the sidebar panel seam (parent design locked; mirror the archived Integrity + Struct tasks).

## Preconditions
- Branch `feat/webview-scripts-component` (checked out from updated `main`). lint/check-types/webview tests green before.
- Read specs: `component-template.md`, `component-sidebar.md`, `component-sidebar-inspector.md`, `component-sidebar-integrity-panel.md` (sibling seams), `css-guidelines.md`, `state-management.md`, `scripting.md` (§7 UI Component States, §9.1 Windows backslash gotcha, §10 patterns).

## Checklist

1. **Create `src/webview/components/Scripts/ScriptsPanel.ts`** — component class per `design.md`. Port code verbatim from the three `sidebar/scripts/` files (~390 LOC total) into one class: shell render + lazy-init gate (was index.ts), script list + card markup + run/cancel state machine + status dots + count (was scriptList.ts), result display + output streaming/batching (was resultDisplay.ts). All module-level state → instance fields. Remove `postProviderMessage`, `S`, `currentSelectionRange` imports: exits via `onRequestList`/`onRunScript`/`onCancelScript`/`getSelection`/`getGeneration`. Keep `esc` from `../../utils`. Keep `scriptListHtml`/`wireScriptList` (and pure helpers like `extLabel`, `cssEscape`, `statusDot`, `runIconHtml`, `scriptCardHtml`, `scriptResultHtml`, `resultsBlockHtml`, `headerFor`, `writesBlockHtml`, `logLinesHtml`) as private methods or module-level pure functions. The old `setRunStartCallback` seam (resultDisplay→scriptList) collapses: both sides are one class now, so the callback becomes a direct internal call from `showResult`/`appendOutput` reset path.
2. **Create `src/webview/components/Scripts/ScriptsPanel.css`** — move all 42 `.script-*` rules verbatim from `styles/sidebar.css`; `import './ScriptsPanel.css'`. Confirm `styles/sidebar.css` keeps only non-script shared panel rules.
3. **Rewire host `hexViewer.ts`**
   - `const scriptsPanel = new ScriptsPanel({ onRequestList, onRunScript, onCancelScript, getSelection: () => currentSelectionRange(), getGeneration: () => S.documentGeneration });` per design.
   - Panel descriptor `{ id: 'scripts', label: 'Scripts', mount: root => scriptsPanel.mount(root) }`.
   - Replace `renderScripts()` → `scriptsPanel.render()`; `activateScripts` (SIDEBAR_TAB_EFFECTS + handleActivateScriptsTabMessage) → `scriptsPanel.setTabActive(true)`; `updateScriptList(msg)` → `setScripts(msg.scripts, msg.trusted)`; `updateScriptResult(...)` → `showResult(...)`; `updateScriptOutput(path, text)` → `appendOutput(path, text)`.
4. **Delete moved code**: `sidebar/scripts/index.ts`, `scriptList.ts`, `resultDisplay.ts` (after confirming no remaining imports, incl. tests).
5. **Tests** `src/test/webview/components/scripts.test.ts` (see design.md). Update any test imports of the deleted module paths.
6. **Add component spec** `.trellis/spec/frontend/components/component-sidebar-scripts-panel.md` (copy `component-template.md` / sibling spec style) + index row in the components table; update `css-guidelines.md` file table + `directory-structure.md` + `hook-guidelines.md` if they reference `sidebar/scripts`.
7. **Validate**
   - `npm run lint`, `npm run check-types`, `npm run compile-tests`.
   - `npx mocha --ui tdd "out/test/webview/**/*.test.js"` (scripts.test.ts + webview.test.ts + webview-message-model.test.ts).
   - `npm test` (full).
   - Fallow: `total_issues 0`, `findings 0`, `clone_groups 0`.

## Review gates
- `Select-String "renderScripts|activateScripts|updateScriptList|updateScriptResult|updateScriptOutput" src/webview/hexViewer.ts` — empty (all on `scriptsPanel.`).
- Component file contains no `S.`, `postProviderMessage`, `rerender`, `currentSelectionRange`, `getByte`, or `state`/`memory` import.
- `sidebar/scripts/` deleted; `styles/sidebar.css` has zero `.script-` rules.
- Markup/behavior parity: script protocol rows in `webview-message-model.test.ts` + any webview.test.ts scripts assertions pass unchanged.

## Rollback
- One commit; `git revert` restores inline rendering + host calls + `styles/sidebar.css` script rules.
