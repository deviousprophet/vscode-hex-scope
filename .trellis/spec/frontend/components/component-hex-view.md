# Component Spec — HexView

> Built from `component-template.md`. Owns the memory hex-grid as a self-contained presentational component.

## Scope / Trigger

Owns `src/webview/components/hexView/` (`hexView.ts` interaction controller, `hexViewRender.ts` pure render layer, `hexViewPaint.ts` DOM paint utilities, `hexView.css`): the virtualized hex-grid (column header, data rows, gap rows, segment banners) as a pure presentational component. Host owns data (`S.memRows`, selection, matches, edits, integrity), virtual-scroll math, and all domain decisions.

Boundary rule: the component owns markup, transient interaction, and styles. It never reads/writes `S`, never calls feature/engine functions, never posts provider messages — it reports through callbacks and paints host-invoked state.

## Layout

```text
src/webview/components/hexView/
    hexView.ts          interaction controller class + HexViewCallbacks
    hexViewRender.ts    pure DOM-free render layer: types (HexViewCell/Banner/Row/Range/RenderInput), renderHexViewHeader, renderHexViewHtml, row/cell markup builders
    hexViewPaint.ts     DOM paint/match utilities: cellAddress, selectedColumns, match highlighting, paintMatchesInRoot, clearCellPreview, columnFor, copy/editable guards
    hexView.css         moved verbatim from styles/memory-view.css (bundled via esbuild)
src/webview/memory/memoryGrid.ts     host grid controller (slice computation, render-input build, vscroll state); imports class from HexView, render from HexViewRender
src/webview/hexViewer.ts             composition root: wires callbacks + ASCII toggle; imports HexViewRange from HexViewRender
src/test/webview/components/hexView.test.ts   (mocha + jsdom)
```

## Contract

```typescript
interface HexViewCell {
    hex: string;                  // two-hex glyph
    char: string;                 // decoded-text glyph
    cls: string;                  // hex-cell classes: byte class (bn/bz/bp/bh/be/bd) + host dirty/integrity
    charCls?: string;             // char-cell classes: cp|cd + host dirty/integrity/edit-placeholder
    val?: number;                 // byte value → data-val attr (paintCell restore source); undefined = empty
}
interface HexViewBanner { name: string; start: number; length: number; color: string; }
interface HexViewRow {
    address: number;
    kind: 'data' | 'gap';
    cells: HexViewCell[];         // data rows only; one per byte
    gap?: { from: number; to: number; bytes: number };  // gap rows only
    banners?: HexViewBanner[];    // segment labels above the row
}
interface HexViewRange { start: number; end: number }

interface HexViewRenderInput {
    rows: readonly HexViewRow[];       // the visible slice (host-computed)
    topSpacer: number;                 // px, preserves slice alignment (host virtual-scroll)
    bottomSpacer: number;              // px
    compressed: boolean;               // content exceeds max physical height (virtual-scroll compression)
    containerHeight: number;           // rows-container height (px) when compressed
    windowTop: number;                 // inner-wrapper vertical offset (px) when compressed
    matchSet: ReadonlySet<number>;     // every address covered by any search match (visible only)
    selection: HexViewRange | null;    // host-owned; component paints it
    activeMatch: HexViewRange | null;  // span of the active match → `.amatch`
    showAscii?: boolean;               // default true = hex + decoded-ASCII columns (single-view parity)
}

interface HexViewCallbacks {
    onHover?: (addr: number) => void;
    onLeave?: () => void;
    onColumnHover?: (col: number) => void;
    onColumnLeave?: () => void;
    onSelectionChange?: (range: HexViewRange) => void;       // drag report (component-transient)
    onCellClick?: (addr: number, shift: boolean, column: 'hex' | 'char') => void;
    onCellContext?: (addr: number, x: number, y: number) => void;
    onCopy?: (range: HexViewRange) => void;
    onVisibleWindowChange?: (scrollTop: number) => void;      // scroll → host recomputes slice
}

export function renderHexViewHeader(showAscii?: boolean): string;  // pure
export function renderHexViewHtml(input: HexViewRenderInput): string;  // pure
export class HexView {
    constructor(rootSelector: string, cb?: HexViewCallbacks);
    mount(): void;                       // idempotent, document-delegated, root-scoped
    setCallbacks(cb: HexViewCallbacks): void;
    setScrollTop(top: number): void;     // drive scroll container (physical)
    getScrollTop(): number;
    scrollTo(addr: number): void;
    paintSelection(range: HexViewRange | null): void;      // incremental class paint
    paintMatch(matchAddrs: readonly number[], index: number, length: number): void;
    paintCell(addr: number, previewText: string | null): void;  // nibble preview; null restores from data-val
    paintStructHighlight(addrs: readonly number[], cls: string): void;   // struct-field class on cells (root-scoped)
    paintClearStructHighlight(cls: string): void;            // remove `cls` from all cells in the root
}
```

## Rules

- **Host-agnostic presentational (B):** component never imports/reads/writes `S`; no data/domain logic, no search/edit/copy, no `postProviderMessage`.
- **Host builds cells:** host loops `BPR` per row calling `getByte`, computes `byteClass`/char text/`dirty`/integrity/struct classes → fills `HexViewCell`. Component composites only match/sel/col-hi from declarative input.
- **Interaction = report:** hover/column-hover/drag-selection/click/context/copy via callbacks; host applies selection state, context menu, edits. Drag range transient in component, persistent in host `S`. The shell makes `#memory-view` focusable (`tabindex="0"`); the HOST owns arrow-key selection (ArrowLeft/Right/Up/Down ± BPR, Shift extends, gap-skipping via `walkMappedAddress`) and opens the context menu on the `ContextMenu` key / Shift+F10 — the component itself has no keyboard logic.
- **Container-wrapper positioning (current parity):** rows container full virtual height + inner wrapper `top: windowTop`; no per-row absolute. Gap rows + banners in-flow.
- **Compressed mode emits NO spacers:** `windowTop` already equals `physicalScrollTop + topSpacer - logicalScrollTop`, so the wrapper subsumes the top offset. Emitting top/bottom spacers inside the wrapper would double-offset and grow blank space above rows as the user scrolls down. Spacers are rendered only in uncompressed (in-flow) mode.
- **Virtualization:** component owns scroll listener → `onVisibleWindowChange(scrollTop)`; host computes slice via `render/virtualScroll.ts` (shared with record view) and feeds new render input. Component does not import virtualScroll math.
- **Header:** component renders it (hidden addr gutter + 00..0F hex cells always + "Decoded text" gated by `showAscii`); header scrollLeft sync is component-internal.
- **Zero size math:** all sizing from CSS (`--cell-size`, `--text-cell-width`, `.cell-group` `4n+1` gaps, `.data-row` height). No width/height computation in TS. Positioning attributes (`top: windowTop` on the wrapper, spacer heights) are host-computed values emitted as inline `style` — pre-existing parity, not size math.
- **CSS debt (documented, not new):** `hexView.css` carries ~10 `!important` rules (integrity/match/sel/col-hi overlap precedence) moved verbatim from `memory-view.css`; this exceeds css-guidelines.md's documented exception (`scripts-toolbar::before`). Known debt; dedupe/cleanup is out of scope for the parity refactor.
- **Root-scoped (single-instance today):** constructor takes `rootSelector`; the component queries only within its root. Note the shell still uses the pre-existing global ids `#memory-view`/`#mem-header`/`#mem-scroll` (single-instance webview). Diff-view two-panel reuse will need those ids turned into class-scoped root markup (a future diff task).
- **Host never writes component DOM directly:** nibble-edit preview via `paintCell(addr, text|null)`; struct-field highlight via `paintStructHighlight(addrs, cls)` / `paintClearStructHighlight(cls)` (root-scoped, class-wide clear); component owns `.editing` class + `textContent`, restores from own `data-val`. No host `querySelectorAll('[data-addr]')` pokes.
- **showAscii boolean** (default true = byte-identical current); `false` gates only char cells + "Decoded text" header label.
- Untrusted text escaped with `esc()`.

## Behaviour

- Column header: hidden `.addr-cell` group + `.cell-group` of 16 `.data-cell[data-col]` header cells (2-hex uppercase) + `.mem-hdr-decoded` "Decoded text" (gated by `showAscii`).
- Data row: `.data-row[data-row=base]` → `.cell-group` `.addr-cell` (8-hex uppercase) + hex `.data-cell[data-col][data-addr][data-val]` + `.char-cell[data-col][data-addr]`.
- Empty byte: `.data-cell.be`, no `data-addr`/`data-val`, `aria-hidden`, excluded from match/sel/hover/drag. Char: `.char-cell.cd` + `.edit-placeholder` when editable.
- Gap row: `.gap-row` with `.gap-dots`/`.gap-range`/`.gap-size`. Seg banner: `.seg-banner` inline colored, above its data row in flow.
- Empty rows state: "No data records found." placeholder.
- Selection/match: `.sel`/`.row-sel`/`.sel-col`/`.match`/`.amatch` painted from render input + `paintSelection`/`paintMatch` (multi-byte span via `length`).
- Hover/column-hover: transient `.col-hi`/hover paints, reported.
- ASCII toggle (small feature): toolbar button flips `showAscii` (default true); single **ASCII** label with an active/pressed state; host owns state, component honors input.

## Validation & Error Matrix

| Condition | Behaviour |
|---|---|
| Empty `S.memRows` | Renders "No data records found." placeholder (host feeds empty slice). |
| Unmapped byte (`be`) | Empty cell, no data-addr/data-val, aria-hidden; excluded from match/sel/hover/drag. |
| `showAscii:false` | Hex + addr only; char cells + "Decoded text" header omitted. |
| Compressed (huge file) | Container full physical height + wrapper `top: windowTop` + spacers; slice rerender on scroll. |
| Scroll during selection | Selection repainted from host state after slice rerender (`activeMatch` preserves `.amatch`). |
| Scroll past the end (compressed) | `windowTop` is clamped to `physicalHeight − sliceHeight` so the slice never overflows the fixed-height container; otherwise the scroll area grows and the scroll handler fights the browser clamp (end-of-scroll shaking). |
| Nibble preview active | `paintCell(addr, text)` shows preview; `paintCell(addr, null)` restores from own data-val. |
| Two instances (future diff) | Root-scoped listeners filter by selector; no id collisions. |

## Tests Required

`src/test/webview/components/hexView.test.ts` (mocha + jsdom + cssImportHook): pure render (header incl. `showAscii:false`, data rows, gap rows, banners, `be`/`cd` empty cells, match/sel/col-hi/amatch compositing, container-wrapper `windowTop` + spacers, root-scoped markup), interaction reports (hover, column hover, drag range, click+shift+column, context, copy shortcut, empty-cell exclusion), paint methods (`paintSelection`, `paintMatch` span, `paintCell` preview/restore, `scrollTo`), `showAscii` toggling. Existing `webview.test.ts` grid assertions pass unchanged (parity gate, via `memoryGrid`).

## Anti-patterns

- Component importing `S`/`state.ts`, engine functions, or `postProviderMessage`.
- Host writing component cell DOM directly (must use `paintCell`/`paintSelection`/`paintMatch`).
- Global DOM-id queries inside the component.
- Size/layout math in TS instead of CSS.
- Virtual-scroll math imported into the component (stays host/shared).
- Diff-view features (side, mirror, per-row absolute) added before the diff task exists.
