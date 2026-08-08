# Design — Integrity self-contained component

Mirror of the archived Struct panel extraction at the same sidebar-panel seam (see `archive/2026-08/08-04-webview-struct-panel-component/design.md`). Behavior-preserving; the parent `08-03` refactor contract is locked — no re-litigation.

## Component contract

```typescript
// src/webview/components/IntegrityPanel/IntegrityPanel.ts
interface IntegrityCallbacks {
    /** Required — host memory adapter for byte reads (keeps memory access host-owned). */
    readByte: (addr: number) => number | undefined;
    /** Auto-fix: write calculated bytes to a stored field → host stages an edit transaction. */
    onStoredValueEdits?: (edits: Array<[number, number]>) => void;
    /** Selection snapshot for the add-check form defaults (was S.selStart/S.selEnd). */
    getSelection?: () => { start: number; end: number } | null;
    /** Copy button → host posts copyText. */
    onCopyText?: (text: string, label: string) => void;
    /** Checks persistence → host posts saveIntegrityChecks. */
    onPersistChecks?: (set: IntegrityCheckSet) => void;
    /** Profile library CRUD → host posts create/update/rename/deleteIntegrityProfile. */
    onCreateProfile?: (profile: IntegrityProfile) => void;
    onUpdateProfile?: (profile: IntegrityProfile) => void;
    onRenameProfile?: (id: string, name: string) => void;
    onDeleteProfile?: (id: string) => void;
    /** Highlight of a check range/stored field → host sets S.integrityHighlight + rerender.memory(). */
    onHighlightChange?: (highlight: IntegrityHighlightInput | null) => void;
}

export class IntegrityPanel {
    constructor(cb?: IntegrityCallbacks);
    mount(root: HTMLElement): void;               // idempotent; renders shell + wires listeners
    render(): void;                               // was renderIntegrity; re-renders shell
    setProfiles(value: unknown, error?: string): void;  // was setIntegrityProfiles
    setChecks(value: unknown): void;              // was setIntegrityChecks
    notifyBytesChanged(): void;                   // was notifyIntegrityBytesChanged
    notifyEditsDiscarded(): void;                 // was notifyIntegrityEditsDiscarded
    notifyEndianChanged(): void;                  // was notifyIntegrityEndianChanged
    setTabActive(active: boolean): void;          // host pushes sidebarTab==='integrity' (lazy init / calc kickoff)
}
```

The component owns the full `#s-integrity` shell (profiles header, check cards + forms, comparison panes, fix-all) and all module-level mutable state (`nextCheckId`, `profiles`, `selectedProfileId`, `profileError`, `actionError`, `profileNameMode`, `addCheckDraft`, `editingCheckId`, `highlightedCheckId`, `integrityState.initialized/checks`) as instance fields.

> Contract deviations from a pure cut (documented for reviewers): the old lazy-init `activateIntegrity()` gate becomes `setTabActive(active)` (host calls it in the tab-effects map, replacing `SIDEBAR_TAB_EFFECTS.integrity`); the old host-side `setIntegrityEditHandler(stageIntegrityEdits)` becomes constructor callback `onStoredValueEdits`. `getSelection` is a pull callback (only needed when opening the add form) instead of a push setter — the panel is not selection-driven.

## Ownership split

Component owns (all moved verbatim from `sidebar/integrity/index.ts`):
- **Profiles header**: profile selector, save-as / rename / update / delete, fix-all, profile-name form.
- **Check cards**: add form, per-check edit/delete/auto-fix, expand/collapse highlight toggle, algorithm + address/stored-value inputs, validation errors.
- **Results**: calculated/stored value panes, single/double comparison layout, copy buttons, status/meta/calculating rendering, debounced calc scheduling, auto-fix with suppression.
- **Highlight**: `syncIntegrityHighlight`/`clearIntegrityHighlight` compute the highlight object but exit via `onHighlightChange` (host owns `S.integrityHighlight` + `rerender.memory`).

Host (`hexViewer.ts`) owns:
- `S.*` reads/writes, `rerender.*`, persistence `postProviderMessage`, `getByte` injection, edit staging (`stageIntegrityEdits`), profile message handling (`handleIntegrityProfilesMessage` → `integrityPanel.setProfiles`), and the endian/bytes-changed/discard event fan-out (`notifyIntegrity*` → `integrityPanel.notify*`).

Cross-boundary exits (was `S.integrityHighlight` / `rerender.memory` / `postProviderMessage` / `getByte` / `S.selStart/selEnd` / `editHandler`):
- `onHighlightChange(highlight | null)` — host sets `S.integrityHighlight` + `if (S.currentView === 'memory') rerender.memory()`.
- `onStoredValueEdits(edits)` — host `stageIntegrityEdits` + `refreshAfterIntegrityEdits`.
- `onCopyText` / `onPersistChecks` / `onCreateProfile` / `onUpdateProfile` / `onRenameProfile` / `onDeleteProfile` — host posts messages.
- `readByte` — host passes `getByte` (keeps `memory/memoryData` import out of the component).
- `getSelection()` — host returns `{ start: S.selStart, end: S.selEnd }` (null-safe).

Component never imports `S`, `state.ts`, `postProviderMessage`, `memory/memoryData`, `render/registry` (`rerender`), or `integrityPersistence`. Core imports (`core/integrity`) and util imports (`actionBtnsHtml`, `esc`, `formatHexHtml`) stay. Pure model `integrityCheckModel.ts` moves under `components/IntegrityPanel/` unchanged.

## Host wiring (hexViewer.ts)

1. `const integrityPanel = new IntegrityPanel({ readByte: getByte, onStoredValueEdits: stageIntegrityEdits, onHighlightChange: applyIntegrityHighlight, onCopyText: copyIntegrityText, onPersistChecks: persistIntegrityChecks, onCreateProfile: ..., onUpdateProfile: ..., onRenameProfile: ..., onDeleteProfile: ..., getSelection: () => (S.selStart !== null && S.selEnd !== null ? { start: S.selStart, end: S.selEnd } : null) });`
   - `applyIntegrityHighlight(highlight)`: `S.integrityHighlight = highlight; if (S.currentView === 'memory') rerender.memory();`.
   - Persistence callbacks call `postProviderMessage({ type: ... })` — the moved `integrityPersistence.ts` bodies live in the host now (or host imports the persistence helpers directly; persistence module's exports are pure `postProviderMessage` wrappers).
2. Panel descriptor: `{ id: 'integrity', label: 'Integrity', mount: root => integrityPanel.mount(root) }`.
3. Replace call sites:
   - `renderIntegrity()` → `integrityPanel.render()`.
   - `activateIntegrity` in `SIDEBAR_TAB_EFFECTS` → `integrityPanel.setTabActive(true)`; add the matching `false` for other tabs if the component needs it (lazy init flag handled internally).
   - `setIntegrityProfiles(profiles, err)` → `integrityPanel.setProfiles(profiles, err)`.
   - `notifyIntegrityBytesChanged()` → `integrityPanel.notifyBytesChanged()`.
   - `notifyIntegrityEditsDiscarded()` → `integrityPanel.notifyEditsDiscarded()`.
   - `notifyIntegrityEndianChanged()` → `integrityPanel.notifyEndianChanged()`.
   - Drop `setIntegrityEditHandler(stageIntegrityEdits)` (callback supplied at construction).
4. Delete `sidebar/integrity/index.ts` + `integrityPersistence.ts` (host now owns persistence via callbacks); update `hexViewer.ts` imports + any test imports.

## CSS

- `components/IntegrityPanel/IntegrityPanel.css` = all rules moved verbatim from `styles/integrity.css`.
- `import './IntegrityPanel.css'` in `IntegrityPanel.ts`; bundled via esbuild.
- `.integrity-shell` keeps its `#s-integrity` container (component creates it in `mount`).

## Tests

`src/test/webview/components/integrity.test.ts` (mocha + jsdom + css-import-hook):
- render: mount(root) renders profiles header + empty state; add form opens with selection defaults from `getSelection`.
- checks: add/edit/delete → `onPersistChecks`; algorithm/stored-field visibility; validation errors; auto-fix toggle reports + `onStoredValueEdits` on mismatch.
- results: calculated value renders, stored comparison (match/mismatch/unverified), copy → `onCopyText`.
- profiles: create/rename/update/delete → profile callbacks; save-as; profile-name form validation.
- highlight: card toggle → `onHighlightChange` with range/stored fields; clear on delete.
- Parity: existing `integrity-check-model.test.ts` (import path update) + `webview.test.ts` `Integrity Checks sidebar` suite pass unchanged.

## Rollback

One commit; `git revert` restores `sidebar/integrity/` inline rendering + host calls + `styles/integrity.css` rules.
