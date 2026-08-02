# Virtual Scroll Code-Spec

Scenario: render only the visible rows plus a buffer of a large memory grid (40x DOM speedup), with a compressed phantom for very large logical ranges. Shared by the single memory view and the diff view (both panels).

## 1. Scope / Trigger

Applies to `src/webview/render/virtualScroll.ts` (pure geometry) and its host wiring in `src/webview/memory/memoryView.ts` (memory grid) and the diff host (`hexDiffViewer.ts`, both panels share one scroll position). Touching row height, scroll mapping, or the compressed phantom requires this spec.

## 2. Signatures

```typescript
interface VirtualScrollState {
    containerHeight: number;
    scrollTop: number;              // LOGICAL scroll position (see contracts)
    bufferSize: number;
    visibleRowIndices: [number, number];
    rowCount: number;
    heightVersion: string | number; // invalidates the cumulative-height cache
    getRowHeight: (rowIndex: number) => number;
}

interface VirtualScrollLayout {
    totalHeight: number;
    physicalHeight: number;         // min(totalHeight, MAX_VIRTUAL_SCROLL_HEIGHT)
    logicalScrollable: number;      // totalHeight - containerHeight
    physicalScrollable: number;     // physicalHeight - containerHeight
    isCompressed: boolean;          // totalHeight > MAX_VIRTUAL_SCROLL_HEIGHT
}

function calcVisibleRange(state): [number, number];   // [startIdx, endIdx) with buffer
function calcRowOffset(rowIndex, state): number;      // exact cumulative offset
function calcTotalHeight(state): number;
function calcScrollLayout(state, maxPhysicalHeight?): VirtualScrollLayout;
function physicalToLogicalScroll(physicalTop, state): number;  // ratio map on scrollable ranges
function logicalToPhysicalScroll(logicalTop, state): number;   // inverse of above
function calcCompressedWindowTop(startIdx, state, layout): number; // buffer top in phantom space
```

Hosts supply the row-height metric. The component (`HexViewComponent`) is virtualization-agnostic: it renders the rows array it is given; the host computes the slice + position (via `calcVisibleRange`, `calcRowOffset`, `calcCompressedWindowTop`) and feeds it.

## 3. Contracts

- **`state.scrollTop` is LOGICAL.** Physical `scrollContainer.scrollTop` is converted through `physicalToLogicalScroll` before use; rerendering the same container preserves the logical position (physical->logical on the old state, logical->physical on the new).
- **Compressed-mode anchor invariant (critical).** The rendered buffer must stay **within one row of the viewport top at every scroll depth**. The buffer's top in phantom space is mapped with the **same compression factor the scroll position uses**:
  `windowTop = (offset(firstVisibleRow) / logicalScrollable) * physicalScrollable`
  (clamped to `[0, logicalScrollable]`, `0` when not compressed / zero-height).
- **Never scale by `physicalHeight / totalHeight`** for the anchor (see Common Mistake).
- Non-compressed mode renders rows in flow with exact-height spacers above/below; compressed mode renders a single absolutely-positioned window.
- `MAX_VIRTUAL_SCROLL_HEIGHT` caps the phantom; `logicalScrollable`/`physicalScrollable` derive from container height, never from `physicalHeight`/`totalHeight` alone.
- Row geometry and the row-height metric are host-supplied (label-aware heights in the single view; `DIFF_ROW_HEIGHT` in the diff). Height-cache invalidation via `heightVersion` must reflect any metric change (row height, gap height, banner heights, label relocation).

## 4. Validation & Error Matrix

| Condition | Behavior |
|---|---|
| `totalHeight <= 0` / `physicalHeight <= 0` | `calcCompressedWindowTop` returns 0 (no crash) |
| Not compressed or `logicalScrollable <= 0` | `calcCompressedWindowTop` returns 0 (spacers render) |
| Scroll to the very bottom (`scrollTop = physicalScrollable`) | `windowTop in [physicalScrollable - rowH*c', physicalScrollable]` — first row at/just above viewport top, never below (no blank gap) |
| Metric changes (label add/delete/relocate, font/theme) | `heightVersion` changes -> height cache rebuilds -> phantom == reality |
| Empty content | `totalHeight 0`; no crash; empty render |

## 5. Good/Base/Bad Cases

- Good: large file scrolls smoothly, rows fill viewport at every depth, no blank band above rows near the end.
- Good: two distant segments -> data rows separated by one gap row; scroll through gap shows no fractional seam.
- Bad: uniform rows at the end show a blank band growing toward `~containerHeight` -> compressed anchor used the wrong factor.

## 6. Tests Required

- `src/test/webview/webview.test.ts`:
  - integer row heights -> integral cumulative offsets.
  - compressed anchor: uniform and mixed rows map to `(offset / logicalScrollable) * physicalScrollable`.
  - **bottom invariant**: at `scrollTop = logicalScrollable`, `calcCompressedWindowTop(firstVisible, ...)` within `[physicalScrollable - rowH, physicalScrollable]`.
  - compressed rerender preserves the first visible logical address when the metric changes.
  - logical-position preservation across rerender (physical->logical old, logical->physical new).

## 7. Wrong vs Correct

### Common Mistake: anchoring by full-height compression instead of scroll compression

**Symptom**: large file shows blank space at the viewport top growing toward `~containerHeight` as you scroll to the end.

**Cause**: two compression factors look similar but are not equal — `c = physicalHeight / totalHeight` (full content) vs `c' = physicalScrollable / logicalScrollable` (scrollable range). Since `c > c'`, an anchor scaled by `c` places the buffer progressively below the scroll position; the gap reaches `containerHeight - rowH*c` at the end.

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
