# Hex View Component Code-Spec

Reusable single-panel hex grid (filename label + 00..0F header + address gutter + byte cells) with its own hover / selection-reporting / column interaction. Host-agnostic row model (`HexViewRow`): the host feeds the slice it wants rendered plus selection/match data; the component owns markup + CSS + transient interaction. Powers the diff view (`src/webview/ui-components/hex-view/hexViewComponent.ts`, `showChar:false`) and the single memory view (Phase 3 of `08-02-reuse-hexview-single-view`).

## 1. Byte-cell design (approved final)

A byte cell carries a **base class** (value/status) plus **combo classes** (hover / column / selection / match). The diff view collapses all differences into one `bd` class; the single view's value classes are kept for parity/reuse.

### Base classes
| class | meaning | style |
|---|---|---|
| `bn` | byte-normal | `color: var(--fg)` |
| `bz` | byte-zero | `color: var(--zero-color)` |
| `bp` | byte-print | `color: var(--print-color)` |
| `bh` | byte-highlight | `color: var(--high-color)` |
| `be` | byte-empty | `color: var(--non-graphic); cursor: default` |
| `bd` | byte-diff (changed/added/removed collapsed) | `color: #ff6b6b; background: rgba(255,90,90,.10)` |

### Combo rules (exact)
- **Hover** — normal cells: `:hover` → `background: var(--hover-bg)`. Diff cells: `bd.cell-hover` / `bd.cell-mirror` → `background: rgba(255,90,90,.16)` (a red lift, no ring). Cross-panel mirror on normal cells: `cell-mirror` → inner ring `box-shadow: inset 0 0 0 1px rgba(255,255,255,.45)`.
- **Column hover** — `.col-hi` → faint white `rgba(255,255,255,.06)`; `bd.col-hi` → faint red `rgba(255,90,90,.14)`; header `hcell.col-hi` → `rgba(255,255,255,.08)` + `--fg`.
- **Selection** — `.sel` → `background: var(--sel-bg); color: var(--sel-fg, var(--fg)); outline: none`; `bd.sel` → same fill, `color: #ff6b6b`. Cross-panel `sel-mirror` → dashed cyan outline.
- **Match** — `.match` → faded yellow `rgba(234,179,8,.22)`; `bd.match` → same yellow, `color: #ff6b6b`. No `amatch` state — the current match is indicated by the row's `search-row` highlight instead.
- **sel+match** — `.sel.match` → yellow bg + blue border `outline: 1px solid rgba(95,207,255,.9)`; `bd.sel.match` → same + `color: #ff6b6b`.
- **Header selected columns** — `hcell.sel-col` → `rgba(255,255,255,.07)` + `--fg` + inner outline.
- **row-sel** — selected rows highlight their address gutter: `.diff-row.row-sel .addr` → `--fg` + `rgba(255,255,255,.07)` + inner outline.

### N/A combos
`be` (empty) cells: no hover, sel, match, sel+match, dirty, editing (no byte / no `data-addr`). `bd` (diff) cells: no dirty / editing (the diff view has no edit mode). `col-hi` IS possible on empty cells (they carry `data-col`).

## 2. Component structure

Row model (host-agnostic; the diff and single-view hosts both feed it):

```typescript
interface HexViewCell { hex: string; char: string; cls: string; }   // one byte: glyphs + host-computed classes
interface HexViewBanner { name: string; start: number; length: number; color: string; }
interface HexViewRow {
    address: number;
    kind: 'data' | 'gap';
    cells: HexViewCell[];                       // data rows only (16 = BPR cells)
    gap?: { from: number; to: number; bytes: number };   // gap rows only
    banners?: HexViewBanner[];                  // single-view segment labels, above the row
}
interface HexViewRenderInput {
    label: string;                              // empty string omits the panel label
    rows: readonly HexViewRow[];                // the slice the host wants rendered
    rowOffset: number;                          // index of rows[0] in the full list (absolute position)
    searchRowIndex: number;                     // row painted `.search-row` (-1 = none)
    matchSet: ReadonlySet<number>;              // addresses painted `.match`
    error: string | null;                       // `.panel-error` on the hex side
    totalHeight: number;                        // `.diff-body` height
    selection?: HexViewRange | null;            // painted from host state (single source of truth, Q7)
    showChar?: boolean;                         // render decoded-text (ASCII) header + char cells; diff passes false
}
```

`renderHexViewComponentHtml(side, input)` — pure HTML: optional `panel-label` + `.diff-header` (hidden address gutter + 00..0F `.hcell` with `data-col`, plus decoded-text label when `showChar`) + `.diff-body` (absolutely positioned rows: `.diff-row` = `.addr` + `.side` of 16 `.data-cell` + optional `.side.side-char` of 16 `.char-cell`; `.gap-row` for `kind:'gap'`). Cell markup keeps `data-addr`/`data-col`/`data-val` (decimal byte value; empty `be` cells omit it) and `.data-cell`/`.char-cell` classes so host handlers (edit, drag, context menu, inspector) attach unchanged.

`HexViewComponent` — owns its own transient interaction state, emits callbacks; selection state lives in the host and is painted through the render input:
- `mount()` — document-delegated listeners scoped to `.diff-component.<side>`.
- `setCallbacks(HexViewCallbacks)` — host wires cross-panel behaviour.
- `setMirrorAddr(addr)` — paint the hovered-by-the-other-side byte (cell + row).
- `setMirrorRange(range)` — paint the selected-by-the-other-side range (sel-mirror).
- `setColumn(col)` / `reapply()`.
- Callbacks: `onHover(addr)`, `onLeave()`, `onSelectionChange(range)`, `onColumnHover(col)`, `onColumnLeave()`, `onCopy(range)`.
- **Selection reporting only:** the component reports drag ranges via `onSelectionChange`; it never stores or paints the selection itself. The host owns `S` state and repaints `.sel`/`.row-sel`/`.sel-col` through the next render input.
- **Copy intent (option B):** the component owns the Ctrl/Cmd+C keydown (guarded against `input/textarea/select/[contenteditable]` targets) and, when it holds a drag selection, emits `onCopy(range)`. The host decides bytes + format + clipboard. (Future editing reuse: a read-only view has no paste; if the component later backs an editable view, add an `onPaste` intent the host decides on — not wired today.)
- Hover clears on leaving the whole component (mouseleave emulation via `relatedTarget`), not per cell (no flicker).

Diff status→class mapping (host-owned): `unchanged→bn`, `empty→be`, `changed|added|removed→bd` (single diff visual).

## 3. Tests

`src/test/webview/ui-components/hex-view-component.test.ts` (jsdom): column hover (onColumnHover + `col-hi` on data and header cells), cell hover (onHover + `cell-hover` + column; clears on component leave), click/drag selection reporting (onSelectionChange, no internal `.sel` paint), empty-cell selection guard, Ctrl+C copy intent (onCopy + text-input guard), `setMirrorAddr` (cell-mirror + row-hi), render-input painting (selection → `sel`/`row-sel`/`sel-col`; match; gap rows; banners; `showChar` header + char cells; host-compatible `data-addr`/`data-col`/`data-val`). `src/test/webview/diff-renderer.test.ts`: `bd` collapse, `bn match`, label optional, identical summary, host `DiffVisualRow`→`HexViewRow` mapping.

