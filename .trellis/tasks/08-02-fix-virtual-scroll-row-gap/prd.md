# Fix virtual scroll row-gap artifacts in memory view

## Goal

Eliminate intermittent hairline gaps that appear between memory rows while scrolling the single hex view's memory grid, without regressing virtual-scroll performance (chunked/buffered rendering) or the large-file compressed-scroll behavior.

## Background / Analysis (2026-08-02)

Three compounding root causes were identified:

1. **Fractional row height → sub-pixel paint seams.** `--cell-size: calc(var(--vscode-editor-font-size) * 1.6)` (`styles/base.css:6`) = 20.8px at the 13px default. The scroller computes all positions as exact floats (`calcRowOffset` cumulative sums, `windowTop` in `memoryView.ts:177`, spacer heights) but the browser paints each row rounded to a whole device pixel. Accumulated fractional offsets land rows on non-integer boundaries intermittently → hairline background sliver between adjacent rows. It is position-dependent, hence "sometimes".
2. **Segment banners unmodeled by the height metric.** `memoryRowHeight()` (`memoryView.ts:92`) models only `rowHeight` (data rows) and `gapHeight` (gap rows). `appendSegmentBanners()` (`memoryView.ts:222`) inserts a `.seg-banner` (~19px) into the row stream above data rows, so the phantom scroll height underestimates real height wherever a banner sits. When a banner row crosses the render-buffer edge while scrolling, the mismatch surfaces as a visible gap/jump, localized at segment-label rows.
3. **Compressed-mode ratio scroll mapping.** For files whose total row height exceeds `MAX_VIRTUAL_SCROLL_HEIGHT` (16,000,000 px), the phantom is capped and `physicalToLogicalScroll` maps `scrollTop` by a straight ratio. Non-uniform rows (gaps + banners) break the linearity, so `windowTop` can be off by up to a fraction of a row → sliver at the buffer edge across the whole file.

Minor contributor: `#mem-rows { padding: 2px 0 }` (`memory-view.css:29`) is not part of the height metric.

## Known Constraints

- `src/webview/render/virtualScroll.ts` is pure logic with existing coverage in `src/test/webview/webview.test.ts` (VirtualScrollState/calcVisibleRange/calcScrollLayout etc.) — keep it pure and testable.
- Memory grid rendering stays buffered/virtualized; never render the full address space.
- Changing `--cell-size` affects the whole grid layout (column widths, addr/text cells, header), not just row gaps.
- Large-file compressed mode is a deliberate design; fixes must not break it.

## Requirements (draft — scope decisions pending grill)

- R1. No hairline gaps between adjacent rows during scrolling in uniform byte areas (Cause 1).
- R2. No gap/jump when scrolling through segment-label rows (Cause 2).
- R3. No buffer-edge sliver in compressed mode on large files (Cause 3).
- R4. Zero performance regression: streaming/search/virtual-scroll benchmarks unchanged (`core/search-performance.test.ts`, memory virtualization intact).
- R5. `npm run compile`, `npm run lint`, `npm test`, `npx fallow` clean.

## Acceptance Criteria (draft)

- [ ] AC1. Scroll the memory grid in a uniform area — no intermittent gaps.
- [ ] AC2. Scroll through segment-boundary rows — no jump/gap at banners.
- [ ] AC3. Open the 24 MB sample (`H:\workspace\sample_hex\firmware_24mb.hex`) — compressed scroll clean, no buffer-edge sliver.
- [ ] AC4. Existing `webview.test.ts` virtual-scroll tests still green; new cases for the changed metric/mapping.
- [ ] AC5. Full suite + fallow clean; no perf regression.

## Out of Scope

- The diff view's hex grid (uses `HexViewComponent`, separate layout) unless a shared root cause fix touches it.
- Record view virtualization.
- Any change to `core/search.ts` or search behavior.

## Open Decisions (grill before design)

| Q | Options | Pending |
|---|---|---|
| Q1 | Scope: all 3 causes, or dominant Cause 1 only? | — |
| Q2 | Cause 1 approach: snap `--cell-size` to whole px (layout-wide) vs round virtual-scroll positions only vs row background seam-hide | — |
| Q3 | Cause 2: make `memoryRowHeight` label-aware (banner height in metric) | — |
| Q4 | Cause 3: index-based compressed mapping (locate row by height, not ratio) | — |

## Decisions (grill, 2026-08-02)

| Q | Decision |
|---|---|
| Q1 | **All 3 causes** in scope |
| Q2 | **Integer `--cell-size`** — `Math.round(editorFontSize * 1.6)` set on `:root` via TS; all derived dims consistent |
| Q3 | **Label-aware row height** — `memoryRowHeight` adds measured `.seg-banner` height × label count; `heightVersion` includes label signal |
| Q4 | **Anchor compressed buffer to exact offset** — `windowTop = calcRowOffset(startIdx) / totalHeight × physicalHeight`; ratio mapping kept for scroll-top only |
