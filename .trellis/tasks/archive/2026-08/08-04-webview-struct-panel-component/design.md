# Design — Struct self-contained component

## Component contract

```typescript
// src/webview/components/Struct/StructPanel.ts
interface StructCallbacks {
    /** Required — host memory adapter for byte reads (keeps byte access host-owned, like Inspector's readByte). */
    readByte: (addr: number) => number | undefined;
    /** Any struct-definition mutation (save/delete struct) → host persists + syncs. */
    onStructsChange?: (structs: StructDef[]) => void;
    /** Any pin mutation (add/edit/delete/pointer-create) → host persists + syncs. */
    onPinsChange?: (pins: StructPin[]) => void;
    /** Both changed in one action (e.g. delete struct cascades pins). */
    onStateChange?: (structs: StructDef[], pins: StructPin[]) => void;
    /** Struct row/range selection → host sets S.selStart/selEnd + rerender.jumpTo + rerender.inspector. */
    onSelectRange?: (start: number, count: number) => void;
    /** Hover/arr-sep highlight on hex rows: apply/clear class at address range. */
    onHighlightHex?: (addrs: number[], cls: string) => void;
    onClearHighlightHex?: (cls: string) => void;
}

export class StructPanel {
    constructor(cb?: StructCallbacks);
    mount(root: HTMLElement): void;                    // idempotent doc-delegated; renders both tracks
    render(): void;                                    // was renderStructPins; re-renders pins track + types track
    setData(structs: StructDef[], pins: StructPin[]): void;  // both (host pushes S.structs/S.structPins)
    setEndian(endian: 'le' | 'be'): void;              // decode source
    setBitFieldAllocation(alloc: BitFieldAllocation): void;  // 'lsb' | 'msb'
    setSelection(start: number | null): void;          // was onSelectionChangeForStruct
    setTabActive(active: boolean): void;               // host pushes sidebarTab==='struct' (guards add/edit-form address sync; component cannot read S)
    resetViewState(): void;                            // was resetStructViewState
}
```

`StructDef` / `StructPin` / `BitFieldAllocation` from `core/types`; `DecodedField` from `core/struct-codec.js` (unchanged).

> Contract deviations from an earlier draft (documented for reviewers): individual `setStructs`/`setPins` setters and `onActiveAddrChange` were dropped as unreferenced — host uses combined `setData`, and `S.activeStructAddr` had no external push sites on main so it was removed from `state.ts` (component keeps `_activeStructAddr` internally). `setTabActive` was added to replace the old `S.sidebarTab !== 'struct'` guard.

## Ownership split

The component owns both tracks and all their UI state:
- **Pins track** (`si-panel-track`, instances side): add-pin form, instance cards (header/actions/edit-form/type-preview/decoded body), decoded rows incl. bit units + arrays + pointer groups, expansion state (`_expanded`, `_expandedArrayFields`, `_expandedArrayElements`), selection state (`_selectedBitRange`, `_hoveredBitRange`, `_selectedBitRowKey`, `_hoveredBitRowKey`, `_selectedFieldAddr`, `_selectedArrKey`, `_selectedArrElemKey`, `_selectedPinId`), field-value menus, pointer follow/create.
- **Types track** (`si-showing-types` side): type list, editor (`se-*` form: name/packed/fields/bit-fields/array counts/C preview), draft state (`_editingType`, `_managingTypes`, `_applyStructId`), bit-field allocation toggle (`sa-btn-bit-lsb`/`msb`).

Data flows in via setters; the component never imports `S`, `state.ts`, `postProviderMessage`, `structPersistence`, `memory/memoryData`, or `rerender`. Util imports (`esc`, `actionBtnsHtml`, `wireActionBtns`, `formatDecimal`, `formatHex`, `getBigUint64`, `getBigInt64`, `asUint64`, `positionContextMenu`, `wireHoverSubmenus`) stay; byte access is injected via the required `readByte` callback (host passes `getByte`). Pure helpers `structPinsModel.ts` move under `components/Struct/`.

Cross-boundary outputs:
- Selection of a struct range (`selectStructRange`/`selectStructFieldRow`/`followPointer*`/`selectPointerTarget`) → `onSelectRange(start, count)`; host sets `S.selStart/selEnd` + `rerender.jumpTo` + `rerender.inspector`.
- Hex-row highlight (`highlightAddress`, `markArraySeparators`, `wireStructHoverRange`) → `onHighlightHex(addrs, cls)` / `onClearHighlightHex(cls)`.
- Persistence (`persistStructs`/`persistStructPins`/`persistStructState`) → `onStructsChange`/`onPinsChange`/`onStateChange`; host persists.

## Host wiring (hexViewer.ts)

1. `const structPanel = new StructPanel({ onStateChange: applyStructState, onStructsChange: applyStructs, onPinsChange: applyPins, onSelectRange: selectStructRangeHost, onHighlightHex: ... });`
   - `applyStructState(structs, pins)`: `S.structs = structs; S.structPins = pins; postProviderMessage({type:'saveStructs',structs}); postProviderMessage({type:'saveStructPins',pins});` (persist logic moved from `structPersistence.ts`).
   - `selectStructRangeHost(start, count)`: `S.selStart = start; S.selEnd = start + count - 1; rerender.jumpTo(start); rerender.inspector();` (moved from struct module).
2. Panel descriptor: `{ id: 'struct', label: 'Struct', mount: root => structPanel.mount(root) }`.
3. Replace call sites:
   - `renderStructPins()` (7×) → `structPanel.render()`.
   - `onSelectionChangeForStruct()` → `structPanel.setSelection(S.selStart)`.
   - `resetStructViewState` → `structPanel.resetViewState()`.
   - struct data refresh sites → `structPanel.setData(S.structs, S.structPins)` (data push after full render / external change).
   - endian/bit-alloc sync → `structPanel.setEndian(S.endian)`; `structPanel.setBitFieldAllocation(S.bitFieldAllocation)`.
4. Delete `sidebar/struct/index.ts`, `structPersistence.ts` (host owns persistence now); update `hexViewer.ts` imports.

## CSS

- `components/Struct/Struct.css` = all rules moved verbatim from `styles/struct.css`.
- `import './Struct.css'` in `Struct.ts`; bundled via esbuild.

## Tests

`src/test/webview/components/struct.test.ts` (mocha + jsdom + css-import-hook):
- render: mount(root) renders pins track + types track; empty states.
- struct definitions: editor opens/saves via `onStructsChange`; C preview renders; delete cascades pins via `onStateChange`.
- pins: add form validates (`parseStructPinAddressInput`), add/edit/delete → `onPinsChange`; address input from `setSelection`.
- decoded rows: `setData` renders instance cards + decoded rows + bit units; expansion persists across re-render.
- bit layout: toggle reports/updates; `setBitFieldAllocation` re-renders.
- selection: row click → `onSelectRange`; pointer follow/create → `onSelectRange` + `onPinsChange`.
- Parity: existing `struct-ui.test.ts`, `struct-pins-model.test.ts`, `webview.test.ts` struct suites pass unchanged.

## Rollback

One commit; `git revert` restores `sidebar/struct/` inline rendering + host calls + `styles/struct.css` rules.
