# Implement — Struct self-contained component

Task: `.trellis/tasks/08-04-webview-struct-panel-component`. Behavior-preserving extraction at the sidebar panel seam (parent design locked; no re-litigation).

## Preconditions
- Branch `feat/webview-struct-component` (checked out). lint/check-types/webview tests green before.

## Checklist

1. **Create `src/webview/components/Struct/StructPanel.ts`** — component class with `mount(root)` rendering both tracks, `render()` (was `renderStructPins`), `setData`, `setEndian`, `setBitFieldAllocation`, `setSelection` (was `onSelectionChangeForStruct`), `setTabActive`, `resetViewState`. Port code verbatim from `sidebar/struct/index.ts`: pins/instances track (add form, cards, decoded rows incl. bit units/arrays/pointers, field-value menus, pointer follow/create), types track (type list, editor with C preview, bit-field allocation toggle). All module-level mutable state (`_expanded`, `_addingPin`, `_editingType`, `_selectedBitRange`, `_fieldValTypes`, etc.) becomes instance fields. Imports stay: utils (`esc`, `actionBtnsHtml`, `wireActionBtns`, `formatDecimal`, `formatHex`, `getBigUint64`, `getBigInt64`, `asUint64`, `positionContextMenu`, `wireHoverSubmenus`), `decodeStruct`/`DecodedField` from `core/struct-codec.js`. Byte access is injected via the required `readByte` callback (host passes `getByte` from `memory/memoryData`); the component must NOT import `memory/memoryData`.
2. **Move `sidebar/struct/structPinsModel.ts`** → `components/Struct/structPinsModel.ts` (pure, unchanged). Update its importers + `struct-pins-model.test.ts`.
3. **Create `src/webview/components/Struct/Struct.css`** — move all rules from `styles/struct.css`; `import './Struct.css'`.
4. **Rewire host `hexViewer.ts`**
   - `const structPanel = new StructPanel({ readByte: getByte, onStructsChange, onPinsChange, onStateChange: applyStructState, onSelectRange, onHighlightHex, onClearHighlightHex });`
   - `applyStructState` = `S.structs = structs; S.structPins = pins;` + `postProviderMessage({type:'saveStructs',structs})` + `postProviderMessage({type:'saveStructPins',pins})` (persistence moved out of `structPersistence.ts`).
   - `onSelectRange(start, count)` = `S.selStart = start; S.selEnd = start + count - 1; rerender.jumpTo(start); rerender.inspector();`.
   - `onHighlightHex(addrs, cls)` / `onClearHighlightHex(cls)` = hex-row class apply/remove on `[data-addr]` (moved `highlightAddress` logic to host or a host-owned helper).
   - Panel descriptor `{ id: 'struct', label: 'Struct', mount: root => structPanel.mount(root) }`.
   - Replace `renderStructPins()` (7×) → `structPanel.render()`; `onSelectionChangeForStruct()` → `structPanel.setSelection(S.selStart)`; `resetStructViewState` → `structPanel.resetViewState()`; struct data pushes → `structPanel.setData(S.structs, S.structPins)`; endian/bit-alloc → `structPanel.setEndian(S.endian)` / `structPanel.setBitFieldAllocation(S.bitFieldAllocation)`.
5. **Delete moved code**: `sidebar/struct/index.ts`, `sidebar/struct/structPersistence.ts` (after confirming no remaining imports; update `hexViewer.ts` imports + any test imports of `renderStructPins`/`onSelectionChangeForStruct`/`resetStructViewState`).
6. **Tests** `src/test/webview/components/struct.test.ts` (see design.md); update `struct-pins-model.test.ts` import path; `struct-ui.test.ts` import of `renderStructPins` re-pointed to the component.
7. **Validate**
   - `npm run lint`, `npm run check-types`, `npm run compile-tests`.
   - `npx mocha --ui tdd "out/test/webview/**/*.test.js"` (webview.test.ts struct parity + struct-ui + struct-pins-model + struct.test.ts).
   - `npm test` (full).
   - Fallow: `total_issues 0`, `findings 0`, `clone_groups 0`.

## Review gates
- `rg "renderStructPins|onSelectionChangeForStruct|resetStructViewState" src/webview/hexViewer.ts` — empty (all on `structPanel.`).
- `rg "S\.|postProviderMessage|rerender" src/webview/components/Struct/Struct.ts` — empty.
- `sidebar/struct/index.ts` + `structPersistence.ts` deleted; `styles/struct.css` deleted or emptied.
- Markup/behavior parity: webview.test.ts struct/pin/bit/pointer suites + struct-ui.test.ts + struct-pins-model.test.ts pass unchanged.

## Rollback
- One commit; `git revert` restores inline rendering + host calls + struct.css rules.
