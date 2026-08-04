# Implement — RecordView component extraction

Task: `.trellis/tasks/08-04-webview-recordview-component`. Design decisions locked; do not re-litigate.

## Preconditions
- Branch `feat/webview-recordview-component` (base main, ExternalChange merged). `npm run check-types` + tests green before.

## Checklist

1. **Study baseline** — read `src/webview/recordView.ts` (all 418 lines), `recordPageCache.ts`, `hexViewer.ts` record call sites, `styles/record-view.css`, `webview.test.ts` "Record View rendering" suite. Catalog ids/classes (record-view, rtbl, raddr/rtype/rcnt/rdata/rchk, record-loading, unavailable node), thead labels, IHEX/SREC label+class maps, format helpers, bespoke scroll math + clamp.
2. **Create component** `src/webview/components/RecordView/RecordView.ts`
   - Types `RecordViewRenderInput`, `RecordViewCallbacks`; pure `renderRecordViewHtml(input)` + `renderRecordEmptyHtml(msg)`; `class RecordView(rootSelector, cb)` with idempotent `mount()` (doc-delegated scroll), `render(input)`, `renderEmpty(msg)`. NO `S` import, no RecordPageCache, no postProviderMessage.
   - Move IHEX/SREC type labels + row/badge/address/data/checksum formatting into component (verbatim).
3. **Create `RecordView.css`** — move `styles/record-view.css` verbatim; `import './RecordView.css'`; delete styles/ file.
4. **Update `hexEditorSession.ts`** — remove `'record-view'` from static CSS link list.
5. **Rewrite host** `hexViewer.ts`
   - `const recordView = new RecordView('#record-view', { onScrollTop: refreshRecordSlice, onNeedPage: requestRecordWindow })`.
   - `renderRecordView` host entry → `recordView.render(buildRecordInput())`; `acceptRecordPage` → re-render if record view active; `resetRecordPages` unchanged.
   - `buildRecordInput()`: slice via shared `render/virtualScroll.ts`, records array with `null` placeholders from `RecordPageCache`, offsets/spacers/clamp.
   - Drop record bespoke scroll math (was module-local in recordView.ts); keep end-of-scroll clamp behavior.
6. **Delete** old record rendering from `recordView.ts` (or split: keep `recordPageCache.ts` as host data util; `recordView.ts` fully absorbed — decide based on what host still needs; paging util stays).
7. **Tests** `src/test/webview/components/record-view.test.ts` (mocha + jsdom + css-import-hook): render parity (thead, cells, format labels/badges), placeholder for null, empty/unavailable, compressed positioning + clamp, onScrollTop, onNeedPage.
8. **Validate**
   - `npm run lint`, `npm run check-types`, `npm run compile-tests`.
   - `npx mocha --ui tdd out/test/webview/components/record-view.test.js` + component batch + `webview.test.ts`.
   - `npm test` (full).
   - Fallow all-axes green.

## Review gates
- `webview.test.ts` "Record View rendering" passes unchanged (parity).
- `rg "recordView" src/` — only component + host wiring; no paging in component.
- `rg "S\.|postProviderMessage|RecordPageCache" src/webview/components/RecordView/` — empty.
- No bespoke record scroll math duplicated; shared virtualScroll used.
- record-view.css gone from styles/ + static list.

## Rollback
- One commit; `git revert` restores recordView.ts/record-view.css/host wiring.
