# Component Spec — Scripts Panel

## Scope / Trigger

Owns `src/webview/components/sidebar/scriptsPanel/scriptsPanel.ts` + `scriptsPanel.css`: the sidebar Scripts panel — toolbar (title/count/refresh), script cards (name/ext/capability badges/status dot/run-cancel button state machine), and embedded result areas (output streaming with realtime-first-100 + debounced batching, collapse/expand, error-type headers, writes-pending notice). The component owns all panel markup and UI state (`currentScripts`, `trusted`, `scriptStatus`, `runningPath`, `pendingTimer`, output batching state, `initialized`). It never reads/writes the `S` global and never posts provider messages: the list/run/cancel requests exit via callbacks, and selection/generation snapshots go through injected accessors.

Host (`hexViewer.ts`) owns: `S` state, `S.documentGeneration`, `currentSelectionRange()`, and `postProviderMessage` for `requestScriptList`/`runScript`/`cancelScript`; host message handlers fan into component setters.

## Layout

```text
src/webview/components/sidebar/scriptsPanel/
    scriptsPanel.ts       interaction controller: mount/render/setScripts/showResult/appendOutput/setTabActive
    scriptsPanel.css      all panel rules (colocated; historically moved from styles/sidebar.css)
src/webview/hexViewer.ts  host wiring (panel descriptor, callbacks, message fan-out)
src/test/webview/components/sidebar/scriptsPanel/scriptsPanel.test.ts   (mocha + jsdom)
```

Panel shell (`sidebar/sidebar.ts`) and shared `.sb-section`/`.sb-body`/`.sb-badge`/`.sb-empty` stay in `sidebar/sidebar.ts`/`sidebar/sidebar.css`. `core/scripting/` is unchanged (pure, shared).

## Contract

```typescript
interface ScriptInfo {
    name: string;
    filePath: string;
    capabilities: string[];
}

interface ScriptsCallbacks {
    onRequestList?: () => void;                                   // host posts { type: 'requestScriptList' }
    onRunScript?: (scriptPath: string, generation: number, selectionRange?: { start: number; end: number }) => void;  // host posts runScript with S.documentGeneration + currentSelectionRange()
    onCancelScript?: (scriptPath: string) => void;                // host posts cancelScript
    getSelection?: () => { start: number; end: number } | null;   // was currentSelectionRange
    getGeneration?: () => number;                                 // was S.documentGeneration
}

class ScriptsPanel {
    constructor(cb?: ScriptsCallbacks);
    mount(root: HTMLElement): void;                  // creates #s-scripts container; idempotent
    render(): void;                                  // was renderScripts; re-renders shell
    setScripts(scripts: ScriptInfo[], trusted: boolean): void;    // was updateScriptList
    showResult(scriptPath: string, results: Array<{ label: string; value: string }> | null | undefined, log: string[] | null | undefined, error: string, errorType: string | undefined, pendingWriteCount: number, writes?: Array<[number, number]>): void;  // was updateScriptResult → showResult
    appendOutput(scriptPath: string, text: string): void;         // was updateScriptOutput → appendOutput (target resolved from running button)
    setTabActive(active: boolean): void;             // was activateScripts lazy-init gate
}
```

## Rules

- Component holds only UI/transient state (`currentScripts`, `trusted`, `scriptStatus` Map, `runningPath`, `pendingTimer`, output batch state, `initialized`). Persistent/domain state lives in the host.
- Reads no `S`, writes no `S`; data pushed via setters; actions report via callbacks. `getSelection`/`getGeneration` are injected pull accessors (host passes `currentSelectionRange()`, `S.documentGeneration`) so selection/generation stay host-owned — the component must NOT import `memory/selection` or `state.ts`.
- Run/cancel/list requests report `onRunScript`/`onCancelScript`/`onRequestList`; the component never calls `postProviderMessage`.
- `setTabActive(true)` replaces the old `activateScripts()` lazy-init gate: first activation fires `onRequestList` (once); the `initialized` flag is never reset (matches pre-refactor).
- Markup is byte-identical to pre-refactor (same ids/classes: `#s-scripts`, `scripts-count`, `scripts-refresh`, `.script-toolbar`, `.script-card`, `.script-run-btn`, `.script-result-area`, `.script-output-block`/`-hdr`/`-log`, `.script-ext`, `.script-dot`). Capability badges (`.script-cap`) were removed with the run-time confirm gate; run history adds `.script-run-row`/`.script-run-hdr` and `.script-clear`. All CSS moved verbatim from `styles/sidebar.css`. Untrusted text escaped with `esc()`; CSS-attribute paths escaped with `cssEscape` (Windows backslashes — scripting.md §9.1).
- The old cross-module `setRunStartCallback` seam (resultDisplay→scriptList) collapsed: both sides are one class, so the output-batch reset is an internal call from `runScript`.
- Pure helpers (`cssEscape`, `extLabel`, `btnTitle`/`btnClass`/`scriptBtnAttrs`, `writesBlockHtml`) stay module-level and DOM-free.

## Behaviour

- Default: empty script list renders "No scripts found in .hexscope/scripts/"; no section-header count badge.
- Card: status dot (gray idle / green ok / red err), name (ellipsis + path tooltip), ext badge, fixed-width run/cancel button. No capability badges on cards — capabilities surface at the run-time confirm gate (see below).
- Button state machine: ▶ play → ⟳ spinner (200 ms pending) → ⏹ stop (click to cancel) → ▶ play on any terminal state. Clicking the running button cancels during pending; while one script runs, every other card's run button carries the real `disabled` attribute (out of tab order; tooltip "A script is already running"; native disabled swallows clicks — no click-wired blocked-run notice, no `aria-disabled`). `.ts` cards get `disabled-ts` (esbuild tooltip); untrusted workspace cards get `disabled-trust` ("Workspace not trusted") and neither is click-wired.
- Run history (per script, session-only): the latest result block stays expanded on top; each completed run collapses into a one-line row `run #N · HH:MM ✓/✕` (`.script-run-row`, `.script-run-hdr`), newest first, capped at `HISTORY_CAP` (5) per card. A new run snapshots the prior result block into history before streaming starts (streamed output never pollutes stored runs). A `✕` clear button on the latest block header empties the card's results and resets its status dot. Re-render order is latest-top.
- Run payload: `onRunScript(path, getGeneration(), getSelection() ?? undefined)` — omitted `selectionRange` when no selection (same shape as pre-refactor `{ type: 'runScript', scriptPath, generation, selectionRange }`).
- Output streaming: first 100 lines appended realtime to the running card's log; later lines buffered and flushed via `setTimeout(0)` debounce (BATCH_THRESHOLD=100).
- `showResult`: clears running state, flushes pending output, sets status dot, snapshots any prior result block into run history, renders latest embedded result block (auto-expanded) + collapsed history rows, wires collapse toggle + clear button. Error-type headers: success "Result", compile "Compile Error" (⚠️ yellow), runtime "Script Error" (🔴), timeout "Timeout" (⏱️ orange), cancel "Cancelled" (dimmed, partial log preserved). Writes: when the payload carries `pendingWrites` (address/value pairs) the writes row is actionable — `N byte(s) written → [Apply & Save] [Discard]`; Apply fires `onApplyScriptWrites(path, writes)` (host stages mapped bytes into `S.edits` + saves), Discard fires `onDiscardScriptWrites(path)` and removes the row. Legacy payloads (count only) keep the plain "not yet saved" notice. `storedWrites` is per-path, cleared on new run / clear / discard.
- Capability gate: the first interactive run of a capability-bearing script (`capabilities.length > 0`) shows an inline confirm panel (`.script-caps-confirm`) listing the script name + required capabilities with Run/Cancel buttons. Accept persists per script in-session (`confirmedCaps` Set — survives re-render, resets on panel remount); decline removes the panel with no run and no partial run state. Capability-less scripts and already-confirmed scripts run immediately. Host-initiated runs (no click) bypass the gate.
- `appendOutput` before any run is a silent no-op (no running button).
- Refresh button and `setTabActive(true)` both fire `onRequestList` (host re-posts `requestScriptList`).

## Validation & Error Matrix

| Condition | Behaviour |
|---|---|
| No scripts | "No scripts found in .hexscope/scripts/" empty state |
| Untrusted workspace | Run disabled (`disabled-trust`) + "Workspace not trusted" tooltip; no click wiring |
| `.ts` script (trusted) | Run disabled (`disabled-ts`) + esbuild tooltip |
| Click run | `onRunScript` with generation + selection (or no `selectionRange` when no selection) |
| Click running button | Cancel: `onCancelScript`, button back to play |
| Second script clicked while running | Run button truly `disabled` (tab-skipped, tooltip) — native disabled swallows click; no run, no cancel |
| First click on capability-bearing script | Inline confirm panel listing capabilities; accept runs + persists per script; decline → no run, no partial state |
| Streamed text / results / log / error | Escaped with `esc()` |
| Windows path in card | `cssEscape` (backslash escaping) for `data-path` attribute selectors |
| `appendOutput` with no running card | Silent no-op |
| `showResult` for unknown path | Status/run state updated; no result block (no crash) |
| Re-run | Prior result block collapsed into one-line history row (capped at 5); latest stays expanded on top |
| Writes pending | Actionable row "N byte(s) written → [Apply & Save] [Discard]" (payload carries `pendingWrites`); Apply → `onApplyScriptWrites`, Discard → `onDiscardScriptWrites` + row removed. Legacy count-only payload → plain "not yet saved" notice |
| Unmounted render / setScripts | No-op (render guards `_panel`) |
| `setTabActive` before first activation | No list request until first `true`; request fires exactly once |

## Tests Required

`src/test/webview/components/sidebar/scriptsPanel/scriptsPanel.test.ts`: mount/render (toolbar + empty state + idempotent), refresh → `onRequestList`, `setScripts` (cards: name/ext/status dots (no cap badges), no count badge, trusted vs untrusted disabled, `.ts` `disabled-ts`), run/cancel state machine (payload shape with generation/selection, play→spinner→stop→play, cancel during pending, other run button truly disabled), run history (latest-top collapse, expand, no stream pollution, clear, 5-row cap), capability gate (confirm listing caps, accept persists, decline no-run, remount resets, cap-less no confirm), `showResult` (success/compile/runtime/timeout/cancel headers, results rows, log, writes notice, auto-expand + collapse toggle, re-run collapses, escaping, unknown-path no-op), `appendOutput` (realtime + first-100-then-batched flush, escaping, no-run no-op), `setTabActive` lazy-init gate. Existing `webviewMessageModel.test.ts` script protocol rows + `webview.test.ts` pass unchanged (parity gate).

## Anti-patterns

- `ScriptsPanel.ts` importing `S`, `state.ts`, `postProviderMessage`, `memory/selection`, `render/registry`, or `memory/memoryData`.
- Component calling `currentSelectionRange()` / reading `S.documentGeneration` directly (must use `getSelection`/`getGeneration`).
- Component posting `requestScriptList`/`runScript`/`cancelScript` (must use `onRequestList`/`onRunScript`/`onCancelScript`).
- Host calling stale `renderScripts`/`activateScripts`/`updateScriptList`/`updateScriptResult`/`updateScriptOutput` module functions.
- Weakening `webviewMessageModel.test.ts` script protocol assertions during the extraction (parity gate).
- Adding `.script-*` rules to `styles/` (they live in `scriptsPanel.css`).
