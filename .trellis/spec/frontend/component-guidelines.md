# DOM Rendering and Interaction Modules

## Rendering Model

The webview uses TypeScript modules that generate HTML strings and attach DOM listeners. `src/webview/hexViewer.ts` is the composition root. Rendering owners include:

- `components/HexView/HexView.ts` (+ `memory/memoryGrid.ts` host controller): virtualized memory header/body and selection paint.
- `recordView.ts`: parsed-record table.
- `sidebar/sidebar.ts` and `sidebar/inspector/index.ts`: sidebar shell, labels, segments, Inspector.
- `sidebar/integrity/index.ts`: integrity cards and actions.
- `sidebar/struct/index.ts`: struct editor, pins, decoded instance rows.
- `contextMenuController.ts`: menu lifecycle; `contextCommands.ts`: command results.

## Required Pattern

1. Pure/core code computes data or action results.
2. A model transition updates `S` or feature-owned state.
3. The caller requests explicit invalidations/rerenders.
4. Rendering escapes untrusted/user text with `esc()` from `src/webview/utils.ts`.
5. Listener setup happens after rendering and is owned by the rendering module or composition root.

`src/webview/webviewMessageModel.ts` demonstrates the model/effect split: each provider message returns `WebviewInvalidations`; `hexViewer.ts` applies DOM effects.

## Self-Contained Components

A component under `src/webview/components/<Name>/` owns its markup, UI state, input behaviours, and styles as one unit. Contract (see [SearchBar Component](./component-search-bar.md)):

- `toHtml()` returns markup; `mount()` attaches document-delegated listeners idempotently (survives host re-renders); feedback setters (`setCount`, `setBusy`, …) let the host push data in.
- The component holds its UI state internally, seeded via constructor options. It never reads or writes the `S` global and never calls feature/engine functions directly — it reports through callbacks the host wires.
- The host syncs shared state from callbacks (e.g. `S.searchMode`/`S.searchEndianness` in `onSearch`) when other renderers depend on it.
- Component CSS is imported by the component's `.ts` and bundled via esbuild; global CSS (tokens/resets/layout) stays in `src/webview/styles/`.
- A component extraction is behavior-preserving: UI gestures the pre-refactor code only used to update shared state must not start triggering new actions.

## Rerender Registry

`src/webview/render/registry.ts` breaks a real circular dependency between feature modules and the composition root. `hexViewer.ts` assigns:

- `rerender.memory`
- `rerender.labels`
- `rerender.toMemory`
- `rerender.jumpTo`

Add a callback only when two modules genuinely require the seam. Keep callback signatures narrow; do not put state mutation into the registry.

## Interaction Rules

- DOM click/context-menu handlers must call feature/model functions instead of duplicating state changes.
- Hover is transient; selection is persistent. Do not reuse one state field for both.
- Context-menu opening selects only where the explicit feature contract requires it; struct rows intentionally do not select on menu open.
- Keyboard paths must reach the same action owner as mouse paths.
- Large memory rendering stays virtualized through `render/virtualScroll.ts`; never render the entire address space.
- Component CSS is imported from the component's `.ts` (`import './<Name>.css'`) — see [SearchBar Component](./component-search-bar.md). Shared/global CSS stays under `src/webview/styles/` (tokens, resets, layout); it does not contain component-specific rules once that component is extracted.

## Accessibility

- Interactive non-native rows need keyboard focus, key handlers, and visible focus state.
- Buttons use native `<button>` where possible.
- Tooltips must have accessible text equivalents.
- Focus state and selected state are distinct.
- See `struct-instance-display.md` for the strict struct-row contract.

## Anti-patterns

- Inline event behavior that mutates `S` differently from the model function.
- Unescaped struct names, labels, profile names, source lines, or error text in HTML.
- Full-page rerender when a narrow invalidation exists.
- Pure helper extraction that leaves orchestration bugs untested and reduces locality.
- New DOM module with no owning stylesheet/test or no clear interface.

## Test Anchors

- `src/test/webview/webview.test.ts`: memory/record/sidebar/virtual-scroll behavior.
- `src/test/webview/struct-ui.test.ts`: complex row rendering and actions.
- `src/test/webview/webview-message-model.test.ts`: model/invalidation split.
- `src/test/webview/utils.test.ts`: escaping and formatting.
