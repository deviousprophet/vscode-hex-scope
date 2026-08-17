# Component Spec — Inspector

## Scope / Trigger

Owns `src/webview/components/sidebar/inspectorPanel/inspectorPanel.ts` (+ `inspectorLabels.ts`) + `inspectorPanel.css`: the sidebar Inspector panel — Inspector address/values, Bit View, the Multi-Byte interpreter, Parsed Segments, and Segment Labels (including the inline add/edit form). The component owns the four section shells, their collapse state, bit-hover highlight, label-form UI state, and interaction. It never reads/writes the `S` global and never posts provider messages: data is pushed via setters, byte reads go through the injected `readByte` accessor, and actions report via callbacks.

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
    onLabelsChange?: (labels: SegmentLabel[]) => void;     // any label mutation
    onCopy?: (text: string, label: string) => void;        // copy chip
}

class InspectorPanel {
    constructor(cb: InspectorCallbacks);
    mount(root: HTMLElement): void;                        // renders 4 sections; idempotent
    setSelection(start: number | null, end: number | null): void;   // data path (was updateInspector)
    setSegments(segments: SerializedSegment[]): void;      // was renderSegments
    setLabels(labels: SegmentLabel[]): void;               // was renderLabels
    setEndian(endian: 'le' | 'be'): void;                  // multi-byte re-decode
    syncLabelForm(): void;                                 // hex-view selection → live-update open label form
}
```

## Rules

- Component holds only UI/transient state (collapse per section in DOM `dataset.collapsed`, bit-hover column, label-form draft/range-mode/pendingWarning, stored labels/segments/selection/endian). Persistent/domain state lives in the host.
- Reads no `S`, writes no `S`; data pushed via setters; actions report via callbacks. `readByte` is injected so byte access stays host-owned.
- `setSelection` is the `updateInspector` parity path only; `syncLabelForm` is the `updateLabelFormSel` parity path and is host-driven from hex-view selection (not from match navigation or struct-field selection).
- Label mutations report `onLabelsChange`; the host persists (`saveLabels`) and invalidates (memory + labels rerender). Confirm-on-warning is component UI state.
- Collapse toggle is one shared `applyCollapsibleSection(sec, defaultCollapsed)` helper used by all five sections.
- Markup is byte-identical to pre-refactor (same ids/classes). Untrusted text escaped with `esc()`.

## Behaviour

- Default: Inspector + Segments expanded, Bit View + Labels collapsed (pre-refactor parity).
- Selection paints address/vals (+ copy chips), bit rows, and the multi-byte interpreter; `setEndian` re-decodes the interpreter (LE/BE).
- Segments sort by start address; item click/keyboard Enter/Space → `onJumpTo`.
- Labels: visibility toggle, move up/down, edit/delete (delete via inline confirm), row-click → `onJumpTo`; add/edit form with name/start/range (length|end modes)/color swatches; validation errors inline; out-of-mapped-data and overlap warnings require a second Save to confirm.
- Hex-view selection updates an open label form's start/range (`syncLabelForm`).

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

`src/test/webview/components/sidebar/inspectorPanel/inspectorPanel.test.ts`: mount (4 sections, empty states), `setSelection` single + multi (chips, raw dump, bit rows, multi-byte), `setEndian` re-decode, `setSegments` (sort/badge/jump/collapse-preserve), `setLabels` (rows/badge/jump), visibility/move/delete, add form save + validation + confirm-on-warning, edit form. Existing `webview.test.ts` inspector/endian/tab-round-trip/segments suites pass unchanged (parity gate).

## Anti-patterns

- `inspectorPanel.ts` importing `S`, `state.ts`, `postProviderMessage`, or feature modules.
- `setSelection` also driving the label form (parity drift — `syncLabelForm` is host-driven from hex-view selection only).
- Global-DOM-id queries outside the component root.
- Duplicate collapse-toggle blocks (use `applyCollapsibleSection`).
