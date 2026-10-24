# Component Spec — Scripts Panel

## Scope / Trigger

Owns `src/webview/components/sidebar/scriptsPanel/scriptsPanel.ts` + `scriptUsages.ts` + `scriptsPanel.css` + `permissionPrompt.ts`: the sidebar Scripts panel — toolbar (title/refresh), Actions/Providers groups (collapsible, counted, session-local collapse state), the filter bar (search + kind chips), script cards (action/provider/both/unknown, clickable name + ext/role chips + capability badges + used-by chip/status dot/run-cancel button state machine, expandable details row with used-by links, TypeScript action row), the card context menu (Open / Copy path / Reveal in Explorer / Show details / Manage permissions / Delete, via the shared MenuController), the inline per-command permission prompt, the revocable Permissions list (script/session/workspace grants with scope chips, per-row revoke, and bulk revoke behind **Manage**), and embedded result areas (output streaming with realtime-first-100 + debounced batching, collapse/expand, error-type headers, write summary line, writes notice). The component owns all panel markup and UI state (`currentScripts`, `trusted`, `compilerAvailable`, `scriptStatus`, `permissionGrants`, `permissionsExpanded`, `runningPath`, `pendingTimer`, `confirmTimers`, `collapsedGroups`, `filterQuery`, `kindFilter`, `expandedDetails`, `lastRun`, `writeSummary`, `usages`, output batching state, `initialized`). It never reads/writes the `S` global and never posts provider messages: the list/run/cancel/decision/revoke/create/open/reveal/delete/copy/convert/guide/used-by-select requests exit via callbacks, and selection/generation snapshots go through injected accessors.

Host (`hexViewer.ts`) owns: `S` state, `S.documentGeneration`, `currentSelectionRange()`, the used-by derivation (`deriveScriptUsages()` in `scriptUsages.ts`, fed by the Integrity panel's `scriptUsages()` + `S.typeInstances` + the last scan), and `postProviderMessage` for `requestScriptList`/`runScript`/`cancelScript`/`scriptPermissionResponse`/`revokeScriptPermission`/`revokeAllScriptPermissions`/`copyText`/`revealScript`/`deleteScript`/`convertScriptToJs`/`openScriptingGuide`; host message handlers fan into component setters. Permission *state* (grants) lives in the extension host (`src/scriptPermissions.ts`, workspace-root-keyed registry); the panel only renders the host-sorted list it is given. The write summary is webview-owned: `hexViewer.applyScriptWrites` captures before-bytes, stages the transaction, shows the `saving` summary, and saves with `saveEdits(scriptPath)`; `savedEdits` → `markWritesSaved`, `scriptSaveFailed` → `markWritesFailed`. Used-by links are **derived transiently** (bound-profile checks + instance sources; never persisted) and pushed via `setUsages`; a link click reports `onSelectUsage` and the host switches to Integrity (`selectCheck`) or Overlay (`selectInstance`).

## Layout

```text
src/webview/components/sidebar/scriptsPanel/
    scriptsPanel.ts       interaction controller: mount/render/setScripts/setUsages/showResult/appendOutput/setTabActive
    scriptUsages.ts       pure used-by derivation (configured path → card identity, check/pin/param records)
    permissionPrompt.ts   inline approval surface (focus, scope menu, deny paths)
    scriptsPanel.css      all panel rules (colocated; historically moved from styles/sidebar.css)
src/webview/hexViewer.ts  host wiring (panel descriptor, callbacks, message fan-out, usage refresh)
src/test/webview/components/sidebar/scriptsPanel/scriptsPanel.test.ts   (mocha + jsdom)
src/test/webview/components/sidebar/scriptsPanel/scriptUsages.test.ts   (pure derivation)
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

/** One host-derived used-by link (scriptUsages.ts; transient, never persisted). */
type ScriptUsageKind = 'integrity' | 'address' | 'size';
interface ScriptUsageRef {
    scriptPath: string;     // card identity (filePath) when the configured path resolves; else the configured path
    kind: ScriptUsageKind;
    label: string;          // check title / instance name (`instance · param` for size)
    checkId?: number;       // integrity usage → host selects the check
    pinId?: string;         // address/size usage → host expands the instance
}

interface ScriptsCallbacks {
    onRequestList?: () => void;                                   // host posts { type: 'requestScriptList' }
    onRunScript?: (scriptPath: string, generation: number, selectionRange?: { start: number; end: number }) => void;  // host posts runScript
    onCancelScript?: (scriptPath: string) => void;                // host posts cancelScript
    onOpenScript?: (scriptPath: string) => void;                  // host posts openScript
    onScriptPermissionDecision?: (requestId: number, decision: 'allow' | 'deny', scope: ScriptPermissionScope, capability: ScriptCapabilityGrant) => void;  // host posts scriptPermissionResponse
    onRevokeScriptPermission?: (scope: ScriptGrantScope, scriptPath: string, capability: ScriptCapabilityGrant) => void;  // host posts revokeScriptPermission
    onRevokeAllScriptPermissions?: (scope?: ScriptGrantScope, scriptPath?: string) => void;  // host posts revokeAllScriptPermissions
    onBrowseExampleScripts?: () => void;                          // host posts { type: 'browseExampleScripts' }
    onAddExampleScripts?: () => void;                             // host posts { type: 'addExampleScripts' }
    onCreateScript?: (template?: ScriptTemplateId) => void;       // host posts createScript (undefined = host picks the template)
    onCopyPath?: (scriptPath: string) => void;                    // host posts copyText { text: scriptPath }
    onRevealScript?: (scriptPath: string) => void;                // host posts revealScript
    onDeleteScript?: (scriptPath: string) => void;                // host posts deleteScript (confirms + unlinks + revokes + rescans)
    onCreateJsVersion?: (scriptPath: string) => void;             // host posts convertScriptToJs (`.ts` → `.js` sibling)
    onOpenScriptingGuide?: () => void;                            // host posts openScriptingGuide (docs/SCRIPTING.md)
    onSelectUsage?: (usage: ScriptUsageRef) => void;              // host reveals Integrity check / Overlay instance
    getSelection?: () => { start: number; end: number } | null;   // was currentSelectionRange
    getGeneration?: () => number;                                 // was S.documentGeneration
}

/** Write lifecycle: `saving` until the correlated savedEdits / scriptSaveFailed arrives. */
interface ScriptWriteSummary {
    scriptPath: string;
    writes: Array<[number, number]>;      // staged [address, byte]
    before: Array<[number, number]>;      // pre-write bytes at the same addresses
    status: 'saving' | 'saved' | 'failed';
    error?: string;                       // host error text when `failed`
}

class ScriptsPanel {
    constructor(cb?: ScriptsCallbacks);
    mount(root: HTMLElement): void;
    render(): void;
    setScripts(scripts: ScriptInfo[], trusted: boolean, compilerAvailable?: boolean): void;  // absent = no esbuild
    setUsages(usages: ScriptUsageRef[]): void;             // host-derived used-by links (refresh in place)
    showPermissionRequest(request: ScriptPermissionRequest): void;
    setPermissionGrants(grants: ScriptGrantView[]): void;
    showWriteSummary(summary: ScriptWriteSummary): void;   // render `saving` (host staged approved bytes)
    markWritesSaved(): void;                               // correlated savedEdits
    markWritesFailed(scriptPath: string, message: string): void;  // correlated scriptSaveFailed
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

- Component holds only UI/transient state (`currentScripts`, `trusted`, `compilerAvailable`, `scriptStatus` Map, `permissionGrants`, `permissionsExpanded`, `runningPath`, `pendingTimer`, `confirmTimers`, output batch state, `initialized`, `collapsedGroups`, `filterQuery`, `kindFilter`, `expandedDetails`, `lastRun`, `writeSummary`, `usages`). Persistent/domain state lives in the host — usages are host-derived (never persisted) and the panel only renders them.
- Reads no `S`, writes no `S`; data pushed via setters; actions report via callbacks. `getSelection`/`getGeneration` are injected pull accessors (host passes `currentSelectionRange()`, `S.documentGeneration`) so selection/generation stay host-owned — the component must NOT import `memory/selection` or `state.ts`.
- Run/cancel/open/reveal/delete/copy/list/decision/revoke/convert/guide requests report via callbacks; the component never calls `postProviderMessage`.
- `setTabActive(true)` is the lazy-init gate: first activation fires `onRequestList` (once); `initialized` is never reset.
- New-script creation is presentation-only: the **＋ New** split button's primary action reports `onCreateScript(undefined)` (the host shows the template picker), each `.script-new-option[data-template]` reports its template id (and closes the chooser). The caret menu's fixed catalog rows (`.script-new-sep` separator, then `[data-example-action="browse"]` / `[data-example-action="all"]`) report `onBrowseExampleScripts` (selective picker) and `onAddExampleScripts` (bulk); the host owns both copies (`browseExampleScripts` / `addExampleScripts`). The component never writes files and never builds template bodies (they live in `core/scripting/templates.ts`). The TypeScript row's **Create JavaScript version** reports `onCreateJsVersion(path)` — the host owns the copy; **Open setup guide** reports `onOpenScriptingGuide()`.
- Markup ids/classes: `#s-scripts`, `scripts-refresh`, `scripts-new`/`scripts-new-menu` (New split button in `.script-new-bar`, `aria-expanded`; `.script-new-popup` lists `.script-new-option[data-template]`, a `.script-new-sep[role="separator"]`, then `.script-new-option[data-example-action="browse"|"all"]`), `.script-filter-bar`/`.script-filter-input`/`.script-kind-chip[data-kind-filter]` (`.active` + `aria-pressed`), `.script-no-match`, `.script-toolbar`, `.script-group`/`.script-group-hdr`/`.script-group-label`/`.script-group-count`/`.script-group-body` (`data-group="actions"|"providers"`, `data-group-toggle`, `aria-expanded`; `[hidden]` when filtered empty), `.script-card` (`data-kind`; `[hidden]` when filtered; `.script-name` is a `<button data-open-name>` — the primary open affordance; `.script-usage-chip[data-usage-chip]` shows `Used by N` or hides), `.script-open-btn`, `.script-run-btn`, `.script-details-toggle` (`aria-expanded`), `.script-details` (`[hidden]`; `.script-details-grid`/`-label`/`-value`/`-actions`/`-btn`, `data-details-usages`/`data-details-last-run`/`data-details-grants`, used-by links `.script-usage-link[data-usage-idx]` + `.script-usage-kind`, actions `[data-details-open]`/`[data-details-copy]`/`[data-details-reveal]`/`[data-details-manage]`), `.script-ts-help`/`.script-ts-note`/`.script-ts-btn` (`[data-ts-guide]`/`[data-ts-convert]`), `.script-result-area`, `.script-output-block`/`-hdr`/`-log`, `.script-write-summary` (`-saving`/`-saved`/`-failed`), `.script-ext`, `.sb-status-dot`, `.script-role` (`data-role` raw, visible job label), `.script-cap`, `.script-warn`, `.script-inspect-hint`, `.script-empty`/`.script-empty-hint`. Card context menu (shared `#menu`): `.menu-item[data-cmd]` rows `script-open`/`script-copy`/`script-reveal`/`script-details`/`script-permissions` (manage is a `menu-disabled` row without an active grant)/`script-delete`, separators `.menu-sep`. Permission surfaces: `.script-perm` (prompt, `data-perm-allow`/`data-perm-menu`/`data-perm-deny`/`.script-perm-option[data-scope][data-grant]`), `.script-perms-section` (`data-perms-manage`, `.expanded` reveals `.script-perms-bulk`)/`.script-perm-row` (`data-scope`)/`.script-perm-scope`/`[data-revoke]`/`[data-revoke-all]`/`[data-revoke-all-workspace]`/`[data-revoke-all-session]`/`.script-perms-hint`; armed bulk buttons carry `.confirm` + text `Confirm?`. Run history adds `.script-run-row`/`.script-run-hdr` and `.script-clear`. All CSS moved verbatim from `styles/sidebar.css`; new permission, grouping, empty-state, unknown-script, New-split, filter, details, TS-row, used-by, and write-summary rules live in `scriptsPanel.css`.
- Untrusted text escaped with `esc()`; CSS-attribute paths escaped with `cssEscape` (Windows backslashes — scripting.md §9.1). The prompt component matches cards by iterating `.script-card` and comparing `dataset.path`, avoiding attribute selectors entirely.
- Pure helpers (`cssEscape`, `extLabel`, `fileName`, `grantLabel`, `scopeLabel`, `scopeTitle`, `grantFromRow`, `btnTitle`/`btnClass`/`scriptBtnAttrs`, `writesBlockHtml`, `roleLabel`, `hasRunEntry`, `scriptKind`, `roleBadgesHtml`, `unknownHintHtml`, `cardLeadHtml`, `lastRunStateFor`/`lastRunText`/`lastRunTitle`, `roleListText`/`capListText`/`entriesFor`/`entryListText`, `fingerprintShort`, `activeGrantCount`, `matchesQuery`/`matchesKind`, `hexByte`/`hexAddress`/`writeRangeText`/`addrRangeText`/`bytePreview`, `writeSummaryHtml`, `nameButtonHtml`, `usageChipHtml`/`usagesValueHtml`/`usageButtonHtml`/`usageListTitle`/`usageKindLabel`, `isCardMenuKey`/`menuRowHtml`/`disabledMenuRowHtml`/`menuSeparatorHtml`) stay module-level and DOM-free; `capabilityPhrase`/`scopeOptions` live in `permissionPrompt.ts`, and `deriveScriptUsages`/`ScriptUsageRef` live in `scriptUsages.ts` (also module-level/pure).

## Behaviour

- Default: empty script list renders "No scripts found in .hexscope/scripts/" plus a hint pointing at the **＋ New** split button (`.script-empty-hint`); the empty state has no create/browse buttons — the New split button is the single creation entry point; no section-header count badge.
- New split button (the single creation entry point): `.script-new-bar` above `.script-list` holds **＋ New** (`#scripts-new`, reports `onCreateScript()`) and the caret (`#scripts-new-menu`, toggles `.script-new-popup` + `aria-expanded`, closes on an outside click). `.script-new-popup` lists the four templates from `core/scripting/templates.ts`, then a `.script-new-sep[role="separator"]`, then the two catalog rows: **Browse examples…** (`[data-example-action="browse"]` → `onBrowseExampleScripts`) and **Add all examples** (`="all"` → `onAddExampleScripts`); choosing any row closes the chooser.
- Catalog actions: the New menu's **Browse examples…** / **Add all examples** report via callbacks; the component never runs the copy itself. The host opens the selective picker (`browseExampleScripts`) or copies the bundled catalog (`hexScope.addExampleScripts`) and rescans when anything was added, so installed cards appear without a manual refresh.
- Card: status dot (gray idle / green ok / red err), name button (ellipsis + path tooltip + `aria-label="Open <name>"`; clicking it reports `onOpenScript` — the pencil button stays as the secondary affordance), role chips, capability badges (`.script-cap`, title "Requires approval: <cap>"), used-by chip (`.script-usage-chip`, `Used by N` + tooltip when the host pushed usages), ext badge, fixed-width open button, fixed-width run/cancel button. The open button reports `onOpenScript` and stays enabled regardless of run state.
- Kinds and grouping: `scriptKind()` derives `action` (`hasRun`, no roles), `provider` (roles, no `hasRun`), `both`, or `unknown` (neither). Legacy payloads without `hasRun` treat role-less scripts as runnable. The list renders an **Actions** group first, then **Providers**, each alphabetically (`localeCompare`) with a count badge and a real collapse button (`aria-expanded`; CSS-only collapse keeps result areas alive). Empty groups render nothing. A `both` script is listed once under Actions and keeps its role chips.
- Card actions by kind: action/both render Run/Cancel + Open; provider renders Open + job-language chips (`Instance address`, `Array size`, `Integrity check`) and **no** `.script-run-btn` element; unknown renders Open + warning glyph + `Inspect exports` hint and no run control. Raw role stays in `data-role`.
- Provider and unknown cards have no `.script-result-area` and no status dot: their state lives in the destination panels (Integrity / Overlay).
- Button state machine: ▶ play → ⟳ spinner (200 ms pending) → ⏹ stop (click to cancel) → ▶ play on any terminal state. Clicking the running button cancels during pending; while one script runs, every other card's run button carries the real `disabled` attribute (out of tab order; tooltip "A script is already running"; native disabled swallows clicks). `.ts` cards get `disabled-ts` (esbuild tooltip) only when `compilerAvailable` is false; untrusted workspace cards get `disabled-trust` ("Workspace not trusted") and neither is click-wired.
- **No pre-run capability gate.** Clicking Run always starts the run (`onRunScript`); the first dangerous command inside the run opens the inline prompt.
- Permission prompt: one at a time, inserted inside the card above `.script-result-area`. Title names the script + capability phrase, detail shows the host-provided string (address/byte count, command, or host). Primary "Allow once"; "More options" expands a menu with the scopes the request offers (`script`/`session`/`workspace`, each for the requested capability and for all capabilities; `workspace` is never offered for `exec`), with labels naming the real lifetime ("for this script, until VS Code restarts" / "for every script, until VS Code restarts" / "for this script in this workspace, across restarts"). Deny is a separate button. Escape denies. Focus starts on "Allow once", moves to the first option when the menu opens, and returns to the card's Run button on close. `showResult` and cancel close an open prompt (denying it). A new request replaces the prompt and denies the stale `requestId`; a missing card denies immediately.
- Permissions list: `setPermissionGrants()` renders `.script-perms-section` above `.script-list` with one row per stored grant — scope chip (`This script` / `This session` / `Workspace`), basename (`All scripts` for a session-wide entry), capability label, and `Revoke` (`onRevokeScriptPermission` with the row's scope). Rows render in host `listGrants()` order (workspace → session → script, then path). A script with 2+ non-session grants gets a per-row `All` bulk action (keeps session-wide grants) and the **Manage** button expands `.script-perms-bulk` with `Revoke all workspace` / `Revoke all session`; every bulk action is a two-step confirm (first click arms and relabels to `Confirm?`, second click reports `onRevokeAllScriptPermissions`). An empty list removes the section. The list re-renders in place, so existing result areas are untouched.
- Rescans (`setScripts`) rebuild the grouped list but move each non-empty `.script-result-area` to the matching card by `data-path`, so result blocks and run history survive regrouping/sorting.
- Filter bar: `.script-filter-bar` (text input + kind chips; hidden while the empty state shows) narrows the list by hiding cards (`[hidden]`), hiding groups with no visible card, and showing `.script-no-match` when nothing matches. Filtering never re-renders, so results/history/permissions survive; `filterQuery`/`kindFilter` are session-local and re-applied after every `setScripts`. `actions` matches action/both/unknown cards (they live in the Actions group).
- Details row: `.script-details-toggle` (aria-expanded) toggles `.script-details` (`.hidden`); expanded paths live in `expandedDetails` and survive rescans. Rows show roles (job labels), capabilities, **Used by** links, derived entries (`run`, `getAddress`, `getSize`, `getIntegrityValue`, `verifyIntegrity`), short fingerprint (full value in title), last run (`HH:MM · state`), and active grants (own rows + every session-wide grant). Used-by links render as `.script-usage-link` chips (label + kind vocabulary `Integrity check`/`Instance address`/`Array size`); a click reports `onSelectUsage(usage)` and the host reveals the destination (Integrity `selectCheck` / Overlay `selectInstance`). `None` renders when the host pushed no usage. Actions report `onOpenScript`, `onCopyPath`, `onRevealScript`, and panel-local **Manage permissions** (expands `.script-perms-section`, rendered only when the card has ≥1 active grant).
- Used-by data: `setUsages(usages)` stores the host-derived list and refreshes each rendered card **in place** (chip + details cell only; result areas, history, and permissions stay attached). Usages are keyed by the card identity (`ScriptInfo.filePath`) when the configured path resolves to a scanned script; an unresolved configured path is kept in the payload but renders nowhere, so a missing script never silently drops the destination. `deriveScriptUsages()` (scriptUsages.ts) resolves workspace-relative/absolute configured paths (exact, then case-insensitive) and derives integrity checks first, then instance address/size sources (`paramValues` overrides skip that parameter).
- Card context menu: right-click on a card (or Shift+F10 / ContextMenu with card focus) opens the shared MenuController popover via `menuController.show(x, y, { innerHTML, emit })`; the menu is headless and report-only. Rows: **Open** → `onOpenScript`, **Copy path** → `onCopyPath`, **Reveal in Explorer** → `onRevealScript`, **Show details** (panel-local: opens the details row), **Manage permissions** (panel-local: expands `.script-perms-section`; a `menu-disabled` row with hint "No active grants" until the card has a grant), **Delete** → `onDeleteScript` (separated; the host confirms, unlinks, revokes grants, and rescans). The controller owns dismissal, Escape, arrow keys, focus restore, and single-active-menu semantics; the panel never touches `#menu` markup beyond the per-show `innerHTML`.
- TypeScript: `setScripts(scripts, trusted, compilerAvailable)` — absent = no esbuild (legacy default). Trusted `.ts` cards with no compiler keep `disabled-ts` and render `.script-ts-help` ("TypeScript needs esbuild, which is not bundled" + **Open setup guide** → `onOpenScriptingGuide`, **Create JavaScript version** → `onCreateJsVersion(path)`); with `compilerAvailable` the Run button is enabled and the row is gone. Untrusted `.ts` shows `disabled-trust` and no TS row.
- Write summary: `showWriteSummary` stores the summary and refreshes the line in place; `showResult` renders it (instead of the plain writes notice) when `writeSummary.scriptPath` matches, `markWritesSaved` flips it to `Saved … Ctrl+Z to undo`, `markWritesFailed(scriptPath, message)` flips it to `Save failed — nothing was saved: <error>` (distinct from `saving`, no undo hint). Ranges over `WRITE_PREVIEW_MAX` (8) show first/last byte only. A new run consumes the summary (the history snapshot keeps the old line); **Clear results** drops it.
- Last run: `showResult` records `{ at, state }` per path (`success`/`error`/`timeout`/`cancel`/`contract`), refreshes the card's details cell, and appends the time to the status-dot tooltip ("Last run succeeded · 12:34"). The dot stays the glance signal.
- Run history (per script, session-only): the latest result block stays expanded on top; each completed run collapses into a one-line row `run #N · HH:MM ✓/✕` (`.script-run-row`, `.script-run-hdr`), newest first, capped at `HISTORY_CAP` (5) per card. A new run snapshots the prior result block into history before streaming starts. A `✕` clear button on the latest block header empties the card's results and resets its status dot.
- Run payload: `onRunScript(path, getGeneration(), getSelection() ?? undefined)`.
- Output streaming: first 100 lines appended realtime to the running card's log; later lines buffered and flushed via `setTimeout(0)` debounce (BATCH_THRESHOLD=100).
- `showResult`: clears running state, flushes pending output, records the last run, sets the status dot, snapshots any prior result block into run history, renders the latest embedded result block (auto-expanded) + collapsed history rows, wires collapse toggle + clear. Error-type headers: success "Result", compile "Compile Error" (⚠️ yellow), runtime "Script Error" (🔴), timeout "Timeout" (⏱️ orange), cancel "Cancelled" (dimmed, partial log preserved), contract "Contract Error". Writes line: the matching write summary when one exists, else `pendingWriteCount` -> "N byte(s) written — saving"; `discardedWriteCount` -> "N byte(s) written, discarded - nothing was saved". No action buttons; approved writes auto-save host-side.
- `appendOutput` before any run is a silent no-op (no running button).
- Refresh button and `setTabActive(true)` both fire `onRequestList` (host re-posts `requestScriptList`).

## Validation & Error Matrix

| Condition | Behaviour |
|---|---|
| No scripts | "No scripts found in .hexscope/scripts/" empty state + hint pointing at the New split button |
| New menu **Browse examples…** click | `onBrowseExampleScripts`; the chooser closes |
| New menu **Add all examples** click | `onAddExampleScripts`; the chooser closes |
| New primary click | `onCreateScript` without a template (host shows the template picker) |
| New caret click | Toggles `.script-new-popup` + `aria-expanded`; no create fires |
| Template option click | `onCreateScript(<template id>)`; the chooser closes |
| Scripts present | Empty state is replaced by the grouped list; the New split button stays |
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
| Write staged (`showWriteSummary` → `showResult`) | Summary line replaces the plain writes notice: "Saving N byte(s) at 0x…–0x… · before … · after …" |
| Correlated `savedEdits` | Line flips to "Saved … · Ctrl+Z to undo" |
| Correlated `scriptSaveFailed` | Line flips to "Write of N byte(s) … failed — nothing was saved: <error>"; distinct from `saving`; staged bytes stay |
| Failure for another path while a summary is pending | Pending summary untouched |
| Write range > 8 bytes | First/last byte only (`before 00 … 05`) with the count in the sentence |
| New run after a summary | Summary consumed; the history snapshot keeps the old line; the new result uses the plain notice |
| Clear results | Summary dropped with the card's results |
| Clean run with writes (no summary) | "N byte(s) written — saving", no buttons |
| Failed run with writes | "N byte(s) written, discarded — nothing was saved" |
| Text filter | Non-matching cards get `[hidden]`; results/history stay in the DOM; `No scripts match the filter` shows when nothing matches; groups with no visible card hide |
| Kind chip | `providers` hides action/both/unknown cards; `actions` hides providers; `All` restores; chips keep `aria-pressed` in sync |
| Filter + rescan | Filter re-applied after `setScripts`; result areas and history survive |
| Details toggle | `.script-details` hidden toggles; `aria-expanded` follows; expanded state survives a rescan |
| Details content | Roles/capabilities/used-by links/entries/fingerprint/last run/grants; escaping applies |
| Used-by chip | `Used by N` with a `kind: label` tooltip when usages exist; hidden (empty text) with none |
| Used-by link click | `onSelectUsage({scriptPath, kind, label, checkId/pinId})`; no run, no result change |
| Usage refresh (`setUsages`) | Chip + details cell update in place; result areas/history/permissions stay attached |
| Unresolved usage path | Kept in the payload, renders no card/link (missing scripts show no card) |
| Details actions | Open → `onOpenScript`, Copy path → `onCopyPath`, Reveal → `onRevealScript`; Manage expands `.script-perms-section` (button hidden with no active grant) |
| Card right-click / Shift+F10 / ContextMenu | Shared `#menu` opens with Open/Copy path/Reveal in Explorer/Show details/Manage permissions/Delete; Escape/outside closes; focus restores |
| Card menu command | Open/Copy/Reveal/Delete report the card path; Show details opens `.script-details`; Manage expands the Permissions section |
| Card menu Delete | `onDeleteScript` with the card path; the host modal-confirms, unlinks, revokes the script's grants, and rescans (no in-panel state change) |
| Card menu without grants | Manage is a `menu-disabled` row with "No active grants"; no expansion fires |
| Trusted `.ts` + no compiler | `disabled-ts` + `.script-ts-help` (guide → `onOpenScriptingGuide`, convert → `onCreateJsVersion(path)`) |
| Trusted `.ts` + compiler available | Run enabled, no `.script-ts-help` |
| Untrusted `.ts` | `disabled-trust`, no `.script-ts-help` |
| Last run | Status dot tooltip + details cell show `HH:MM · state`; untouched scripts show `Not run yet` |
| Permissions list | Rows with scope chip + basename/`All scripts` + capability; Revoke reports scope/path/capability; empty list removes section |
| Manage click | Toggles `.expanded` + `aria-expanded`; reveals bulk revoke controls; no revoke fires |
| Bulk revoke (workspace/session/per-script) | First click arms (`.confirm`, `Confirm?`); second click reports `onRevokeAllScriptPermissions`; per-scope or per-script payload |
| Session-wide grant row | Name shows `All scripts` (never the raw `*`); per-script `All` is not offered |
| Grant list order | Rendered in host order (workspace → session → script, then path); the panel does not re-sort |
| Unmounted render / setScripts | No-op (guards `sections?.body`) |
| `setTabActive` before first activation | No list request until first `true`; request fires exactly once |

## Tests Required

`src/test/webview/components/sidebar/scriptsPanel/scriptsPanel.test.ts`: mount/render (toolbar + empty-state hint + New split button with caret toggle/four template options/catalog rows under a separator/outside-click close/idempotent + filter bar hidden with no scripts), refresh → `onRequestList`, New menu **Browse examples…** → `onBrowseExampleScripts`, New menu **Add all examples** → `onAddExampleScripts` (no separate header install action), New primary/option create → `onCreateScript`, `setScripts` (cards: name/ext/role chips with job labels + `data-role`, capability badges, status dots, no count badge, trusted vs untrusted disabled, `.ts` `disabled-ts`, open action reports the path and stays enabled), script kinds (action/provider/both/unknown actions, provider/unknown render no `.script-run-btn`, legacy-payload fallback), grouping (Actions before Providers, counts, alphabetical order with `hello.js` first, empty groups, collapse/expand + `aria-expanded`, result-area preservation across collapse and rescan), run/cancel state machine (payload shape with generation/selection, play→spinner→stop→play, cancel during pending, other run button truly disabled, no pre-run prompt), permission prompt (render inside the card, Allow once payload, scope menu options with lifetime labels incl. no `workspace` for exec, `*` breadth, Escape/Deny, one-at-a-time replace, close on result/cancel, unknown path deny, focus return), Permissions list (scope chips + host order, `All scripts` for session-wide rows, per-row revoke payloads, Manage expansion, per-script/workspace/session bulk two-step confirm, empty removal, result areas preserved), write summary (saving/saved/failed states + distinctness, cross-path failure isolation, large-range truncation, history snapshot on re-run, clear, missing-area no-op), details row (toggle + rescan persistence, roles/caps/used-by/entries/fingerprint/last run/grants, escaping, open/copy/reveal callbacks, manage visibility + expansion, session-wide grant counting), used-by links (chip count/tooltip, details links + kind labels, link → `onSelectUsage` payload, in-place refresh preserving the very same result DOM, usages-pushed-before-rescan rendering, unmatched path rendering nowhere), card context menu (right-click + Shift+F10 open the shared menu, Open/Copy/Reveal/Delete payloads, disabled Manage without grants, Show details expansion, Manage expansion, Escape close), filename click → `onOpenScript` with the pencil alongside, filter bar (hidden/shown with scripts, text hiding + result preservation + no-match, kind chips + group hiding, rescan survival with run history), TypeScript path (disabled-ts + action row wiring, compiler-available enables Run + hides the row, untrusted stays `disabled-trust`), last run (tooltip + details cell states, survives a rescan), run history (latest-top collapse, expand, no stream pollution, clear, 5-row cap), `showResult` (headers, results rows, log, writes notices, auto-expand + collapse toggle, escaping, unknown-path no-op), `appendOutput` (realtime + first-100-then-batched flush, escaping, no-run no-op), `setTabActive` lazy-init gate. `src/test/webview/components/sidebar/scriptsPanel/scriptUsages.test.ts` covers the pure derivation (relative/absolute path resolution, case-insensitive fallback, unresolved path kept, address/size/param usages, manual `paramValues` override, blank sources skipped, ordering). Existing `webviewMessageModel.test.ts` protocol rows + `webview.test.ts` pass unchanged (parity gate).

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
- Filtering by re-rendering the list (it must hide/show — results, run history, and permissions must survive).
- Deriving usages inside the panel: they come from the host via `setUsages` (the panel never reads `S`/profiles), and a resolved path must stay the card identity while an unresolved configured path is kept for destinations.
- Re-rendering the list for a usage refresh: the chip and details cell update in place so result areas, run history, and permissions survive.
- Opening a second menu implementation for the card context menu (the shared `MenuController` is the only popover menu), or executing navigation commands inline: Open/Copy/Reveal/Delete exit via callbacks; only Show details / Manage permissions are panel-local.
- Leaving a failed script save at "saving" or reporting it as saved: `scriptSaveFailed` must flip the summary to the distinct `failed` state.
- Restoring the silent disabled-`.ts`-Run dead end: the TS row's setup guide and create-JS actions are the product answer (JS-first).
- Writing write-summary state into the host: before/after bytes and the lifecycle line are webview-owned; the host only stages the transaction and reports save success/failure.
