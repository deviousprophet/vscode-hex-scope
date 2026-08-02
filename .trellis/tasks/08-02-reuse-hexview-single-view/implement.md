# Implementation: Reuse HexViewComponent in single hex view

Task: `08-02-reuse-hexview-single-view` · Branch: `feat/reuse-ui-components-single-view` · Base: `main`

## Phase 1 — Generalize component (`src/webview/ui-components/hex-view/`)

1. **Row model** — `hexViewComponent.ts`: replace `DiffVisualRow` dependency with `HexViewRow`/`HexViewCell`/`HexViewBanner` (design §2); `HexViewRenderInput` gains `selection?` and `showChar`. Cell markup keeps `data-addr`/`data-col`/`data-val` + `.data-cell`/`.char-cell` (host compatibility, Q10).
2. **Gap + banner + char rendering** — `rowHtml` handles `kind:'gap'`, `banners` (rendered above data row), and char cells when `showChar`; `headerHtml` adds decoded-text label when `showChar`.
3. **CSS** — move gap-row/seg-banner/char-cell/selection styles from `memory-view.css` into `hexViewComponent.css` (component owns grid styles, Q3/Q9). Update `hexDiffSession.ts`/`hexEditorSession.ts` css loaders if needed.
4. **Diff mapping** — `hexDiffViewer.ts` maps `DiffVisualRow` -> `HexViewRow` (`showChar:false`); visual output must be byte-identical.
5. **Component tests** — move `hex-view-component.test.ts` -> `src/test/webview/ui-components/`; add row-model/gap/banner/showChar/selection cases.

## Phase 2 — Split + virtualize diff host (`hexDiffViewer.ts` + `diff/diffView.ts` + `render/virtualScroll.ts`)

6. **Split the diff host (Q11)** — refactor `hexDiffViewer.ts` into a thin composition root + `src/webview/diff/diffView.ts` render/interaction host mirroring `memoryView.ts` (naming: `renderDiffBody`, `diffScrollState`, etc.). Keep `diffViewModel.ts` pure + `diffRenderer.ts`.
7. **Wiring** — one `VirtualScrollState` (uniform `DIFF_ROW_HEIGHT` getter), `calcVisibleRange`/`calcScrollLayout`/`calcCompressedWindowTop` per `frontend/virtual-scroll.md`; `viewMode` filter BEFORE slicing; same slice + `windowTop` to both panels; logical-position preservation on rerender.
8. **Positioning** — non-compressed spacers / compressed window per spec (anchor invariant — never `physicalHeight/totalHeight`).
9. **Diff tests** — virtualization cases (filter-then-slice, same slice both panels, compressed anchor uniform rows, scroll-position preservation).

## Phase 3 — Adopt in single view (`memoryView.ts` + `hexViewer.ts`)

10. **Rendering swap** — `renderMemBody` feeds the component a `HexViewRow[]` slice (`S.memRows` 1:1, labels -> banners, gap rows -> kind); remove `renderRow`/`renderGapRow`/`appendSegmentBanners`/`renderMemHeader` (host `mem-header` replaced by component header incl. decoded-text label).
11. **Selection + match highlight via input** — pass `selection` from `S.selStart/S.selEnd` and match set; component paints; `onSelectionChange` -> `S` -> rerender (Q7); search/jump/context-menu writes still rerender.
12. **Interaction re-anchor** — host edit/drag/context-menu/inspector listeners attach to component cells (same attributes/classes); verify nibble preview + dirty in-place mutations survive component renders; keep `S.lastClickColumn` hex-vs-char copy format.
13. **Header scroll-sync** — host horizontal scroll syncs the component header (was `mem-header`).

## Verification

- `npm run compile`, `npm run lint`, `npm test` (component + webview + diff suites), `npx fallow --format json --quiet` (0/0/0).
- Manual single view: all parity items (edit #128, decoded-text, drag, ctx-menu, inspector, search, record switch, gaps, banners, virtual scroll) identical to main.
- Manual diff: hex-only visual unchanged; 24 MB sample (`H:\workspace\sample_hex\firmware_24mb.hex`) compare scrolls smoothly, no blank band / seam / jump.

## Risky Files / Rollback Points

| File | Risk | Rollback |
|---|---|---|
| `hexViewComponent.ts` row model | Diff visual changes / host handlers break | Keep cell attrs/classes; revert row model |
| `memoryView.ts` rendering swap | Parity regressions (edit, drag, search) | Phase-gate: single view last; revert swap |
| `hexDiffViewer.ts` split + virtualization | Split refactor risks behavior regressions; scroll mapping bugs (blank band) | Phase-gate; follow `virtual-scroll.md` anchor invariant; diff behavior preserved |
| CSS migration | Grid styling drift | Move rules atomically; both views load component css |

## Follow-up Checks Before `task.py start`

- [ ] PRD + design + implement reviewed and approved by user.
- [ ] `task.py start 08-02-reuse-hexview-single-view`.
