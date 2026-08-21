# Component Spec — Inspector

## Scope / Trigger

Owns `src/webview/components/sidebar/inspectorPanel/inspectorPanel.ts` (+ `inspectorLabels.ts`) + `inspectorPanel.css`: the sidebar Inspector panel — Inspector address/values, Bit View (internal block), the Multi-Byte interpreter, and Segment Labels (permanent segment rows merged with editable labels, including the inline add/edit form). The component owns the two section shells, their collapse state, bit-hover highlight, label-form UI state, and interaction. It never reads/writes the `S` global and never posts provider messages: data is pushed via setters, byte reads go through the injected `readByte` accessor, and actions report via callbacks.

Host (`hexViewer.ts`) owns: `S` state, label persistence (`saveLabels` + memory rebuild + invalidation), selection, endian, segment data, and jumps.

## Layout

```text
src/webview/components/sidebar/inspectorPanel/
    inspectorPanel.ts          interaction controller: mount/setSelection/setSegments/setLabels/setEndian/syncLabelForm
    inspectorLabels.ts    DOM-free label markup/validation helpers (labelItemHtml, labelFormHtml, range parsing, LABEL_COLORS)
    inspectorPanel.css         panel rules (insp-*, bit-*, mi-*, segment-*, label-*, lf-*)
src/webview/hexViewer.ts  host wiring (panel descriptor, applyInspectorLabels, pushInspectorState)
src/test/webview/components/sidebar/inspectorPanel/inspectorPanel.test.ts   (mocha + jsdom)
```

Panel shell (`sidebar/sidebar.ts`) and shared `.sb-section`/`.sb-body`/`.sb-badge`/`.sb-empty` stay in `sidebar/sidebar.ts`/`sidebar/sidebar.css`.

## Contract

```typescript
interface InspectorCallbacks {
    readByte: (addr: number) => number | undefined;        // required — host memory adapter
    onJumpTo?: (address: number) => void;                  // segment/label row click
    onLabelsChange?: (labels: SegmentLabel[], segmentNames?: Record<string, string>) => void;  // any label mutation; segmentNames rides the same channel
    onCopy?: (text: string, label: string) => void;        // copy chip
    onLabelDraftChange?: (draft: LabelDraftPreview | null) => void;  // live form draft → host grid preview; null clears
}

class InspectorPanel {
    constructor(cb: InspectorCallbacks);
    mount(root: HTMLElement): void;                        // renders 4 sections; idempotent
    setSelection(start: number | null, end: number | null): void;   // data path (was updateInspector)
    setSegments(segments: SerializedSegment[]): void;      // was renderSegments
    setLabels(labels: SegmentLabel[], segmentNames?: Record<string, string>): void;  // was renderLabels
    setEndian(endian: 'le' | 'be'): void;                  // multi-byte re-decode
    syncLabelForm(): void;                                 // hex-view selection → live-update open label form
}
```

## Rules

- Component holds only UI/transient state (section collapse via the shared `SidebarSections` framework, sticky bit-block collapse, bit-hover column, label-form draft/range-mode/pendingWarning/lastFocused/rename, stored labels/segments/segmentNames/selection/endian). Persistent/domain state lives in the host.
- Reads no `S`, writes no `S`; data pushed via setters; actions report via callbacks. `readByte` is injected so byte access stays host-owned.
- `setSelection` is the `updateInspector` parity path only; `syncLabelForm` is the `updateLabelFormSel` parity path and is host-driven from hex-view selection (not from match navigation or struct-field selection).
- Label mutations report `onLabelsChange`; the host persists (`saveLabels`) and invalidates (memory + labels rerender). Confirm-on-warning is component UI state.
- Collapse toggle is the shared `SidebarSections` whole-header control (two sections: `insp`, `labels`); the internal Bits block uses its own local `.sb-inner-toggle` disclosure.
- Markup is stable per the form contract in `inspectorLabels.ts` (same ids/classes); visual restyles change class rules, not the ids. Untrusted text escaped with `esc()`.

## Behaviour

- Default: Inspector expanded, Labels collapsed (slim 22px header packed to the bottom of the pane view). Bit View lives inside the Inspector section as an internal sticky-collapsible block (auto-expands on new selection unless the user collapsed it this mount). Segments are merged into Labels as permanent (non-deletable) rows; no separate Segments section.
- Selection paints address/vals (+ copy chips), the merged byte line (displays first ≤8 bytes + ellipsis; click copies the FULL selection — matching the "Click to copy N bytes" tooltip; the ellipsis is never copied), bit rows, and the multi-byte interpreter (`[LE/BE · N-byte]` context tag); `setEndian` re-decodes the interpreter (LE/BE).
- Labels: visibility toggle, edit/delete (delete via inline confirm), row-click → `onJumpTo`; rows address-sorted (no manual reorder); every row shows `0xSTART–0xEND · SIZE`; add/edit form with name/start/range (End Address | Size·Length modes via a shared `.compact-tabs` switch above the field, default **End Address**)/color swatches; a read-only auto-calc chip shows the counterpart (size in End mode, end address in Length mode); validation errors inline; out-of-mapped-data and overlap warnings require a second Save to confirm. Pinned segment rows are permanent but name-only renamable via ✎ → an inline name editor replaces the row's name span (autofocus + select; Enter commits, Escape reverts, blur commits; blank or matching the parsed name clears the override). Name overrides are keyed by start address (decimal string) and persist through `onLabelsChange`/`saveLabels` (`segmentNames` map); renamed rows show the override with the parsed name as tooltip.
- Color swatches are `<button type="button" class="lf-swatch">` with a selection ring and `aria-pressed` (active swatch `true`, others `false`). Esc cancels the form; Enter (from an input) submits; the first field autofocuses on open.
- The form reports a live draft range via `onLabelDraftChange` on every input/mode-switch/swatch change (invalid/partial input or rename mode reports `null`); `renderLabels()` (any labels rerender, incl. cancel/save) is the teardown choke point that clears the preview.
- Hex-view selection updates an open label form's start/range (`syncLabelForm`). Auto-fill fires only on selection changes, never keystrokes; the last-focused field receives the fill — Start focused fills Start (+ Range per mode); Range focused auto-switches to End addr mode and fills the selection end. Rename-mode forms ignore selection changes.

## Validation & Error Matrix

| Condition | Behaviour |
|---|---|
| Empty labels | "No labels defined" empty state |
| Empty segments | "No segments" empty state |
| No selection | "Click a byte to inspect"; bits "—" |
| No data at address | "No data at this address" |
| Label save, invalid start/range/name | Inline error; no `onLabelsChange` |
| Label save overlapping/outside mapped data | Warning inline; first Save holds, second confirms |
| Endian toggle | Multi-byte cards re-decode |

## Tests Required

`src/test/webview/components/sidebar/inspectorPanel/inspectorPanel.test.ts`: mount (2 sections, empty states), `setSelection` single + multi (chips, byte line, bit rows, multi-byte), `setEndian` re-decode, `setSegments` (merged permanent rows/badge/jump), `setLabels` (rows/badge/jump), visibility/delete, add form save + validation + confirm-on-warning, edit form, bits sticky-collapse + remount reset, labels collapse/expand in the pane view. Existing `webview.test.ts` inspector/endian/tab-round-trip/segments suites pass unchanged (parity gate).

## Anti-patterns

- `inspectorPanel.ts` importing `S`, `state.ts`, `postProviderMessage`, or feature modules.
- `setSelection` also driving the label form (parity drift — `syncLabelForm` is host-driven from hex-view selection only).
- Global-DOM-id queries outside the component root.
- Duplicate collapse-toggle logic (use the shared `SidebarSections` whole-header control; internal blocks only where nested, e.g. Bits).
