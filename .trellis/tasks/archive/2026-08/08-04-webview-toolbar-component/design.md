# Design — Toolbar component extraction

## Component contract

```ts
// src/webview/components/Toolbar/Toolbar.ts

type ToolbarView = 'memory' | 'record';

interface ToolbarCallbacks {
    onViewChange?: (v: ToolbarView) => void;
    onAsciiToggle?: () => void;
    onEditStart?: () => void;
    onSave?: () => void;
    onCancel?: () => void;
}

interface ToolbarRenderState {
    view: ToolbarView;
    ascii: boolean;        // ASCII button active
    editMode: boolean;     // Edit hidden / EDITING group shown
    dirtyCount: number;    // #edit-dirty-count + Save disabled
}

export function renderToolbarHtml(searchBarHtml: string, state: ToolbarRenderState): string;  // pure
export class Toolbar {
    constructor(cb?: ToolbarCallbacks);
    mount(): void;                                   // idempotent, document-delegated
    setView(v: ToolbarView): void;                   // active tab + memory-only gating (ascii/edit-group)
    setEditMode(on: boolean): void;                  // Edit button hidden / EDITING group shown
    setAscii(on: boolean): void;                     // ASCII button active class
    setDirty(count: number): void;                   // #edit-dirty-count text + Save disabled (count===0)
}
```

## Direct-render + slot

- Pure `renderToolbarHtml(searchBarHtml, state)` builds: `.view-tabs` (Memory/Records active by `state.view`), `.tb-sep`, ASCII toggle button (`tb-ascii-btn`, `active` when memory && `state.ascii`), Edit button (hidden while `state.editMode`), `#edit-mode-group` (EDITING pill, dirty count, Save/Cancel — shown when `state.editMode`), Save disabled when `state.dirtyCount===0`.
- SearchBar slot: host calls `renderToolbarHtml(searchBar.toHtml(), { view: S.currentView, ascii: getShowAscii(), editMode: S.editMode, dirtyCount: S.edits.size })`. Component render output `<div id="toolbar">${tabs}${ascii}${editGroup}${searchBarHtml}</div>`.
- `toHtml` regenerates from host state each full render; per-invalidation host calls setters only.

## Interaction (report-only)
- `mount()` attaches doc-delegated listeners on the buttons (view tabs, ASCII, Edit, Save, Cancel), idempotent. Each reports to the corresponding callback. Component never mutates `S`, never posts, never runs edit logic.
- Host callbacks: `onViewChange`→`switchView(v)`; `onAsciiToggle`→`setShowAscii(!getShowAscii())`; `onEditStart`→enter edit mode; `onSave`→post saveEdits; `onCancel`→clear edits. Host then calls setters back (or invalidations re-render).

## CSS
- `src/webview/components/Toolbar/Toolbar.css` = `#toolbar`, `.view-tabs`, `.tb-sep`, `.tb-edit-btn`, `.tb-cancel-btn`, `.tb-ascii-btn`, `.tb-editing-pill`, `#edit-dirty-count`, `.tb-save-btn` (moved verbatim from `styles/toolbar.css`).
- `styles/toolbar.css` keeps `#stats-bar` + `.si/*` + `.ext-*-banner` (stats bar + external banners, separate host-rendered elements).
- `Toolbar.ts` imports `./Toolbar.css` → esbuild bundles into `dist/webview.css`.

## Host wiring (hexViewer.ts)

1. Create `const toolbar = new Toolbar({ onViewChange: switchView, onAsciiToggle: () => setShowAscii(!getShowAscii()), onEditStart, onSave, onCancel })`.
2. Inject `toolbar.toHtml()` into render() `#app`; call `toolbar.mount()`.
3. Register grid/search render callbacks; per-invalidation call `toolbar.setView(S.currentView)`, `setEditMode(S.editMode)`, `setAscii(getShowAscii())`, `setDirty(S.edits.size)` (replacing `setupToolbarButtons`/`setupEditButtons`/`updateEditControls`/`updateDirtyBar`).
4. `updateMemoryOnlyControls` shrinks to toolbar-agnostic (grid/sidebar visibility only); search-box visibility moves to `searchBar.setVisible`, toolbar memory-gating internal to `setView`.

## SearchBar visibility (record view)

- SearchBar is its own component (slot-in to `#toolbar`), unaware of the current view. Host toggles its visibility on view switch: **SearchBar gains `setVisible(bool)`** (component-encapsulated DOM; toggles `#search-box` display) — host `switchView` calls `searchBar.setVisible(v === 'memory')`. Toolbar does not write SearchBar's DOM (no cross-component writes).
- Ctrl+F keeps focusing the hidden input in record view (existing no-op), unchanged.

## Tests
- `src/test/webview/components/toolbar.test.ts` (mocha + jsdom + css-import-hook): pure render (tabs w/ active state, ASCII button memory-gated, edit button hidden while editing, EDITING group shown in edit mode, dirty count + save disabled), callbacks (view/ascii/edit/save/cancel report), setters (setView GsetEditMode/setAscii/setDirty), SearchBar slot included, idempotent mount surviving re-render.