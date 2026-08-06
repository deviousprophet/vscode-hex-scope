# PRD — Extract Struct panel into self-contained component

## Origin
Child of `08-03-webview-component-refactor` (roadmap: Struct panel). The sidebar shell established the panel seam: host `panels` config with `{ id, label, mount(root) }`, lazy mount-once. This child deepens the struct descriptor's `mount(root)` into a real self-contained component at the same seam — no shell change.

## Problem
Struct panel logic lives in `sidebar/struct/index.ts` (4783 lines, 95 `S.` global reads) with helpers `structPinsModel.ts` (pure) and `structPersistence.ts` (posts `saveStructs`/`saveStructPins`). Panel CSS lives in `styles/struct.css` (708 lines). Host calls `renderStructPins()` (7 sites), `onSelectionChangeForStruct()`, `resetStructViewState()`; panel descriptor builds `<div id="s-struct-pins">` inline.

## Goal
Self-contained `StructPanel` component owning both tracks (pins/instances + types/editor) and all their UI state: add/edit struct definitions, C-preview, add/edit/delete pins, decoded instance rows, bit layouts, bit-field allocation toggle, expansion/collapse state, field-value menus, pointer follow/create. It never reads/writes `S`, never posts provider messages — data is pushed via setters, actions reported via callbacks. CSS moves to `components/Struct/Struct.css`.

## Scope
In:
- `src/webview/components/Struct/StructPanel.ts` (or `Struct.ts`) + `Struct.css`.
- Pure helpers `structPinsModel.ts` move under the component dir.
- Host `hexViewer.ts` rewiring: panel descriptor → `structPanel.mount(root)`; `renderStructPins()` → `structPanel.render()`; `onSelectionChangeForStruct` → `structPanel.setSelection(...)`; `resetStructViewState` → `structPanel.resetViewState()`; endian/bit-alloc/data pushed via setters; persistence moves to host callbacks.
- `styles/struct.css` content → `Struct.css`.
- Delete `sidebar/struct/index.ts` after confirming no remaining imports.

Out:
- Integrity / Scripts panels (separate child tasks).
- Sidebar shell (`Sidebar.ts`/`Sidebar.css`) unchanged.
- `core/struct-codec.ts` (pure, shared with core tests) unchanged.
- Any behavior change.

## Acceptance Criteria
- [ ] `components/Struct/Struct.ts` + `Struct.css` exist; component owns both tracks' markup, expansion state, bit-field allocation toggle, editor draft state, pin add/edit state, field-value menus, pointer follow/create; zero `S` reads/writes; no `postProviderMessage`.
- [ ] Setters push data (`setStructs`/`setPins` or `setData`, `setEndian`, `setBitFieldAllocation`, `setSelection`); callbacks report (`onStructsChange`, `onPinsChange`, `onSelectRange`, `onHighlightHex`).
- [ ] Host rewire: `renderStructPins`/`onSelectionChangeForStruct`/`resetStructViewState` gone from `hexViewer.ts`; `sidebar/struct/index.ts` deleted.
- [ ] Markup/behavior identical: struct editor round-trip, C preview, pin add/edit/delete, decoded rows + bit units, bit layout toggle, field-value menus, pointer follow/create, selection → hex highlight + jump.
- [ ] `styles/struct.css` rules moved to `Struct.css`.
- [ ] `npm run lint`, `npm run check-types`, `npm test` pass; struct test batch green (struct-ui.test.ts, struct-pins-model.test.ts, sidebar.test.ts, webview.test.ts parity); fallow 0/0/0.
- [ ] No functional/visual change in the running extension.

## Notes
- Persistence (`saveStructs`/`saveStructPins`) moves from `structPersistence.ts` into host callbacks (component must not import `postProviderMessage`).
- Hex-view highlight (`highlightAddress` on `[data-addr]`) is a cross-component DOM poke → becomes `onHighlightHex(addrs, cls)` callback the host applies.
