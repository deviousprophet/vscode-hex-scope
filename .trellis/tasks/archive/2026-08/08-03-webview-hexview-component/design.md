# Design — HexView component extraction

## Component contract

```ts
// src/webview/components/HexView/HexView.ts

interface HexViewRow {
    address: number;
    kind: 'data' | 'gap';
    cells: HexViewCell[];              // data rows only; one per byte
    gap?: { from: number; to: number; bytes: number };  // gap rows only
    banners?: HexViewBanner[];         // segment labels above the row
}
interface HexViewCell {
    hex: string;                       // two-hex glyph
    char: string;                      // decoded-text glyph
    cls: string;                       // base byte class only: bn|bz|bp|bh|be|bd
    val?: number;                      // byte value → data-val attribute (paintCell restore source)
}
interface HexViewBanner { name: string; start: number; length: number; color: string; }
interface HexViewRange { start: number; end: number }

interface HexViewRenderInput {
    rows: readonly HexViewRow[];       // the visible slice (host-computed)
    rowOffset: number;                 // index of rows[0] in the full list (host accounting/spacers)
    totalHeight: number;               // full content height (px)
    windowTop: number;                 // wrapper vertical offset (px) — host virtual-scroll anchor
    matchSet: ReadonlySet<number>;
    selection: HexViewRange | null;    // host-owned; component paints it
    showAscii?: boolean;               // default true = hex + decoded-ASCII columns (single-view parity)
}

interface HexViewCallbacks {
    onHover?: (addr: number) => void;
    onLeave?: () => void;
    onColumnHover?: (col: number) => void;
    onColumnLeave?: () => void;
    onSelectionChange?: (range: HexViewRange | null) => void;   // drag report
    onCellClick?: (addr: number, shift: boolean) => void;
    onCellContext?: (addr: number, x: number, y: number) => void;
    onCopy?: (range: HexViewRange) => void;
    onVisibleWindowChange?: (scrollTop: number) => void;         // scroll → host recomputes slice
}

export function renderHexViewHtml(input: HexViewRenderInput): string;   // pure
export class HexView {
    constructor(rootSelector: string, cb: HexViewCallbacks = {});
    setCallbacks(cb: HexViewCallbacks): void;
    mount(): void;                                                       // idempotent, document-delegated
    paintSelection(range: HexViewRange | null): void;                    // host → incremental class paint
    paintMatch(addrs: readonly number[], index: number): void;
    scrollTo(addr: number): void;
    paintCell(addr: number, previewText: string | null): void;           // nibble-edit preview; null clears (.editing)
}
```

## Instance scoping (diff-compatible)

- The component never uses global DOM ids (`#mem-rows`, `#mem-header`). Every query/event dispatch is scoped to the instance's root: constructor takes a `rootSelector` (single view passes `'#memory-view'`; diff later passes two panel roots). Listener targets are resolved via `root.querySelector*`.
- `renderHexViewHtml` output is injected into the root by the host. `mount()` attaches document-delegated listeners that filter to `rootSelector` matches — two instances (diff panels) coexist without collision.
- Single-instance today; multi-instance cost is just passing a selector. No mirror/side/`a`/`b` features are added now (diff is a separate future feature).

## Rendering (pure function)

- `renderHexViewHtml(input)` builds: **column header** (hidden address gutter + 00..0F hex cells + "Decoded text" column gated by `showAscii`) + **rows** (data rows with addr gutter + hex cells + char cells, gap rows, segment banners). Header is part of the component markup (shares cell classes/CSS with body); host does not render it separately.
- Header columns: address gutter + 00..0F hex header cells render **always** (hex column always present, `.data-cell[data-col]` reused for header). `showAscii:false` gates only the char cells and the "Decoded text" header label. Header `.data-cell` cells carry no `data-addr` → interaction selectors (which target `[data-addr]`) exclude them naturally.
- Header scroll sync: `mount()` keeps the sticky header's `scrollLeft` in sync with body horizontal scroll (current `syncHeaderScroll` behavior), scoped to the component root.
- **Row positioning (container-wrapper, current parity):** the rows container gets the full virtual height (`#mem-rows` `position`/`height` from virtual-scroll layout); one inner wrapper is pushed down by `top: windowTop` (host-computed offset), rows inside flow normally. No per-row absolute positioning. Diff view may switch to per-row absolute positioning in its own task.
- Spacers (host-computed top/bottom padding) preserve the slice's vertical alignment inside the full-height container.
- **Gap rows + banners are in-flow row content (current parity):** a `HexViewRow` of `kind:'gap'` renders `.gap-row`; a data row with `banners` renders `.seg-banner`(s) above `.data-row` in flow. Virtual-scroll row-height accounting stays host-side exactly as today (uniform data-row height, gap rows taller; banners add in-flow height as they do now — reproduced, not "fixed").
- Spacers (host-computed top/bottom padding) preserve the slice's vertical alignment inside the full-height container.
- ASCII column: `showAscii` (default `true`) renders the decoded-ASCII char cells + "Decoded text" header; `showAscii:false` renders addr + hex only. `showAscii:true` must render byte-identical markup/classes to the current single view. Diff view later passes `showAscii:false`.
- **Single-view ASCII toggle (small feature):** host adds a single **ASCII** button in the memory view toolbar with an active/pressed state that flips the render input `showAscii` between `true` and `false`. Default `true` (byte-identical to current single view). Component stays presentational — it only honors the `showAscii` input; host owns the button + state.
- Per-cell class compositing at render time: base `cls` (bn/bz/bp/bh/be/bd) + `match` (from `matchSet`, empty `be` cells excluded) + `sel` (from `selection`, empty excluded) + `col-hi`-capable hooks. Editing/dirty/integrity/struct classes are inputs on `cls` (host computes these — they are data-driven, not transient). Applied to both hex and char cells.
- Empty (`be`) cells: model = `{hex:' ', char:' ', cls:'be', val:undefined}`; render emits `data-col` only, **no** `data-addr`/`data-val`, `aria-hidden`, and excludes match/sel/hover/drag targets — exactly current behavior.
- Addresses rendered uppercase 8-wide hex; `data-addr`/`data-col`/`data-val` attributes preserved (interaction + host hooks rely on them); char cells carry `data-addr` too (host `lastClickColumn` needs to distinguish hex vs char targets).
- **Zero size math in the component:** all column/row sizing comes from CSS (moved memory-view.css + base.css tokens: `--cell-size`, `--text-cell-width`, `.cell-group` `4n+1` group gaps, `.data-row` height). Component emits cells in order with no inline size styles — exact current parity. Diff view later overrides sizing via its own CSS.
- **Scroll + virtualization ownership (A):** the component owns the scroll container and its scroll listener; on scroll it calls `onVisibleWindowChange(scrollTop)` (host callback). Host computes the visible slice via `render/virtualScroll.ts` (shared with record view) and feeds a new render input. Component does not import virtualScroll math. Host also measures CSS row/gap heights and syncs virtual-scroll metrics exactly as today.
- All untrusted text escaped with `esc()`.

## Interaction (controller class)

- `mount()` attaches document-delegated listeners (mousedown/mousemove/mouseup, mouseover/mouseout, keydown, contextmenu), guarded idempotent, filtered to `rootSelector`.
- Hover: paints `.cell-hover` transiently, reports `onHover(addr)` + `onColumnHover(addr & 0xF)`. Hover applies to hex and char cells alike.
- Column hover: header cells + cell hover both drive `.col-hi` paint on matching cells + header; reports.
- Drag selection: mousedown on a `[data-addr]` cell anchors; mousemove extends to element-from-point address; reports `onSelectionChange({start,end})`. Does NOT write `S`. mouseup clears drag state (keeps last reported range in host).
- Click: `onCellClick(addr, e.shiftKey)` — host computes shift-expand vs replace using `S`.
- Context: `onCellContext(addr, e.clientX, e.clientY)` — host decides select-if-outside + shows menu.
- Copy: Ctrl/Cmd+C while drag selection active → `onCopy(range)`; skips when typing in editable targets.
- Transient paints (hover, col-hi, drag range) are component-internal; `paintSelection`/`paintMatch`/`scrollTo` are host-invoked state repaints.
- Nibble-edit preview: host calls `paintCell(addr, 'D-')` on first typed nibble, `paintCell(addr, null)` on clear (escape/selection change/commit). Component owns the `.editing` class + `textContent` mutation; host never writes component cell DOM directly (no `dataCellAt`/`dataset.val` reads). `paintCell(null)` restores the cell text from its own `data-val` (rendered from `HexViewCell.val`).

## Host wiring (hexViewer.ts)

1. Build render input from `S` + `render/virtualScroll.ts`: visible slice of `S.memRows`, offsets, total height. Feed via `renderHexViewHtml` (or component-internal repaint on invalidation).
2. Callbacks:
   - `onCellClick` → existing `selectByteFromClick` equivalent (shift-expand) → `updateByteSelection`.
   - `onCellContext` → `selectByteForContextMenu` equivalent + `showCtxMenu(x,y)`.
   - `onSelectionChange` → drag applies selection (host `S` + `applySel` repaint) — reuses current `setupMemoryDragSelection` handler body.
   - `onCopy` → `doCopySelection` (collect + post copyText).
   - hover/column → transient, no host state (component-internal paint only; host may ignore or mirror later).
3. Replace `renderMemHeader`/`renderMemBody`/`applySel`/`applyMatchHighlights`/`scrollTo` imports with component equivalents; delete `memory/dragSelection.ts`, `memory/selectionClick.ts`; keep `memory/memoryData.ts` + `memory/selection.ts` (shared host data/state).
4. Nibble-edit typing (hexViewer.ts) unchanged: reads cells via `data-addr`/`data-val` in component DOM, calls `stageIntegrityEdit`, then `paintSelection`/repaint.

## CSS

- Move `src/webview/styles/memory-view.css` rules verbatim → `src/webview/components/HexView/HexView.css`; delete the styles/ file. `HexView.ts` does `import './HexView.css'`.
- esbuild already emits bundled `dist/webview.css` (from SearchBar work); no build change.

## Search engine touch

- `searchEngine.ts` currently imports `applyMatchHighlights, applySel, scrollTo` from `memory/memoryView`. After extraction these become host-provided component actions: host passes `paintMatch`/`scrollTo`/selection repaint into the search glue (or search glue calls host `rerender` seams). Signature of `runSearch` unchanged.

## Tests

- `src/test/webview/components/hex-view.test.ts` (mocha + jsdom, css-import-hook): pure render (header, data rows, gap rows, banners, `showAscii` true/false with `true` byte-identical to current, selection/match/col-hi paint, container-wrapper positioning incl. `windowTop` + spacers), interaction reports (hover, column hover, drag range, click+shift, context, copy shortcut, empty-cell exclusion), paint methods (`paintSelection`, `paintMatch`, `scrollTo`), root-scoped instance queries (no global ids).
- Existing `webview.test.ts` grid assertions must still pass unchanged (parity gate).

## Rollback

- Rewrite of most complex module — keep component extraction in one commit. `git revert` restores `memoryView.ts`/`dragSelection.ts`/`selectionClick.ts`/`memory-view.css` and host wiring.
