# Design: Fix virtual scroll row-gap artifacts

Task: `08-02-fix-virtual-scroll-row-gap` · Branch: `fix/virtual-scroll-row-gap` · Base: `main`

## 1. Architecture

Memory grid = `memoryView.ts` renders a buffered slice of `S.memRows`; `render/virtualScroll.ts` (pure) computes visible range, cumulative row offsets, and the compressed-mode phantom for large files. All three fixes keep that split: logic stays in `virtualScroll.ts`/`memoryView.ts`, CSS stays in `memory-view.css`/`base.css`.

## 2. Changes

### 2.1 Cause 1 — integer `--cell-size` (root fix)
- In `memoryView.ts`, compute `cellSizePx = Math.round(editorFontSize * 1.6)` (editor font size already measured from `--vscode-editor-font-size` in `getVirtualScrollMetrics`). When it differs from the current value, `document.documentElement.style.setProperty('--cell-size', '${cellSizePx}px')`.
- All derived vars (`--cell-pad = cell-size/4`, `--text-cell-width = cell-size*0.7`) and `.data-row`/`.gap-row`/cells then use integer px → no fractional accumulation → no sub-pixel seams.
- Keep the CSS fallback definition in `base.css` (used pre-first-measure and if TS not running); TS override wins after boot.
- Re-applied inside `syncVirtualScrollMetrics` so font-size changes (theme/zoom re-measure) re-round; `heightVersion` already gates cache rebuild.

### 2.2 Cause 2 — label-aware row height
- Extend `memoryRowHeight`: for a data row whose address has labels, add `bannerHeight * labelCount` (from `buildLabelMap()`/`S.labels`). Gap rows unchanged.
- Measure `.seg-banner` height once with a probe (same technique as `getRecordRowHeight`), fallback constant.
- `heightVersion` must include a label-derived signal (e.g. `S.labels.size` + `bannerHeight`) so adding/removing labels invalidates the height cache; otherwise phantom underestimates/overestimates after label changes.
- Result: cumulative heights == real DOM height; non-compressed spacers + compressed mapping both align at segment rows.

### 2.3 Cause 3 — anchor compressed buffer to the scroll mapping (CORRECTED)
> **CORRECTION (post-archive):** the original Cause-3 change scaled by `physicalHeight / totalHeight`, which is WRONG — it drifts the buffer below `scrollTop` by up to `~containerHeight` near the end (blank space at the viewport top). The regression was diagnosed and fixed; see `.trellis/spec/frontend/virtual-scroll.md` §7. Cause 3 was itself a misdiagnosis — the pre-fix additive anchor was already correct.
- Correct anchor (kept after correction):
  `windowTop = (calcRowOffset(startIdx, state) / layout.logicalScrollable) * layout.physicalScrollable` (guard `totalHeight <= 0`, non-compressed, or `logicalScrollable <= 0` → 0).
- This uses the SAME compression factor as the scroll position (`physicalToLogicalScroll`/`logicalToPhysicalScroll`), so the buffer stays within one row of the viewport top at every scroll depth.
- `renderMemory` passes the computed `windowTop` instead of deriving it inline.

### 2.4 Minor — `#mem-rows` padding
- `padding: 2px 0` (`memory-view.css:29`) is outside the height metric; leave as-is (constant, invisible) unless a fix is trivial — note in implement.

## 3. State / Cache Notes

- `vscrollState.getRowHeight` becomes label-aware; cache identity (`cacheGetRowHeight === state.getRowHeight`) plus `heightVersion` already force rebuild when the closure or version changes.
- `calcRowOffset`/`calcTotalHeight` unchanged API — only the row-height getter they call changes.
- No changes to `calcVisibleRange`, `calcScrollLayout`, `logicalToPhysicalScroll`/`physicalToLogicalScroll` (ratio mapping stays for scroll-top conversion; the *rendering* anchor is what changes).

## 4. Performance

- All three fixes are O(1) or O(rows) at rebuild only: rounding is per-sync, label lookup reuses `buildLabelMap`, compressed anchor is two divisions. No per-scroll-tick added work, no full-render regression. Streaming/search untouched.

## 5. Tests

- `src/test/webview/webview.test.ts` covers `VirtualScrollState`/`calcVisibleRange`/`calcScrollLayout` — keep green; add cases:
  - integer row height → cumulative offsets integral.
  - label-aware getter: row with banner contributes `rowHeight + bannerHeight`.
  - compressed anchor: given layout + exact offsets, expected `windowTop` = scaled exact offset (uniform and mixed gap/banner rows).
- `core/search-performance.test.ts` untouched.
- Run: `npm run compile`, `npm run lint`, `npm test`, `npx fallow`.

## 6. Wrong vs Correct

Wrong: round only visible positions (rows stay 20.8px → seams persist); hardcode banner height constant (breaks on font/theme change); per-scroll binary-search row lookup (perf regression); ratio-correcting by tweaking the phantom divisor (hides symptom, breaks other rows).
Correct: integer row geometry at the source (`--cell-size`); label-aware metric so phantom == reality; rendering anchored to exact offsets scaled to the phantom; all logic pure/testable.
