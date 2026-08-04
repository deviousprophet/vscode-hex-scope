# Design — RecordView component extraction

## Component contract

```ts
// src/webview/components/RecordView/RecordView.ts

interface RecordViewRenderInput {
    format: 'ihex' | 'srec';
    records: readonly (SerializedRecord | null)[];   // null = unloaded (placeholder row)
    recordOffset: number;        // index of records[0] in the full list
    totalHeight: number;         // full content height (px)
    containerHeight: number;     // rows-container height (px) when compressed
    windowTop: number;           // inner-wrapper vertical offset (px)
    compressed: boolean;
    topSpacer: number;           // px
    bottomSpacer: number;        // px
}

interface RecordViewCallbacks {
    onScrollTop?: (scrollTop: number) => void;       // host recomputes slice
    onNeedPage?: (first: number, last: number) => void; // record index range; host maps to pages + requests
}

export function renderRecordViewHtml(input: RecordViewRenderInput): string;  // pure (table incl thead)
export function renderRecordEmptyHtml(message: string): string;              // pure (unavailable node)
export class RecordView {
    constructor(rootSelector: string, cb?: RecordViewCallbacks);
    mount(): void;                       // idempotent, doc-delegated scroll
    render(input: RecordViewRenderInput): void;
    renderEmpty(message: string): void;
}
```

## Rendering

- Container: `#record-view` (host keeps `visibleClass` toggle; component root via `rootSelector`).
- Table: `table.rtbl` with `thead` (Addr/Type/Cnt/Data/CHK) + `tbody`. Uncompressed: rows in flow w/ top/bottom spacers. Compressed: wrapper `position:relative; height:containerHeight` + absolute `table` at `top:windowTop` (parity with current `replaceRecordViewContent` + clamp fix).
- Row (data): `tr` → `.raddr` (8-hex uppercase `resolvedAddress`; `raddr-empty` + `—` dash for non-data record types), `.rtype` (type label + badge class), `.rcnt` (byte count), `.rdata` (hex bytes space-joined; error text when record error), `.rchk` (checksum cell: `—` on error, checksum hex + `.cok`/`.cerr`/`.cerr-tag`). IHEX/SREC labels + class maps live in component (moved from `recordView.ts`).
- Row (placeholder, unloaded): `tr.record-loading` single cell "Loading…" — parity.
- Empty/unavailable: `renderRecordEmptyHtml(msg)` renders `recordViewUnavailableNode` equivalent.
- All text via `textContent`/esc; no inline unescaped record data.

## Scroll + paging

- `mount()` attaches one doc-delegated scroll listener filtered to `rootSelector`; on scroll reports `onScrollTop(scrollEl.scrollTop)`.
- Component also detects when its visible window touches unloaded (`null`) indexes and reports `onNeedPage(first,last)` (record index range). Host maps to pages (existing `requestRecordWindow` page math + `requestRecordPage` post) fills `RecordPageCache`, then re-renders. Paging math + provider post stay host-side.
- Host computes slice via shared `render/virtualScroll.ts` (`calcVisibleRange`/`calcRowOffset`/`calcTotalHeight`/`calcScrollLayout`/`physicalToLogicalScroll`/`logicalToPhysicalScroll`), applying the end-of-scroll clamp from the HexView/external-change work.
- Resize: host window resize listener recomputes slice + `render(input)` (component does not own resize).

## Host wiring (hexViewer.ts)

1. `const recordView = new RecordView('#record-view', { onScrollTop: refreshRecordSlice, onNeedPage: requestRecordWindow })`.
2. On view switch to record: `recordView.render(buildRecordInput())`; on record-page arrival (`acceptRecordPage`): re-render if currentView==='record'.
3. `buildRecordInput()` reads `RecordPageCache` (host util kept) → `records: (SerializedRecord|null)[]`, computes slice + offsets via `virtualScroll`.
4. `renderRecordView` host entry point (re-exported) → `recordView.render(...)`; `resetRecordPages`/`acceptRecordPage` unchanged (host data).

## CSS

- Move `src/webview/styles/record-view.css` rules verbatim → `components/RecordView/RecordView.css`; delete styles/ file; `import './RecordView.css'` in RecordView.ts.
- Remove `'record-view'` from static CSS link list in `hexEditorSession.ts`.

## Tests

- `src/test/webview/components/record-view.test.ts` (mocha + jsdom + css-import-hook): render parity (thead, data row cells incl `.raddr`/`.rtype`/`.rcnt`/`.rdata`/`.rchk`, format-specific labels/badges), placeholder for `null`, empty/unavailable, compressed wrapper positioning + clamp, scroll reports `onScrollTop`, `onNeedPage` on unloaded visible range.
- Existing `webview.test.ts` "Record View rendering" suite passes unchanged (parity gate).

## Rollback

- One commit; `git revert` restores `recordView.ts`/`record-view.css`/host wiring.
