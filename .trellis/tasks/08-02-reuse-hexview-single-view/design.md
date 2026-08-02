# Design: Reuse HexViewComponent in single hex view

Task: `08-02-reuse-hexview-single-view` · Branch: `feat/reuse-ui-components-single-view` · Base: `main`

## 1. Architecture

```text
               HexViewComponent (shared, ui-components/hex-view/)
               virtualization-agnostic grid renderer
   hex + char cells, gap rows, banners, selection paint, header
        ▲                                        ▲
        │ render input (rows/slice/selection/     │ render input
        │  matchSet/showChar) + callbacks         │
        │                                        │
  single-view host                         diff host
  memoryView.ts + virtualScroll           hexDiffViewer.ts + virtualScroll
  (edit, drag, ctx-menu, inspector,       (viewMode filter, diff-run/search
   search, record-switch)                 highlight, swap)
```

- Component owns: grid HTML (hex/char/gap/banner/selection), header (addr/hex/decoded), CSS, selection/hover/copy intents.
- Host owns: virtual scroll (slice + position), editing, drag, context menu, inspector, search, record switch, `S` state.
- Component renders the rows array it is given — never computes scroll; host feeds slice + `windowTop`/spacers.

## 2. Row Model (Phase 1 — generalize)

```typescript
interface HexViewCell { hex: string; char: string; cls: string; }
interface HexViewRow {
    address: number;
    kind: 'data' | 'gap';
    cells: HexViewCell[];            // data rows only (BPR cells)
    gap?: { from: number; to: number; bytes: number };   // gap rows
    banners?: { name: string; start: number; length: number; color: string }[];
}
interface HexViewRenderInput {
    label?: string;
    rows: readonly HexViewRow[];
    rowOffset: number;               // absolute position of rows[0]
    searchRowIndex: number;
    matchSet: ReadonlySet<number>;
    error?: string | null;
    totalHeight: number;
    selection?: HexViewRange | null; // painted from host state (Q7)
    showChar: boolean;               // Q9: decoded-text header + char cells
}
```

- Diff host maps `DiffVisualRow` -> `HexViewRow` (hex from `cell.byte`, char unused when `showChar` false, `statuses` -> `cls`).
- Single-view host maps `S.memRows` -> `HexViewRow` (1:1; gap rows -> `kind:'gap'`; labels -> `banners`).
- `renderHexViewComponentHtml(side, input)` stays pure; cell markup keeps `data-addr`/`data-col`/`data-val` + `.data-cell`/`.char-cell` so host handlers (edit, drag, ctx-menu) attach unchanged (Q10).
- Header: addr + hex column indices + (when `showChar`) decoded-text column label. Replaces single-view `mem-header`; host scrolls the container and the component header scrolls with it (host keeps horizontal `scrollLeft` sync on the container).

## 3. Virtualization (Phase 2 — diff; Phase 3 — single view already wired)

- Both hosts use `render/virtualScroll.ts` per `frontend/virtual-scroll.md`:
  - host computes `[startIdx, endIdx)` via `calcVisibleRange`, `totalHeight`/`layout` via `calcScrollLayout`.
  - non-compressed: rows in flow + exact spacers above/below.
  - compressed: single absolutely-positioned window at `calcCompressedWindowTop(startIdx, state, layout)` = `(offset / logicalScrollable) * physicalScrollable` (anchor invariant — never `physicalHeight/totalHeight`).
  - `state.scrollTop` is LOGICAL; rerender preserves logical position (physical->logical old, logical->physical new).
- Diff: one `VirtualScrollState`, uniform `getRowHeight = () => DIFF_ROW_HEIGHT`. `viewMode === 'diff'` filters `shownRows()` to diff rows BEFORE slicing; both panels (a/b) render the same slice with the same `windowTop`. `swap` stays host-side (class flip + request).
- Single view: existing wiring kept, but the row-height getter now measures component rows (`rowHeight`/`gapHeight`/`bannerHeight` label-aware) — unchanged metric, fed to `virtualScroll`.

## 4. State Ownership

- Component: none besides transient interaction; reports `onSelectionChange(range)`, `onHover(addr)`, `onCopy(range)`.
- Host (single view): `S.selStart/S.selEnd` sole selection truth; user changes -> `S` -> rerender with `selection` in input; search/jump/context-menu write `S` -> rerender paints.
- Editing state (`S.edits`, nibble buffer, `S.lastClickColumn`) stays host-side; component cells carry the same attributes/classes the host's handlers already use.

## 5. Behavior Parity Checklist (single view, must stay — Q10)

- Edit mode (#128): nibble buffer typing, decoded-text (char-column) editing, paste, fill, undo — unchanged; in-place cell mutations (nibble preview, dirty classes) don't get clobbered by renders.
- Drag selection, shift-click, context menu (address-appropriate), inspector updates, search nav + highlight, record-view switch, `S.lastClickColumn` hex-vs-char copy format.
- Gap rows + banners render identically; virtual scroll (uniform + label-aware heights) behaves per spec (no seams, no blank band, no boundary jump).
- Decoded-text header + column render (single view only).

## 6. Tests

- Component: `src/test/webview/ui-components/hex-view-component.test.ts` (moved) — extend for `HexViewRow` model, gap/banner kinds, `showChar` header+cells, selection input painting, host-compatible cell attributes.
- Diff: `src/test/webview/diff-view-model.test.ts` + new virtualization cases (viewMode filter before slicing, same slice both panels, compressed anchor on uniform rows).
- Single view: `src/test/webview/webview.test.ts` — parity (edit, drag, search highlight), virtual-scroll cases per `virtual-scroll.md`.
- Run: `npm run compile`, `npm run lint`, `npm test`, `npx fallow` 0/0/0.

## 7. Wrong vs Correct

Wrong: component computes its own scroll (duplicates virtualScroll, diff forced into it); single-view header stays host-side split from the grid; ASCII column host-rendered outside the component (row not atomic); selection owned by component (two sources); cell markup changes break host edit handlers; compressed anchor uses `physicalHeight/totalHeight`.
Correct: virtualization-agnostic component fed slices by both hosts; decoded-text header+data in component gated by `showChar`; host-compatible cell markup (Q10); selection painted from host state via render input; compressed anchor per `virtual-scroll.md`.
