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
    getDataRange?: () => { start: number; end: number } | null;    // full-file mapped range (min seg start → max seg end) — add-form fallback when no selection
    getEndian?: () => 'le' | 'be';                            // shared byte-order source (was S.endian)
    onCopyText?: (text: string, label: string) => void;       // copy chip → host posts copyText
    onPersistChecks?: (state: IntegrityCheckSet) => void;     // checks persistence → host posts saveIntegrityChecks
    onHighlightChange?: (highlight: IntegrityHighlight | null) => void; // range/stored highlight → host sets S.integrityHighlight + rerender.memory()
}

class IntegrityPanel {
    constructor(cb: IntegrityCallbacks);
    mount(root: HTMLElement): void;                            // creates #s-integrity container; idempotent
    render(): void;                                            // was renderIntegrity; re-renders shell
    setChecks(value: unknown): void;                           // was setIntegrityChecks (init + perFileDataChange slices)
    notifyBytesChanged(): void;                                // was notifyIntegrityBytesChanged
    notifyEditsDiscarded(): void;                              // was notifyIntegrityEditsDiscarded
    notifyEndianChanged(): void;                               // was notifyIntegrityEndianChanged
    setTabActive(active: boolean): void;                       // host pushes sidebarTab==='integrity' (lazy-init gate was activateIntegrity)
}
```

## Rules

- Component holds only UI/transient state (check cards + forms, `highlightedCheckId`, debounce timers, auto-fix suppression, `initialized` flag). Persistent/domain state lives in the host.
- Reads no `S`, writes no `S`; data pushed via setters; actions report via callbacks. `readByte`/`getSelection`/`getEndian` are injected pull accessors (host passes `getByte`, `S.selStart/S.selEnd`, `S.endian`) so memory/selection/byte-order stay host-owned — the component must NOT import `memory/memoryData`.
- Check mutations report `onPersistChecks` (local `persistChecks()` built on `integrityCheckSetFromStates`); auto-fix/Fix-all edits report `onStoredValueEdits`; highlight exits via `onHighlightChange` (never poke `S.integrityHighlight` or `rerender.memory()`).
- `setTabActive(true)` replaces the old `activateIntegrity()` lazy-init gate: first activation renders + kicks off `scheduleIntegrityCalculation` for each check; the `initialized` flag is never reset (matches pre-refactor).
- Markup is byte-identical to pre-refactor (same ids/classes: `#s-integrity`, `integrity-shell`, `integrity-card`, `integrity-check-form`, `data-check-id`, `data-draft-control`, `data-form-action`, `data-check-toggle`, `data-auto-fix`, `data-copy-calculated`, `data-check-status`); all CSS moved verbatim from `styles/integrity.css`. Untrusted text escaped with `esc()`. Parity exception: the calculated pane's empty `title=""` attributes (fed by the now-removed `calculatedDisplay.title`, always `''`) were dropped from the value `<span>` and `<code>` as dead markup — zero-value empty attribute, no user-visible change. (The `Profile` label row and `integrity-profiles` library block are gone with the retired panel profile library; orphaned `.integrity-profile-*` CSS was removed.)
- Pure model helpers stay pure and unit-tested (`integrityCheckModel.ts`); no DOM, no `S`.

## Behaviour

- Default: empty check list renders "No integrity checks configured.".
- Add form opens with selection defaults from `getSelection()`; no selection → full-file range from `getDataRange()` (host derives min segment start → max segment end from `S.parseResult.segments`); neither → blank. Optional "Check name" input (`data-draft-control="name"`, maxlength 40, trimmed, duplicates allowed); empty name persists as no field. Card title = `check.name || algorithmLabel(check.algorithm)`. `IntegrityCheckConfig.name?` carried by `normalizeIntegrityCheck` (trim, >40 dropped) so names survive reload; `schemaVersion` unchanged.
- Live refill (label-form parity): `notifySelectionChanged()` on hex-view selection change (host calls it from `onHexViewSelectionChange` next to `syncLabelForm`) refills the open add/edit form — end-focused → end only, else start+end; null selection leaves values as-is; never on keystrokes. `formLastFocused` reset on open/save/cancel.
- Header row = Fix all / ＋ Add (right, same line, no `Profile` label — profile selection lives in the toolbar **Select Profile** dropdown, not the panel).
- Algorithm change toggles the stored-value field; validation errors inline; save → `onPersistChecks` + debounced calculation (250 ms).
- Result cards: status symbol (✓/✕/∑/…/!/?), calculated value pane, optional stored pane (match/mismatch/unverified), copy button → `onCopyText`; Auto fix toggle stages mismatched stored values via `onStoredValueEdits`, with suppression so a discarded mismatch isn't immediately re-staged (paused state until toggle/Fix all/endian change).
- Card header click toggles highlight → `onHighlightChange({ rangeStart, rangeEnd, status, storedStart?, storedLength? })`; edit/delete via card action buttons. Delete persists via `persistChecks()`.
- `notifyEndianChanged()` clears suppression, re-renders, and re-decodes stored values per `getEndian()`.
- Lazy init: no calculation or notify work until `setTabActive(true)` (first integrity tab activation).

## Validation & Error Matrix

| Condition | Behaviour |
|---|---|
| Empty checks | "No integrity checks configured." empty state |
| Invalid range (end < start / bad hex) | Inline `[data-form-error]`; no `onPersistChecks` |
| Hash algorithm draft with stored field | Stored field hidden; stored config stripped |
| Stored bytes unmapped | Card Error status; no comparison/fix |
| Auto-fix mismatch staged | `onStoredValueEdits` with [addr, byte] pairs |
| Discard after mismatch | Suppression flag; no immediate re-stage; `paused` styling |
| Fix-all conflicts | `setActionError` message; apply none |
| Unmounted render / before first activation | No-op (render guards `_panel`; notifies guard `initialized`) |

## Tests Required

`src/test/webview/components/sidebar/integrityPanel/integrityPanel.test.ts`: mount (shell + empty states + idempotent render), add-form selection defaults, check add/edit/delete → `onPersistChecks`, inline validation, hash stored-field visibility, result render + copy → `onCopyText`, stored match/mismatch, auto-fix staging + discard suppression, `notifyEndianChanged` re-decode, highlight toggle → `onHighlightChange` + clear on delete, `setTabActive` lazy-init. Existing `integrityCheckModel.test.ts` (import re-point) + `webview.test.ts` `Integrity Checks sidebar` suite pass unchanged (parity gate).

## Anti-patterns

- `integrityPanel.ts` importing `S`, `state.ts`, `postProviderMessage`, `memory/memoryData`, `render/registry` (`rerender`), or `integrityPersistence`.
- Component setting `S.integrityHighlight` / calling `rerender.memory()` directly (must use `onHighlightChange`).
- Component calling `getByte` directly (must use injected `readByte`).
- Host calling stale `renderIntegrity`/`activateIntegrity`/`setIntegrity*`/`notifyIntegrity*` module functions.
- Weakening `webview.test.ts` integrity assertions during the extraction (parity gate).
