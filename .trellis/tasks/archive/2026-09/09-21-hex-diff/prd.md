# Hex Diff View

## Goal

Read-only dedicated editor comparing two Intel HEX / SREC files in an address-aligned hex grid with byte-level diff highlighting, a summary bar, and next/previous difference navigation.

## Background

- Source requirement set: repo issue 103 (do not reference the issue number in task, branch, or artifact titles).
- Firmware files are sparse, address-addressed images (Intel HEX / SREC); the same bytes can live at different addresses, so comparison is address-keyed, not textual.
- Existing single-file viewer (`hexScope.hexEditor`) and its `HexView` grid already isolate interaction per instance root (see `.trellis/spec/frontend/components/component-hex-view.md`).

## Key Decisions

1. **Phasing.** One task, two phases. Phase A = compare command, dedicated read-only editor, side-by-side address-aligned grid, changed/added/removed highlighting, summary bar, next/prev navigation. Phase B = unified toggle, label context, SREC↔HEX edge polish.
2. **Editor mechanism.** Command opens a `WebviewPanel` in the editor column (own tab), not a `CustomReadonlyEditorProvider` (which binds a single document; this feature compares two).
3. **Entry point.** Command `HexScope: Compare with...`, available from the editor title bar and command palette when a supported file is active. Base file = active file; the second file is chosen via `window.showOpenDialog` filtered to the eight supported extensions. Two-file/multi-select entry from the explorer is out of scope.
4. **A/B semantics.** A = active file (left), B = chosen file (right). "Added" = mapped in B only; "removed" = mapped in A only.
5. **Diff semantics.** Address-keyed per resolved address across the union of both files' address spaces.
6. **Grid layout.** Side-by-side, row-aligned, single shared address column, fixed 16 bytes per row, only union range rendered.
7. **Surface.** Grid + summary bar + diff navigation only. No sidebar, Records view, editing, scripts, or integrity in the diff editor.
8. **Labels.** Read-only per-side label overlays: A's labels on A, B's labels on B. No label editing in the diff editor. (Phase B.)
9. **Compute location.** Diff is computed host-side in a typed core module; the webview receives compact diff data plus both parsed segment sets.
10. **Grid reuse.** Reuse the existing `HexView` component for the diff grid (confirmed). Requires a prerequisite de-globalization refactor: turn its remaining `#mem-scroll` / `#mem-header` id queries and id-based CSS into root-scoped class selectors, and add a horizontal-scroll sync seam so two instances can coexist.
11. **Naming.** Task "Hex Diff View", slug `hex-diff`, branch `feat/hex-diff`. No issue number anywhere.

### Findings round 2 (post-Phase-A review)

12. **Interaction parity.** Full read-only pointer parity with `HexView`: hover + column hover, click/drag byte selection, address-gutter row selection, copy selected bytes. No editing. Selection is mirrored across both panes (same address range painted on each side).
13. **Action bar.** Buttons, left→right: `Prev diff`, `Next diff`, `Show all`, `Show diff`, `Swap sides`, `Find`, `Sync scroll`. `Sync scroll` default ON. `Swap sides` swaps pane order, header file labels, and diff colors (colors follow the file). `Copy` copies from the pane where the selection was made. Counts (changed / added / removed) remain.
14. **View modes.** `Show all` default = full union row model. `Show diff` = only rows containing at least one changed/added/removed byte; identical rows and gap rows hidden; on zero differences show a `No differences` empty-state message. Navigating to a run keeps the current mode (a run row is by definition a difference row, so it stays visible).
15. **Search.** Reuse the `SearchBar` component and `core/search.ts` engine. One query searches both panes; matches highlight in both grids; the match count is the combined address-ordered set. `Find` toggles the bar (hidden by default). Match next/previous walks addresses in order and scrolls both grids.
16. **Address column.** Visible on both panes (the single shared address column may repeat).
17. **Divider.** 3px higher-contrast divider between panes, brightening on hover, static width (not draggable).
18. **Same-name files.** When both panes share a basename, side labels (and the tab title) use the shortest disambiguating path suffix; the full path is always available as a tooltip. Picker lists supported open editors with their paths plus `Browse…` (no persisted recent-files list).

### Findings round 3 (explorer compare selection, Beyond Compare style)

19. **Explorer-driven selection.** Compare is driven from the Explorer context menu, not a dialog. `Set as 1st file to compare` stashes a left/first candidate in session memory; `Compare with the 1st file` uses that stash with the right-clicked file and opens the diff. The stash clears after a successful compare and on window reload; setting a new 1st file replaces it. There is no explicit clear action and no status-bar item — feedback is the information message shown when the 1st file is set.
20. **Command set.** `hexScope.selectAsFirst` (`Set as 1st file to compare`), `hexScope.compareToStaged` (`Compare with the 1st file`), `hexScope.compareSelected` (`Compare Two Files`). The dialog-based `Compare with...` (`hexScope.compareWith`) and its editor-title entry are removed; the three commands remain in the Command Palette. `Clear Compare Selection` does not exist.
21. **Visibility.** One file selected (`!listMultiSelection`): `Set as 1st file to compare`, plus `Compare with the 1st file` only while a 1st file is staged. Exactly two files selected (`listDoubleSelection`): `Compare Two Files` only. Three or more: no compare items. Items render inside the existing `HexScope` submenu in the `3_compare` group (below the `navigation` group), and only in the Explorer (`explorerViewletFocus`), never the editor title.
22. **Two-file order.** With exactly two selected, the right-clicked file is A/left and the other is B/right.
23. **Explorer-only + validation.** `resourceLangId` describes only the clicked file, so the menu gate is an approximation; the command validates both files (supported extension, valid checksums). An unsupported, folder, unreadable, or checksum-invalid file warns and opens nothing. A stale staged file produces no panel; the stash is kept because it clears only on a successful compare.

### Findings round 4 (diff view polish)

24. **Scroll stability.** In large compressed comparisons, the actively scrolled pane must not blank or flicker. Scroll-driven re-renders are coalesced to one per animation frame and skipped when the visible slice indices are unchanged (both panes render only when the slice actually moves).
25. **Loading screen.** The diff editor shows the same loading card as the single-file viewer while reading, parsing, and computing, with determinate progress from a new `diffProgress` host→webview message (stages `read` / `parse` / `diff`, per-file `completed`/`total`). The card is replaced by the grids on `diffInit` and by the error card on `diffError`.
26. **Search always visible.** The search bar is always visible in the diff view — there is no `Find` toggle or `Find` action button. `Ctrl+F` focuses and selects the input (the reused `SearchBar` binds `Ctrl+F`).
27. **Toolbar layout.** Row 1: `Show all` / `Show diff` toggle then `Prev diff` / `Next diff` (left), `Swap sides` (center, aligned to the pane split), always-visible search bar (right). Row 2: `Sync scroll` toggle (left), diff stat (changed / added / removed) centered.
28. **Format pill.** The side-head format label renders as a pill identical to the hex-view stats-bar format pill, via one shared `.fmt-pill` class used by both surfaces. The `·` separator between name and format is dropped.
29. **Icon action buttons.** The diff action bar uses Unicode-glyph icon buttons (repo convention; no codicon font): `▲` Prev diff, `▼` Next diff, `≡` Show all, `≠` Show diff, `⇄` Swap sides, `⇅` Sync scroll. Every button keeps a `title` and `aria-label`, and the button hit target is comfortably sized (not the 18px icon-button minimum).

### Findings round 5 (loading regression)

30. **Concurrent load.** Round 4 serialized the two files' read+parse to keep progress monotonic, which doubles the wall clock for two similar large files. Restore concurrency: read and parse both sides with `Promise.all`, and keep the bar monotonic by summing the two per-file fractions (`completed = fractionA + fractionB`, `total = 2`). Sum of monotonic fractions stays monotonic.

### Findings round 6 (loading-bar parity)

31. **Loading-bar parity with the hex view.** The diff loading card uses the same *indeterminate animated* bar as the single-file viewer; the host stops width-driving the fill, and `diffProgress` only updates the card text as `Loading <stage> <pct>%…` (stage = `read` / `parse` / `diff`, mirroring `hexViewer.loadProgressLabel`). Supersedes the determinate bar in decision 25.

### Findings round 7 (diff load speed & progress)

32. **True parallelism.** Round 5's `Promise.all` gave concurrency but not parallelism: the extension host is single-threaded, so two CPU-bound compact parses interleave and the pair costs ~1.6–2× one file (measured 4 MiB: parseA 532ms + parseB 544ms → both-concurrent 869ms). Parse each file in its own Node `worker_threads` worker (following the `scriptRunner`/`scriptWorker` precedent) so the pair loads in roughly one file's parse time.
33. **Monotonic progress.** The compact parser emits two stages (`parse` = source scan, `build` = record/segment materialization) that both report a full `completed/total`; the diff mapped both onto the same per-file half, so the stage switch reset the fraction from ~1.0 back to 0 (measured two backwards jumps: 100% → 75% → 80% → 56% → 60% → 94%). Own the per-file fraction in one place and clamp it to a running maximum so the bar only advances.
34. **Zero-copy handoff.** The worker owns the file bytes (transferred, not copied) and returns segment buffers by transfer, so the round trip adds no full-size copy.

### Findings round 7 (diff load speed & progress, continued)

35. **Throttled worker progress.** A worker that posts a message per parser event serializes the two workers: the extension host's single main thread drains ~95k–525k tiny `progress` messages per file, so wall time returns to ~2× one worker (measured 4 MiB 1126ms unthrottled vs 744ms throttled; 16 MiB 4672ms vs 2593ms). Post only when `Math.floor(fraction * 100)` strictly advances (integer percent), keep the running-max fraction, and never throttle the `result` post.

### Findings round 8 (read weight)

36. **Read weight (bar shape).** The read slice of each file's unit (`READ_SHARE`) must be small, not 0.5: reading is fast and posts no intermediate progress, so a half-bar reservation made the bar jump straight to 50% and then crawl 50→100 during the parse. `READ_SHARE = 0.05` so the bar tracks the dominant parse (reads ≈5%, parse 5→100%).

### Findings round 9 (action buttons show icon + text)

37. **Icon + text action buttons.** The diff action bar buttons keep their Unicode glyph but add a short visible text label (`≡ Show all`, `≠ Show diff`, `▲ Prev diff`, `▼ Next diff`, `⇄ Swap sides`, `⇅ Sync scroll`) so the actions are readable without hovering; the descriptive tooltip/`aria-label` is unchanged. Supersedes the icon-only decision 29 (R29 / AC31).

### Findings round 10 (search parity with the hex view)

38. **Full search parity.** The diff search bar adopts the hex surface's host semantics for everything except the two intentional differences (the bar is always visible; one query unions both panes' addresses). Concretely:
    - **Completed-query Enter navigates.** A second Enter / Shift+Enter on an unchanged completed query steps to the next/previous match instead of re-running the search, driven by the same canonical key (`searchKeyFor`) and completed-key tracking as the hex view.
    - **Streaming results.** Consume the engine's `onProgressUpdate` to paint matches, update the count, and jump to the first hit while the search is still running, instead of waiting for `onComplete`.
    - **Active match is the selection.** Navigating to a match sets the mirrored read-only selection to that match's address span (so `Ctrl+C` copies it), not just a highlight.
    - **Wrap-around navigation.** Next/previous match wrap at the ends (modulo), matching the hex view.
    - **Divergence-aware invalidation.** A UI-only query/mode/endian change drops the match set only when the visible search key *diverges* from the running/completed search; an unchanged key keeps the current matches.
    - **Count survives a toolbar re-render.** After the toolbar re-injects the search bar, the host re-pushes the current match count.
    - Search options already persist within a panel because the component instance is cached and `toHtml()` regenerates from its internal state; only a fresh compare (`resetDiffSearch`) resets them.

## Requirements

- R1 — `HexScope: Compare with...` command appears for a supported active file (editor title bar + command palette) and prompts for the second file.
- R2 — Comparison opens in a dedicated read-only editor tab in the editor column; both files are shown by name.
- R3 — The grid is address-aligned: each side uses one row per 16-byte-aligned address block over the union of both files' ranges.
- R4 — Byte-level highlighting distinguishes: changed bytes, byte ranges mapped in B only (added), and byte ranges mapped in A only (removed).
- R5 — A summary bar reports total bytes changed / added / removed.
- R6 — Navigation jumps to the next and previous difference, cycling through differences in address order.
- R7 — Existing per-file segment labels render as read-only context on their own side. (Phase B.)
- R8 — Files with differing address spaces, formats, or non-contiguous records are handled without error; unmapped-but-aligned bytes render as empty cells, not as false differences.
- R9 — Either pane scrolls the exact same rows: a short file must not leave a blank lower half or a phantom error region; the error state only appears when a comparison fails.
- R10 — Click/drag selection, address-gutter selection, hover + column hover, and copy behave like the single-file `HexView`; selection is read-only and mirrored across both panes.
- R11 — The action bar exposes `Prev diff`, `Next diff`, `Show all`, `Show diff`, `Swap sides`, `Find`, `Sync scroll`; `Sync scroll` starts ON and can be turned off for independent scrolling.
- R12 — `Show diff` filters out identical and gap rows, shows `No differences` when the pair is identical, and keeps the mode when navigating runs.
- R13 — `Swap sides` swaps panes, header file labels, and diff colors; `Copy` copies from the pane where the selection was made.
- R14 — `Find` opens the reused search bar, searching both panes with one query; matches highlight in both grids and next/previous walks matches in address order, scrolling both grids.
- R15 — Both panes show an address column; the divider between panes is thicker and hover-highlighted.
- R16 — Files sharing a basename are disambiguated in the pane labels and tab title, with the full path on hover.
- R17 — The Explorer `HexScope` submenu exposes `Set as 1st file to compare`, `Compare with the 1st file`, and `Compare Two Files` per the visibility rules in Decision 21, in the `3_compare` group; none appears in the editor title.
- R18 — `Set as 1st file to compare` stores the clicked file for the session and confirms it with an information message. There is no status-bar item and no clear command.
- R19 — With a 1st file staged, `Compare with the 1st file` on another supported Explorer file opens the diff with the staged file as A/left and the clicked file as B/right.
- R20 — With exactly two files selected, `Compare Two Files` opens the diff with the clicked file as A/left and the other as B/right.
- R21 — The staged 1st file clears after a successful compare and on window reload; setting a new 1st file replaces it.
- R22 — The dialog-based `Compare with...` command and its editor-title menu entry are gone, and no `Clear Compare Selection` command exists.
- R23 — Comparing 3+ selected files is not offered; an unsupported, folder, unreadable, or invalid file warns instead of opening.
- R24 — Scrolling a large compressed comparison never blanks or flickers the actively scrolled pane; re-renders coalesce to one per animation frame and skip unchanged slices.
- R25 — A loading card shows determinate progress while the comparison loads and is replaced by the grids (or the error card) when loading finishes.
- R26 — The search bar is always visible in the diff view; `Ctrl+F` focuses it; no `Find` button exists.
- R27 — Row 1 is `Show all`/`Show diff` + `Prev diff`/`Next diff` (left), `Swap sides` (center), search bar (right); row 2 is `Sync scroll` (left) and the centered diff stat.
- R28 — The side-head format shows as a pill matching the hex-view format pill, with no `·` separator.
- R29 — Diff action buttons show each action's Unicode glyph together with a short visible text label (`≡ Show all`, `≠ Show diff`, `▲ Prev diff`, `▼ Next diff`, `⇄ Swap sides`, `⇅ Sync scroll`), plus a tooltip and `aria-label`, with a hit target large enough to click comfortably.
- R30 — Both files are read and parsed in parallel worker threads (no serial 2× penalty), while the reported progress stays monotonic from the summed per-file fractions and never exceeds its total.
- R31 — The diff loading card shows the same indeterminate animated bar as the hex view; percent appears only in the card text as `Loading <stage> <pct>%…`, and the bar width is never driven by progress.
- R32 — The diff search bar reaches full parity with the hex search bar's host behaviour: Enter on an unchanged completed query navigates matches instead of re-running; results stream while searching; the active match is the mirrored selection (so `Ctrl+C` copies it); next/previous wrap at the ends; a UI-only change invalidates matches only when the search key diverges; and the match count survives a toolbar re-render. The always-visible bar and the two-pane union search are the only intentional differences.

## Acceptance Criteria

- [ ] AC1 — With a supported file active, running `HexScope: Compare with...` and choosing a second supported file opens a new read-only editor tab.
- [ ] AC2 — A file compared with itself shows zero changed, added, and removed bytes.
- [ ] AC3 — Two files differing in one byte report exactly one changed byte in the summary bar and highlight that byte on both sides.
- [ ] AC4 — A byte range present only in B is counted as added and shown as added on the B side; the corresponding A-side cells are empty.
- [ ] AC5 — A byte range present only in A is counted as removed and shown as removed on the A side; the corresponding B-side cells are empty.
- [ ] AC6 — Comparing an Intel HEX file with an SREC file resolves both to their address spaces and reports differences by resolved address.
- [ ] AC7 — Non-contiguous records and address gaps produce gap rows / empty cells, never synthetic zero bytes or false differences.
- [ ] AC8 — Next/previous difference buttons move the viewport between successive differences and wrap or stop predictably at the ends.
- [ ] AC9 — The diff editor exposes no editing, save, script, integrity, or sidebar affordances.
- [ ] AC10 — Closing the diff tab releases its panels/watchers and leaves no retained host state.
- [ ] AC11 — Comparing a short pair fills the viewport normally: no blank lower half and no phantom error area; a failed comparison shows the error card and hides the grids.
- [ ] AC12 — Dragging or address-gutter-dragging selects the same address range on both panes; `Ctrl+C` copies the source pane's bytes.
- [ ] AC13 — `Sync scroll` ON: scrolling one pane scrolls the other; OFF: panes scroll independently.
- [ ] AC14 — `Show diff` hides identical and gap rows; an identical pair shows `No differences`; `Prev`/`Next` still frame each run.
- [ ] AC15 — `Swap sides` flips pane order and labels and turns added cells into removed cells (and vice versa).
- [ ] AC16 — `Find` reveals the search bar; one query highlights matches in both panes and next/previous walks matches in address order.
- [ ] AC17 — Both panes display addresses; the pane divider is visibly thicker and highlights on hover.
- [ ] AC18 — Two files named `firmware.hex` in different folders show distinguishable side labels and tab title with full paths on hover.
- [ ] AC19 — Explorer on one supported file inside `HexScope` shows `Set as 1st file to compare`; after setting it, an information message confirms the file and `Compare with the 1st file` appears.
- [ ] AC20 — `Compare with the 1st file` on a second supported file opens the diff with the staged file on the left and the clicked file on the right.
- [ ] AC21 — Selecting exactly two supported files in Explorer shows `Compare Two Files`, which opens the clicked file on the left and the other on the right.
- [ ] AC22 — Selecting three or more files shows no compare item in the submenu.
- [ ] AC23 — No status-bar item is shown for the staged file, and the staged file clears after a successful compare and on window reload.
- [ ] AC24 — `Compare with...` and `Clear Compare Selection` do not exist in the Command Palette, submenu, or editor title menu.
- [ ] AC25 — Selecting an unsupported, folder, unreadable, or checksum-invalid file shows a warning and opens no panel.
- [ ] AC26 — Scroll-wheel scrolling a large compressed comparison keeps the actively scrolled pane continuously populated (no blank band/flicker).
- [ ] AC27 — Opening a large comparison shows the loading card with advancing progress, then the aligned grids; a failed comparison shows the error card instead.
- [ ] AC28 — The diff view always shows the search bar; `Ctrl+F` focuses/selects its input; there is no `Find` button.
- [ ] AC29 — The toolbar shows row 1 (`Show all`/`Show diff`, `Prev diff`, `Next diff`, `Swap sides`, search) and row 2 (`Sync scroll`, diff stat centered) as specified.
- [ ] AC30 — Side heads render `<name>` followed by a format pill identical in style to the hex-view stats-bar format pill, with no ` · ` separator.
- [ ] AC31 — The diff action bar shows glyph + text buttons (`≡ Show all`, `≠ Show diff`, `▲ Prev diff`, `▼ Next diff`, `⇄ Swap sides`, `⇅ Sync scroll`), each with a tooltip/`aria-label`; buttons are comfortably sized and toggles still show an active state.
- [ ] AC32 — Comparing two similar large files takes roughly one file's parse time (parallel workers), not two, and the reported progress never moves backwards.
- [ ] AC33 — The diff loading card's bar animates indeterminately (never width-driven); its text reads `Loading read …%` / `Loading parse …%` / `Loading diff …%`, matching the hex-view loading label.
- [ ] AC34 — In the diff view: a repeat Enter steps between matches without re-running the search; a large search streams a rising count and jumps to the first hit; the active match is selected on both panes and `Ctrl+C` copies its bytes; next/previous wrap at the ends; changing the query back to the completed one keeps its matches while a divergent query drops them; and the count is still shown after the toolbar re-renders.

## Out of Scope

- Editing either file from the diff editor.
- Three-way / directory / merge comparison.
- Persisted diff view state (view mode, last compared files).
- Unified (interleaved) view mode in Phase A.
- Label editing in the diff editor.
- Reusing profiles, structs, pins, integrity checks, or scripts inside the diff editor.
- Persisting the compare selection across window reloads.
- Comparing more than two files at once (directory/3-way).
- A dedicated picker UI: selection is driven purely by the Explorer selection + `Select Compare` stash.

## Technical Notes

- Supported extensions: `.hex`, `.ihx`, `.ihex`, `.srec`, `.mot`, `.s19`, `.s28`, `.s37`.
- Address resolution must use format-resolved addresses, not raw record address fields.
- Existing `HexView` is a presentational component with root-scoped listeners; its remaining global-id queries (`#mem-scroll`, `#mem-header`) and id-based CSS are the blocker for two simultaneous instances.

## Open Questions

- None. `HexView` reuse + prerequisite refactor confirmed by user.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
