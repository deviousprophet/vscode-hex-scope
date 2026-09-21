# Technical Design — Hex Diff View

## Architecture & Boundaries

Runtime placement follows `.trellis/spec/frontend/directory-structure.md` (core = runtime-neutral, host = `vscode`-importing, webview = browser-only).

| Layer | New / changed | Responsibility |
|---|---|---|
| Core | `src/core/diff.ts` (new) | Pure byte-diff engine over `MemorySegment[]`. No `vscode`, no DOM. |
| Core | `src/core/wire.ts` (new, extraction) | `serializeParseResult` moved out of `hexEditorSession.ts`. |
| Host | `src/diff/diffEditorPanel.ts` (new) | Owns the two files, parse, diff, webview panel, lifecycle/disposal. |
| Host | `src/extension.ts` (changed) | Registers the compare command + file picker. |
| Host | `package.json` (changed) | Contributes command + editor-title menu entry. |
| Host | `esbuild.js` (changed) | Adds `src/webview/diffViewer.ts` → `dist/diffViewer.js`. |
| Protocol | `src/diffProtocol.ts` (new) | Typed hostwebview union for the diff surface. |
| Browser | `src/webview/diffViewer.ts` (new) | Diff composition root. |
| Browser | `src/webview/diff/` (new) | `diffModel.ts`, `diffGrid.ts`, `diffSummary.ts`, `diff.css`. |
| Reused | `src/webview/components/hexView/*` | `HexView` + `renderHexViewHeader` / `renderHexViewHtml` + paint. |
| Reused | `src/core/parser/*`, `core/document.ts`, `core/types.ts` | Parse, `detectFormatFromParts`, `WireParseResult`. |
| Reused | `src/webview/render/virtualScroll.ts` | Shared virtual-scroll math (host-computed). |

Rationale: a separate diff bundle avoids booting the single-file app shell (sidebar, toolbar, state, integrity, scripts) for a grid + summary surface, and keeps `webviewProtocol.ts` single-editor.

## Prerequisite Refactor — de-globalize `HexView`

`HexView` listeners are already root-scoped; only id queries and id CSS block two instances.

- `src/webview/components/hexView/hexView.ts`: `#mem-header` → root-scoped `.mem-header` (lines 94, 110, 209); `#mem-scroll` → `.mem-scroll` (line 191).
- `src/webview/components/hexView/hexView.css`: `#memory-view` / `#mem-header` / `#mem-scroll` selectors → class selectors.
- `src/webview/hexViewer.ts` shell (lines 1206-1208): add classes beside the existing ids, so `memoryGrid.ts` / `hexViewer.ts` `getElementById` callers keep working.
- Add a horizontal-scroll seam: the component scroll handler reports `scrollLeft` alongside `scrollTop`, and a `setScrollLeft(left)` method is exposed.
- Parity gate: `src/test/webview/components/hexView.test.ts` and `src/test/webview/webview.test.ts` pass unchanged.

## Contracts

### `src/core/diff.ts`

```typescript
export type DiffKind = 'changed' | 'added' | 'removed';

export interface DiffRun { start: number; end: number; kind: DiffKind; count: number; }
export interface DiffSummary { changed: number; added: number; removed: number; }
export interface DiffModel { summary: DiffSummary; runs: DiffRun[]; }

export function computeByteDiff(
    a: readonly MemorySegment[],
    b: readonly MemorySegment[],
): DiffModel;
```

Semantics: sweep the union of resolved addresses from both sides; address in both → compare bytes (`changed` when different); address only in A → `removed`; only in B → `added`. Adjacent same-kind addresses merge into one run. Addresses mapped in neither file never appear. Runs are sorted ascending.

### `src/diffProtocol.ts`

```typescript
export interface DiffSide {
    name: string;
    path: string;                 // full path, always available for tooltip/disambiguation
    format: 'ihex' | 'srec';
    parseResult: WireParseResult;
    labels: SegmentLabel[];
}

export type DiffProviderToWebview =
    | { type: 'diffInit'; generation: number; a: DiffSide; b: DiffSide; diff: DiffModel }
    | { type: 'diffError'; generation?: number; message: string };

export type DiffWebviewToProvider =
    | { type: 'ready' }
    | { type: 'copyText'; text: string; label?: string };
```

Serialization reuses the moved `serializeParseResult` (`core/wire.ts`), which copies each `Uint8Array` into an exact `ArrayBuffer` — same seam contract as the single-file editor.

### `DiffEditorPanel` (`src/diff/diffEditorPanel.ts`)

```typescript
export class DiffEditorPanel {
    static readonly viewType = 'hexScope.hexDiff';
    static open(context: vscode.ExtensionContext, baseUri: vscode.Uri, otherUri: vscode.Uri): Promise<void>;
}
```

Owns: file read, format detection (`detectFormatFromParts`), compact parse (shared parse dispatch), `computeByteDiff`, the `WebviewPanel` (`ViewColumn.Active`, read-only), the HTML shell, `ready`/disposal handling. Cleanup registered before awaiting reads (mirrors `editor-lifecycle.md` panel-cleanup rule).

## Data Flow

1. User runs `HexScope: Compare with...` with a supported file active.
2. Command validates the base file (`parseResultIsValid`); prompts `showOpenDialog` filtered to the eight extensions; validates the chosen file.
3. `DiffEditorPanel.open` reads/parses both, computes the diff, serializes both sides.
4. Panel opens, webview sends `ready`, host posts `diffInit`.
5. Webview builds one row model (identical on both sides), renders two `HexView` instances, paints diff classes, renders the summary bar + navigation, and syncs scroll.

## Grid / Row Model

- One `HexViewRow` per 16-byte-aligned block over the union of mapped ranges. Block is `data` when mapped on either side, `gap` only when mapped on neither.
- Per side, a byte cell exists only where that side maps the address; otherwise `be` empty cell. An added block → empty cells on A, values on B.
- Cell `cls` combines the base byte class with `diff-chg` / `diff-add` / `diff-del`.
- Shared address column: the left grid renders `.addr-cell`; the right grid hides it via a variant class. Rows and BPR are identical, so addresses stay aligned.
- Scroll sync: host mirrors `scrollTop` (from `onVisibleWindowChange`) and `scrollLeft` (new callback) between instances; both grids share identical row heights.

## Navigation & Summary

- Summary bar: total bytes changed / added / removed from `DiffModel.summary`.
- Next/previous difference: walk `DiffModel.runs`, scroll the target address into view (`HexView.scrollTo`), highlight the active run; disable at ends.

## Labels (Phase B)

`diffInit` already carries `labelsA` / `labelsB`. Phase B renders them as read-only `.seg-banner` context per side. No `saveLabels`, no label editing.

## Validation & Error Matrix

| Condition | Response |
|---|---|
| Base or chosen file has checksum/malformed errors | Do not compare; warn and offer Quick Repair (mirrors `openInHexScope`). |
| File read/parse fails | Post `diffError`; render error card. |
| Unknown webview message | Ignore (typed dispatcher). |
| Panel disposed / load superseded | Abort parse, ignore stale generation, clear host state. |
| Address gaps / differing formats | Union model; gap rows / empty cells; no synthetic zeros. |
| Identical files | Empty summary and run list; grid renders plain. |

## Trade-offs

- **Separate bundle vs mode flag**: isolation and a smaller surface chosen; cost is a second esbuild entry.
- **Run list vs per-address map**: runs stay compact for large sparse images; cost is a host sweep of mapped bytes.
- **Address-keyed vs textual**: shifted-but-identical blocks count as removed + added; accepted because firmware is address-addressed.

## Findings Round 2 — Diff Surface Upgrades

Post-review findings and their designs. All are Phase A edge/UX fixes; the diff surface stays read-only.

### F1 — Blank lower half

`diff.css` gives `.diff-error { display: grid }` and `.diff-body { display: flex }`, which override the HTML `hidden` attribute, so the hidden error container still occupies `flex:1` and splits the viewport 50/50. Fix by gating both on the attribute:

```css
.diff-body[hidden], .diff-error[hidden] { display: none; }
```

### F4 — Addresses on both panes

Remove the `.diff-hide-addr` class from the B panel shell and drop the `.diff-hide-addr .addr-cell` rule; both grids render their own address gutter.

### F7 — Divider

Replace the 1px `.diff-side` border with a dedicated `.diff-split` element between the panes: `3px`, higher-contrast token, `:hover` brightens, static width. Sides stay `flex:1`; the splitter is `flex:0 0 3px`.

### F3 — Read-only pointer parity

Host owns one selection range in `diffGrid.ts`; mirrors it into both grids via render-input `selection` (already supported) and repaints with `HexView.paintSelection`. Wire both instances:

```typescript
onCellClick(addr, shift, col)      // anchor + extend, mirrored paint
onSelectionChange(range)           // drag range
onAddressRowClick(rowBase, shift)
onAddressRowDrag(rows)
```

Copy: `Ctrl+C` (host document keydown, selection present) resolves the source pane's bytes for the selected mapped addresses and posts `copyText`; the host writes `vscode.env.clipboard`. Unmapped addresses are skipped (no zero-fill), matching `core/byteTools/copy.ts`.

### F5 — Action bar + view modes

`diffSummary.ts` renders: counts · `Prev diff` · `Next diff` · `Show all` · `Show diff` · `Swap sides` · `Find` · `Sync scroll`.

- `viewMode: 'all' | 'diff'` in `diffGrid.ts`; `diff` filters `data.rows` to rows with at least one diff byte (gaps and identical rows removed). Zero rows under `diff` → `No differences` empty state.
- `syncScroll` boolean (default `true`) gates the `syncFrom` mirroring in `diffGrid.ts`.
- `findVisible` toggles the search bar.

### F2/F6 — Swap + search

- `Swap sides` exchanges `data.a` / `data.b` and the two head labels, then re-renders. Diff runs are address-keyed and `diffClassForSide` already colors per side, so `added`/`removed` swap automatically.
- `Find` reveals a `SearchBar` instance (reused component + `searchBar.css`). Host `runSearch` uses `core/search.ts` per side over hydrated `SerializedSegment[]`; match addresses are unioned (dedupe by address) and painted through render-input `matchSet` / `activeMatch` in both grids. Count = combined distinct addresses. Next/previous walks addresses and reuses `scrollToDiff`.

### F7' (labels) — Same-name files

Host sends `DiffSide.path` (full path). `diffViewer.ts` computes the label: basename, unless both sides share it, then the shortest disambiguating trailing path suffix. `title` carries the full path; the panel tab title uses the same labels.

## Findings Round 3 — Explorer Compare Selection (Beyond Compare style)

Replaces the dialog/quick-pick flow with Explorer selection.

### Commands and contributions (`package.json`)

Remove `hexScope.compareWith` (`Compare with...`) and its menu entry. Add:

| Command | Title | `when` (inside `hexScope.actions` submenu) |
|---|---|---|
| `hexScope.selectAsFirst` | `Set as 1st file to compare` | `resourceLangId =~ /^(intel-hex|srec)$/ && !listMultiSelection && explorerViewletFocus` |
| `hexScope.compareToStaged` | `Compare with the 1st file` | same + `hexScope.hasCompareSelection` |
| `hexScope.compareSelected` | `Compare Two Files` | `resourceLangId =~ /^(intel-hex|srec)$/ && listDoubleSelection && explorerViewletFocus` |

The three compare items use `group: "3_compare"` (VS Code's built-in Explorer compare group) while `Open with HexScope` / `Quick Repair` stay in `group: "navigation"`. VS Code always sorts `navigation` first, so the submenu renders two categories: navigation, then compare.

`explorerViewletFocus` is the explorer-only gate so the items never leak into the editor-title `HexScope` submenu. `listDoubleSelection` gives exact-two (Decision 21); three or more matches nothing. There is no clear command.

### Selection stash (`src/diff/compareSelection.ts`, host)

```typescript
interface CompareSelection { uri: vscode.Uri; name: string }
class CompareSelectionStore {
    get(): CompareSelection | null;
    set(uri: vscode.Uri): void;      // stores the file + setContext(hexScope.hasCompareSelection, true)
    clear(): void;                  // drops the file + setContext(..., false)
}
```

- Session memory only; a fresh window starts empty.
- No status-bar item (Decision 19); the set confirmation is the command's information message.
- The store is created in `activate` and pushed to `context.subscriptions`.

### Command handlers (`src/extension.ts`)

- `selectAsFirst(uri)`: reject folders/unsupported (`isSupportedHexFile`); `store.set(uri)`; information message naming the file and the next step.
- `compareToStaged(uri)`: `store.get()` must exist; validate both (`validateComparable`); on success clear the store and `DiffEditorPanel.open(context, staged, clicked)`.
- `compareSelected(uri, selectedUris)`: require exactly two supported (`selectedUris ?? [uri]`, dedupe); clicked `uri` is A/left, the other B/right; validate both; open.
- Palette invocation without a resource: warn `Select a firmware file in the Explorer` and return.

### Removals

- Delete `src/diff/diffPicker.ts` and its tests; drop `pickComparisonTarget`, `chooseOtherFile`, `browseForFile`, `supportedOpenPaths`, `openTabPaths`, `documentPaths`, `orderedPair`, `ComparisonPickerDeps`/`resolveComparisonTarget` from `src/extension.ts` (superseded by the stash flow). `validateComparable` and `isSupportedHexFile` stay and are reused.
- Delete the `Clear Compare Selection` command and the `CompareSelectionStore` status-bar item (`clear()` now only drops the stash + context key).

### Validation & error matrix

| Condition | Response |
|---|---|
| `Compare with the 1st file` with no staged file | Item hidden by `when`; if invoked from palette, warn. |
| Second/other file unsupported (multi-select) | Warn naming the file; open nothing. |
| Stashed file deleted/moved/invalid at compare time | `validateComparable` warns (unreadable names the file; checksum/malformed offers Quick Repair); open nothing. The stash is kept — it clears only on a successful compare (R21). |
| Checksum/malformed file | Existing `validateComparable` warning + Quick Repair offer. |
| Three or more selected | No item; palette invocation warns. |

## Findings Round 4 — Diff View Polish

Post-review UX fixes for the diff surface. Still read-only.

### R4-1 — Scroll stability

`diffGrid.syncFrom` rebuilds both panes' `innerHTML` on every scroll event (`renderDiffGrid` at `diffGrid.ts:293-294`), so the pane being scrolled is destroyed and recreated mid-scroll — a blank/flicker band, worst in compressed (large-file) mode where both panes also carry fixed height + `windowTop`.

Fix in `diffGrid.ts`:
- Coalesce scroll-driven renders with `requestAnimationFrame` (one render per frame).
- Track the last rendered visible range (`[start, end)` + layout version + view/sync state); skip the render when unchanged.
- Keep the follower mirror (`setScrollTop`/`setScrollLeft`) but only re-slice when the range actually moves.

### R4-2 — Loading screen + real progress

`diffHtml` renders an empty `<div id="app">`; the host parses both files on `ready` with no feedback.

- `diffHtml` gets the same loading card markup used by `hexEditorSession._getHtml` (eyebrow / title / text / animated bar), naming both files, with a determinate bar target.
- New host→webview message (union in `src/diffProtocol.ts`):
  ```typescript
  | { type: 'diffProgress'; stage: 'read' | 'parse' | 'diff'; completed: number; total: number }
  ```
- `DiffEditorPanel` posts `diffProgress` while reading/parsing each file (using the parsers' `onProgress`) and once around `computeByteDiff`, throttled like `LoadProgressReporter`.
- The webview swaps the card for the grids on `diffInit`, and for the error card on `diffError`.

### R4-3 — Search bar always visible

`diffSearch.ts` hides `#diff-search` until `Find` (`findVisible` starts `false`, `#diff-search.open` gates display), and `diffSummary.ts` renders a `Find` toggle button.

Fix: mount `SearchBar` on boot and always show `#diff-search`; delete `toggleFind`/`isFindVisible`/the `Find` button (and its active-state wiring). `Ctrl+F` focus/select stays in the reused `SearchBar` (close/open no-ops).

### R4-4 — Toolbar layout (two rows)

`diffSummary.ts` markup becomes two rows:

- Row 1: `Show all` / `Show diff` toggle + `Prev diff` / `Next diff` (left), `Swap sides` (center, on the pane split), always-visible search bar (right).
- Row 2: `Sync scroll` toggle (left), diff stat (changed / added / removed) centered.

The search bar moves out of `#diff-search` below the toolbar and into the row-1 right slot (still the reused `SearchBar` markup). Diff stat leaves row 1 and is centered on row 2. Center alignment uses a 3-slot flex row so `Swap sides` sits on the split line for equal panes.

### R4-6 — Icon action buttons

Match the repo's webview convention (Unicode glyphs, no codicon font). `diffSummary.ts` `actionButton` renders a glyph instead of a label:

| Action | Glyph | `title` / `aria-label` |
|---|---|---|
| `diff-prev` | `▲` | Previous difference |
| `diff-next` | `▼` | Next difference |
| `diff-show-all` | `≡` | Show all rows |
| `diff-show-diff` | `≠` | Show differences only |
| `diff-swap` | `⇄` | Swap sides |
| `diff-sync` | `⇅` | Sync scroll |

Each `<button class="diff-action">` carries `title` + `aria-label` (readable tooltip; text buttons had visible labels, icons need this for accessibility parity) and keeps the `.active` state for the toggle pair / `Sync scroll`. Size: comfortable hit target (≈26×26px, ~14px glyph) rather than the 18px icon minimum, per the review request.

`actionButton(id, label, glyph, active)` gains the glyph + tooltip params; `updateToggleButtons` is unchanged.

### R4-5 — Format pill (shared class)

Extract the stats-bar pill rule into one shared utility class `.fmt-pill` in `src/webview/styles/base.css`; `statsBar.css` `.si-fmt .svl` uses it, and `diffViewer.setSideHead` renders the format as `<span class="fmt-pill">IHEX</span>` after the name (no ` · ` separator).

## Findings Round 5 — Concurrent Load (regression fix)

Round 4's `loadBothSides` (`src/diff/diffEditorPanel.ts:117-121`) serializes read+parse to keep `diffProgress` monotonic. Parsing dominates, so two similar files now cost ~2× the single-file time — the loading card made a pre-existing wait visible and also introduced this serialization.

Fix:

- Read and parse both sides with `Promise.all`; keep `AbortController`/generation staleness checks.
- Each file's progress is a fraction in `[0, 1]` — its read fills the first half (`0 → 0.5`) and its parse the second (`0.5 → 1`, relayed from the parser's `completed/total`). (The earlier "read completes at 1" wording was wrong: it would regress a file's own fraction from 1 back to `parse = 0`; the shipped mapping keeps each fraction monotonic.) Post `completed = combinedLoadProgress([fractionA, fractionB])`, `total = 2`. Sum of two monotonic fractions is monotonic, so the bar never regresses; a file that throws stops contributing at its last fraction.
- Keep the `diffProgress` shape (`stage` + `completed` + `total`) unchanged. With concurrency the stage reflects the furthest phase reached (`read` until both reads finish, then `parse`, then `diff`), so the card's stage label stays coherent.
- Extract the fraction-summing into a pure helper (e.g. `combinedLoadProgress(fractions)`) so monotonicity is unit-testable without the panel.

## Compatibility & Rollback

- The de-globalization refactor keeps ids on the shell elements and swaps CSS selectors only, so existing `getElementById` call sites and tests are unaffected.
- The dialog picker removal drops only `hexScope.compareWith`; the four new commands cover selection, and `DiffEditorPanel.open` is unchanged.
- Rollback: revert the branch; no persisted state, schema, or migration is introduced.

## Specs to Update (Phase 3)

- `.trellis/spec/frontend/editor-lifecycle.md` — new diff panel + protocol.
- `.trellis/spec/frontend/memory-navigation.md` — addressed diff rows/gaps.
- `.trellis/spec/frontend/components/component-hex-view.md` — class-scoped contract, scroll-left seam, remove the "future diff task" note.
- A new `components/component-diff-view.md` (or feature spec) for the diff surface.
