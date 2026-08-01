# Hex View Component Code-Spec

Reusable single-panel hex grid (filename label + 00..0F header + address gutter + byte cells) with its own hover / selection / column interaction. Powers the diff view (`src/webview/diff/hexViewComponent.ts`); the single-file hex view is a future consumer.

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

`renderHexViewComponentHtml(side, input)` — pure HTML: optional `panel-label` (empty string omits it) + `.diff-header` (hidden address gutter + 00..0F `.hcell` with `data-col`) + `.diff-body` (absolutely positioned `.diff-row` = `.addr` + `.side` of 16 `.data-cell`).

`HexViewComponent` — owns its own interaction state, emits callbacks, paints its own transient classes:
- `mount()` — document-delegated listeners scoped to `.diff-component.<side>`; `destroy()` removes them.
- `setCallbacks(HexViewCallbacks)` — host wires cross-panel behaviour.
- `getSelection()` / `setSelection(range)` — single range (start/end addresses).
- `setMirrorAddr(addr)` — paint the hovered-by-the-other-side byte (cell + row).
- `setMirrorRange(range)` — paint the selected-by-the-other-side range (sel-mirror).
- `setColumn(col)` / `reapply()`.
- Callbacks: `onHover(addr)`, `onLeave()`, `onSelectionChange(range)`, `onColumnHover(col)`, `onColumnLeave()`.
- Hover clears on leaving the whole component (mouseleave emulation via `relatedTarget`), not per cell (no flicker).

Status→class mapping: `unchanged→bn`, `empty→be`, `changed|added|removed→bd` (single diff visual).

## 3. Tests

`src/test/webview/hex-view-component.test.ts` (jsdom): column hover (onColumnHover + `col-hi` on data and header cells), cell hover (onHover + `cell-hover` + column; clears on component leave), click/drag selection (onSelectionChange + `sel` + `row-sel` + `sel-col`), `setMirrorAddr` (cell-mirror + row-hi). `src/test/webview/diff-renderer.test.ts`: `bd` collapse, `bn match`, label optional, identical summary.
