# Implementation: Fix virtual scroll row-gap artifacts

Task: `08-02-fix-virtual-scroll-row-gap` · Branch: `fix/virtual-scroll-row-gap` · Base: `main`

## Ordered Checklist

1. **Integer `--cell-size`** — `src/webview/memory/memoryView.ts`: in/around `syncVirtualScrollMetrics`, compute `cellSizePx = Math.round(editorFontSize * 1.6)`; set `document.documentElement.style.setProperty('--cell-size', ...)` when changed. Verify `.data-row`/`.gap-row`/cells land on whole px.
2. **Banner height probe + label-aware `memoryRowHeight`** — measure `.seg-banner` height (probe div, fallback const); `memoryRowHeight` adds `bannerHeight * labelCount` for labeled data rows; wire label lookup from `buildLabelMap()`/`S.labels`; add label signal to `heightVersion` (e.g. `${rowHeight}:${gapHeight}:${bannerHeight}:${S.labels.size}`).
3. **Compressed anchor** — `renderMemory`/`visibleRowsHtml`: `windowTop = (calcRowOffset(startIdx, state) / calcTotalHeight(state)) * layout.physicalHeight` (guard totalHeight 0); drop the additive `physicalScrollTop + topOffset - virtualScrollTop` form.
4. **Tests** — `src/test/webview/webview.test.ts` add: integral cumulative offsets; label-aware getter; compressed `windowTop` anchor (uniform + mixed gap/banner rows).
5. **Verify** — manual on the 24 MB sample + a labeled file: no intermittent gaps uniform area, no banner-boundary jump, no compressed sliver; `npm run compile`, `npm run lint`, `npm test`, `npx fallow` (0/0/0).

## Validation Commands

- `npm run compile` (tsc + lint + esbuild)
- `npm test` (all suites; webview.test.ts virtual-scroll cases included)
- `npx fallow --format json --quiet` → 0/0/0
- Manual: uniform scroll (gap-free), segment-boundary scroll (no jump), 24 MB `H:\workspace\sample_hex\firmware_24mb.hex` compressed scroll (no sliver).

## Risky Files / Rollback Points

| File | Risk | Rollback |
|---|---|---|
| `memoryView.ts` `--cell-size` override | Grid dims shift (20.8→21); header/cell alignment drift | Revert override; CSS fallback stays |
| `memoryView.ts` label-aware getter | Wrong label count → phantom mismatch / cache churn | Keep getter pure; verify heightVersion changes on label edit |
| `visibleRowsHtml` compressed anchor | Division by zero / wrong scale → rows mispositioned | Guard totalHeight 0; fall back to additive form |
| `webview.test.ts` new cases | Existing virtual-scroll expectations break | Assert public outputs only |

## Follow-up Checks Before `task.py start`

- [ ] PRD + design + implement reviewed and approved by user.
- [ ] `task.py set-branch 08-02-fix-virtual-scroll-row-gap fix/virtual-scroll-row-gap` (done).
- [ ] `task.py start 08-02-fix-virtual-scroll-row-gap`.
