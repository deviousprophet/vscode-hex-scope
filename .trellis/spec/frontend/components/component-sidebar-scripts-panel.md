# Component Spec — Scripts Panel

## Scope / Trigger

Owns `src/webview/components/sidebar/scriptsPanel/scriptsPanel.ts` + `scriptsPanel.css` + `permissionPrompt.ts`: the sidebar Scripts panel — toolbar (title/count/refresh), script cards (name/ext/role + capability badges/status dot/run-cancel button state machine), the inline per-command permission prompt, the revocable workspace Permissions list, and embedded result areas (output streaming with realtime-first-100 + debounced batching, collapse/expand, error-type headers, writes notice). The component owns all panel markup and UI state (`currentScripts`, `trusted`, `scriptStatus`, `permissionGrants`, `runningPath`, `pendingTimer`, output batching state, `initialized`). It never reads/writes the `S` global and never posts provider messages: the list/run/cancel/decision/revoke requests exit via callbacks, and selection/generation snapshots go through injected accessors.

Host (`hexViewer.ts`) owns: `S` state, `S.documentGeneration`, `currentSelectionRange()`, and `postProviderMessage` for `requestScriptList`/`runScript`/`cancelScript`/`scriptPermissionResponse`/`revokeScriptPermission`; host message handlers fan into component setters. Permission *state* (grants) lives in the extension host (`src/scriptPermissions.ts`); the panel only renders the list it is given.

## Layout

```text
src/webview/components/sidebar/scriptsPanel/
    scriptsPanel.ts       interaction controller: mount/render/setScripts/showResult/appendOutput/setTabActive
    permissionPrompt.ts   inline approval surface (focus, scope menu, deny paths)
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
    roles?: string[];
    fingerprint: string;
}

type ScriptCapabilityGrant = 'write' | 'exec' | 'fetch' | '*';
type ScriptPermissionScope = 'once' | 'script' | 'session' | 'workspace';

interface ScriptWorkspaceGrant { scriptPath: string; capability: ScriptCapabilityGrant }

interface ScriptsCallbacks {
    onRequestList?: () => void;                                   // host posts { type: 'requestScriptList' }
    onRunScript?: (scriptPath: string, generation: number, selectionRange?: { start: number; end: number }) => void;  // host posts runScript
    onCancelScript?: (scriptPath: string) => void;                // host posts cancelScript
    onOpenScript?: (scriptPath: string) => void;                  // host posts openScript
    onScriptPermissionDecision?: (requestId: number, decision: 'allow' | 'deny', scope: ScriptPermissionScope, capability: ScriptCapabilityGrant) => void;  // host posts scriptPermissionResponse
    onRevokeScriptPermission?: (scriptPath: string, capability: ScriptCapabilityGrant) => void;  // host posts revokeScriptPermission
    onAddExampleScripts?: () => void;                             // host posts { type: 'addExampleScripts' }
    getSelection?: () => { start: number; end: number } | null;   // was currentSelectionRange
    getGeneration?: () => number;                                 // was S.documentGeneration
}

class ScriptsPanel {
    constructor(cb?: ScriptsCallbacks);
    mount(root: HTMLElement): void;
    render(): void;
    setScripts(scripts: ScriptInfo[], trusted: boolean): void;
    showPermissionRequest(request: ScriptPermissionRequest): void;
    setPermissionGrants(grants: ScriptWorkspaceGrant[]): void;
    showResult(scriptPath, results, log, error, errorType, pendingWriteCount, discardedWriteCount?: number): void;
    appendOutput(scriptPath: string, text: string): void;
    setTabActive(active: boolean): void;
}

class PermissionPrompt {                    // permissionPrompt.ts
    constructor(cb: { onDecision(requestId, decision, scope, capability): void }, timeoutMs?: number);
    show(request: ScriptPermissionRequest): void;   // replaces + denies a stale prompt
    close(): void;                                  // denies a still-open request
    dispose(): void;                                // teardown: drop prompt + timer
    isOpenFor(scriptPath: string): boolean;
}
```

The prompt's auto-close timer mirrors `SCRIPT_PERMISSION_TIMEOUT_MS` from `webviewProtocol.ts`
(the host denies on its own timer; the mirror only removes a dead prompt, never sends a deny).

## Rules

- Component holds only UI/transient state (`currentScripts`, `trusted`, `scriptStatus` Map, `permissionGrants`, `runningPath`, `pendingTimer`, output batch state, `initialized`). Persistent/domain state lives in the host.
- Reads no `S`, writes no `S`; data pushed via setters; actions report via callbacks. `getSelection`/`getGeneration` are injected pull accessors (host passes `currentSelectionRange()`, `S.documentGeneration`) so selection/generation stay host-owned — the component must NOT import `memory/selection` or `state.ts`.
- Run/cancel/open/list/decision/revoke requests report via callbacks; the component never calls `postProviderMessage`.
- `setTabActive(true)` is the lazy-init gate: first activation fires `onRequestList` (once); `initialized` is never reset.
- Markup ids/classes: `#s-scripts`, `scripts-refresh`, `scripts-add-examples`, `.script-toolbar`, `.script-card`, `.script-open-btn`, `.script-run-btn`, `.script-result-area`, `.script-output-block`/`-hdr`/`-log`, `.script-ext`, `.sb-status-dot`, `.script-role`, `.script-cap`, `.script-empty`/`.script-add-examples`. Permission surfaces: `.script-perm` (prompt, `data-perm-allow`/`data-perm-menu`/`data-perm-deny`/`.script-perm-option[data-scope][data-grant]`), `.script-perms-section`/`.script-perm-row`/`[data-revoke]`. Run history adds `.script-run-row`/`.script-run-hdr` and `.script-clear`. All CSS moved verbatim from `styles/sidebar.css`; new permission and empty-state rules live in `scriptsPanel.css`.
- Untrusted text escaped with `esc()`; CSS-attribute paths escaped with `cssEscape` (Windows backslashes — scripting.md §9.1). The prompt component matches cards by iterating `.script-card` and comparing `dataset.path`, avoiding attribute selectors entirely.
- Pure helpers (`cssEscape`, `extLabel`, `fileName`, `grantLabel`, `btnTitle`/`btnClass`/`scriptBtnAttrs`, `writesBlockHtml`) stay module-level and DOM-free; `capabilityPhrase`/`scopeOptions` live in `permissionPrompt.ts`.

## Behaviour

- Default: empty script list renders "No scripts found in .hexscope/scripts/" plus a native **Add example scripts** button (`.script-empty [data-add-examples]`, keyboard reachable); no section-header count badge.
- Catalog install action: the header **+** (`#scripts-add-examples`) and the empty-state button both report `onAddExampleScripts`; the component never runs the command itself. The host copies the bundled catalog (`hexScope.addExampleScripts`) and rescans, so installed cards appear without a manual refresh.
- Card: status dot (gray idle / green ok / red err), name (ellipsis + path tooltip), role badges, capability badges (`.script-cap`, title "Requires approval: <cap>"), ext badge, fixed-width open button, fixed-width run/cancel button. The open button reports `onOpenScript` and stays enabled regardless of run state.
- Button state machine: ▶ play → ⟳ spinner (200 ms pending) → ⏹ stop (click to cancel) → ▶ play on any terminal state. Clicking the running button cancels during pending; while one script runs, every other card's run button carries the real `disabled` attribute (out of tab order; tooltip "A script is already running"; native disabled swallows clicks). `.ts` cards get `disabled-ts` (esbuild tooltip); untrusted workspace cards get `disabled-trust` ("Workspace not trusted") and neither is click-wired.
- **No pre-run capability gate.** Clicking Run always starts the run (`onRunScript`); the first dangerous command inside the run opens the inline prompt.
- Permission prompt: one at a time, inserted inside the card above `.script-result-area`. Title names the script + capability phrase, detail shows the host-provided string (address/byte count, command, or host). Primary "Allow once"; "More options" expands a menu with the scopes the request offers (`script`/`session`/`workspace`, each for the requested capability and for all capabilities; `workspace` is never offered for `exec`). Deny is a separate button. Escape denies. Focus starts on "Allow once", moves to the first option when the menu opens, and returns to the card's Run button on close. `showResult` and cancel close an open prompt (denying it). A new request replaces the prompt and denies the stale `requestId`; a missing card denies immediately.
- Workspace Permissions list: `setPermissionGrants()` renders `.script-perms-section` above `.script-list` (basename + capability label, `Revoke` per row). `Revoke` reports `onRevokeScriptPermission`. An empty list removes the section. The list re-renders in place, so existing result areas are untouched.
- Run history (per script, session-only): the latest result block stays expanded on top; each completed run collapses into a one-line row `run #N · HH:MM ✓/✕` (`.script-run-row`, `.script-run-hdr`), newest first, capped at `HISTORY_CAP` (5) per card. A new run snapshots the prior result block into history before streaming starts. A `✕` clear button on the latest block header empties the card's results and resets its status dot.
- Run payload: `onRunScript(path, getGeneration(), getSelection() ?? undefined)`.
- Output streaming: first 100 lines appended realtime to the running card's log; later lines buffered and flushed via `setTimeout(0)` debounce (BATCH_THRESHOLD=100).
- `showResult`: clears running state, flushes pending output, sets status dot, snapshots any prior result block into run history, renders the latest embedded result block (auto-expanded) + collapsed history rows, wires collapse toggle + clear. Error-type headers: success "Result", compile "Compile Error" (⚠️ yellow), runtime "Script Error" (🔴), timeout "Timeout" (⏱️ orange), cancel "Cancelled" (dimmed, partial log preserved), contract "Contract Error". Writes notice: `pendingWriteCount` -> "N byte(s) written — saving"; `discardedWriteCount` -> "N byte(s) written, discarded - nothing was saved". No action buttons; approved writes auto-save host-side.
- `appendOutput` before any run is a silent no-op (no running button).
- Refresh button and `setTabActive(true)` both fire `onRequestList` (host re-posts `requestScriptList`).

## Validation & Error Matrix

| Condition | Behaviour |
|---|---|
| No scripts | "No scripts found in .hexscope/scripts/" empty state + **Add example scripts** button |
| Empty-state install click | `onAddExampleScripts` (no list request) |
| Header **+** click | `onAddExampleScripts` |
| Scripts present | Empty-state install action is removed with the empty state |
| Untrusted workspace | Run disabled (`disabled-trust`) + "Workspace not trusted" tooltip; no click wiring |
| `.ts` script (trusted) | Run disabled (`disabled-ts`) + esbuild tooltip |
| Click run | `onRunScript` immediately (no capability gate), with generation + selection |
| Click open | `onOpenScript` with the card path; no run, no result change; enabled for untrusted, `.ts`, and while another script runs |
| Click running button | Cancel: `onCancelScript`, button back to play, open prompt denied |
| Second script clicked while running | Run button truly `disabled` (tab-skipped, tooltip) |
| Host asks for approval | One `.script-perm` in that card; decision → `onScriptPermissionDecision` |
| Allow once | `{ decision: 'allow', scope: 'once', capability: <requested> }` |
| Broader option | `{ decision: 'allow', scope, capability: <requested or '*'> }` |
| Escape / Deny | `{ decision: 'deny', scope: 'once' }`; prompt removed; focus → Run |
| New request while one is open | Old id denied, one prompt remains |
| `showResult` / cancel with prompt open | Prompt denied + removed |
| No card for the requested path | Immediate deny decision |
| Streamed text / results / log / error | Escaped with `esc()` |
| Windows path in card | `cssEscape` for attribute selectors; prompt matches `dataset.path` directly |
| `appendOutput` with no running card | Silent no-op |
| `showResult` for unknown path | Status/run state updated; no result block (no crash) |
| Re-run | Prior result block collapsed into one-line history row (capped at 5); latest stays expanded on top |
| Clean run with writes | "N byte(s) written and saved", no buttons |
| Failed run with writes | "N byte(s) written, discarded — nothing was saved" |
| Permissions list | Rows with basename + capability; Revoke reports callback; empty list removes section |
| Unmounted render / setScripts | No-op (guards `sections?.body`) |
| `setTabActive` before first activation | No list request until first `true`; request fires exactly once |

## Tests Required

`src/test/webview/components/sidebar/scriptsPanel/scriptsPanel.test.ts`: mount/render (toolbar + empty state + install action + idempotent), refresh → `onRequestList`, empty-state/header install → `onAddExampleScripts`, `setScripts` (cards: name/ext/role/capability badges, status dots, no count badge, trusted vs untrusted disabled, `.ts` `disabled-ts`, open action reports the path and stays enabled), run/cancel state machine (payload shape with generation/selection, play→spinner→stop→play, cancel during pending, other run button truly disabled, no pre-run prompt), permission prompt (render inside the card, Allow once payload, scope menu options incl. no `workspace` for exec, `*` breadth, Escape/Deny, one-at-a-time replace, close on result/cancel, unknown path deny, focus return), Permissions list (rows, revoke callback, empty removal, result areas preserved), run history (latest-top collapse, expand, no stream pollution, clear, 5-row cap), `showResult` (headers, results rows, log, writes notices, auto-expand + collapse toggle, escaping, unknown-path no-op), `appendOutput` (realtime + first-100-then-batched flush, escaping, no-run no-op), `setTabActive` lazy-init gate. Existing `webviewMessageModel.test.ts` protocol rows + `webview.test.ts` pass unchanged (parity gate).

## Anti-patterns

- `ScriptsPanel.ts` importing `S`, `state.ts`, `postProviderMessage`, `memory/selection`, `render/registry`, or `memory/memoryData`.
- Component calling `currentSelectionRange()` / reading `S.documentGeneration` directly (must use `getSelection`/`getGeneration`).
- Component posting `requestScriptList`/`runScript`/`cancelScript`/`scriptPermissionResponse`/`revokeScriptPermission` (must use callbacks).
- Host calling stale `renderScripts`/`activateScripts`/`updateScriptList`/`updateScriptResult`/`updateScriptOutput` module functions.
- Re-introducing a pre-run capability gate or any second confirmation path (the per-command prompt is the only ask).
- Re-introducing Apply & Save / Discard controls (writes commit automatically on success).
- Storing grants in the panel (host owns them; the panel only renders `scriptPermissions`).
- Weakening `webviewMessageModel.test.ts` script protocol assertions during the extraction (parity gate).
- Adding `.script-*` rules to `styles/` (they live in `scriptsPanel.css`).
