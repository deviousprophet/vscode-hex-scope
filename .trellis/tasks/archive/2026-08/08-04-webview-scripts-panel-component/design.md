# Design — Scripts self-contained component

Mirror of the archived Integrity panel extraction at the same sidebar-panel seam (see `archive/2026-08/08-04-webview-integrity-panel-component/design.md`). Behavior-preserving; the parent `08-03` refactor contract is locked — no re-litigation.

## Component contract

```typescript
// src/webview/components/Scripts/ScriptsPanel.ts
interface ScriptInfo {
    name: string;
    filePath: string;
    capabilities: string[];
}

interface ScriptsCallbacks {
    /** Host posts requestScriptList (refresh rescan). */
    onRequestList?: () => void;
    /** Run: host posts runScript with S.documentGeneration + current selection. */
    onRunScript?: (scriptPath: string, generation: number, selectionRange?: { start: number; end: number }) => void;
    /** Cancel: host posts cancelScript. */
    onCancelScript?: (scriptPath: string) => void;
    /** Selection snapshot for the run payload (was currentSelectionRange). */
    getSelection?: () => { start: number; end: number } | null;
    /** Document generation for the run payload (was S.documentGeneration). */
    getGeneration?: () => number;
}

export class ScriptsPanel {
    constructor(cb?: ScriptsCallbacks);
    mount(root: HTMLElement): void;                 // idempotent; renders shell + wires toolbar
    render(): void;                                 // was renderScripts; re-renders shell
    setScripts(scripts: ScriptInfo[], trusted: boolean): void;   // was updateScriptList (list rebuild + count + wiring)
    showResult(scriptPath: string, results: Array<{ label: string; value: string }> | null | undefined, log: string[] | null | undefined, error: string, errorType: string | undefined, pendingWriteCount: number): void;  // was updateScriptResult → showResult
    appendOutput(scriptPath: string, text: string): void;        // was updateScriptOutput → appendOutput
    setTabActive(active: boolean): void;            // was activateScripts lazy-init gate
}
```

The component owns the full `#s-scripts` shell and all module-level mutable state from the three old files as instance fields: `currentScripts`, `trusted`, `scriptStatus` (Map), `runningPath`, `pendingTimer`, `runStartCallback` (now internal — the old cross-module seam from resultDisplay→scriptList collapses), `outputCount`, `outputBuffer`, `flushTimer`, `batchPath`.

## Ownership split

Component owns (all moved verbatim from `sidebar/scripts/`):
- **`scriptList.ts`**: script card markup (name/ext badge/cap badges/status dot/run button), list rebuild + wiring, run/cancel dispatch, the 200 ms pending-spinner state machine (`runIconHtml`, `renderRunStates`, `updateBtnState`), status dots, count badge, `requestScriptList` trigger.
- **`resultDisplay.ts`**: output streaming (`appendOutput` realtime + `BATCH_THRESHOLD=100` debounced `flushBuffer`), result block markup (`scriptResultHtml`, error-type headers, results table, log, writes notice), collapse wiring, `showResult` auto-expand.
- **`index.ts`**: shell render (toolbar + count + refresh), lazy-init gate (`initialized`), the three message setters.

Host (`hexViewer.ts`) owns:
- `postProviderMessage` for `requestScriptList` / `runScript` / `cancelScript` (was direct calls in scriptList.ts).
- `S.documentGeneration` + `currentSelectionRange` reads (injected via `getGeneration` / `getSelection`).
- Message handlers fan-out: `handleScriptInfoMessage` → `scriptsPanel.setScripts`; `handleScriptResultMessage` → `scriptsPanel.showResult`; `handleScriptOutputMessage` → `scriptsPanel.appendOutput`; `handleActivateScriptsTabMessage` → `scriptsPanel.setTabActive(true)`.
- `SIDEBAR_TAB_EFFECTS.scripts` = `scriptsPanel.setTabActive(true)` (was `activateScripts`).

Cross-boundary exits (was `postProviderMessage` / `S.documentGeneration` / `currentSelectionRange`):
- `onRequestList()` — host `postProviderMessage({ type: 'requestScriptList' })`.
- `onRunScript(path, generation, selectionRange)` — host `postProviderMessage({ type: 'runScript', scriptPath: path, generation, selectionRange })`.
- `onCancelScript(path)` — host `postProviderMessage({ type: 'cancelScript', scriptPath: path })`.
- `getSelection()` — host returns `currentSelectionRange()`.
- `getGeneration()` — host returns `S.documentGeneration`.

Component never imports `S`, `state.ts`, `postProviderMessage`, `memory/selection`, or `render/registry`. Util imports (`esc`) stay.

## Host wiring (hexViewer.ts)

1. `const scriptsPanel = new ScriptsPanel({ onRequestList: () => postProviderMessage({ type: 'requestScriptList' }), onRunScript: (scriptPath, generation, selectionRange) => postProviderMessage({ type: 'runScript', scriptPath, generation, selectionRange }), onCancelScript: scriptPath => postProviderMessage({ type: 'cancelScript', scriptPath }), getSelection: () => currentSelectionRange(), getGeneration: () => S.documentGeneration });`
2. Panel descriptor: `{ id: 'scripts', label: 'Scripts', mount: root => scriptsPanel.mount(root) }`.
3. Replace call sites:
   - `renderScripts()` → `scriptsPanel.render()` (descriptor mount; root.innerHTML no longer host-owned).
   - `activateScripts` in `SIDEBAR_TAB_EFFECTS` (and `handleActivateScriptsTabMessage`) → `scriptsPanel.setTabActive(true)`.
   - `updateScriptList(msg)` → `scriptsPanel.setScripts(msg.scripts, msg.trusted)`.
   - `updateScriptResult(...)` → `scriptsPanel.showResult(...)`.
   - `updateScriptOutput(path, text)` → `scriptsPanel.appendOutput(path, text)`.
4. Delete `sidebar/scripts/index.ts`, `scriptList.ts`, `resultDisplay.ts`; update `hexViewer.ts` imports + any test imports.

## CSS

- `components/Scripts/ScriptsPanel.css` = all 42 `.script-*` rules moved verbatim from `styles/sidebar.css` (plus the `script-output-hdr::before` triangle rules and any `#scripts-*` id rules).
- `import './ScriptsPanel.css'` in `ScriptsPanel.ts`; bundled via esbuild.
- The `sb-section`/`sb-hdr` shared section pattern stays in `Sidebar.css` (component uses the `script-toolbar` header, not the collapsible `.sb-section` — per scripting.md the scripts tab has one non-collapsible section).

## Tests

`src/test/webview/components/scripts.test.ts` (mocha + jsdom + css-import-hook, mirror `integrity.test.ts`):
- render: mount(root) renders toolbar (title/count/refresh) + empty state ("No scripts found in .hexscope/scripts/").
- setScripts: cards render name/ext/capability badges/status dots; trusted=false disables Run with "Workspace not trusted" tooltip; `.ts`+no-esbuild class `disabled-ts` (host passes the flag via capability/config — verify how `trusted`+esbuild availability reaches the component; the old code only knew `trusted` and `.ts` extension, disabled-ts was purely extension-based).
- run/cancel state machine: click run → `onRunScript` (with generation + selection from `getGeneration`/`getSelection`); pending 200ms spinner; running → stop icon; click → `onCancelScript`; terminal → play.
- showResult: success/runtime/timeout/compile/cancel headers, results rows, log lines, writes notice, auto-expand; re-run replaces prior result.
- appendOutput: realtime first 100, then batched flush; escape user text.
- setTabActive: lazy-init — notify is a no-op until first activation.
- Parity: existing `webview-message-model.test.ts` script protocol rows + `webview.test.ts` (if any scripts suite) pass unchanged.

## Rollback

One commit; `git revert` restores `sidebar/scripts/` inline rendering + host calls + `styles/sidebar.css` script rules.
