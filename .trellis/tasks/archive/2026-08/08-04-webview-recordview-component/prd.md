# PRD — Extract RecordView into self-contained component

## Origin
Child of `08-03-webview-component-refactor` (issue #151: "Refactor webview UI into self-contained components"). ACs: per-component `.ts`+`.css`, colocated styles, shared styles only global, no functional/visual change.

## Problem
`recordView.ts` (418 lines) mixes paging data layer, virtual-scroll math, table rendering, and host-visible exports (`renderRecordView`/`acceptRecordPage`/`resetRecordPages`) in one module. It uses bespoke scroll math (not the shared `render/virtualScroll.ts` used by HexView). CSS in shared `styles/record-view.css`. Minimal direct test coverage.

## Goal
Self-contained `RecordView` component owning the record table markup, format-specific row rendering, scroll reporting, and colocated CSS. Host owns paging cache (`RecordPageCache`), slice computation (shared `virtualScroll`), and page-arrival re-renders.

Structure:
```text
src/webview/components/RecordView/
    RecordView.ts    pure render fn + class RecordView (render/renderEmpty, onScrollTop, onNeedPage)
    RecordView.css   record-view.css rules (moved verbatim)
src/webview/recordPageCache.ts   host data util (stays)
src/webview/hexViewer.ts         host wiring (paging, slice, page requests)
```

## Design decisions (locked in planning grills)
- **Scope (Q1-A):** component = table markup + scroll + row formatting. `RecordPageCache` + accept/reset paging stay host util (data layer).
- **Render API (Q2-A):** component `render(input)` where host feeds record slice (`SerializedRecord|null`[]) + offsets + total; component reports `onScrollTop` (host recomputes slice) + `onNeedPage(start,end)` (host fills cache → re-render).
- **Virtual scroll (Q3-A):** unify on shared `render/virtualScroll.ts` (drop record's bespoke `calcRecordScrollLayout`/`recordPhysicalToLogicalScroll`); component owns scroll container + listener, reports scroll; host computes slice.
- **Paging placeholder (Q4-A):** host passes `records` array with `null` for unloaded → component renders placeholder row; `onNeedPage` reported when visible window touches unloaded index.
- **CSS + table chrome (Q5-A):** `record-view.css` → `RecordView.css` verbatim; component renders full table incl `thead` (Addr/Type/Cnt/Data/CHK); container `#record-view` stays component root.
- **Row formatting (Q6-A):** component owns IHEX/SREC row formatting (type labels, address/badge classes, data classes, checksum); host passes raw `SerializedRecord` + `format: 'ihex'|'srec'`.
- **Visibility (Q7-A-lite):** host keeps `visibleClass` toggle on `#record-view` container; component mounts once (doc-delegated scroll); hidden element won't fire scroll until visible.
- **Empty/resize (Q8-A):** component exposes `renderEmpty(msg)`; resize recompute = host re-feeds slice (component does not own resize listener).

## Scope
In:
- `src/webview/components/RecordView/RecordView.ts` + `RecordView.css`.
- `hexViewer.ts` — wire RecordView (render input from cache + virtualScroll; `onScrollTop` → recompute; `onNeedPage` → cache fill; re-render on page arrival + resize).
- `styles/record-view.css` → moved to `RecordView.css`; static link list updated.

Out:
- `recordPageCache.ts` — stays host data util (unchanged).
- Moving shared `virtualScroll` into component — stays shared.

## Acceptance Criteria
- [x] `components/RecordView/RecordView.ts` + `RecordView.css` exist; component owns table markup, format row rendering, scroll reporting, styles. Zero `S` reads; no paging-cache logic.
- [x] Renders byte-identical table structure (`#record-view` container, `table.rtbl`, `thead` Addr/Type/Cnt/Data/CHK, row cells `.raddr`/`.rtype`/`.rcnt`/`.rdata`/`.rchk`, placeholder + unavailable nodes) as pre-refactor.
- [x] `onNeedPage` fires for unloaded visible range; host fills cache; re-render shows real rows (null → placeholder).
- [x] Uses shared `render/virtualScroll.ts` for slice math (bespoke record scroll math removed); end-of-scroll clamp preserved.
- [x] `styles/record-view.css` moved into `RecordView.css`; static link list updated.
- [x] `npm run lint`, `npm run check-types`, `npm run test` pass. Fallow green.
- [x] `webview.test.ts` "Record View rendering" suite passes unchanged.

## CSS deltas (intentional, user-requested — NOT verbatim CSS move)
RecordView.css differs from the deleted `styles/record-view.css` by explicit user direction (column layout parity for the record table):
- Column widths: fixed px for Addr (90) / Type (110) / Cnt (45) / CHK (80); Data flexible.
- `.raddr` restyled to match the hex-view address gutter (`--addr-fg`, `font-editor`, uppercase, `--font-size`/`--cell-size` line-height); dash (`raddr-empty`) no longer centered.
- `.cok`/`.cerr` checksum cells explicit `text-align: left`.
These are the only intentional deviations from "moved verbatim"; thead structure + row cell classes are byte-identical.
