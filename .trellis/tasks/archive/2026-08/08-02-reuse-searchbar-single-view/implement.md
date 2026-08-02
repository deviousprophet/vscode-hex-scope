# Implementation: Reuse SearchBarComponent in single hex view

Task: `08-02-reuse-searchbar-single-view` · Branch: `feat/reuse-ui-components-single-view` · Base: `main`

## Ordered Checklist

1. **Component seed + trigger** — `src/webview/ui-components/search-bar/searchBarComponent.ts`: optional constructor `seed?: { mode?, endianness?, query? }` applied to state + `toHtml()`; `onSearch` gains optional 4th `trigger` arg (`'button'` from run/mode/endian, `'enter-next'`/`'enter-prev'` from Enter). Defaults unchanged. Update `frontend/search-bar-component.md` spec (§2 API, seed + trigger).
2. **Component test** — `src/test/webview/search-bar-component.test.ts`: seeded mode/endianness reflected in `toHtml()`; trigger arg passed through on Enter vs run.
3. **Single-view host wiring** — `src/webview/hexViewer.ts`: remove hand-rolled `#search-box` markup; construct `new SearchBarComponent(cb, { mode: S.searchMode, endianness: S.searchEndianness, query: '' })`; `mount()`; wire adapter (`onSearch(query, mode, endianness, trigger?)` mirrors `S` + `runSearch(trigger ?? 'button')`, `onPrev`/`onNext`/`onClear` → glue fns). Remove `setupSearchControls`/`initSearch`-adjacent glue calls that duplicate component behaviors. **Add host-level Ctrl+Z keydown** (guard `S.editMode` → `undoLastEdit`) replacing `searchControls`' `isUndoShortcut`.
4. **Delete `searchControls.ts`** — `src/webview/search/searchControls.ts` removed; clean dangling imports.
5. **`searchEngine.ts` DOM-write swap + strip completed-nav only** — replace `updMC` (`#match-count`) with host `searchBar.setCount(S.matchAddrs.length, S.matchIdx)`; replace `setSearchBusy` (`#search-progress`) with `searchBar.setBusy(bool)`; **remove** `handleCompletedSearchNavigation` + `_lastCompletedSearchKey` (component owns Enter-on-completed); **keep** `SearchTrigger` + `runSearch(trigger)` + `navigateBySearchTrigger` for single-view Enter-during-streaming parity; keep all orchestration (streaming, first-jump, navigation, selection, switch-to-memory). Watch for the component/host call cycle: glue calls `setCount`/`setBusy`, component `onSearch` calls glue — ensure no double-trigger.
6. **CSS — component owns all search-bar styles** — move `#search-box`/`#search-mode`/`.search-addr-wrap`/`.search-addr-prefix`/`#search-input`(+variants)/`#btn-prev`/`#btn-next`/`#btn-clear-search`/`#match-count`/`.search-progress`(+`hs-search-spin`) from `base.css` → `searchBarComponent.css`; delete `toolbar.css` leftover search dups (lines 80-105); update header comments. `hexEditorSession.ts` `_getHtml` cssFiles adds the component css via relative-path link (styles/ mapping can't reach it); `hexDiffSession.ts` already loads it — comment tweak only. Grid `.search-row` match-highlight stays host-side.
7. **Test isolation** — move `src/test/webview/search-bar-component.test.ts` → `src/test/webview/ui-components/` (test glob `out/test/**/*.test.js` already recursive; fix relative imports if depth changed).
8. **Verify parity** — manual: single view search behaves identically (search/navigate/clear/count/spinner/endian/mode/addr prefix/Ctrl+F/Enter-nav/record-view switch); Ctrl+Z undo works in edit mode; search bar looks like diff view's.
9. **Full verification** — `npm run compile`, `npm run lint`, `npm test`, `npx fallow` (0 dead/0 complexity/0 dupes).

## Validation Commands

- `npm run compile` (tsc + lint + esbuild)
- `npm test` (all suites; `search-bar-component.test.ts` included)
- `npx fallow --format json --quiet` → 0/0/0
- Manual: single view open → search works identically; record view → search switches to memory; diff view search unchanged.

## Risky Files / Rollback Points

| File | Risk | Rollback |
|---|---|---|
| `hexViewer.ts` template swap | Search box markup/IDs diverge → memoryView `#search-input` read breaks | Keep IDs identical (component emits them); revert template swap |
| `searchEngine.ts` count/spinner swap | Double-trigger / count from component's `this.query` vs glue's read | Verify single source; revert glue DOM writes |
| `searchControls.ts` delete | Dangling imports elsewhere + **loses Ctrl+Z undo** | Grep before delete (only hexViewer imports); re-home undo to host keydown first |
| `searchEngine.ts` count/spinner swap + completed-nav strip | Double-trigger / count from component's `this.query` vs glue's read; over-stripping breaks Enter-mid-stream nav | Verify single source + Enter-nav on completed AND running searches; revert glue DOM writes |
| Component seed | Diff default drift (`le`) | Defaults unchanged when seed omitted |
| CSS consolidation | base.css/toolbar.css/component css split wrong → both views styled inconsistently | Move rules atomically; both views load component css; visual parity check |
| Ctrl+Z undo re-home | Undo stops working if keydown guard wrong (`S.editMode`) | Same guard as `isUndoShortcut`; manual undo test in edit mode |

## Follow-up Checks Before `task.py start`

- [ ] PRD + design + implement reviewed and approved by user.
- [ ] `task.py set-branch 08-02-reuse-searchbar-single-view feat/reuse-ui-components-single-view` (done).
- [ ] `task.py start 08-02-reuse-searchbar-single-view`.
