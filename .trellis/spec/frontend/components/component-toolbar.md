# Component Spec — Toolbar

> Built from `component-template.md`. Owns the top toolbar chrome as a self-contained presentational component.

## Scope / Trigger

Owns `src/webview/components/toolbar/toolbar.ts` + `toolbar.css`: the `#toolbar` element (view tabs Memory/Records, ASCII toggle, edit-mode group Edit/Save/Cancel/dirty count). Host owns all state (`S.currentView`, `S.editMode`, edits), edit/save/cancel logic, and view switching.

Boundary rule: the component owns markup, transient button active/edit-group state, and styles. It never reads/writes `S`, never posts provider messages, never runs edit logic — it reports clicks and renders host-pushed state.

## Layout

```text
src/webview/components/toolbar/
    toolbar.ts       types + pure render fn + controller class
    toolbar.css      toolbar chrome rules (moved from styles/toolbar.css)
src/webview/hexViewer.ts     host wiring (callbacks + setters)
src/test/webview/components/toolbar.test.ts   (mocha + jsdom)
```

## Contract

```typescript
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
    ascii: boolean;        // ASCII button active (memory view)
    editMode: boolean;     // Edit hidden / EDITING group shown
    dirtyCount: number;    // #edit-dirty-count text + Save disabled
}

export function renderToolbarHtml(searchBarHtml: string, state: ToolbarRenderState): string;  // pure
export class Toolbar {
    constructor(cb?: ToolbarCallbacks);
    setCallbacks(cb: ToolbarCallbacks): void;
    mount(): void;                                   // idempotent, document-delegated
    setView(v: ToolbarView): void;                   // active tab + memory-only gating (ascii/edit-group)
    setEditMode(on: boolean): void;                  // Edit hidden / EDITING group shown
    setAscii(on: boolean): void;                     // ASCII button active class
    setDirty(count: number): void;                   // #edit-dirty-count text + Save disabled (count===0)
setStatus(message: string): void;                // transient #edit-status message; auto-clears after 3s
}
```

## Rules

- **Report-only:** every button click → callback; component never mutates `S`, never posts `saveEdits`, never runs edit/undo logic.
- **Host state via setters:** host calls `setView`/`setEditMode`/`setAscii`/`setDirty` on invalidation; component owns transient active/edit-group classes derived from them.
- **Memory gating is internal to `setView`:** `applyMemoryGating` shows ascii button + Edit (mem && !editMode) / EDITING group (mem && editMode), and re-applies the ASCII `active` class on every view change (re-entry from record must not lose it).
- **Dirty:** `setDirty(count)` sets `#edit-dirty-count` (empty at 0, else "N unsaved byte(s)") and Save `disabled = count===0`.
- **Responsive:** `#toolbar` scrolls horizontally (`overflow-x: auto`) when content exceeds the width; the search input shrinks (flex `0 1 180px`, `min-width: 70px`) before the fixed nav buttons/select so narrow webviews never clip the rightmost controls.
- **SearchBar slot:** `toHtml()` embeds `${searchBar.toHtml()}` — SearchBar is its own component, mounts independently, doc-delegated. Toolbar never writes SearchBar DOM.
- **SearchBar visibility:** host calls `searchBar.setVisible(view==='memory')` on switch (component-encapsulated `#search-box`); Toolbar unaware.
- **Re-render:** `mount()` idempotent; `toHtml()` regenerates from state each full render; per-invalidation host uses lightweight setters, not full toolbar re-render.
- Markup byte-identical to pre-refactor (ids/classes listed in Behaviour); untrusted text escaped with `esc()`.
- Zero `S` import; no `postProviderMessage`; no size/layout math in TS (CSS owns it).

## Behaviour

- `.view-tabs` > `#btn-mem`/`#btn-rec` (Memory/Records) with `active` class on current view.
- `.tb-sep`.
- `#btn-ascii-toggle` (`.tb-ascii-btn`) active only in memory view + ascii on.
- `#btn-edit-mode` (`.tb-edit-btn`) visible when memory && !editMode.
- `#edit-mode-group` (EDITING pill `.tb-editing-pill`, `#edit-dirty-count`, `#edit-status` transient status, `#btn-save` `.tb-save-btn`, `#btn-cancel` `.tb-cancel-btn`) visible when memory && editMode; Save disabled when dirtyCount===0.
- `#load-progress` (`role="status"`, `hidden`) — host-owned load-progress indicator rendered in the toolbar; toggled by host, not a component state.
- SearchBar output embedded as the trailing slot.

## Validation & Error Matrix

| Condition | Behaviour |
|---|---|
| Record view | ASCII + edit buttons/groups hidden; search hidden (via SearchBar.setVisible); tabs active. |
| Memory re-entry with ascii on | ASCII button shown AND `active` (re-applied by `applyMemoryGating`). |
| Edit mode on | Edit hidden, EDITING group shown, Save/Cancel visible. |
| dirtyCount 0 | `#edit-dirty-count` empty, Save disabled. |
| dirtyCount N | "N unsaved byte(s)" text, Save enabled. |

## Tests Required

`src/test/webview/components/toolbar.test.ts` (mocha + jsdom + cssImportHook): pure render (tabs active, ASCII memory-gated, edit hidden while editMode, EDITING group, dirty + save disabled, SearchBar slot), callback reports (view/ascii/edit/save/cancel), setters (setView/setEditMode/setAscii/setDirty), ASCII active survives record→memory re-entry, idempotent mount. Existing `webview.test.ts` toolbar/edit assertions pass unchanged (parity gate).

## Anti-patterns

- Component reading `S`/`state.ts` or posting provider messages.
- Host writing toolbar button DOM directly (must use setters).
- Duplicated memory-gating predicate (render fn + setters + gating) — single `applyMemoryGating` owner.
- Folding stats bar or external-change banners into Toolbar (separate elements).
- Toolbar writing SearchBar's DOM (search visibility lives in SearchBar).
