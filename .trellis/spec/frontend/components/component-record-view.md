# Component Spec — RecordView

> Built from `component-template.md`. Owns the record table as a self-contained presentational component.

## Scope / Trigger

Owns `src/webview/components/recordView/recordView.ts` + `recordView.css`: the record table (thead Addr/Type/Cnt/Data/CHK + rows), IHEX/SREC row formatting, scroll reporting, and colocated styles. Host owns paging (`RecordPageCache` + `requestRecordWindow/requestRecordPage` + provider post), slice computation (shared `render/virtualScroll.ts`), and page-arrival re-renders.

Boundary rule: the component owns table markup, row formatting, and scroll reporting. It never reads/writes `S`, never touches the paging cache, never posts provider messages — it renders host-fed slices and reports.

## Layout

```text
src/webview/components/recordView/
    recordView.ts       types + pure render fns + controller class
    recordView.css      record-table rules (moved from styles/record-view.css)
src/webview/hexViewer.ts    host wiring (paging, slice via virtualScroll, page requests)
src/webview/recordPageCache.ts  host data util (unchanged)
src/test/webview/components/recordView.test.ts   (mocha + jsdom)
```

## Contract

```typescript
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
    onScrollTop?: (scrollTop: number) => void;          // host recomputes slice
    onNeedPage?: (first: number, last: number) => void; // record index range; host maps to pages
}

export function renderRecordViewHtml(input: RecordViewRenderInput): string;  // pure (table incl thead)
export function renderRecordEmptyHtml(message: string): string;              // pure (unavailable node)
export class RecordView {
    constructor(rootSelector: string, cb?: RecordViewCallbacks);
    setCallbacks(cb: RecordViewCallbacks): void;
    mount(): void;                       // idempotent, doc-delegated scroll
    render(input: RecordViewRenderInput): void;
    renderEmpty(message: string): void;
}
```

## Rules

- **Pure render:** `renderRecordViewHtml(input)` builds `table.rtbl` (thead Addr/Type/Cnt/Data/CHK + tbody). Uncompressed: rows in flow with spacer rows (RECORD_MAX_SPACER_PX cap). Compressed: relative wrapper (height = totalHeight) + absolute table at `top:windowTop`.
- **Row formatting lives in component:** IHEX/SREC type label maps, badge classes, address text (8-hex uppercase `resolvedAddress`; `raddr-empty` + `—` dash for non-data types), data (hex bytes space-joined; error text on error), checksum cell (`—` on error, checksum hex + `.cok`/`.cerr`/`.cerr-tag`).
- **Paging stays host:** `null` in `records` = unloaded → `tr.record-loading` "Loading…" placeholder. Component reports `onNeedPage(first,last)` when visible window touches unloaded indexes; host maps to pages, fills cache, re-renders. Component never imports `RecordPageCache`.
- **Virtualization:** `mount()` one doc-delegated scroll listener filtered to rootSelector → `onScrollTop`; host computes slice via shared `render/virtualScroll.ts` + `clampWindowTop` (shared util). No bespoke scroll math in component.
- **Visibility:** host keeps the `visibleClass` toggle on `#record-view`; component mounts once.
- **Empty/resize:** `renderEmpty(msg)`; resize recompute = host re-feeds slice (component does not own resize).
- Markup/row cell classes byte-identical to pre-refactor; record text escaped via `esc()`/`textContent`.
- Zero `S` import; no postProviderMessage; no size math beyond host-fed layout.

## Behaviour

- Data row `tr` (+ `rerr` class when error or invalid checksum): `.raddr` (8-hex uppercase; `raddr-empty` + `—` dash for non-data), `.rtype` badge (`rbadge rb-*` label), `.rcnt` (byte count), `.rdata` (hex bytes; error text), `.rchk` (`—`/checksum + `.cok`/`.cerr`/`.cerr-tag`).
- Placeholder row: `tr.record-loading` "Loading…". Unavailable: `renderRecordEmptyHtml`.
- Column layout (user-requested): Addr 90px / Type 110px / Cnt 45px / CHK 80px fixed; Data flexible. Address styled like hex-view gutter (`--addr-fg`, font-editor, uppercase); checksum left-aligned; dash not centered.

## Validation & Error Matrix

| Condition | Behaviour |
|---|---|
| Unloaded record in window | Placeholder row rendered; `onNeedPage(first,last)` reported. |
| Compressed (huge file) | Relative wrapper + absolute table at clamped `windowTop`; slice rerender on scroll. |
| Record error / invalid checksum | `rerr` row class; checksum `—` or error tag. |
| Non-data record type | Address cell shows `—` dash (left-aligned with address text). |
| No parseResult | `renderEmpty` "Record View Unavailable" node. |

## Tests Required

`src/test/webview/components/recordView.test.ts` (mocha + jsdom + cssImportHook): render parity (thead, data row cells, `rerr`, IHEX/SREC labels/badges), placeholder for `null`, unavailable, compressed wrapper + clamp, `onScrollTop`, `onNeedPage`, `setCallbacks`. Existing `webview.test.ts` "Record View rendering" suite passes unchanged (parity gate).

## Anti-patterns

- Component importing `S`/`state.ts`, `RecordPageCache`, or `postProviderMessage`.
- Paging/request math inside the component (stays host).
- Bespoke scroll math duplicated in the component (shared `virtualScroll` + `clampWindowTop`).
- Component owning resize listener (host re-feeds slice).
- Renaming table ids/classes.
