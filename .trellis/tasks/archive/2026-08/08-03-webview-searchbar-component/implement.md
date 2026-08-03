# Implement — SearchBar component extraction

Task: `.trellis/tasks/08-03-webview-component-refactor` (SearchBar scope).

## Checklist

1. [x] **Baseline** — `git status` clean; `npm run check-types` and `npm run test` green before touching code.
2. [x] **Create component** `src/webview/components/SearchBar/SearchBar.ts`
   - [x] `class SearchBar` per design contract (`constructor(cb, seed)`, `toHtml()`, `mount()`, `setCount()`, `setBusy()`).
   - [x] Internal mode/endian/query; `searchKeyFor` helper exported; Ctrl+F focus; Enter run/navigate parity; endian pill toggle; addr-mode overlay + hex strip.
   - [x] No undo handling; no `S` import.
3. [x] **Create `SearchBar.css`** — move every `.search-*` / `#search-*` rule out of `toolbar.css` verbatim (same selectors, no value changes).
4. [x] **Import css** — `import './SearchBar.css'` in `SearchBar.ts`.
5. [x] **Edit `searchEngine.ts`**
   - [x] `runSearch(query, mode, endianness, trigger='button')`: build key from explicit params; drop `S.searchMode`/`S.searchEndianness`/`currentSearchQuery()` reads.
   - [x] Keep `clearSearch`/`nextMatch`/`prevMatch`/`initSearch`; keep `S.matchAddrs`/`S.matchIdx` writes.
6. [x] **Edit `hexViewer.ts`**
   - [x] Remove search bar HTML block (hexViewer.ts:538-546 and siblings).
   - [x] Instantiate + seed + mount `SearchBar`; wire `onSearch` → sync `S.searchMode/S.searchEndianness` then `runSearch(q,m,e,trigger)`; `onPrev/onNext/onClear` → engine fns; engine completion calls `searchBar.setCount/setBusy`.
   - [x] Move Ctrl+Z undo keydown here (gated `S.editMode`); Ctrl+F stays in component.
7. [x] **Edit `hexEditorSession.ts`** — `_getHtml` links `dist/webview.css` (keep existing `styles/*.css` links).
8. [x] **Strip `toolbar.css`** — remove search rules (done in step 3 via move).
9. [x] **Tests** — create `src/test/webview/ui-components/search-bar.test.ts` (mocha + jsdom): mode labels, endian pill (no re-run), addr overlay + hex-strip, Enter run/navigate parity, Ctrl+F focus, clear, setCount/setBusy, seed, trigger passthrough, and Ctrl+Z does NOT fire search callbacks. 18 passing.
10. [x] **Validate**
    - [x] `npm run lint` — PASS
    - [x] `npm run check-types` — PASS
    - [x] jsdom batch — 155 passing, 2 pre-existing failures (state default-endian + record-view markup; untouched files, fail identically on main)
11. [ ] **Manual smoke** — launch extension host, verify: search bar renders same, run/search/nav/clear, endian pill, addr mode, Ctrl+F, Ctrl+Z undo. **PENDING (user-run)**

## Review gates
- [x] After step 9: full diff review vs PRD ACs before `task.py finish`.
- [x] Verify no `S.searchMode`/`S.searchEndianness` reads remain in search decision path (`rg "searchMode|searchEndianness" src/webview` — remaining hits must be host-sync or render-only).
- [x] Verify no `.search-`/`#search-` rules remain in `toolbar.css`.

## Rollback points
- Post-step-5 engine signature change is the breaking seam; keep steps 2-8 in one commit so `git revert` restores fully.
