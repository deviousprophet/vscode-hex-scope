# PRD: Hex Diff View

## Goal

Give HexScope users a way to compare two Intel HEX / Motorola SREC firmware files side-by-side at the byte level, aligned by memory address, so they can see what changed between firmware revisions (and added/removed address ranges) directly in an address-aware hex grid.

User value: firmware engineers diffing two build outputs, verifying flash images match, or auditing what a change touched — without leaving the hex grid context HexScope already provides.

## Background / Confirmed Facts

- HexScope has a custom readonly editor `hexScope.hexEditor` (viewType) registered via `CustomReadonlyEditorProvider` (src/hexEditorProvider.ts:6).
- `HexEditorSession.resolveCustomEditor` (src/hexEditorSession.ts:313) loads one document, parses via `parseIntelHexCompact` / `parseSRecCompact`, serializes to webview, wires messaging, external-change watcher, labels/structs/integrity persistence.
- Both parsers produce `CompactParseResult` with `segments: MemorySegment[]` where `MemorySegment = { startAddress, data: Uint8Array }`; contiguous ranges only, address gaps preserved as separate segments (src/core/parser/segments.ts:13).
- The single-file webview has: memory view (`MemRow` rows + virtual scroll), record view, labels sidebar (`SegmentLabel`), stats bar, search, edit transactions.
- Labels stored per-uri: `hexScope.labels.${uri}` in workspaceState (src/hexEditorSession.ts:388).
- Commands registered in src/extension.ts; menus declared in package.json `contributes.menus` with `resourceLangId =~ /^(intel-hex|srec)$/` conditions.
- Issue #103 (author deviousprophet, assigned deviousprophet) is the source requirement set.

## Requirements

R1. **HexScope: Compare Selected** (multi-select of two supported files, explorer context menu, like VS Code built-in compare) and **HexScope: Set as 1st file to compare** / **HexScope: Compare with the 1st file** (staging flow) — all available from explorer context menu and editor title bar when supported files are involved. No file picker.
R2. Opens a dedicated, read-only diff editor separate from the single-file Memory/Records viewer.
R3. Side-by-side hex grid showing both files aligned by address (unified mode explicitly out of scope, never planned).
R4. Byte-level highlighting for:
    - Changed bytes (both files have data, values differ)
    - Added address ranges (data in file B, not in A)
    - Removed address ranges (data in file A, not in B)
R5. Summary bar with total bytes changed / added / removed and jump-to-next/previous-difference navigation.
R6. Respect existing address-range labels so diffs can be viewed in context of named regions.
R7. Gracefully handle differing address spaces/gaps (e.g. SREC vs HEX, non-contiguous records).
R8. **Visual parity with the single-file hex editor.** The diff view uses the same visual language as `hexScope.hexEditor`: shared design tokens (base.css: `--font-editor`, `--cell-size`, `--addr-fg`, `--toolbar-bg`, `--input-*`, etc.), monospace hex grid with the same 16-byte row layout and 4-byte grouping gaps, address gutter in the editor line-number color, toolbar/summary-bar chrome, and themed scrollbar. Diff status colors: changed = amber, added = green, removed = red; A/B side accents stay blue/orange (D23). Nothing in the diff view looks like browser-default HTML.
R9. **Reliable virtual scroll.** Large or gapped diffs render via fixed-row-height windowing: only visible rows (± a render buffer) are in the DOM; each row is absolutely positioned at `index × rowHeight` inside a full-height body; the container scrolls natively with one scrollbar; scroll position survives re-renders (init / update / swap / search). Row height is one source of truth shared by CSS and JS.

## Acceptance Criteria

AC1. Selecting two supported files in the explorer and choosing **Compare Selected** opens the diff editor with the two files; staging a first file then choosing **Compare to <name>** on a second file also opens it immediately.
AC2. Staging state is ephemeral: cleared after a diff opens, and selecting a new first file replaces the old staging.
AC2b. The diff opens in a new, read-only editor showing both files aligned by address; both grids use the same row layout (16 bytes/row default) and address gutter.
AC3. Bytes present in both files are shown with changed bytes highlighted in both panels; only-one-side regions show in the other panel as added/removed (with visual treatment distinct from "changed").
AC4. Summary bar shows accurate total changed/added/removed byte counts and next/prev difference navigation lands on the correct address.
AC5. If labels exist for either file's address ranges, they render in the diff view and can be used to contextualize diffs.
AC6. Files with different address spaces or gaps render without misalignment — addresses always line up across the two grids; empty cells shown where one side lacks data.
AC7. Diff editor is read-only: no edits, no record view, no scripts sidebar actions that mutate. Search is allowed (D21) but is non-mutating.
AC8. Cross-format comparison (ihex vs srec) works.
AC9. Diff view renders with the hex editor's visual language (R8): themed background/foreground, monospace grid, 4-byte grouping, address gutter; changed/added/removed cells are visually distinct and match the editor's color grammar. It must never render as unstyled browser-default HTML.
AC10. Virtual scroll (R9): scrolling a large or gapped diff is smooth and never shows a double-offset/frozen viewport; rows stay aligned to the address gutter; the scroll position is preserved when the diff updates (external change), swap, or search navigation re-renders. DOM row count stays bounded (visible ± buffer), not O(total rows).
AC11. The diff webview loads and renders without runtime errors: all referenced DOM nodes exist at bootstrap (no null deref on first render), and inline-styled geometry is not blocked by the CSP.
AC12. Refusing invalid pairs (D8): opening a same-file (same fsPath) or identical-content pair is blocked with a visible message; pair identity is judged by URI fsPath, never filename — two same-named files in different folders are a valid pair.
AC13. Refusing unparseable files (D9): opening a pair where either file has checksum errors or malformed lines is blocked with the existing Quick Repair message; the diff view never renders half-broken data.
AC14. Live re-diff (D13): an external change to either file re-parses that side and pushes an updated diff to the open tab (debounced ~200ms); no stale diff, no tab close.
AC15. Live revalidation (D15): a live change making the files identical shows an "identical files" state (zero differences, tab stays open); a file becoming unparseable shows a per-panel parse-error state.
AC16. Staged-file feedback (D18): the staged 1st file carries a persistent `FileDecorationProvider` badge/checkmark and menu text reflecting state; cleared when staging clears.
AC17. Keyboard navigation (D20): `Alt+↓` / `Alt+↑` jump to next/prev difference run in the diff webview (in addition to toolbar buttons), with no collision with existing extension keybindings.
AC18. Union search (D21): one query runs against both files' segments; results merge into one union list; matches highlight in whichever panel holds data at that address; next/prev cycles the union. Read-only.
AC19. Side-tagged labels (D22): when A and B have different labels over the same address range, both render, each tagged with its source side; renames between versions stay visible.
AC20. Swap (D23): the Swap control exchanges the two panels' positions while the A/B tags and side accents stay attached to the same files; added/removed semantics never flip.
AC21. Per-panel selection + copy (D11): click-drag selects a byte range within one panel; copy commands (hex string / C array / ASCII) copy from that file's bytes.
AC22. Shared label rail (D6): the union of both files' labels renders in one rail, reusing the label-sidebar pattern; a label's range highlights in both panels where present.
AC23. Minimal chrome (D10): the diff webview carries only the two grids, summary bar, shared label rail, next/prev navigation, swap, and search — no tabs, edit controls, scripts, structs, inspector, bit view, or integrity. Read-only by construction.
AC24. Loading/error presentation: the initial loading state and a `loadError` render styled (not bare text), and the summary bar shows the "identical" state (D19) as a distinct styled indicator.

## Test Requirements

These map to the PRD ACs above; all live under `src/test/`:

- **Core diff** (`core/diff.test.ts`): per-address statuses, union rows + gaps, summary counts, run extraction, address `0` / huge gaps / empty results, cross-format parse inputs (AC3/AC4/AC6/AC8).
- **Pair-URI round-trip** (`core/pairUri.test.ts`): encode→decode round-trip; same pair always yields the same key; same-name-different-folder pairs stay distinct (AC12/D14).
- **Protocol discriminators** (`webview/webview-message-model.test.ts`): `diffInit` / `diffUpdate` / `diffSwap` / `diffSearch` dispatch + model application; unknown/malformed diff-adjacent types no-op (D1/D21).
- **View model** (`webview/diff-view-model.test.ts`): next/prev run-focus wrap, search-match-focus wrap, row/column indexing, `DIFF_ROW_BYTES` parity with core (R5/D16/D21).
- **Extension commands + staging** (`extension/extension.test.ts`): command registration, staging lifecycle (ephemeral), `compareToStaged` opens a `hexdiff` tab (AC1/AC2/D7/D17/D18).

## Out of Scope

- Editing / write-back of either file from the diff view.
- Three-way merge or patch generation/export.
- Binary (non-HEX/SREC) file diffing.
- Structural/record-level diff (e.g. compare record type sequences); only byte-level by address.
- Applying labels in the diff view; labels remain read-only display.

## Decisions

D1. **Editor surface: new custom editor viewType `hexScope.hexDiff`** (Option A). Registered alongside `hexScope.hexEditor` via `CustomReadonlyEditorProvider`, backed by a virtual `CustomDocument` wrapping the (baseUri, compareUri) pair. One tab per diff, title shows both filenames, `retainContextWhenHidden`, reuses session + `webviewProtocol` messaging plumbing.
D2. **Layout: side-by-side only.** Unified mode is explicitly not planned now or in the future (user decision). R3 narrowed: side-by-side hex grid only.
D3. **Diff computed host-side (extension), once per open**; serialized diff sent to webview over the existing `webviewProtocol` channel. Diff logic lives in `core/` (testable) next to `memory.ts` / `segments.ts`; webview is a thin renderer.
D4. **Byte-level diff granularity.** Unified per-address status map (unchanged / changed / added / removed / empty). Added/removed "ranges" are display groupings of contiguous same-status addresses, not separate data structures. Summary counts and next/prev navigation operate on per-address statuses.
D5. **Union-of-rows alignment.** Single row set = union of both files' row spans (per-file row collection merged, sorted, deduped). Each row rendered in both panels; a cell is `empty` when that side has no byte at that address. One shared virtual-scroll state, one scrollbar.
D6. **Shared label rail.** Union of both files' `SegmentLabel`s rendered in one left rail (reusing the label-sidebar pattern); a label highlights across both panels where its range exists. Labels display-only, never editable from diff view.
D7. **Beyond Compare-style staging, no picker.** Two entry paths, both open the diff immediately:
    - Explorer multi-select of 2 supported files → context menu **Compare Two Files** → diff.
    - Explorer single file → **Set as 1st file to compare** (stages as left/base A) → another file's menu shows **Compare with the 1st file** → diff opens immediately.
    Staging state is **ephemeral** (session-only, cleared as soon as a diff opens or a different first file is picked; never persists across restarts). Editor title bar uses the same staging verbs. No file-picker flow exists.
D8. **Refuse invalid pairs.** Opening is blocked (message shown) for same-file (same URI). Identical-content pairs are **not** blocked: they open and show the "identical files" state (D15 supersedes the earlier identical-content block idea). Pair identity is judged by **URI (fsPath), never by filename** — two same-named files in different folders are a valid, distinct pair.
D9. **Refuse unparseable files.** Reuse the single-file gate (`parseResultIsValid`, src/extension.ts:26): if either file has checksum errors or malformed lines, opening is blocked with the existing Quick Repair message. The diff view never renders half-broken data.
D10. **Minimal chrome.** Diff webview carries only: two side-by-side grids, summary bar, shared label rail, next/prev difference navigation, swap button, and byte-pattern search (D21). No tabs, edit controls, scripts, structs, inspector, bit view, or integrity. Read-only by construction.
D11. **Per-panel selection + copy.** Click-drag selects a byte range within one panel (A or B); the selection renders with the shared `sel` treatment. Copy formats hex string / C array / ASCII are offered in a toolbar copy control and via Ctrl+C (uses the chosen format), reusing the existing `formatCopyCommand` formatters. Copy is per-side: it reads that file's bytes for the selected addresses.
D12. **Fixed 16 bytes/row** (same as existing viewer `BPR = 16`, src/webview/state.ts:8) — no toggle. Default orientation: **A = left panel, B = right panel**; a **Swap button** exchanges the panel positions (identity stays file-bound, D23).
D13. **Live re-diff on external change.** Watch both file URIs (reuse the single-file watcher + debounce pattern, src/hexEditorSession.ts:524); on change of either, re-parse that side, recompute the diff host-side, push an update to the webview. No stale diffs.
D14. **Pair-keyed tab identity.** Tab title shows both filenames (`v1.hex ⟷ v2.hex`); the virtual `CustomDocument.uri` encodes the canonicalized URI pair so the same pair reuses one tab and same-name-different-folder pairs stay distinct. Swap (D12) is a view preference and does not change the pair key.
D15. **Live revalidation.** D8/D9 gates apply to *opening* only. In an open diff, a live change making the files identical shows an "identical files" state (zero differences, no close); a file becoming unparseable shows a per-panel parse-error state. The open tab stays current and truthful.
D16. **Diff-run navigation.** Next/prev jumps between contiguous runs of non-unchanged addresses (changed/added/removed merged); landing on a run highlights its first address. Runs are derived from D4's per-address status map.
D17. **Staging independence & order.** Staging is independent of open diff tabs (staging a fresh pair anytime is allowed; no blocking on open tabs). In **Compare Selected**, the file selected first in the multi-select is A (left); a staged first file does not override selection order. Any staged A is cleared after a diff opens (D7).
D18. **Staged-file visual feedback.** The staged (1st) file gets a persistent visible marker so the pending state is obvious across folders: a `FileDecorationProvider` badge/checkmark on the staged file row plus menu text reflecting state ("1st file: <name> (selected)"). Cleaned up when staging clears (D7/D17).
D19. **Summary bar contents.** Live counts: "identical" when files match, else "N changed · M added · K removed" (from D4's per-address status map). Doubles as the D15 identical-state indicator.
D20. **Keyboard shortcuts for diff navigation.** `Alt+↓` / `Alt+↑` jump to next/prev difference run (D16) in the diff webview, in addition to toolbar buttons. No collision with existing extension keybindings or VS Code defaults.
D21. **Union byte-pattern search.** Diff view gets the single-file search UI (query box + mode/endianness, reusing `searchControls`/`searchEngine` glue); one query runs the existing host-side `SearchEngine` (src/core/search.ts) against **both** files' segments. Match sets merge into one union list; matches highlight in whichever panel holds data at that address; Next/Prev cycles the union. Search is read-only (does not mutate either file).
D22. **Side-tagged labels.** When A and B have different labels over the same address range, **both** render, each tagged with its source side (color/prefix). Renames between versions stay visible rather than being merged away. Labels display-only (D6).
D23. **Swap = exchange positions, not identity.** A/B identity attaches to the **file**, never to screen position. The shared label rail (D6) permanently shows side-tagged labels "A: <name>" / "B: <name>" with accent colors (A=blue, B=orange); Swap slides the panels (positions exchange) and the rail's side tags reorder, while the A/B tags stay on the same files. The same blue/orange accents repeat in summary-bar counts and label-rail side tags (D22) so A/B is recognizable everywhere. Rationale: diff status (D4) is computed relative to A, so roles never rename on swap (D14). Red/green are avoided for side accents because they collide with changed/added/removed highlight semantics.
D24. **Visual parity (R8).** The diff webview loads the shared `base.css` design tokens and mirrors the editor's cell / address / toolbar / summary-bar conventions rather than defining its own look. Diff status colors: changed = red, added = green (both panels), removed = magenta (both panels) — distinct from the blue/orange A/B side accents (D23). The webview HTML must include every DOM node the view script references at bootstrap (no `getElementById(...)!` on missing nodes) and a CSP that permits the renderer's inline geometry styles, or the renderer must not rely on them. Rationale: users already read the hex-grid grammar; a divergent look would misread as a different tool.
D25. **Fixed-row-height virtual scroll (R9).** One row-height constant shared by CSS and the windowing math (`DIFF_ROW_HEIGHT`/`.diff-row` height). Rendering: rows absolutely positioned at `index × rowHeight` inside a `position:relative` body whose height is `rows × rowHeight`; the viewport `overflow:auto` container scrolls natively; no `translateY` offset on the body. Re-render restores the container's `scrollTop` because the container element is rebuilt on each render. Rationale: an earlier `translateY`-plus-container-scroll double-offset produced a frozen viewport; absolute positioning keeps position and windowing in one frame of reference.
D26. **Diff grid layout (user-specified, supersedes D5's single-gutter wording).** (a) A fixed **00..0F column header** sits above both panels (sticky at the top of the scroll viewport, scrolls horizontally with the content). (b) Each panel has its **own address gutter** — `[A-addr][A cells][B-addr][B cells]` — so a byte present at an address on one side but absent on the other is still visible as "this address exists here, not there". (c) The grid is **centered** in the viewport when narrower than the window (fit-content + margin auto). (d) A **visible vertical gutter** (2px theme-border + padding/margin) separates the two panels. (e) Highlight color changed from amber to **red** (changed = red, added = green, removed = magenta; D24 updated to match).
D27. **Per-panel parse-error state (D15 live revalidation).** `diffInit`/`diffUpdate` carry `aError`/`bError` (`string | null`). When a side's parse result has checksum/malformed errors, the webview flags that panel (`panel-error`, dimmed cells) and shows a side error banner; the other panel keeps rendering. A live edit making a file unparseable surfaces this instead of silently showing partial bytes.
D28. **Diff search = single-view search parity.** The diff webview reuses the single-file view's search UI and behavior exactly (same `#search-box` controls: mode select Bytes/Value/ASCII/Addr, endian Auto/LE/BE toggle shown for Value mode, `0x` prefix overlay for Addr mode, per-mode placeholders, 🔍/▲/▼/✕, `N / M` match count, Enter runs / Shift+Enter previous, Ctrl+F focuses). `diffSearchRequest` carries `query` + `mode` + `endianness`; the host runs the core `SearchEngine` against **both** files' segments and merges the matches into one union. Matches highlight **per cell** on whichever panel holds data; the current match also gets the search-focus row treatment. The only difference from the single view: it searches both files.
D29. **Per-panel copy (D11).** Click-drag selects a byte range within one panel (A or B; drag locked to the starting side). A toolbar copy control (format select: hex / C array / ASCII) and Ctrl+C copy the selected side's bytes via the shared `formatCopyCommand`. Clicking empty scroll space clears the selection; toolbar/rail clicks keep it.
D30. **Explorer menu switch (single vs double select), kept in the HexScope submenu.** All diff-flow items live inside the `hexScope.actions` submenu (shown whenever `resourceLangId` matches), keeping the HexScope context menu consistent:
    - **Compare Two Files** (`hexScope.compareSelected`) requires `listDoubleSelection` (exactly 2 selected).
    - Single-file items (**Open with HexScope Viewer**, **Quick Repair**, **Set as 1st file to compare**, **Compare with the 1st file**) require `!listMultiSelection`.
    - The handler accepts the multi-select `Uri[]` in **either** the first or second argument (VS Code has passed it as the second arg in practice — a `Array.isArray(second)` catch-all fixed a silent no-op). With insufficient args it warns instead of silently returning.
    So single-select shows only the staging flow; exactly-2 shows only Compare Two Files; >2 shows neither. The submenu's items appear in the editor-title menus (single active editor, no list selection) while Compare Two Files stays effectively explorer-only. The staged state is **cleared as soon as a diff opens** (either entry path), so the badge and "Compare with the 1st file" item disappear immediately (D7). Staging is **menu-only** — no staging keybindings are contributed; bare `Alt+↓/↑` stays reserved for in-diff navigation (D20).
D31. **Unsupported selection → explicit warning.** `compareSelected` validates every picked URI against the supported extensions (`.hex .ihx .ihex .srec .mot .s19 .s28 .s37`); if any is unsupported (e.g. mixed hex+txt selection), it warns "only HEX/SREC files can be compared (unsupported: …)" and does not open. Command-palette entries for the staging/compare commands are gated to `resourceLangId =~ /^(intel-hex|srec)$/` so they can't fire from a non-hex editor.
D32. **Diff chrome (user-specified).** The toolbar sits **on top** (under the file-label rail): view tabs (All/Diff), diff-region navigation, the search box (D28), copy control, and Swap. The summary bar no longer shows changed/added/removed byte counts or region counts — it only signals "Files are identical". **View mode** toggle: **All** shows the full aligned grid; **Diff** shows only visual rows that contain a difference (changed/added/removed); an empty Diff result shows "No differences".




