# Component Spec — Struct Panel

## Scope / Trigger

Owns `src/webview/components/sidebar/structPanel/structPanel.ts` (+ `structPinsModel.ts`) + `structPanel.css`: the sidebar Struct panel — both tracks (pins/instances + types/editor). The component owns all panel markup, expansion state, bit-field allocation toggle, editor draft state, pin add/edit state, field-value menus, pointer follow/create, and the bit-layout toggle. It never reads/writes the `S` global and never posts provider messages: data is pushed via setters, byte reads go through the injected `readByte` accessor, and actions report via callbacks.

Host (`hexViewer.ts`) owns: `S` state, struct/pin persistence (`saveStructs`/`saveStructPins`), selection, endian, bit-field allocation, hex-view highlight, and jumps.

## Layout

```text
src/webview/components/sidebar/structPanel/
    StructPanel.ts         interaction controller: mount/render/setData/setEndian/setBitFieldAllocation/setSelection/setTabActive/resetViewState
    structPinsModel.ts     pure pin-model helpers (makeStructPin, withEditedStructPin, upsertPointerStructPin, ...)
    structPanel.css        all panel rules (moved verbatim from styles/struct.css)
src/webview/hexViewer.ts   host wiring (panel descriptor, applyStructs/applyPins/applyStructState, selectStructRangeHost, highlight)
src/test/webview/components/sidebar/structPanel/structPanel.test.ts   (mocha + jsdom)
```

Panel shell (`sidebar/sidebar.ts`) and shared `.sb-section`/`.sb-body`/`.sb-badge`/`.sb-empty` stay in `sidebar/sidebar.ts`/`sidebar/sidebar.css`. `core/structCodec.ts` is pure and shared; mixed-endian overrides extend it with per-field/per-struct `endian`/`allocation` resolution (threaded effective values, pointer-global exception, `DecodedField.endian`/`allocation` resolved indicators) — the panel consumes the resolved row values for badges and passes the same effective values into bit-unit binary rendering.

## Contract

```typescript
interface StructCallbacks {
    readByte: (addr: number) => number | undefined;        // required — host memory adapter
    onStructsChange?: (structs: StructDef[]) => void;      // save/delete struct
    onPinsChange?: (pins: StructPin[]) => void;            // add/edit/delete/pointer-create pin
    onStateChange?: (structs: StructDef[], pins: StructPin[]) => void;  // both at once (e.g. delete struct cascades pins)
    onSelectRange?: (start: number, count: number) => void; // struct row/range selection → host S.selStart/S.selEnd + jumpTo + inspector
    onHighlightHex?: (addrs: number[], cls: string) => void; // hover/array-sep class on hex rows
    onClearHighlightHex?: (cls: string) => void;
}

class StructPanel {
    constructor(cb: StructCallbacks);
    mount(root: HTMLElement): void;                          // renders both tracks; idempotent
    render(): void;                                          // was renderStructPins; re-renders from pushed state
    setData(structs: StructDef[], pins: StructPin[]): void;  // host pushes S.structs/S.structPins
    setEndian(endian: 'le' | 'be'): void;                    // decode source
    setBitFieldAllocation(alloc: BitFieldAllocation): void;  // 'lsb' | 'msb'
    setSelection(start: number | null): void;                // was onSelectionChangeForStruct
    setTabActive(active: boolean): void;                     // host pushes sidebarTab==='struct'
    resetViewState(): void;                                  // was resetStructViewState
}
```

## Rules

- Component holds only UI/transient state (expansion Sets, `_fieldValTypes`, `_activeStructAddr`, add/edit-form flags, `_applyStructId`, bit-range selection, `_tabActive`). Persistent/domain state lives in the host.
- Reads no `S`, writes no `S`; data pushed via setters; actions report via callbacks. `readByte` is injected (host passes `getByte` from `memory/memoryData`) so byte access stays host-owned — the component must NOT import `memory/memoryData`.
- Struct/pin mutations report `onStructsChange`/`onPinsChange`/`onStateChange`; the host syncs `S` + persists (`saveStructs`/`saveStructPins`). Selection → `onSelectRange`; hex-row highlight/array separators → `onHighlightHex`/`onClearHighlightHex`. The host applies them through the HexView paint seam (`memoryGrid.paintStructHighlight`/`paintClearStructHighlight` → `HexView.paintStructHighlight`/`paintClearStructHighlight`, root-scoped) — never a host `[data-addr]` DOM poke.
- `S.activeStructAddr` was removed from `state.ts` (had no external push/read sites); the component keeps `_activeStructAddr` internally.
- Markup is byte-identical to pre-refactor (same ids/classes); all CSS moved verbatim from `styles/struct.css`. Untrusted text escaped with `esc()`.
- Pin model helpers stay pure and unit-tested (`structPinsModel.ts`); no DOM, no `S`.

## Behaviour

- Pins track: add-pin form (hex address, struct picker), instance cards (expand/collapse `›` chevron, always-visible Edit/View-type/Delete actions, delete w/ inline confirm), decoded rows incl. scalar/array/struct/bitfield/pointer rows + pointer follow/create; bit-layout LSB/MSB toggle reporting each explicit switch via `onBitAllocationChange` (host persists `saveBitAllocation` into the bound profile; the host push via `setBitFieldAllocation` stays authoritative on refresh, e.g. profile switch/external edit). The Instances `＋ Add` header button is disabled when no struct types exist (tooltip "No struct types defined").
- Types track: type list, struct editor (name/packed/fields incl. bit-fields, arrays, pointers, move/delete), with an `Edit` / `Preview` segmented tab bar (`.se-tabs.compact-tabs`, `role=tablist`) at the top of the editor: the form (name, struct default, field header, `#se-fields`, Add Field, inline error, Save/Cancel) lives in `.se-view[data-se-view=edit]` and the C preview in `.se-view[data-se-view=preview][hidden]`. Switching views is attribute-only (toggles `active`/`aria-selected` on the tabs and `hidden` on the views, ArrowLeft/ArrowRight + Enter/Space; never a re-render), so draft state and the section-body scroll position are preserved; the editor always opens on `Edit`. The preview has NO fixed `max-height` and no inner scroll — its syntax-highlighted C code flows in the section body and scrolls with it, wrapping long lines (`white-space: pre-wrap; overflow-wrap: anywhere`). Pointer declaration is a visible per-field `*` toggle button in a dedicated `Ptr` column (9-column editor grid) with the per-field context-menu path ("Attach pointer"/"Clear pointer") kept as a secondary route; a `void`-typed field is pointer-active by default and cannot have pointer stripped, bit-field container rows show the button disabled, and the button active state mirrors `data-ptr`/`editorRowIsPointer`. The Types `＋ Add` header button opens the new-type editor (disabled while an editor is open); there is no in-body "New type" button and no `←` back button.
- Hex-view selection clears stale struct selection and syncs add/edit-form address inputs (`setSelection`); the `S.sidebarTab === 'struct'` guard is replaced by `setTabActive`.
- Row/header click selects the corresponding byte range → `onSelectRange`; hover highlights hex rows via callback.
- Field-value context menus: sticky `View as` per row identity, `Copy as`, pointer jump/create — all report-only.
- Per-field/per-struct endian (`LE`/`BE`) + allocation (`LSB`/`MSB`) overrides: struct editor shows tri-state selects (`Auto`/`LE`/`BE` endian + `Auto`/`LSB`/`MSB` allocation; `Auto` = inherited). Controls keep a neutral background regardless of selection — no tint on explicit selections; the `Auto` option's `title` shows the inherited source (e.g. `Auto — inherits BE`). Struct-level `Endian`/`Alloc` gather into a grid-aligned `.se-struct-default-row` sharing the field grid columns: the Packed toggle sits in the Type column (shortened `packed` label, full `__attribute__((packed))` in `title`), a "struct default" label fills the Name column, and `#se-endian` / `#se-alloc` sit in the Endian/Alloc columns; per-field editor column headers read `Endian`/`Alloc`. The field-level `Alloc` select renders **only on bit-field container rows** (unsigned scalar with named `bitFields`, non-pointer); plain scalar, pointer, and struct-typed rows emit an empty placeholder cell so the grid stays aligned — a nested struct's bitfield allocation is overridden on the nested `StructDef`'s own struct-level Alloc, not on the referencing field. Field-level `Endian` selects render on every row. Decoded rows + bit-unit parent headers render an explicit-override chip when the effective value differs from the global overlay; bit-unit chips appear only on the parent value row — bit child rows and pointer header rows never chip (pointer rows resolve the inherited field/struct endian, not the global overlay, but render no chips). Value cells render with the row's resolved endian/allocation, not the global overlay. Long nested-struct names in the type select truncate with the full name in `title`.

## Validation & Error Matrix

| Condition | Behaviour |
|---|---|
| Empty pins, no types | "Define a struct type first." empty state; Instances `＋ Add` disabled |
| Empty pins, types exist | "No instances yet" empty state |
| Empty types | "No types defined yet" empty state |
| Pin address invalid/partial/overflow | Rejected (`parseStructPinAddressInput` → null) |
| Struct editor invalid (name/count/type/bitfield) | Inline `se-error`; no `onStructsChange` |
| Pointer target unmapped | `(unmapped)` status, no arrow/expansion |
| Selected range disappears after remap | Selection cleared, no stale state |
| Missing bytes | `??`; never decode as zero |

## Tests Required

`src/test/webview/components/sidebar/structPanel/structPanel.test.ts`: mount (both tracks + empty states), `setData` renders instance cards + decoded rows + expansion persistence, `setEndian` re-decode, `setBitFieldAllocation` re-render + LSB/MSB toggle + toggle persistence report (`onBitAllocationChange`), row click → `onSelectRange`, pointer follow/create → `onSelectRange` + `onPinsChange`, editor save → `onStructsChange`, C preview, delete cascade → `onStateChange`, add/edit/delete pin → `onPinsChange`, `setSelection` → add-form address, plus the deep-render suite (array headers, offsets, pointers, bit-field grouping, copy formats, byte order), Edit/Preview tab switching (draft preserved across views), scroll-preserving incremental edits. `structPinsModel.test.ts` (import re-point) + `webview.test.ts` struct suites pass unchanged (parity gate).

## Common Mistakes

- **Stale derived bit-editor state after a text-edit.** The `+ Add bit` button's disabled state derives from the container's remaining bits (sum of child `bitWidth` vs `typeByteSize * 8`). Editing a child's width in place calls `syncEditorDraft` + `refreshEditorPreview`, but `refreshEditorPreview` only re-renders `#se-preview` — it never rebuilds the row-set, so any control whose state is computed during `refreshFieldRows`/`bitChildrenHtml` stays stale. Width edits must therefore call `refreshBitChildAddButton(draft, row)` (updates the button's `disabled`/`title` in place without losing input focus). Example regression scenario: u8 container with children 3+5 (container full, button disabled) → shrink the first child to 1 (total 6) → button must enable immediately, without save/reopen.
- **Re-capping array counts.** Array element count is intentionally unlimited (see `struct-model.md`). The count input keeps only a non-digit strip; do not add `maxlength`, `slice(0, N)`, or `Math.min` back to `fieldArrayCellHtml` / the `.sfe-count-inp` handler / `readEditorArrayCount`.

## Anti-patterns

- `StructPanel.ts` importing `S`, `state.ts`, `postProviderMessage`, `memory/memoryData`, or `rerender`.
- Component poking `[data-addr]` hex rows directly (must use `onHighlightHex`).
- Host mutating `S.structs`/`S.structPins` without a `setData` push.
- Global-DOM-id queries outside the component root.
- Weakening `structPanel.test.ts` assertions during the extraction (parity gate).
