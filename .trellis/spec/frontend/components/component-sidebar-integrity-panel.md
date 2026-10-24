# Component Spec — Integrity Panel

## Scope / Trigger

Owns `src/webview/components/sidebar/integrityPanel/integrityPanel.ts` (+ `integrityCheckModel.ts`) + `integrityPanel.css`: the sidebar Integrity panel — check list (add/edit/delete, algorithm selection, address/stored-value inputs, auto-fix toggle), per-check result display (calculated/stored comparison, copy), and the Fix-all action. The component owns all panel markup, check/form UI state, debounced calculation scheduling, and auto-fix suppression. It never reads/writes the `S` global and never posts provider messages: data is pushed via setters, byte reads/selection/endian go through injected accessors, and actions report via callbacks.

Host (`hexViewer.ts`) owns: `S` state, checks persistence (`saveIntegrityChecks` into the bound file profile), edit staging (`stageIntegrityEdits`), `S.integrityHighlight` + `rerender.memory()`, and the endian/bytes-changed/discard event fan-out.

## Layout

```text
src/webview/components/sidebar/integrityPanel/
    integrityPanel.ts       interaction controller: mount/render/setChecks/notifyBytesChanged/notifyEditsDiscarded/notifyEndianChanged/setTabActive
    integrityCheckModel.ts  pure check-model helpers (makeIntegrityCheck, draftFromIntegrityConfig, integrityCheckSetFromStates, ...)
    integrityResultRender.ts  pure result/card markup (checkCardHtml, resultBodyHtml, checkStatusLabel, ...)
    integrityCalculation.ts   debounced scheduling + async calculate pipeline (readByte/endian/hooks injected)
    integrityHighlight.ts     range/stored highlight derivation + reporting hooks
    integrityPanel.css      all panel rules (moved verbatim from styles/integrity.css)
src/webview/hexViewer.ts    host wiring (panel descriptor, applyIntegrityHighlight, persistence callbacks, notify fan-out)
src/test/webview/components/sidebar/integrityPanel/integrityPanel.test.ts   (mocha + jsdom)
```

Panel shell (`sidebar.ts`) and shared `.sb-section`/`.sb-body`/`.sb-badge`/`.sb-empty` stay in `sidebar.ts`/`sidebar.css`. `core/integrity.ts` holds the shared config (`IntegrityCheckConfig.name?`) + `normalizeIntegrityCheck` (trim, >40 dropped).

## Contract

```typescript
interface IntegrityCallbacks {
    readByte: (addr: number) => number | undefined;            // required — host memory adapter
    onStoredValueEdits?: (edits: Array<[number, number]>) => void;  // auto-fix → host stages edit transaction
    getSelection?: () => { start: number; end: number } | null;    // add-form defaults (was S.selStart/S.selEnd)
    getDataRange?: () => { start: number; end: number } | null;    // full-file mapped range (min seg start → max seg end)
    getEndian?: () => 'le' | 'be';                            // shared byte-order source (was S.endian)
    onCopyText?: (text: string, label: string) => void;       // copy chip → host posts copyText
    onPersistChecks?: (state: IntegrityCheckSet) => void;     // checks persistence → host posts saveIntegrityChecks
    onHighlightChange?: (highlight: IntegrityHighlight | null) => void;
    onScriptCheckRequest?: (request: IntegrityScriptRunRequest) => void; // host posts runIntegrityScript
    onOpenScript?: (scriptPath: string) => void;              // host posts openScript
    onRequestScriptList?: () => void;                         // picker discovery → host posts requestScriptList
    onCreateScript?: (role: ScriptRole) => void;              // empty picker → host posts createScript
    onOpenScriptsFolder?: () => void;                         // empty picker → host posts openScriptsFolder
    getPendingEdits?: () => Array<[number, number]>;          // script run input (S.edits)
    getGeneration?: () => number;                             // stale-response guard (S.documentGeneration)
}

/** One configured script check exposed to the host for used-by derivation. */
interface IntegrityScriptUsageRef {
    checkId: number;       // runtime id (panel-assigned); selectCheck takes it back
    scriptPath: string;    // authored workspace-relative path (kept even when unscanned)
    label: string;         // card title: custom name, else the script file name
}

class IntegrityPanel {
    constructor(cb: IntegrityCallbacks);
    mount(root: HTMLElement): void;
    render(): void;
    setChecks(value: unknown): void;
    setAvailableScripts(scripts, trusted): void;
    acceptScriptResult(msg: IntegrityScriptResultMessage): void;
    scriptUsages(): IntegrityScriptUsageRef[];   // host used-by derivation: script checks + runtime ids
    selectCheck(id: number): void;               // host used-by link: highlight + reveal (scrolls into view)
    notifyBytesChanged(): void;
    notifyEditsDiscarded(): void;
    notifyEndianChanged(): void;
    notifyDocumentOpened(): void;   // re-run checks against the new document
    notifyDocumentSaved(): void;    // re-run script checks after a save
    setTabActive(active: boolean): void;
}
```

## Rules

- Component holds only UI/transient state (check cards + forms, `highlightedCheckId`, debounce timers, auto-fix suppression, `initialized` flag). Persistent/domain state lives in the host.
- Host used-by integration is one-way and additive: `scriptUsages()` reports the configured script checks (runtime id + authored path + card title) for the host's `deriveScriptUsages()`, and `selectCheck(id)` sets `highlightedCheckId`, re-renders (selected card class), reports the highlight, and scrolls the card into view; an unknown id is a no-op. The panel never derives or stores usages.
- Reads no `S`, writes no `S`; data pushed via setters; actions report via callbacks. `readByte`/`getSelection`/`getEndian` are injected pull accessors (host passes `getByte`, `S.selStart/S.selEnd`, `S.endian`) so memory/selection/byte-order stay host-owned — the component must NOT import `memory/memoryData`.
- Check mutations report `onPersistChecks` (local `persistChecks()` built on `integrityCheckSetFromStates`); auto-fix/Fix-all edits report `onStoredValueEdits`; highlight exits via `onHighlightChange` (never poke `S.integrityHighlight` or `rerender.memory()`).
- `setTabActive(true)` replaces the old `activateIntegrity()` lazy-init gate: first activation renders + kicks off `scheduleIntegrityCalculation` for each check; the `initialized` flag is never reset (matches pre-refactor).
- Markup is byte-identical to pre-refactor (same ids/classes: `#s-integrity`, `integrity-shell`, `integrity-card`, `integrity-check-form`, `data-check-id`, `data-draft-control`, `data-form-action`, `data-check-toggle`, `data-auto-fix`, `data-copy-calculated`, `data-check-status`); all CSS moved verbatim from `styles/integrity.css`. Untrusted text escaped with `esc()`. Parity exception: the calculated pane's empty `title=""` attributes (fed by the now-removed `calculatedDisplay.title`, always `''`) were dropped from the value `<span>` and `<code>` as dead markup — zero-value empty attribute, no user-visible change. (The `Profile` label row and `integrity-profiles` library block are gone with the retired panel profile library; orphaned `.integrity-profile-*` CSS was removed.)
- Pure model helpers stay pure and unit-tested (`integrityCheckModel.ts`); no DOM, no `S`.

## Behaviour

- Default: empty check list renders "No integrity checks configured.".
- Kinds: the kind control (algorithm select) gains a `Script` option. Selecting it reveals `[data-script-field]` with a picker of `@script integrity` scripts (relative paths) plus a free-text path input; a selected check persists `kind:'script'` and a workspace-relative `scriptPath`. An empty picker shows a disabled placeholder plus **＋ Add** (`.sb-btn-add`, `title`/`aria-label` `Create an integrity script`; `data-create-script="integrity"` → `onCreateScript`) and **Open scripts folder** (`.sb-btn-secondary`, `data-open-scripts-folder` → `onOpenScriptsFolder`); both disappear once a matching script exists.
- Script cards: `Script · <name>` chip (full path in the tooltip), status-line states `Verified`/`Failed` (verify), `Match`/`Mismatch` (value), `Stale`, refresh (`data-script-refresh`) and open-script (`data-script-open`) actions. The calculated pane header is `Value` (byte result) or `Verify` (PASS/FAIL); the stored pane is `Stored` with no endian tag.
- Host used-by links: `scriptUsages()` lists every configured script check in stored order (name-less checks fall back to the script basename) and `selectCheck(id)` highlights one exactly like a card-header toggle — the selected card gets `integrity-card-selected`, the range/stored highlight is reported through the existing `onHighlightChange`, and `.scrollIntoView({ block: 'nearest' })` reveals the card (guarded for jsdom). The host's usage refresh is driven by `setChecks`/`onPersistChecks`, so check add/edit/delete updates the Scripts panel without the panel knowing anything about scripts.
- Script scheduling: run on tab activation / document open / save / refresh (`startScriptRun` → `onScriptCheckRequest`, per-check request id + generation). A byte change bumps the token and marks the settled result stale; auto-fix suppression is reused unchanged. Stale or calculating script checks never contribute to Fix all, and a `valid === true` script result contributes no fix.
- Add form opens with selection defaults from `getSelection()`; no selection → full-file range from `getDataRange()` (host derives min segment start → max segment end from `S.parseResult.segments`); neither → blank. Optional "Check name" input (`data-draft-control="name"`, maxlength 40, trimmed, duplicates allowed); empty name persists as no field. Card title = `check.name || algorithmLabel(check.algorithm)` (script: `name || script base name`). `IntegrityCheckConfig.name?` carried by `normalizeIntegrityCheck` (trim, >40 dropped) so names survive reload; `schemaVersion` unchanged.
- Live refill (label-form parity): `notifySelectionChanged()` on hex-view selection change (host calls it from `onHexViewSelectionChange` next to `syncLabelForm`) refills the open add/edit form — end-focused → end only, else start+end; null selection leaves values as-is; never on keystrokes. `formLastFocused` reset on open/save/cancel.
- Header row = `Fix all` only (right-aligned, same line, no `Profile` label — profile selection lives in the toolbar **Select Profile** dropdown, not the panel). The create entry point is the `Integrity Checks` section-header action `#integrity-add-btn` (`sb-btn sb-btn-add sb-section-action`, visible `＋ Add`, `title`/`aria-label` `Add check`), mounted once via the section's `mountActions`; its click opens the add form (in the body) and expands the section. `render()` only syncs its `disabled` state from `addCheckDraft` (`syncAddButton`), so re-renders never duplicate the listener. The add form title reads `＋ Add check` (edit keeps `✎ Edit Check`) and the create-mode submit reads `Add`.
- Every algorithm exposes the stored-value field; validation errors inline; save → `onPersistChecks` + debounced calculation (250 ms).
- Result cards: status symbol (✓/✕/∑/…/!/?), calculated value pane, optional stored pane (match/mismatch/unverified), copy button → `onCopyText`; Auto fix toggle stages mismatched stored values via `onStoredValueEdits`, with suppression so a discarded mismatch isn't immediately re-staged (paused state until toggle/Fix all/endian change).
- Card header click toggles highlight → `onHighlightChange({ rangeStart, rangeEnd, status, storedStart?, storedLength? })`; edit/delete via card action buttons. Delete persists via `persistChecks()`.
- `notifyEndianChanged()` clears suppression, re-renders, and re-decodes stored values per `getEndian()` — checksums (CRC16/CRC32) only; MD5/SHA stored panes always use natural byte order and show no endian tag (`Stored`, not `Stored (LE)`). Byte order is gated by `isChecksumAlgorithm()` (`src/core/integrity.ts`) in both `integrityCalculation.ts` (`expectedBytes`) and `integrityResultRender.ts` (stored pane value + label).
- Lazy init: no calculation or notify work until `setTabActive(true)` (first integrity tab activation).

## Validation & Error Matrix

| Condition | Behaviour |
|---|---|
| Empty checks | "No integrity checks configured." empty state |
| Invalid range (end < start / bad hex) | Inline `[data-form-error]`; no `onPersistChecks` |
| Hash algorithm draft with stored field | Stored field remains visible; stored config persists |
| Stored bytes unmapped | Card Error status; no comparison/fix |
| Auto-fix mismatch staged | `onStoredValueEdits` with [addr, byte] pairs |
| Discard after mismatch | Suppression flag; no immediate re-stage; `paused` styling |
| Fix-all conflicts | `setActionError` message; apply none |
| Unmounted render / before first activation | No-op (render guards `_panel`; notifies guard `initialized`) |

## Tests Required

`src/test/webview/components/sidebar/integrityPanel/integrityPanel.test.ts`: mount (shell + empty states + idempotent render), header add action (`#integrity-add-btn` in `.sb-section-actions`, `＋ Add` + `Add check`, no body button, expands a collapsed section, disabled while the add form is open, exactly one listener across re-renders), add-form selection defaults, check add/edit/delete → `onPersistChecks`, inline validation, hash stored-field visibility, result render + copy → `onCopyText`, stored match/mismatch, hash auto-fix staging + discard suppression, `notifyEndianChanged` re-decode, highlight toggle → `onHighlightChange` + clear on delete, `setTabActive` lazy-init, script card statuses, stale/refresh, script picker + path validation, empty picker (disabled placeholder + create/open-folder actions and their disappearance), script auto-fix/Fix all, stale generation re-request, used-by links (`scriptUsages()` refs for script checks only incl. trimmed paths + title fallback, `selectCheck` highlight/render/highlight report/scrollIntoView, unknown-id no-op). Existing `integrityCheckModel.test.ts` + `webview.test.ts` `Integrity Checks sidebar` suite pass unchanged (parity gate, writer expectations carry `kind:'builtin'`).

## Anti-patterns

- `integrityPanel.ts` importing `S`, `state.ts`, `postProviderMessage`, `memory/memoryData`, `render/registry` (`rerender`), or `integrityPersistence`.
- Component setting `S.integrityHighlight` / calling `rerender.memory()` directly (must use `onHighlightChange`).
- Component calling `getByte` directly (must use injected `readByte`).
- Host calling stale `renderIntegrity`/`activateIntegrity`/`setIntegrity*`/`notifyIntegrity*` module functions.
- Component executing a script (script text/worker never crosses into the webview; it posts `runIntegrityScript` and consumes `integrityScriptResult`).
- Script pane applying endian conversion or showing an endian tag on a script stored field.
- Weakening `webview.test.ts` integrity assertions during the extraction (parity gate).
