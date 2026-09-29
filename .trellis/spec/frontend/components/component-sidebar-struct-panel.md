# Component Spec — Struct Panel

## Scope / Trigger

Owns `src/webview/components/sidebar/structPanel/structPanel.ts` (orchestrator), its extracted render modules (`structCPreview.ts`, `structBinaryView.ts`, `structEditorFields.ts`, `structValueFormat.ts`, `structRowRenderer.ts`), `structPinsModel.ts` and `structPanel.css`: the sidebar Struct panel — both tracks (pins/instances + types/editor). The component owns all panel markup, expansion state, bit-field allocation toggle, editor draft state, pin add/edit state, field-value menus, pointer follow/create, and the bit-layout toggle. It never reads/writes the `S` global and never posts provider messages: data is pushed via setters, byte reads go through the injected `readByte` accessor, and actions report via callbacks.

Host (`hexViewer.ts`) owns: `S` state, struct/pin persistence (`saveStructs`/`saveStructPins`), selection, endian, bit-field allocation, hex-view highlight, and jumps.

## Layout

```text
src/webview/components/sidebar/structPanel/
    structPanel.ts         orchestrator: mount/render/setData/setEndian/setBitFieldAllocation/setSelection/setTabActive/resetViewState
    structCPreview.ts      C-preview token/line builders + renderStructCPreview/hydrateStructPreviews
    structBinaryView.ts    bit-span / binary rendering helpers
    structEditorFields.ts  editor field-row markup helpers
    structValueFormat.ts   decoded value formatting + copy-text helpers (owns ColType/StructRenderCtx)
    structRowRenderer.ts   decoded row/group renderers + pointer renderers
    structPinsModel.ts     pure pin-model helpers (makeStructPin, withEditedStructPin, upsertPointerStructPin, ...)
    structPanel.css        all panel rules (moved verbatim from styles/struct.css)
src/webview/hexViewer.ts   host wiring (panel descriptor, applyStructs/applyPins/applyStructState, selectStructRangeHost, highlight)
src/test/webview/components/sidebar/structPanel/structPanel.test.ts   (mocha + jsdom)
```

The extracted render modules are free functions over a narrow `StructRenderCtx` (structs/pins/endian/bit-field allocation/show-hidden/field-value types/default value type/readByte + expansion and bit-range sets); `structPanel.ts` keeps the `StructPanel` class as the orchestrator and exposes thin delegating methods so its call sites stay stable. None of the five modules import `S`, `state.ts`, `postProviderMessage`, `memory/memoryData`, or `rerender`.

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
    onBitAllocationChange?: (bitAllocation: BitFieldAllocation) => void; // global LSB/MSB toggle
    onShowHiddenFieldsChange?: (showHiddenFields: boolean) => void;      // global show-hidden toggle
}

class StructPanel {
    constructor(cb: StructCallbacks);
    mount(root: HTMLElement): void;                          // renders both tracks; idempotent
    render(): void;                                          // was renderStructPins; re-renders from pushed state
    setData(structs: StructDef[], pins: StructPin[]): void;  // host pushes S.structs/S.structPins
    setEndian(endian: 'le' | 'be'): void;                    // decode source
    setBitFieldAllocation(alloc: BitFieldAllocation): void;  // 'lsb' | 'msb'
    setShowHiddenFields(show: boolean): void;                // instance-view hidden filter
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
- The named-type kind badge is one shared primitive: `.sd-kind` / `.se-kind-badge` share the badge rule at the 10px type floor, differing only by layout modifiers (`.sd-kind` = `flex-shrink:0` in the type list; `.se-kind-badge` = `justify-self:start` in the editor default row). `.si-chip` and record-view tags remain the documented 9px dense-mark exception in `css-guidelines.md`.
- Pin model helpers stay pure and unit-tested (`structPinsModel.ts`); no DOM, no `S`.

## Behaviour

- Pins track: add-pin form (hex address, struct picker), instance cards (expand/collapse `›` chevron, always-visible Edit/View-type/Delete actions, delete w/ inline confirm), decoded rows incl. scalar/array/struct/bitfield/pointer rows + pointer follow/create; bit-layout LSB/MSB toggle reporting each explicit switch via `onBitAllocationChange` (host persists `saveBitAllocation` into the bound profile; the host push via `setBitFieldAllocation` stays authoritative on refresh, e.g. profile switch/external edit). The Instances header also carries a global **Show hidden** checkbox (`#si-show-hidden-chk`) that reports via `onShowHiddenFieldsChange` (host persists `saveShowHiddenFields`; `setShowHiddenFields` is authoritative on refresh). While it is off (default), decoded groups whose declared field resolves `hidden === true` are filtered out at the decode-to-render seam (`renderStructFieldGroups` + `renderNestedStructGroup` via `resolveStructFieldByPath`), dropping a hidden container's whole subtree; toggling it re-renders the instances in place without reopening the editor. The Instances `＋ Add` header button is disabled when no struct types exist (tooltip "No struct types defined").
- Types track: type list, **kind chooser**, and a per-kind editor. The `＋ Add` header button sets `_choosingKind` and replaces the Types body with a three-tile picker (`#sm-kind-picker`, `.sm-kind-tile[data-kind]` = `struct` / `bitfield` / `enum`, `#sm-kind-cancel`); each tile seeds that kind's draft and clears `_choosingKind`, Cancel returns to the list creating nothing, and the kind is immutable after creation. `editorHtml(draft, existing)` dispatches on `draft.kind`: `'bitfield'` → `bitFieldDefEditorHtml`, `'enum'` → `enumDefEditorHtml`, else `structEditorHtml`. `＋ Add` is disabled while an editor or the picker is open; there is no in-body "New type" button and no `←` back button.
- Types track — pure-struct editor: name/packed/endian + the field grid (type, pointer, name, per-field endian, **alloc**, **hide**, array, move, delete; **9-column** grid, no `Bits` column, no per-field bit toggle, no child bit rows). The `Alloc` column renders a per-field `Alloc` select **only** on a reusable bit-field-reference row; every other row keeps a placeholder cell so the grid stays aligned. The `Hide` column is a per-field checkbox that sets `StructField.hidden` (instance-view only; unchecked writes no key). The editor has an `Edit` / `Preview` segmented tab bar (`.se-tabs.compact-tabs`, `role=tablist`) at the top: the form (name, struct default, field header, `#se-fields`, Add Field, inline error, Save/Cancel) lives in `.se-view[data-se-view=edit]` and the C preview in `.se-view[data-se-view=preview][hidden]`. Switching views is attribute-only (toggles `active`/`aria-selected` on the tabs and `hidden` on the views, ArrowLeft/ArrowRight + Enter/Space; never a re-render), so draft state and the section-body scroll position are preserved; the editor always opens on `Edit`. The preview has NO fixed `max-height` and no inner scroll — its syntax-highlighted C code flows in the section body and scrolls with it, wrapping long lines (`white-space: pre-wrap; overflow-wrap: anywhere`). Pointer declaration is a visible per-field `*` toggle button in a dedicated `Ptr` column with the per-field context-menu path ("Attach pointer"/"Clear pointer") kept as a secondary route; a `void`-typed field is pointer-active by default and cannot have pointer stripped, bit-field-reference and enum-reference rows show the button disabled, and the button active state mirrors `data-ptr`/`editorRowIsPointer`.
- Types track — reusable bit-field types: a `kind: 'bitfield'` def is listed with an `.sd-kind` badge and `<baseType> · N children` meta; editing it dispatches to `bitFieldDefEditorHtml`/`wireBitFieldDefEditor` (name + `#se-base-type` unsigned width + `#se-bf-def-children` name/width rows, no struct field grid, no nesting). Reached only through the kind chooser's **Bit-field** tile (seeded `baseType:'uint32'` + one child); the standalone `#sm-add-bitfield-btn` action is removed. The field type picker groups scalar / Struct / **Bit-field** options (`bitfield:<id>`); a bitfield-reference row blocks the pointer toggle and is the **only** row that authors a per-field `Alloc` override (usage-scoped; all other rows keep the alignment placeholder). The `+ Add bit` button (`#se-bf-def-add`) of the bit-field form disables when the base width is fully allocated.
- Types track — enum types: a `kind: 'enum'` def is listed with the `.sd-kind` badge and `<baseType> · N entries` meta; editing dispatches to `enumDefEditorHtml` + its wiring (name + `#se-enum-base-type` unsigned width + `#se-enum-entries` name/value rows with `#se-enum-add` / `.sfe-enum-del-entry` / move, inline `.se-error` range validation that blocks Save). Reached only through the kind chooser's **Enum** tile (seeded `baseType:'uint8'` + one entry); the standalone `#sm-add-enum-btn` action is removed. The field type picker adds an **Enum** optgroup (`enum:<id>`); each bit-field child row (inline and def editors) gains an optional enum picker (`.sfe-bf-child-enum`). Enum-typed fields block the pointer toggle and show no alloc override.
- Hex-view selection clears stale struct selection and syncs add/edit-form address inputs (`setSelection`); the `S.sidebarTab === 'struct'` guard is replaced by `setTabActive`.
- Row/header click selects the corresponding byte range → `onSelectRange`; hover highlights hex rows via callback.
- Field-value context menus: sticky `View as` per row identity, `Copy as`, pointer jump/create — all report-only.
- Per-field/per-struct endian (`LE`/`BE`) overrides: the pure-struct editor shows a tri-state struct-level `Endian` select (`Auto`/`LE`/`BE`, `Auto` = inherited, `#se-endian`) and a per-field `Endian` select on every row (`.sfe-endian-sel`). Controls keep a neutral background regardless of selection — no tint on explicit selections; the `Auto` option's `title` shows the inherited source (e.g. `Auto — inherits BE`). The struct-level `Endian` sits in a grid-aligned `.se-struct-default-row` sharing the field grid columns: the Packed toggle sits in the Type column (shortened `packed` label, full `__attribute__((packed))` in `title`), a "struct default" label fills the Name column. The pure-struct form authors **no struct-level** allocation override (`#se-alloc` is gone) and no `Bits` column; a per-field `.sfe-alloc-sel` is authored **only** on a reusable bit-field-reference row (every other row keeps an alignment placeholder cell). Legacy `allocation` values on loaded fields/defs stay intact through save and still drive decode, and the `hidden` flag is authored by the per-field `Hide` checkbox (instance-view only). Decoded rows + bit-unit parent headers still render an explicit-override chip when the effective endian/allocation differs from the global overlay (a per-field alloc is authored on bit-field-reference rows; struct-level and other-field allocation values are JSON/import-only now); bit-unit chips appear only on the parent value row — bit child rows and pointer header rows never chip (pointer rows resolve the inherited field/struct endian, not the global overlay, but render no chips). Value cells render with the row's resolved endian/allocation, not the global overlay. Long nested-struct names in the type select truncate with the full name in `title`.

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

`src/test/webview/components/sidebar/structPanel/structPanel.test.ts`: mount (both tracks + empty states), `setData` renders instance cards + decoded rows + expansion persistence, `setEndian` re-decode, `setBitFieldAllocation` re-render + LSB/MSB toggle + toggle persistence report (`onBitAllocationChange`), row click → `onSelectRange`, pointer follow/create → `onSelectRange` + `onPinsChange`, editor save → `onStructsChange`, C preview, delete cascade → `onStateChange`, add/edit/delete pin → `onPinsChange`, `setSelection` → add-form address, plus the deep-render suite (array headers, offsets, pointers, bit-field grouping, copy formats, byte order), Edit/Preview tab switching (draft preserved across views), scroll-preserving incremental edits, the kind chooser (three tiles, cancel creates nothing, no standalone add-bitfield/add-enum actions), the 9-column pure-struct grid with an `Alloc` select on bit-field-reference rows only (placeholder elsewhere; no bit toggle/Bits column), the Alloc override authoring/save round-trip, the Hide checkbox round-trip, the hidden-field render filter (default omit, `setShowHiddenFields` reveal, in-place toggle preserving focus/scroll, hidden bit-field container hides children, hidden nested leaf), the composition of hidden + reusable bit-field ref + enum in one instance, the parity golden (instance view + C preview byte-identical with unused features), the bit-field/enum def forms save, and the Instances `Show hidden` toggle reporting `onShowHiddenFieldsChange`. `structPinsModel.test.ts` (import re-point) + `webview.test.ts` struct suites pass unchanged (parity gate), plus the provider seam (`showHiddenFieldsChanged` invalidation re-drives the panel).

## Common Mistakes

- **Stale derived bit-field-def state after a text-edit.** The `#se-bf-def-add` (`+ Add bit`) button's disabled state derives from the bit-field def's remaining bits (sum of child `bitWidth` vs `typeByteSize * 8`). Editing a child's width in place calls `syncEditorDraft` + `refreshEditorPreview`, but `refreshEditorPreview` only re-renders `#se-preview` — it never rebuilds the row-set, so any control whose state is computed during the row render stays stale. Width/base-type edits must therefore call `refreshBitFieldDefAddButton` (updates the button's `disabled`/`title` in place without losing input focus). Example regression scenario: u8 def with children 3+5 (full, button disabled) → shrink the first child to 1 (total 6) → button must enable immediately, without save/reopen.
- **Re-capping array counts.** Array element count is intentionally unlimited (see `struct-model.md`). The count input keeps only a non-digit strip; do not add `maxlength`, `slice(0, N)`, or `Math.min` back to `fieldArrayCellHtml` / the `.sfe-count-inp` handler / `readEditorArrayCount`.
- **Re-introducing inline bit-field authoring into the pure-struct form.** The pure-struct field grid is 9 columns (Type/Ptr/Name/Endian/Alloc/Hide/[ ]/move/del) and authors no bit toggle, no child bit rows, and no `Bits` column. The `Alloc` select is authored **only** on a reusable bit-field-reference row (all other rows render a placeholder cell); never restore a struct-level `#se-alloc` or a per-field alloc on non-reference rows. Inline containers load via migration → reusable types; keep decode-only support for legacy inline shapes, not editor markup.

## Anti-patterns

- `structPanel.ts` (or any module under `structPanel/`) importing `S`, `state.ts`, `postProviderMessage`, `memory/memoryData`, or `rerender`.
- Component poking `[data-addr]` hex rows directly (must use `onHighlightHex`).
- Host mutating `S.structs`/`S.structPins` without a `setData` push.
- Global-DOM-id queries outside the component root.
- Weakening `structPanel.test.ts` assertions during the extraction (parity gate).
