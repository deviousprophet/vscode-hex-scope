# Virtual Scroll Code-Spec

Scenario: render only the visible rows plus a buffer of a large memory grid (40x DOM speedup), with a compressed phantom for very large logical ranges.

## 1. Scope / Trigger

Applies to `src/webview/render/virtualScroll.ts` (pure geometry) and its integration in `src/webview/memory/memoryView.ts` (memory grid) and `recordView.ts` (page-based record variant). Touching row height, scroll mapping, or the compressed phantom requires this spec.

## 2. Signatures

```typescript
interface VirtualScrollState {
    containerHeight: number;
    scrollTop: number;             // LOGICAL scroll position (see contracts)
    bufferSize: number;
    visibleRowIndices: [number, number];
    rowCount: number;
    heightVersion: string | number; // invalidates the cumulative-height cache
    getRowHeight: (rowIndex: number) => number;
}

interface VirtualScrollLayout {
    totalHeight: number;
    physicalHeight: number;        // min(totalHeight, MAX_VIRTUAL_SCROLL_HEIGHT)
    logicalScrollable: number;     // totalHeight - containerHeight
    physicalScrollable: number;    // physicalHeight - containerHeight
    isCompressed: boolean;         // totalHeight > MAX_VIRTUAL_SCROLL_HEIGHT
}

function calcVisibleRange(state): [number, number];   // [startIdx, endIdx) with buffer
function calcRowOffset(rowIndex, state): number;      // exact cumulative offset
function calcTotalHeight(state): number;
function calcScrollLayout(state, maxPhysicalHeight?): VirtualScrollLayout;
function physicalToLogicalScroll(physicalTop, state): number;  // ratio map on scrollable ranges
function logicalToPhysicalScroll(logicalTop, state): number;   // inverse of above
function calcCompressedWindowTop(startIdx, state, layout): number; // buffer top in phantom space
```

`memoryView.ts` supplies the row-height metric:

```typescript
function memoryRowHeight(rowIndex, rowHeight, gapHeight, bannerHeight, labelMap): number;
// data row: rowHeight + bannerHeight * labelCount; gap row: gapHeight
```

## 3. Contracts

- **Row geometry is integer-px.** `--cell-size` is rounded at runtime (`Math.round(editorFontSize * 1.6)`) and scoped to `#memory-view` (never `:root` — that would re-size the diff/hex-view grids). Gap rows are integer too (`gapHeight = Math.round(rowHeight * 1.5) + 4`; CSS `.gap-row { height: round(calc(var(--cell-size) * 1.5), 1px) }`). Fractional row heights accumulate sub-pixel offsets that paint as hairline seams between rows.
- **The height metric must equal real DOM height.** A data row that renders segment banners contributes `bannerHeight × labelCount`; the banner height is measured from a probe containing **both** `.sb-name` and `.sb-meta` lines. `heightVersion` = `rowHeight:gapHeight:bannerHeight:labelSignature(labelMap)` where `labelSignature` derives from the actual visible label map (`size + sum of addresses`) — it changes on add, delete, **and relocation** of labels, so the height cache always rebuilds.
- **`state.scrollTop` is LOGICAL.** Physical `scrollContainer.scrollTop` is converted through `physicalToLogicalScroll` before use; rerendering the same container preserves the logical position (physical→logical on the old state, logical→physical on the new).
- **Compressed-mode anchor invariant (the critical one).** The rendered buffer must stay **within one row of the viewport top at every scroll depth**. The buffer's top in phantom space must be mapped with the **same compression factor the scroll position uses**:
  `windowTop = (offset(firstVisibleRow) / logicalScrollable) * physicalScrollable`
  (clamped to `[0, logicalScrollable]`, `0` when not compressed / zero-height). Never scale by `physicalHeight / totalHeight` (see Common Mistake).
- Non-compressed mode renders rows in flow with exact-height spacers above/below (`buildVisibleRowsHtml`); compressed mode renders a single absolutely-positioned window.

## 4. Validation & Error Matrix

| Condition | Behavior |
|---|---|
| `totalHeight <= 0` / `physicalHeight <= 0` | `calcCompressedWindowTop` returns 0 (no crash) |
| Not compressed or `logicalScrollable <= 0` | `calcCompressedWindowTop` returns 0 (spacers render) |
| Scroll to the very bottom (`scrollTop = physicalScrollable`) | `windowTop ∈ [physicalScrollable − rowH·c′, physicalScrollable]` — first row at/just above viewport top, never below (no blank gap) |
| Label added/deleted/relocated | `heightVersion` changes → height cache rebuilds → phantom == reality |
| Font/theme changes font-size | `--cell-size` re-rounded; `heightVersion` changes |
| Label hidden | excluded from `labelMap`; no banner height added |

## 5. Good/Base/Bad Cases

- Good: 16 mapped bytes at an aligned address → one data row; scroll smooth, no seams.
- Good: two distant segments → data rows separated by one gap row; scroll through the gap row shows no fractional seam.
- Good: scrolling a >16M-px file to the end shows the last rows flush with the viewport bottom, no blank space above them.
- Bad: uniform rows at the end show a blank band growing toward `~containerHeight` → compressed anchor used the wrong factor.

## 6. Tests Required

- `src/test/webview/webview.test.ts`:
  - integer row heights → integral cumulative offsets (use the real `Math.round(rowHeight*1.5)+4` gap formula).
  - label-aware getter: labeled data row contributes `rowHeight + bannerHeight`; hidden labels excluded.
  - compressed anchor: uniform and mixed rows map to `(offset / logicalScrollable) * physicalScrollable`.
  - **bottom invariant**: at `scrollTop = logicalScrollable`, `calcCompressedWindowTop(firstVisible, ...)` within `[physicalScrollable − rowH, physicalScrollable]`.
  - `--cell-size` override scoped to `#memory-view`.
  - compressed rerender preserves the first visible logical address when labels change.
- `core/search-performance.test.ts` untouched (search perf is independent of virtual scroll).

## 7. Wrong vs Correct

### Common Mistake: anchoring by full-height compression instead of scroll compression

**Symptom**: after "fixing" row-gap seams, a large file shows blank space at the viewport top that grows toward ~`containerHeight` as you scroll to the end.

**Cause**: two compression factors look similar but are not equal — `c = physicalHeight / totalHeight` (full content) vs `c′ = physicalScrollable / logicalScrollable` (scrollable range). Since `c > c′`, an anchor scaled by `c` places the buffer progressively below the scroll position; the gap reaches `containerHeight − rowH·c` at the end.

#### Wrong

```typescript
function calcCompressedWindowTop(startIdx, state, layout) {
    return (calcRowOffset(startIdx, state) / layout.totalHeight) * layout.physicalHeight;
}
```

#### Correct

```typescript
function calcCompressedWindowTop(startIdx, state, layout) {
    if (layout.totalHeight <= 0 || layout.physicalHeight <= 0) { return 0; }
    if (!layout.isCompressed || layout.logicalScrollable <= 0) { return 0; }
    const offset = Math.max(0, Math.min(calcRowOffset(startIdx, state), layout.logicalScrollable));
    return (offset / layout.logicalScrollable) * layout.physicalScrollable;
}
```

Use the passed `layout`'s own `logicalScrollable`/`physicalScrollable` — never recompute via `logicalToPhysicalScroll` (which re-derives layout with the default cap) and never use `totalHeight`/`physicalHeight`.
