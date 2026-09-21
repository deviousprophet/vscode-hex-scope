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

## Phase C — Finish (after Phase A2 is green)

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
