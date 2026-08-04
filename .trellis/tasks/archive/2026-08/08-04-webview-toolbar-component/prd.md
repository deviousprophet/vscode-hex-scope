# PRD — Extract Toolbar into self-contained component

## Origin
Child of `08-03-webview-component-refactor` (issue #151: "Refactor webview UI into self-contained components"). ACs: per-component `.ts`+`.css`, colocated styles, shared styles only global, no functional/visual change.

## Problem
`#toolbar` markup + its button wiring live scattered: markup in `hexViewer.ts` render(); view-tab + ASCII + edit button listeners in `hexViewer.ts` (`setupToolbarButtons`, `setupEditButtons`, `setShowAscii`, `updateMemoryOnlyControls`); dirty bar in `editControls.ts`; CSS in shared `styles/toolbar.css`. Untested, coupled to composition root.

## Goal
Self-contained `Toolbar` component owning `#toolbar` markup, its button chrome, transient active-class/edit-group state, and toolbar CSS. Host owns all state (`S`), edit/save/cancel logic, view switching.

Structure:
```text
src/webview/components/Toolbar/
    Toolbar.ts     toHtml + class Toolbar (report-only callbacks, host-invoked setters)
    Toolbar.css    #toolbar chrome rules (moved from styles/toolbar.css)
```

## Design decisions (locked in planning grills)
- **Scope (Q1-A):** Toolbar = `#toolbar` element only (view tabs, ASCII toggle, edit-mode group). SearchBar stays an injected child component (its existing `toHtml()`); stats bar + external-change banners stay host-rendered separate elements (not toolbar chrome).
- **Button contract (Q2-A):** component reports every click via callbacks (`onViewChange`, `onAsciiToggle`, `onEditStart`, `onSave`, `onCancel`); host owns all state + logic; host pushes active state back via setters (`setView`, `setEditMode`, `setDirty`, `setAscii`).
- **CSS split (Q3):** `Toolbar.css` = `#toolbar`, `.view-tabs`, `.tb-sep`, `.tb-edit-btn/.tb-cancel-btn/.tb-ascii-btn`, `.tb-editing-pill`, `#edit-dirty-count`, `.tb-save-btn`. `toolbar.css` keeps `#stats-bar`/`.si*` + `.ext-*-banner` (stats bar + external banners separate).
- **Slot mechanics (Q4-A):** `Toolbar.toHtml()` embeds `${searchBar.toHtml()}`; zero new slot mechanism; SearchBar mounts independently (both doc-delegated).
- **Re-render (Q5-A-lite):** `mount()` idempotent doc-delegated; `toHtml()` regenerates on full render; per-invalidation host calls lightweight setters, not full re-render of toolbar.
- **Dirty bar (Q6-A):** single `setDirty(count)` sets count text + Save disabled (count===0).
- **Memory gating (Q7-A):** `setView('memory'|'record')` derives active tab + memory-only visibility (ascii/edit-group); host calls once.
- **Edit entry/exit (Q8-A):** component reports only; host mutates `S.editMode` + calls `setEditMode`.
- **SearchBar visibility (Q9-C):** SearchBar (own component, slot-in) gains `setVisible(bool)`; host `switchView` calls it — no cross-component DOM writes; Toolbar unaware of search visibility.

## Scope
In:
- `src/webview/components/Toolbar/Toolbar.ts` + `Toolbar.css`.
- `hexViewer.ts` — replace inline `#toolbar` markup + button wiring with Toolbar component; callbacks → host handlers (switchView, setShowAscii, edit/save/cancel); setters on invalidation.
- `editControls.ts` — `updateEditControls`/`updateDirtyBar` become host calls `setView`/`setEditMode`/`setDirty`/`setAscii`.
- `styles/toolbar.css` — toolbar chrome rules moved to `Toolbar.css`.

Out:
- Stats bar, external-change banners — separate elements, stay host.
- Renaming/restructuring `statsBar.ts`/`externalChangeUi.ts` — separate concerns.

## Acceptance Criteria
- [ ] `components/Toolbar/Toolbar.ts` + `Toolbar.css` exist; component owns `#toolbar` markup, transient button active/edit-group state, and toolbar styles. Zero `S` reads; no edit/save/post logic.
- [ ] Pure render + report-only callbacks + host-invoked setters per design; renders byte-identical `#toolbar` DOM (same ids/classes) as pre-refactor.
- [ ] SearchBar slot: `Toolbar.toHtml()` includes SearchBar output; SearchBar mounts independently; survives re-render.
- [ ] `styles/toolbar.css` toolbar-chrome rules moved verbatim; toolbar.css keeps stats/banner rules.
- [ ] `npm run lint`, `npm run check-types`, `npm run test` pass. Fallow green.
- [ ] No functional/visual change to toolbar, tabs, ASCII, edit/save/cancel, dirty count in running extension.