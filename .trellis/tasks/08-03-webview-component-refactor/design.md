# Design — SearchBar component extraction

## Layout
```
src/webview/components/SearchBar/
    SearchBar.ts      class SearchBar + pure render helpers
    SearchBar.css     extracted search styles
```
```text
src/webview/search/searchEngine.ts   (edited) — explicit-param runSearch
src/webview/hexViewer.ts             (edited) — wire component, move undo, drop inline search HTML
src/webview/styles/toolbar.css       (edited) — strip search rules
src/hexEditorSession.ts              (edited) — link dist/webview.css
src/test/webview/ui-components/search-bar.test.ts  (new)
```

## Component contract
```ts
interface SearchBarCallbacks {
    onSearch: (query: string, mode: SearchMode, endianness: SearchEndianness, trigger: SearchTrigger) => void;
    onPrev: () => void;
    onNext: () => void;
    onClear: () => void;
}
interface SearchBarSeedOptions { mode?: SearchMode; endianness?: SearchEndianness; query?: string }

class SearchBar {
    constructor(cb: SearchBarCallbacks, seed: SearchBarSeedOptions = {});
    toHtml(): string;                          // markup, injected by host
    mount(): void;                             // document-delegated listeners (survives re-renders)
    setCount(count: number, current: number): void;
    setBusy(busy: boolean): void;
}
```
- Component holds `mode`/`endianness`/`query` internally. Reads no `S`, writes no `S`.
- Seed on boot from `S` (host reads `S.searchMode`/`S.searchEndianness`).
- `searchKeyFor(mode, raw, endianness)` canonical-key helper exported for host reuse (running-search parity).
- Global DOM IDs (`#search-input`, `#match-count`, …) as today — single instance.
- Ctrl+F stays in component; Ctrl+Z undo NOT in component.

## Engine changes
- `runSearch(query, mode, endianness, trigger = 'button')`: explicit params; internal key = `searchKeyFor(mode, query, endianness)`. Remove `S.searchMode`/`S.searchEndianness` reads and `currentSearchQuery()` DOM read from the search-decision path.
- Keep `clearSearch`, `nextMatch`, `prevMatch`, `initSearch` signatures and match-state writes to `S.matchAddrs`/`S.matchIdx` (rendering still reads these).
- Host sets `S.searchMode`/`S.searchEndianness` in the `onSearch` callback before calling engine (memoryView `NEEDLE_LEN_BY_MODE` reads `S.searchMode`).

## Host wiring (hexViewer.ts)
1. Remove search bar HTML block (mode `<option>`s + endian buttons + input + buttons + match count), keep surrounding toolbar shell.
2. `const searchBar = new SearchBar({ onSearch: (q, m, e) => { S.searchMode = m; S.searchEndianness = e; runSearch(q, m, e, trigger); }, onPrev, onNext, onClear }, { mode: S.searchMode, endianness: S.searchEndianness })`.
3. Inject `searchBar.toHtml()` at mount; call `searchBar.mount()`.
4. Engine callbacks for completion call `searchBar.setCount(...)` / `searchBar.setBusy(...)`.
5. Ctrl+Z undo keydown listener moves from searchControls into host wiring (gated `S.editMode`).

## CSS loading (transition)
- `SearchBar.ts` does `import './SearchBar.css'` → esbuild emits `dist/webview.css`.
- `_getHtml` appends `<link rel="stylesheet" href="dist/webview.css">`; existing `src/webview/styles/*.css` links remain for unmoved components.
- Transitional: two stylesheet sources coexist. Future component moves drop more files from the static list until it's empty; final cleanup then removes the static list.

## Tests
- mocha + jsdom (deps already present). Port branch `search-bar-component.test.ts` cases, adapt import path + names. Add a case asserting undo key no longer bound by component (Ctrl+Z triggers no onSearch/callback) to lock the undo split.
- Run: `npm run lint`, `npm run check-types`, `npm run test`.

## Rollback
- Pure additive/move refactor. Revert = `git revert` of the commit; static link list + `toolbar.css` restore original search styling; engine signature change is the only breaking seam (kept within one commit).
