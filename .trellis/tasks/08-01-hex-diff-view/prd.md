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

R1. **HexScope: Compare Selected** (multi-select of two supported files, explorer context menu, like VS Code built-in compare) and **HexScope: Select as 1st file to compare** / **HexScope: Compare to <name>** (staging flow) — all available from explorer context menu and editor title bar when supported files are involved. No file picker.
R2. Opens a dedicated, read-only diff editor separate from the single-file Memory/Records viewer.
R3. Side-by-side hex grid showing both files aligned by address (unified mode explicitly out of scope, never planned).
R4. Byte-level highlighting for:
    - Changed bytes (both files have data, values differ)
    - Added address ranges (data in file B, not in A)
    - Removed address ranges (data in file A, not in B)
R5. Summary bar with total bytes changed / added / removed and jump-to-next/previous-difference navigation.
R6. Respect existing address-range labels so diffs can be viewed in context of named regions.
R7. Gracefully handle differing address spaces/gaps (e.g. SREC vs HEX, non-contiguous records).

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
    - Explorer multi-select of 2 supported files → context menu **Compare Selected** → diff.
    - Explorer single file → **Select as 1st file to compare** (stages as left/base A) → another file's menu shows **Compare to `<A name>`** → diff opens immediately.
    Staging state is **ephemeral** (session-only, cleared when diff opens or a different first file is picked; never persists across restarts). Editor title bar uses the same staging verbs (stage when nothing staged; "Compare to <A>" when A staged). No file-picker flow exists.
D8. **Refuse invalid pairs.** Opening is blocked (message shown) for same-file (same URI) and identical-content pairs. Pair identity is judged by **URI (fsPath), never by filename** — two same-named files in different folders are a valid, distinct pair.
D9. **Refuse unparseable files.** Reuse the single-file gate (`parseResultIsValid`, src/extension.ts:26): if either file has checksum errors or malformed lines, opening is blocked with the existing Quick Repair message. The diff view never renders half-broken data.
D10. **Minimal chrome.** Diff webview carries only: two side-by-side grids, summary bar, shared label rail, next/prev difference navigation, swap button, and byte-pattern search (D21). No tabs, edit controls, scripts, structs, inspector, bit view, or integrity. Read-only by construction.
D11. **Per-panel selection + copy.** Click-drag selects a byte range within one panel; copy commands (hex string / C array / ASCII) copy from that file's bytes, reusing existing copy formatters. No fill/analyze context-menu actions.
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
D23. **Swap = exchange positions, not identity.** A/B identity attaches to the **file**, never to screen position. Panel headers permanently show "A: <name>" / "B: <name>" with accent colors (A=blue, B=orange); Swap slides the panels (positions exchange) while headers/labels keep the same A/B tags on the same files. The same blue/orange accents repeat in summary-bar counts and label-rail side tags (D22) so A/B is recognizable everywhere. Rationale: diff status (D4) is computed relative to A, so roles never rename on swap (D14). Red/green are avoided for side accents because they collide with changed/added/removed highlight semantics.
