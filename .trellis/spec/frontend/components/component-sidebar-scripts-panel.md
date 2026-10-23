# Component Spec — Scripts Panel

## Scope / Trigger

Owns `src/webview/components/sidebar/scriptsPanel/scriptsPanel.ts` + `scriptsPanel.css` + `permissionPrompt.ts`: the sidebar Scripts panel — toolbar (title/count/refresh), Actions/Providers groups (collapsible, counted, session-local collapse state), script cards (action/provider/both/unknown, name/ext/role chips + capability badges/status dot/run-cancel button state machine), the inline per-command permission prompt, the revocable Permissions list (script/session/workspace grants with scope chips, per-row revoke, and bulk revoke behind **Manage**), and embedded result areas (output streaming with realtime-first-100 + debounced batching, collapse/expand, error-type headers, writes notice). The component owns all panel markup and UI state (`currentScripts`, `trusted`, `scriptStatus`, `permissionGrants`, `permissionsExpanded`, `runningPath`, `pendingTimer`, `confirmTimers`, `collapsedGroups`, output batching state, `initialized`). It never reads/writes the `S` global and never posts provider messages: the list/run/cancel/decision/revoke requests exit via callbacks, and selection/generation snapshots go through injected accessors.

Host (`hexViewer.ts`) owns: `S` state, `S.documentGeneration`, `currentSelectionRange()`, and `postProviderMessage` for `requestScriptList`/`runScript`/`cancelScript`/`scriptPermissionResponse`/`revokeScriptPermission`/`revokeAllScriptPermissions`; host message handlers fan into component setters. Permission *state* (grants) lives in the extension host (`src/scriptPermissions.ts`, workspace-root-keyed registry); the panel only renders the host-sorted list it is given.

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
    /** Scan-time `run` export detection; absent in legacy payloads. */
    hasRun?: boolean;
    /** Explicit `@entry run` header override. */
    runExplicit?: boolean;
}

type ScriptCapabilityGrant = 'write' | 'exec' | 'fetch' | '*';
type ScriptPermissionScope = 'once' | 'script' | 'session' | 'workspace';
type ScriptGrantScope = 'script' | 'session' | 'workspace';

/** One stored grant as shown in the Permissions section (`*` path = session-wide). */
interface ScriptGrantView { scriptPath: string; capability: ScriptCapabilityGrant; scope: ScriptGrantScope }

interface ScriptsCallbacks {
    onRequestList?: () => void;                                   // host posts { type: 'requestScriptList' }
    onRunScript?: (scriptPath: string, generation: number, selectionRange?: { start: number; end: number }) => void;  // host posts runScript
    onCancelScript?: (scriptPath: string) => void;                // host posts cancelScript
    onOpenScript?: (scriptPath: string) => void;                  // host posts openScript
    onScriptPermissionDecision?: (requestId: number, decision: 'allow' | 'deny', scope: ScriptPermissionScope, capability: ScriptCapabilityGrant) => void;  // host posts scriptPermissionResponse
    onRevokeScriptPermission?: (scope: ScriptGrantScope, scriptPath: string, capability: ScriptCapabilityGrant) => void;  // host posts revokeScriptPermission
    onRevokeAllScriptPermissions?: (scope?: ScriptGrantScope, scriptPath?: string) => void;  // host posts revokeAllScriptPermissions
    onAddExampleScripts?: () => void;                             // host posts { type: 'addExampleScripts' }
    onCreateScript?: (template?: ScriptTemplateId) => void;       // host posts createScript (undefined = host picks the template)
    getSelection?: () => { start: number; end: number } | null;   // was currentSelectionRange
    getGeneration?: () => number;                                 // was S.documentGeneration
}

class ScriptsPanel {
    constructor(cb?: ScriptsCallbacks);
    mount(root: HTMLElement): void;
    render(): void;
    setScripts(scripts: ScriptInfo[], trusted: boolean): void;
    showPermissionRequest(request: ScriptPermissionRequest): void;
    setPermissionGrants(grants: ScriptGrantView[]): void;
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

- Component holds only UI/transient state (`currentScripts`, `trusted`, `scriptStatus` Map, `permissionGrants`, `permissionsExpanded`, `runningPath`, `pendingTimer`, `confirmTimers`, output batch state, `initialized`, `collapsedGroups`). Persistent/domain state lives in the host.
- Reads no `S`, writes no `S`; data pushed via setters; actions report via callbacks. `getSelection`/`getGeneration` are injected pull accessors (host passes `currentSelectionRange()`, `S.documentGeneration`) so selection/generation stay host-owned — the component must NOT import `memory/selection` or `state.ts`.
- Run/cancel/open/list/decision/revoke requests report via callbacks; the component never calls `postProviderMessage`.
- `setTabActive(true)` is the lazy-init gate: first activation fires `onRequestList` (once); `initialized` is never reset.
- New-script creation is presentation-only: the **＋ New** split button's primary action reports `onCreateScript(undefined)` (the host shows the template picker), each `.script-new-option` reports its template id (and closes the chooser), and the empty-state **Create script** reports `onCreateScript(undefined)`. The component never writes files and never builds template bodies (they live in `core/scripting/templates.ts`).
- Markup ids/classes: `#s-scripts`, `scripts-refresh`, `scripts-add-examples`, `scripts-new`/`scripts-new-menu` (New split button in `.script-new-bar`, `aria-expanded`; `.script-new-popup` lists `.script-new-option[data-template]`), `.script-toolbar`, `.script-group`/`.script-group-hdr`/`.script-group-label`/`.script-group-count`/`.script-group-body` (`data-group="actions"|"providers"`, `data-group-toggle`, `aria-expanded`), `.script-card` (`data-kind`), `.script-open-btn`, `.script-run-btn`, `.script-result-area`, `.script-output-block`/`-hdr`/`-log`, `.script-ext`, `.sb-status-dot`, `.script-role` (`data-role` raw, visible job label), `.script-cap`, `.script-warn`, `.script-inspect-hint`, `.script-empty`/`.script-add-examples`/`.script-create`/`[data-create-script]`. Permission surfaces: `.script-perm` (prompt, `data-perm-allow`/`data-perm-menu`/`data-perm-deny`/`.script-perm-option[data-scope][data-grant]`), `.script-perms-section` (`data-perms-manage`, `.expanded` reveals `.script-perms-bulk`)/`.script-perm-row` (`data-scope`)/`.script-perm-scope`/`[data-revoke]`/`[data-revoke-all]`/`[data-revoke-all-workspace]`/`[data-revoke-all-session]`/`.script-perms-hint`; armed bulk buttons carry `.confirm` + text `Confirm?`. Run history adds `.script-run-row`/`.script-run-hdr` and `.script-clear`. All CSS moved verbatim from `styles/sidebar.css`; new permission, grouping, empty-state, unknown-script, and New-split rules live in `scriptsPanel.css`.
- Untrusted text escaped with `esc()`; CSS-attribute paths escaped with `cssEscape` (Windows backslashes — scripting.md §9.1). The prompt component matches cards by iterating `.script-card` and comparing `dataset.path`, avoiding attribute selectors entirely.
- Pure helpers (`cssEscape`, `extLabel`, `fileName`, `grantLabel`, `scopeLabel`, `scopeTitle`, `grantFromRow`, `btnTitle`/`btnClass`/`scriptBtnAttrs`, `writesBlockHtml`, `roleLabel`, `hasRunEntry`, `scriptKind`, `roleBadgesHtml`, `unknownHintHtml`, `cardLeadHtml`) stay module-level and DOM-free; `capabilityPhrase`/`scopeOptions` live in `permissionPrompt.ts`.

## Behaviour

- Default: empty script list renders "No scripts found in .hexscope/scripts/" plus a native **Create script** button (`.script-empty [data-create-script]`) and **Add example scripts** button (`.script-empty [data-add-examples]`, keyboard reachable); no section-header count badge.
- New split button: `.script-new-bar` above `.script-list` holds **＋ New** (`#scripts-new`, reports `onCreateScript()`) and the caret (`#scripts-new-menu`, toggles `.script-new-popup` + `aria-expanded`, closes on an outside click). `.script-new-popup` lists the four templates from `core/scripting/templates.ts`; choosing one reports its id and closes the chooser.
- Catalog install action: the header **+** (`#scripts-add-examples`) and the empty-state button both report `onAddExampleScripts`; the component never runs the command itself. The host copies the bundled catalog (`hexScope.addExampleScripts`) and rescans, so installed cards appear without a manual refresh.
- Card: status dot (gray idle / green ok / red err), name (ellipsis + path tooltip), role chips, capability badges (`.script-cap`, title "Requires approval: <cap>"), ext badge, fixed-width open button, fixed-width run/cancel button. The open button reports `onOpenScript` and stays enabled regardless of run state.
- Kinds and grouping: `scriptKind()` derives `action` (`hasRun`, no roles), `provider` (roles, no `hasRun`), `both`, or `unknown` (neither). Legacy payloads without `hasRun` treat role-less scripts as runnable. The list renders an **Actions** group first, then **Providers**, each alphabetically (`localeCompare`) with a count badge and a real collapse button (`aria-expanded`; CSS-only collapse keeps result areas alive). Empty groups render nothing. A `both` script is listed once under Actions and keeps its role chips.
- Card actions by kind: action/both render Run/Cancel + Open; provider renders Open + job-language chips (`Instance address`, `Array size`, `Integrity check`) and **no** `.script-run-btn` element; unknown renders Open + warning glyph + `Inspect exports` hint and no run control. Raw role stays in `data-role`.
- Provider and unknown cards have no `.script-result-area` and no status dot: their state lives in the destination panels (Integrity / Overlay).
- Button state machine: ▶ play → ⟳ spinner (200 ms pending) → ⏹ stop (click to cancel) → ▶ play on any terminal state. Clicking the running button cancels during pending; while one script runs, every other card's run button carries the real `disabled` attribute (out of tab order; tooltip "A script is already running"; native disabled swallows clicks). `.ts` cards get `disabled-ts` (esbuild tooltip); untrusted workspace cards get `disabled-trust` ("Workspace not trusted") and neither is click-wired.
- **No pre-run capability gate.** Clicking Run always starts the run (`onRunScript`); the first dangerous command inside the run opens the inline prompt.
- Permission prompt: one at a time, inserted inside the card above `.script-result-area`. Title names the script + capability phrase, detail shows the host-provided string (address/byte count, command, or host). Primary "Allow once"; "More options" expands a menu with the scopes the request offers (`script`/`session`/`workspace`, each for the requested capability and for all capabilities; `workspace` is never offered for `exec`), with labels naming the real lifetime ("for this script, until VS Code restarts" / "for every script, until VS Code restarts" / "for this script in this workspace, across restarts"). Deny is a separate button. Escape denies. Focus starts on "Allow once", moves to the first option when the menu opens, and returns to the card's Run button on close. `showResult` and cancel close an open prompt (denying it). A new request replaces the prompt and denies the stale `requestId`; a missing card denies immediately.
- Permissions list: `setPermissionGrants()` renders `.script-perms-section` above `.script-list` with one row per stored grant — scope chip (`This script` / `This session` / `Workspace`), basename (`All scripts` for a session-wide entry), capability label, and `Revoke` (`onRevokeScriptPermission` with the row's scope). Rows render in host `listGrants()` order (workspace → session → script, then path). A script with 2+ non-session grants gets a per-row `All` bulk action (keeps session-wide grants) and the **Manage** button expands `.script-perms-bulk` with `Revoke all workspace` / `Revoke all session`; every bulk action is a two-step confirm (first click arms and relabels to `Confirm?`, second click reports `onRevokeAllScriptPermissions`). An empty list removes the section. The list re-renders in place, so existing result areas are untouched.
- Rescans (`setScripts`) rebuild the grouped list but move each non-empty `.script-result-area` to the matching card by `data-path`, so result blocks and run history survive regrouping/sorting.
- Run history (per script, session-only): the latest result block stays expanded on top; each completed run collapses into a one-line row `run #N · HH:MM ✓/✕` (`.script-run-row`, `.script-run-hdr`), newest first, capped at `HISTORY_CAP` (5) per card. A new run snapshots the prior result block into history before streaming starts. A `✕` clear button on the latest block header empties the card's results and resets its status dot.
- Run payload: `onRunScript(path, getGeneration(), getSelection() ?? undefined)`.
- Output streaming: first 100 lines appended realtime to the running card's log; later lines buffered and flushed via `setTimeout(0)` debounce (BATCH_THRESHOLD=100).
- `showResult`: clears running state, flushes pending output, sets status dot, snapshots any prior result block into run history, renders the latest embedded result block (auto-expanded) + collapsed history rows, wires collapse toggle + clear. Error-type headers: success "Result", compile "Compile Error" (⚠️ yellow), runtime "Script Error" (🔴), timeout "Timeout" (⏱️ orange), cancel "Cancelled" (dimmed, partial log preserved), contract "Contract Error". Writes notice: `pendingWriteCount` -> "N byte(s) written — saving"; `discardedWriteCount` -> "N byte(s) written, discarded - nothing was saved". No action buttons; approved writes auto-save host-side.
- `appendOutput` before any run is a silent no-op (no running button).
- Refresh button and `setTabActive(true)` both fire `onRequestList` (host re-posts `requestScriptList`).

## Validation & Error Matrix

| Condition | Behaviour |
|---|---|
| No scripts | "No scripts found in .hexscope/scripts/" empty state + **Create script** + **Add example scripts** buttons |
| Empty-state install click | `onAddExampleScripts` (no list request) |
| Empty-state create click | `onCreateScript` without a template (host shows the template picker) |
| Header **+** click | `onAddExampleScripts` |
| New primary click | `onCreateScript` without a template (host shows the template picker) |
| New caret click | Toggles `.script-new-popup` + `aria-expanded`; no create fires |
| Template option click | `onCreateScript(<template id>)`; the chooser closes |
| Scripts present | Empty-state install action is removed with the empty state |
| Action script (`hasRun`, no roles) | Actions group; status dot + Run/Cancel + Open |
| Provider script (roles, no `hasRun`) | Providers group; Open + job chips only, no `.script-run-btn` |
| Both script (`hasRun` + roles) | Actions group; Run/Cancel + Open + job chips (one card) |
| Unknown script (neither) | Actions group; Open + warning + `Inspect exports`, no `.script-run-btn` |
| Legacy payload without `hasRun` | Role-less scripts stay runnable; role-bearing scripts are providers |
| Group header click | Toggles `.collapsed` + `aria-expanded`; runs nothing; result areas survive |
| Group empty after classification | That group header is not rendered |
| Rescan (`setScripts`) | Result areas move to the matching card by path |
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
| Permissions list | Rows with scope chip + basename/`All scripts` + capability; Revoke reports scope/path/capability; empty list removes section |
| Manage click | Toggles `.expanded` + `aria-expanded`; reveals bulk revoke controls; no revoke fires |
| Bulk revoke (workspace/session/per-script) | First click arms (`.confirm`, `Confirm?`); second click reports `onRevokeAllScriptPermissions`; per-scope or per-script payload |
| Session-wide grant row | Name shows `All scripts` (never the raw `*`); per-script `All` is not offered |
| Grant list order | Rendered in host order (workspace → session → script, then path); the panel does not re-sort |
| Unmounted render / setScripts | No-op (guards `sections?.body`) |
| `setTabActive` before first activation | No list request until first `true`; request fires exactly once |

## Tests Required

`src/test/webview/components/sidebar/scriptsPanel/scriptsPanel.test.ts`: mount/render (toolbar + empty state + install action + empty-state create + New split button with caret toggle/four template options/idempotent), refresh → `onRequestList`, empty-state/header install → `onAddExampleScripts`, empty-state/New primary/option create → `onCreateScript`, `setScripts` (cards: name/ext/role chips with job labels + `data-role`, capability badges, status dots, no count badge, trusted vs untrusted disabled, `.ts` `disabled-ts`, open action reports the path and stays enabled), script kinds (action/provider/both/unknown actions, provider/unknown render no `.script-run-btn`, legacy-payload fallback), grouping (Actions before Providers, counts, alphabetical order with `hello.js` first, empty groups, collapse/expand + `aria-expanded`, result-area preservation across collapse and rescan), run/cancel state machine (payload shape with generation/selection, play→spinner→stop→play, cancel during pending, other run button truly disabled, no pre-run prompt), permission prompt (render inside the card, Allow once payload, scope menu options with lifetime labels incl. no `workspace` for exec, `*` breadth, Escape/Deny, one-at-a-time replace, close on result/cancel, unknown path deny, focus return), Permissions list (scope chips + host order, `All scripts` for session-wide rows, per-row revoke payloads, Manage expansion, per-script/workspace/session bulk two-step confirm, empty removal, result areas preserved), run history (latest-top collapse, expand, no stream pollution, clear, 5-row cap), `showResult` (headers, results rows, log, writes notices, auto-expand + collapse toggle, escaping, unknown-path no-op), `appendOutput` (realtime + first-100-then-batched flush, escaping, no-run no-op), `setTabActive` lazy-init gate. Existing `webviewMessageModel.test.ts` protocol rows + `webview.test.ts` pass unchanged (parity gate).

## Anti-patterns

- `ScriptsPanel.ts` importing `S`, `state.ts`, `postProviderMessage`, `memory/selection`, `render/registry`, or `memory/memoryData`.
- Component calling `currentSelectionRange()` / reading `S.documentGeneration` directly (must use `getSelection`/`getGeneration`).
- Component posting `requestScriptList`/`runScript`/`cancelScript`/`scriptPermissionResponse`/`revokeScriptPermission`/`revokeAllScriptPermissions` (must use callbacks).
- Building template bodies or writing script files inside the panel: bodies live in `core/scripting/templates.ts`, the host creates/normalizes, and the panel only reports `onCreateScript`.
- Host calling stale `renderScripts`/`activateScripts`/`updateScriptList`/`updateScriptResult`/`updateScriptOutput` module functions.
- Re-introducing a pre-run capability gate or any second confirmation path (the per-command prompt is the only ask).
- Rendering a Run control for a provider/unknown card (it must not exist in the markup, not merely be disabled).
- Duplicating a both-kind card across Actions and Providers, or showing a provider status dot.
- Hardcoding catalog filenames for ordering: the list sorts by name, which keeps the shipped action examples in catalog order.
- Re-introducing Apply & Save / Discard controls (writes commit automatically on success).
- Storing grants in the panel (host owns them; the panel only renders `scriptPermissions`).
- Firing a bulk revoke on the first click, or re-sorting the grant list inside the panel (the host `listGrants()` order is canonical).
- Weakening `webviewMessageModel.test.ts` script protocol assertions during the extraction (parity gate).
- Wording a permission lifetime as "the editor closes": both in-memory scopes end at host exit, so their labels say "until VS Code restarts" — "editor" reads as the hex editor panel, which grants now survive.
- Adding `.script-*` rules to `styles/` (they live in `scriptsPanel.css`).
