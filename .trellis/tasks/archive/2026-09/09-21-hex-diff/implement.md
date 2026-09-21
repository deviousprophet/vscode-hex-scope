# Execution Plan — Hex Diff View

Complex task. Ordered, phase-gated. Do not start a step whose prerequisite is incomplete.

## Phase A — Core diff (independently verifiable)

1. **Prerequisite refactor: de-globalize `HexView`.**
   - `src/webview/components/hexView/hexView.ts`: `#mem-header` → root-scoped `.mem-header` (94, 110, 209); `#mem-scroll` → `.mem-scroll` (191).
   - `src/webview/components/hexView/hexView.css`: id selectors → class selectors.
   - `src/webview/hexViewer.ts` (1206-1208): add classes beside ids.
   - Add the `scrollLeft` report + `setScrollLeft` seam.
   - Gate: `src/test/webview/components/hexView.test.ts` and `src/test/webview/webview.test.ts` pass unchanged.
2. **`src/core/diff.ts`** — `computeByteDiff` + `DiffModel`; unit test `src/test/core/diff.test.ts` (identical, single changed byte, added-only, removed-only, gaps, adjacent-run merge, empty inputs, address 0 / last byte boundaries).
3. **`src/core/wire.ts`** — extract `serializeParseResult` from `hexEditorSession.ts`; update its imports. No behavior change.
4. **`src/diffProtocol.ts`** — typed `DiffProviderToWebview` / `DiffWebviewToProvider`.
5. **`src/diff/diffEditorPanel.ts`** — host panel: file read, `detectFormatFromParts`, compact parse, `computeByteDiff`, HTML shell, `ready`/disposal, `parseResultIsValid` gate + Quick Repair warning.
6. **`package.json` + `src/extension.ts`** — contribute `hexScope.compareWith` ("Compare with...") + editor-title/command-palette menu; register command, `showOpenDialog` picker.
7. **`esbuild.js`** — add the `src/webview/diffViewer.ts` → `dist/diffViewer.js` bundle entry.
8. **Webview diff surface** — `src/webview/diff/diffModel.ts`, `diffGrid.ts` (two `HexView` instances + shared rows + scroll sync), `diffSummary.ts` (summary + next/prev), `diff.css` (`diff-chg`/`diff-add`/`diff-del`, hidden right address column), composition root `src/webview/diffViewer.ts`.
9. **Tests** — `src/test/core/diff.test.ts`; a diff-panel/command test in `src/test/extension/`; a webview diff render test in `src/test/webview/` (row alignment, empty-vs-value added/removed, summary counts, scroll sync, placeholder/error state).

## Phase B — Follow-up (unified mode + label context)

Deferred. Split into a child task if pursued: unified (interleaved) view toggle, read-only per-side label overlays, SREC↔HEX edge polish. `diffInit` already carries both label sets.

## Phase A2 — Findings round 2 (post-review UX/edge fixes, still read-only)

Ordered; each step gated by the previous.

1. **F1 blank lower half.** `src/webview/diff/diff.css`: add `.diff-body[hidden], .diff-error[hidden] { display: none; }` so the `hidden` attribute is not defeated by `display:flex/grid`.
2. **F4 addresses on both panes.** Drop `.diff-hide-addr` from the B panel shell (`src/webview/diffViewer.ts`) and remove its CSS rule.
3. **F7 divider.** Add a dedicated `.diff-split` element between panes in the shell; `3px`, higher-contrast token, `:hover` brighten, `flex: 0 0 3px`; remove the 1px `.diff-side` border.
4. **F3 pointer parity + copy.** `src/webview/diff/diffGrid.ts`: one mirrored selection range; wire `onCellClick`, `onSelectionChange`, `onAddressRowClick`, `onAddressRowDrag`; repaint both grids via `paintSelection`. `src/diffProtocol.ts`: add `copyText` to `DiffWebviewToProvider`. `src/diffViewer.ts`: host `Ctrl+C` when a selection exists, resolve the source pane's mapped bytes (skip unmapped), post `copyText`. `src/diff/diffEditorPanel.ts`: handle `copyText` → `vscode.env.clipboard.writeText`.
5. **F5 action bar + view modes.** `src/webview/diff/diffSummary.ts`: counts + `Prev diff`, `Next diff`, `Show all`, `Show diff`, `Swap sides`, `Find`, `Sync scroll`; `viewMode` radio pair (`all` default), `syncScroll` toggle (default ON), `findVisible` toggle. `src/webview/diff/diffGrid.ts`: filter rows to diff-only rows under `diff`; `No differences` empty state when zero; gate `syncFrom` on `syncScroll`.
6. **F2 swap.** Swap `data.a` / `data.b` and the head labels, then re-render; `added`/`removed` follow through `diffClassForSide`.
7. **F6 search.** Reuse `SearchBar` (`src/webview/components/searchBar/`) + `core/search.ts` in the diff bundle (import `searchBar.css`). Host `runSearch` runs each side over hydrated `SerializedSegment[]`, unions match addresses (dedupe), paints `matchSet`/`activeMatch` in both grids, and wires next/previous to `scrollToDiff`. `Find` toggles bar visibility.
8. **Label disambiguation.** `src/diffProtocol.ts`: add `path: string` to `DiffSide`. `src/diff/diffEditorPanel.ts`: populate it. `src/webview/diffViewer.ts`: basename label, shortest disambiguating suffix on collision, full path in `title`; same labels in the panel tab title.
9. **Picker (item 2 = A).** `src/extension.ts`: first `showQuickPick` of supported open editors (label = basename, description = path) + a `Browse…` item that opens the filtered dialog; then a confirm `showQuickPick` with `Compare A ↔ B`, `Swap`, `Cancel`. No persisted recent list.
10. **Tests.** Extend `src/test/webview/diffViewer.test.ts` (error/body hidden, addresses on both panes, divider present, selection mirrored + copy payload, `Show diff` filtering + `No differences`, swap flips colors/labels, sync toggle, search highlight + nav, label disambiguation). Extend `src/test/extension/extension.test.ts` for the picker flow and `copyText` clipboard. `src/test/core/diff.test.ts` unchanged.
11. **Spec updates.** Update `component-diff-view.md`, `component-hex-view.md` (pointer parity reuse), `component-search-bar.md` (multi-surface reuse note), `editor-lifecycle.md` (copyText + picker), `memory-navigation.md` (view-mode filtering).

## Phase A3 — Explorer compare selection (Beyond Compare style)

Ordered; each step gated by the previous.

1. **`src/diff/compareSelection.ts`** (new, host): `CompareSelectionStore` with `get`/`set`/`clear`; owns the status-bar item (`$(diff) HexScope: <name>`, tooltip `<path>\nClick to clear`, `command = hexScope.clearCompareSelection`) and the `hexScope.hasCompareSelection` context key via `setContext`. Session memory only.
2. **`package.json`**: remove `hexScope.compareWith` and its `hexScope.actions` entry; add the four commands + submenu entries with the `when` clauses from `design.md` (Findings Round 3) — `explorerViewletFocus` keeps them out of the editor title.
3. **`src/extension.ts`**: create the store in `activate` (push to subscriptions); register `hexScope.selectForCompare`, `hexScope.compareWithSelected`, `hexScope.compareSelectedFiles`, `hexScope.clearCompareSelection`; keep `validateComparable` / `isSupportedHexFile`; remove `compareWith`, `pickComparisonTarget`, `chooseOtherFile`, `browseForFile`, `supportedOpenPaths`, `openTabPaths`, `documentPaths`, `orderedPair`, `ComparisonPickerDeps`, `resolveComparisonTarget`, and the `diffPicker` imports.
4. **Delete `src/diff/diffPicker.ts`.**
5. **Tests.** Update `src/test/extension/extension.test.ts`: remove picker tests; add select-for-compare (status bar + context key), compare-selected (clicked = B, stash = A, clears on success), compare-selected-files (exactly two; clicked = A), clear, unsupported-second-file warning, palette-without-resource warning. Remove picker tests from `src/test/core/diff.test.ts` (keep the label tests).
6. **Specs.** Update `editor-lifecycle.md` (commands, `when` clauses, status bar, stash lifecycle) and `component-diff-view.md` (picker removed).
7. **Validation:** `npm run check-types`, `npm run lint`, `npm test`, then the `/fallow-fix` gate.

## Phase A4 — Compare command revision (supersedes A3 command set)

Ordered; each step gated by the previous.

1. **`package.json`**: replace the four A3 commands with three — `hexScope.selectAsFirst` (`Set as 1st file to compare`), `hexScope.compareToStaged` (`Compare with the 1st file`), `hexScope.compareSelected` (`Compare Two Files`); delete `hexScope.selectForCompare`, `hexScope.compareWithSelected`, `hexScope.clearCompareSelection` (command + menu). Keep `when` gates as revised in `design.md` (Findings Round 3) and `group: "3_compare"`.
2. **`src/diff/compareSelection.ts`**: remove the status-bar item and `dispose()`; the store becomes `get`/`set`/`clear` only (store file + `hexScope.hasCompareSelection` context key). Session memory only.
3. **`src/extension.ts`**: register `selectAsFirst`, `compareToStaged`, `compareSelected`; drop `clearCompareSelection`; update the test seams and the information-message/hint strings; keep `explorerViewletFocus` gates and `validateComparable`.
4. **Tests**: update `src/test/extension/extension.test.ts` for the three commands, no status-bar item, and the revised hints; remove `clear` coverage.
5. **Specs**: update `editor-lifecycle.md` and `component-diff-view.md` to the three commands (no clear, no status bar).
6. **Validation**: `npm run check-types`, `npm run lint`, `npm test`, then the `/fallow-fix` gate.

## Phase A5 — Diff view polish (findings round 4)

Ordered; each step gated by the previous.

1. **R4-1 scroll stability.** `src/webview/diff/diffGrid.ts`: coalesce `syncFrom` renders with `requestAnimationFrame` and skip the render when the visible range / layout version / view+sync state is unchanged (follower mirror still runs); add a test seam to flush a pending frame.
2. **R4-5 format pill.** `src/webview/styles/base.css`: add the shared `.fmt-pill` utility. `src/webview/styles/statsBar.css`: `.si-fmt .svl` reuses `.fmt-pill` (no visual change). `src/webview/diffViewer.ts` `setSideHead`: render `<name>` + `<span class="fmt-pill">IHEX|SREC</span>` (drop ` · `); keep the full-path `title`. `src/webview/diff/diff.css`: nothing new for the pill.
3. **R4-3 always-visible search.** `src/webview/diffSearch.ts`: mount and show the bar on boot; remove `toggleFind`/`isFindVisible`/`#diff-search.open` gating. `src/webview/diff/diffSummary.ts`: remove the `Find` button + its active-state wiring.
4. **R4-4 toolbar layout.** `src/webview/diff/diffSummary.ts` + `src/webview/diffViewer.ts` shell + `src/webview/diff/diff.css`: two-row toolbar — row 1 `Show all`/`Show diff` + `Prev diff`/`Next diff` (left), `Swap sides` (center), search bar (right); row 2 `Sync scroll` (left), diff stat centered. Move the `SearchBar` markup into row 1.
5. **R4-2 loading screen + progress.** `src/diffProtocol.ts`: add `{ type: 'diffProgress'; stage: 'read' | 'parse' | 'diff'; completed: number; total: number }` to `DiffProviderToWebview`. `src/diff/diffEditorPanel.ts`: add the loading card to `diffHtml`, post throttled `diffProgress` while reading/parsing each file and around the diff, and hide the card on `diffInit`/`diffError`. `src/webview/diff/diffMessages.ts`/`diffViewer.ts`: handle `diffProgress` (update the card) and swap the card for the grids/error.
6. **Tests.** `src/test/webview/diffViewer.test.ts`: scroll-stability (no re-render when the range is unchanged; one render per frame), always-visible search bar (no `Find` button), two-row toolbar order/grouping, format pill + no separator. `src/test/extension/extension.test.ts` or a small core test for `diffProgress` payload/handling. Keep the existing suites green.
7. **R4-6 icon buttons.** `src/webview/diff/diffSummary.ts`: `actionButton(id, label, glyph, active)` renders the glyph (`▲` `▼` `≡` `≠` `⇄` `⇅`) with `title` + `aria-label`; `src/webview/diff/diff.css`: `.diff-action` becomes a comfortable square icon button (~26×26px, ~14px glyph) with hover/active/disabled states preserved.
8. **Specs.** Update `component-diff-view.md` (toolbar, icon buttons, always-visible search, loading card, format pill) and `editor-lifecycle.md` (`diffProgress`).
9. **Validation:** `npm run check-types`, `npm run lint`, `npm test`, then the `/fallow-fix` gate.

## Phase A6 — Concurrent load (loading regression fix)

Ordered; each step gated by the previous.

1. **Concurrent read+parse.** `src/diff/diffEditorPanel.ts`: replace the serial `readDiffSource`/`parseDiffSource` awaits with `Promise.all` over both files (read then parse each), keeping the staleness checks and the `diff` stage around `computeByteDiff`.
2. **Monotonic summed progress.** Track each file's fraction (`[0,1]`); post `completed = fractionA + fractionB`, `total = 2` through the existing `DiffProgressReporter`. Extract the summing into a pure helper (`combinedLoadProgress`) so it can be unit-tested.
3. **Tests.** Add a core/host test asserting `combinedLoadProgress` is monotonic and bounded by `total`, and that interleaved per-file fractions never regress the combined value. Keep the existing `diffProgress` webview tests green.
4. **Specs.** Update `editor-lifecycle.md` (concurrent load + summed progress) and note the regression in `component-diff-view.md`.
5. **Validation:** `npm run check-types`, `npm run lint`, `npm test`, then the `/fallow-fix` gate.

## Phase A7 — Loading-bar parity with the hex view

Ordered; each step gated by the previous.

1. **Indeterminate bar.** `src/diff/diffEditorPanel.ts`: drop the `det` class from `#diff-loading-fill` in `diffHtml`. `src/webview/diff/diff.css`: delete the `.loading-bar-fill.det` rule.
2. **Text-only progress.** `src/webview/diff/diffGrid.ts` `applyDiffProgress`: set the card text to `Loading ${stage} ${pct}%…` (raw stage names, mirroring `hexViewer.loadProgressLabel`) and remove the `fill.style.width` write plus the `DIFF_STAGE_LABEL` map. Keep `progressPercent`.
3. **Tests.** `src/test/webview/diffViewer.test.ts`: update the label expectations (`Loading read …%` / `Loading parse …%` / `Loading diff …%`) and assert the fill carries no inline width and no `det` class.
4. **Specs.** Update `component-diff-view.md` and `editor-lifecycle.md` loading-card wording (indeterminate bar + text label).
5. **Validation:** `npm run check-types`, `npm run lint`, `npm test`, then the `/fallow-fix` gate.

## Phase A8 — Parallel diff load (findings round 7)

Ordered; each step gated by the previous. Fixes the measured 2× diff load and the non-monotonic bar.

1. **`src/diff/diffParseWorker.ts`** (new, Node worker). `workerData: { kind: 'diffParse'; bytes: ArrayBuffer; extension: string }` (bytes transferred; `kind` sentinel so the import-safe module only runs as the diff worker — its test imports the pure helpers). Decode with `TextDecoder`, `detectFormatFromParts(extension, raw)`, run `parseIntelHexCompact`/`parseSRecCompact` with `onProgress` mapped to one **monotonic** `fraction` (scan `[0, 0.9]`, build `[0.9, 1]`, running max) in exported `stageFraction`/`nextLoadFraction`. Post `{ type: 'progress', fraction }`; on success post `{ type: 'result', format, wire }` where `wire = serializeParseResult(result, format)` with all segment `ArrayBuffer`s in the transfer list; on throw post `{ type: 'error', message }` (validation inside the async entry, so a bad job still posts an error). Mirror `src/core/scripting/scriptWorker.ts` (worker-side message/`parentPort` shape). Throttle progress to **integer percent**: post only when `Math.floor(fraction * 100)` strictly advances past the last emitted percent (`percent <= lastPercent` gate, not time-based), keeping the running-max monotonicity. `parseSourceRecordsAsync` reports once per source line, so an unthrottled worker posts ~100k–500k messages per file and the host's single main thread drains them all, serializing the two workers (measured, two workers in parallel: 4 MiB 1126ms / 95k msgs vs throttled 744ms / 95 msgs; 16 MiB 4672ms / 381k vs 2593ms / 98). Never throttle the `result` post.
2. **`esbuild.js`**: add a `diffParseWorker` context — entry `src/diff/diffParseWorker.ts`, `bundle/cjs/node/external:['vscode']`, outfile `dist/diffParseWorker.js` — and include it in the `watch`/`rebuild`/`dispose` wiring beside `ctxWorker`.
3. **`src/diff/loadProgress.ts`**: add `advanceFraction(previous, next)` — clamp to `[0, 1]` and keep the running maximum — so per-file monotonicity is testable without a worker.
4. **`src/diff/diffEditorPanel.ts`**: `readDiffSource` returns the `Uint8Array` (no host-side decode). Add `parseSideInWorker(uri, bytes, signal, onFraction)` that spawns `new Worker(path.join(__dirname, 'diffParseWorker.js'), { workerData: { kind: 'diffParse', bytes: bytes.buffer, extension }, transferList: [bytes.buffer] })`, relays `progress` → `onFraction`, resolves `result`/rejects `error`, and terminates on `signal.abort`. `loadSide` uses it (`fraction = advanceFraction(previous, mapped)`); `diffSide` uses the worker `wire` directly; `computeByteDiff` wraps each `wire.segments[i].data` in a `Uint8Array` view. Drop the now-unused `parseIntelHexCompact`/`parseSRecCompact`/`serializeParseResult` imports.
5. **Tests.** `src/test/core/diffLoadProgress.test.ts`: `advanceFraction` never decreases, clamps out-of-range, and a scan→build stage switch (1.0 → 0) does not regress the combined value. Add a worker round-trip test (small IHEX + SREC fixture) asserting format/segment bytes/error propagation, and keep the existing webview `diffProgress` label tests green.
6. **Specs.** Update `editor-lifecycle.md` (worker-parallel parse + monotonic fraction) and `component-diff-view.md` (parallel worker + monotonic progress note).
7. **Validation:** `npm run check-types`, `npm run lint`, `npm test`, then the `/fallow-fix` gate.

## Phase A9 — Read weight (findings round 8)

One step; no protocol, card, or test change.

1. **`src/diff/diffEditorPanel.ts`**: `READ_SHARE` `0.5` → `0.05` (and update the constant's doc comment). Reading is fast and posts no progress, so a half-bar reservation made the diff loading bar jump to 50% then crawl; the small slice lets the bar track the dominant parse. `FILE_TOTAL`, the `read`/`parse` stage gate (`fraction <= READ_SHARE`), and `READ_SHARE + (1 - READ_SHARE) * running` are unchanged.
2. **Docs.** `editor-lifecycle.md` + `component-diff-view.md` read-split wording; `design.md` round 5/7 phrasing + new "Findings Round 8 — Diff Read Weight" section.
3. **Validation:** `npm run check-types`, `npm run lint`, `npm test`; no new tests (private constant, no seam) — existing `diffLoadProgress`/`diffViewer` suites stay green.

## Phase A10 — Icon + text action buttons (findings round 9)

Ordered; each step gated by the previous.

1. **`src/webview/diff/diffSummary.ts`**: `actionButton(id, glyph, text, title, active)` renders `<span class="diff-action-glyph" aria-hidden="true">${glyph}</span><span class="diff-action-text">${text}</span>`; update the six call sites (`Show all` / `Show diff` / `Prev diff` / `Next diff` / `Swap sides` / `Sync scroll`) keeping the descriptive `title`/`aria-label`.
2. **`src/webview/diff/diff.css`**: `.diff-action` → `inline-flex` row, `gap:5px`, `height:26px`, `padding:0 8px`, auto width; add `.diff-action-glyph` (~14px) + `.diff-action-text` (10px); keep hover/`.active`/`:disabled`.
3. **Tests** `src/test/webview/diffViewer.test.ts`: per-button glyph span + text span assertion (replace the bare `textContent` glyph list), keep `title`/`aria-label`, stylesheet guard → comfortable height + auto width.
4. **Specs** `component-diff-view.md` (action-button rule + tests line) and `editor-lifecycle.md` (action-bar bullet): glyph + text.
5. **Validation:** `npm run check-types`, `npm run lint`, `npm test`, then the `/fallow-fix` gate.

## Phase A11 — Search parity with the hex view (findings round 10)

Ordered; each step gated by the previous.

1. **`src/webview/search/searchNavigation.ts`** (new, pure, no `S`/DOM/`memoryGrid`): move `shouldNavigateCompletedSearch` here and add `isSearchDiverged`. `src/webview/search/searchEngine.ts` imports them (no behavior change) so the diff bundle stays isolated.
2. **`src/webview/diff/diffSearch.ts`**: completed-key tracking + repeat-Enter navigate; `onProgressUpdate` streaming (paint + count + one-time first jump); divergence-gated `onQueryChanged`; modulo wrap in `stepMatch`; `applyMatches` selects the active match (`selection: true`); export `refreshDiffSearchCount()` and call it from `mountDiffSearch`.
3. **`src/webview/diff/diffViewer.ts`**: call `refreshDiffSearchCount()` after `setDiffSummary` re-injects the bar.
4. **Tests** `src/test/webview/diffViewer.test.ts`: repeat-Enter navigates (no second engine run), streaming count/jump, active-match selection + `Ctrl+C` copy, wrap at both ends, divergence keep/clear, count survives `setDiffSummary` re-render. Keep `searchBar.test.ts` green.
5. **Specs** `component-diff-view.md` (search rule + tests) and `component-search-bar.md` (drop the diff "known gap"; note full parity).
6. **Validation:** `npm run check-types`, `npm run lint`, `npm test`, then the `/fallow-fix` gate.

## Phase C — Finish (after Phase A11 is green)

1. Commit all working-tree changes for the task (single commit; no secrets; match repo commit style).
2. Run `/update-changelog` (`.agents/skills/update-changelog/SKILL.md`) to prepare the changelog entry synchronized with package version and the committed changes since the latest release tag.
3. Record the work in the task journal / wrap-up.

## Validation Commands

- `npm run check-types`
- `npm run lint`
- `npm test`
- Fallow scan, then the `fallow-fix` skill for findings.
- Manual: `npm run watch`, F5, run `HexScope: Compare with...` on an IHEX and an SREC file; verify AC2-AC9.

## Risky Files / Rollback Points

- `src/webview/components/hexView/hexView.ts`, `hexView.css`, `src/webview/hexViewer.ts` — shared grid; parity-gated by existing tests. Roll back this step first if the single-file viewer regresses.
- `src/hexEditorSession.ts` — touched only for the `serializeParseResult` extraction.
- Rollback is branch-level; no persisted state, schema, or migration.

## Review Gates

- After step 1: hexView/webview tests green (refactor is behavior-preserving).
- After step 5: `computeByteDiff` unit tests green before any UI work.
- Before finish: full-scope `trellis-check` + spec updates.
