# Design — Inspector self-contained component

## Component contract

```typescript
// src/webview/components/Inspector/Inspector.ts
type InspectorSelection = { start: number | null; end: number | null };

interface InspectorCallbacks {
    /** Segment/label row click → host jumps (rerender.jumpTo). */
    onJumpTo?: (address: number) => void;
    /** Any label mutation (add/edit/delete/move/visibility) → host persists + invalidates. */
    onLabelsChange?: (labels: SegmentLabel[]) => void;
}

export class Inspector {
    constructor(cb?: InspectorCallbacks);
    mount(root: HTMLElement): void;                    // idempotent doc-delegated; renders 4 sections
    setSelection(start: number | null, end: number | null): void;  // data path (was updateInspector + updateLabelFormSel)
    setSegments(segments: SerializedSegment[]): void;  // was renderSegments
    setLabels(labels: SegmentLabel[]): void;           // was renderLabels
    setEndian(endian: 'le' | 'be'): void;              // multi-byte re-decode source
}
```

`SegmentLabel` / `SerializedSegment` come from `core/types` (unchanged).

## Ownership split

The component owns the four section shells and all their UI state:
- **Inspector** (`#s-insp`): address/vals markup, copy chips, collapsible section state.
- **Bit View** (`#s-bits`): single/multi byte bit rows, column-hover highlight, collapse state.
- **Multi-byte interpreter** (`#insp-multi`): width selection, LE/BE decode (from stored endian), copy wires.
- **Segments** (`#s-segments`): sorted segment list, badges, collapse, click/keyboard navigation → `onJumpTo`.
- **Labels** (`#s-labels`): badge, item rows (visibility/move/edit/delete), row-click jump → `onJumpTo`; inline add/edit form (name/start/range-mode len|end/color swatches), validation + confirm-on-warning, live update from selection.

Data flows in via setters; the component never imports `S`, `state.ts`, `postProviderMessage`, or feature modules. `esc`, `fmtB`, `actionBtnsHtml`/`wireActionBtns` stay as util imports. `LabelState` is the `S.labels` element type (imported from `core/types`).

## Host wiring (hexViewer.ts)

1. `const inspector = new Inspector({ onJumpTo: addr => rerender.jumpTo(addr), onLabelsChange: applyInspectorLabels });`
   - `applyInspectorLabels(labels)`: `S.labels = labels; postProviderMessage({type:'saveLabels',labels}); buildMemRows(); rerender.labels(); if (S.currentView==='memory') rerender.memory();` (moved from sidebar.ts `persistLabelsAndRender`/`applyLabel`).
2. Panel descriptor: `{ id: 'inspector', label: 'Inspector', mount: root => inspector.mount(root) }`.
3. Replace call sites:
   - `updateInspector()` (11×) → `inspector.setSelection(S.selStart, S.selEnd)`.
   - `updateLabelFormSel()` (2×) → folded into `setSelection`.
   - segments invalidation effect → `inspector.setSegments(S.parseResult?.segments ?? [])`.
   - `rerender.labels = () => inspector.setLabels(S.labels)`.
   - struct tab effect `renderLabels` → `inspector.setLabels(S.labels)`.
   - `setFileEndian`/init → `inspector.setEndian(S.endian)`.
4. Delete `renderInspectorSections`; delete `sidebar.ts` and `sidebar/inspector/index.ts` once empty.

## CSS

- `components/Inspector/Inspector.css` = panel-content rules claimed from `styles/sidebar.css`: `.insp-*`, `.bit-*`, `.mi-*`, `.segment-*`, `.label-*`, `.lf-*`, `#s-insp/#s-bits/#s-segments/#s-labels` content rules. Shared `.sb-section/.sb-hdr/.sb-body`/`.sb-badge`/`.sb-empty` stay in `Sidebar.css` (shell-owned).
- `import './Inspector.css'` in `Inspector.ts`; bundled via esbuild.

## Tests

`src/test/webview/components/inspector.test.ts` (mocha + jsdom + css-import-hook):
- render: 4 sections from mount(root); labels/segments/bits empty states.
- `setSelection`: paints `#insp-vals` (single + multi), bit rows, multi-byte cards; `setEndian` re-decodes (LE vs BE uint16).
- `setSegments`: rows + badge; item click → `onJumpTo`; collapse persists across re-set.
- `setLabels`: rows + badge; visibility/move/delete → `onLabelsChange`; row click → `onJumpTo`; add/edit form opens, validation errors, confirm-on-warning, save → `onLabelsChange`.
- Parity: existing `webview.test.ts` inspector/endian/tab-round-trip + segments suites pass unchanged.

## Rollback

One commit; `git revert` restores `sidebar.ts`/`inspector/index.ts` inline rendering + host calls + sidebar.css rules.
