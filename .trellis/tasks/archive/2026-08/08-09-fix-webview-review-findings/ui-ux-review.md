# UI/UX Heuristic Review — Webview (v2.17.1..HEAD component refactor)

Reviewer role: human UX heuristic pass (Nielsen + pragmatic). Scope: direct-DOM webview
`src/webview/**` (components, host, styles). **No source edited** — findings only.

- Method: read component markup/render/interaction code + CSS per area; compared against
  `.trellis/spec/frontend/components/*.md` contracts and pre-refactor source at `v2.17.1`.
- Severity: **S** serious UX defect · **M** moderate · **L** minor/polish.
- `[REG]` = regression introduced by the refactor (verified vs v2.17.1 or spec).

Summary: **S = 4, M = 14, L = 20** (total 38). Regressions: B1, B2, C2 (context-menu ASCII), C1 (edit-view gate).

---

## 1. Memory view (hex grid)

- **S · [REG] B1 — grid slice goes stale on window resize.** No resize listener at HEAD;
  pre-refactor `memoryView.ts` had `window.addEventListener('resize', () => refreshMemoryScrollPosition(...))`.
  `vscrollState.containerHeight` is only refreshed from `syncVirtualScrollMetrics`
  (`memoryGrid.ts:389`), reached via `renderMemoryGrid` — i.e. on scroll, not on resize.
  After a webview resize the visible slice + scroll extent are wrong until the user scrolls.
  Violation: visibility of system status / responsiveness.
  Fix: `memoryGrid.ts` mount — `window.addEventListener('resize', …)` → re-measure container
  height + `renderMemoryGrid` (restore parity). Add regression test.

- **L — column-header hit affordance.** Header cells (`hexViewRender.ts:70-72`) have
  `cursor:default` and no click behavior (header column highlight comes only from row hover).
  Header column-highlight is impossible when the viewport shows a gap row. Not a regression.
  Fix: make header `data-cell` a column-highlight surface (pointerenter → `onColumnHover`).

- **L — dirty-byte legend absent.** Amber underline (`hexView.css:75`) appears on edited bytes
  with no explanation anywhere in the toolbar. Violation: recognition / match-to-mental-model.
  Fix: add tooltip/title on the EDITING pill or the dirty count: "underlined bytes are edited".

- **L — "No data records found."** (`hexViewRender.ts:66`) is the only empty-state copy in the
  grid; acceptable. No spinner during initial load inside the grid (initial load uses the
  `.loading-shell`, `hexViewer.ts` render). OK.

- **L — nibble preview shows `A-` with no in-cell hint.** `handleEditBufferChar`
  (`hexViewer.ts:517-529`) paints `X-` for nibble 1 of 2; a user who types one hex char then
  pauses sees a dangling `-`. Minor discoverability. Fix: placeholder glyph `·` for nibble 2.

- **M — grid is mouse-only.** No keyboard selection/movement in the hex grid (cells are
  non-focusable spans; `data-addr` cells have no tabindex). Ctrl+Shift+arrows / Home/End
  impossible. Typical for hex editors but flagging for keyboard-operability. Fix (follow-up):
  tabindex on cells + arrow-key movement, or document that search/addr-jump is the path.

## 2. Record view

- **M — misleading empty-state copy.** When `recordCount === 0`, `hexViewer.ts:248-250` renders
  `RECORD_EMPTY_MESSAGE` ("Record details are not loaded in the webview. Use Memory view…",
  `hexViewer.ts:78`) under a "Record View Unavailable" title (`recordView.ts:91`). For a valid
  empty parse this reads like a feature limitation, not an empty file.
  Violation: match system & real world / error states.
  Fix: when `recordCount === 0` render a real empty state ("No records in file."); keep the
  "unavailable" message only for the no-parseResult case.

- **L — loading placeholders fine** (`recordView.ts:95` "Loading…" colspan=5 row).
  Checksum error tag ("checksum error", `recordView.ts:140`) and `rerr` row tint are good.

- **L — no row affordance.** Rows show `cursor:default` (`recordView.css:30`) and do nothing on
  click. Fine (read-only parity), but a click-to-copy / jump-to-address would be discoverable.
  Follow-up.

## 3. Search bar

- **S · [REG] B2 — mode/endianness change stops syncing `S`, so match-highlight width is stale.**
  `SearchBar.setMode/setEndianness` (`searchBar.ts:152-162`) update component state only; the
  host writes `S.searchMode/searchEndianness` only in `onSearch` (`hexViewer.ts:413-417`).
  `memoryGrid.getNeedleLen()` (`memoryGrid.ts:498-503`) still reads `S.searchMode` + the DOM
  input value. After switching Bytes→ASCII (or changing endian) without re-running, an existing
  match set renders with the wrong span width (e.g. "DE AD" highlighted as one 2-byte span in
  ASCII mode where it is one 1-char span). Violation: consistency.
  Fix (pick one, per PRD B2): sync `S` on control change (parity) **or** stop reading `S` for
  needle width — store `searchKey`/span in the engine glue and read that. Document in spec.

- **M — next/prev navigate a stale match set after a mode/endian change.** Because control
  changes don't re-run or invalidate (`searchBar.ts:158-162`; spec 4.66-67 "parity: does not
  re-run"), ▼/▲ after switching mode still walks the old query's matches while the input shows a
  new query. New search only happens on Enter/button. At minimum, clear/invalidate the count
  ("0 / 0") and de-highlight when the visible query diverges from the completed search key.
  Violation: visibility of system status.

- **L — ▲/▼ glyphs for prev/next.** `searchBar.ts:56-57` renders "Previous match" as ▲ above
  "Next match" as ▼. Vertical arrows for horizontal progression are ambiguous (read as
  line-up/line-down). Suggest ⇤/⇥ or ‹ › / ⌃⌄ with the existing tooltips. Polish.

- **M — no accessible name / live region on search chrome.** `#search-input` and `#search-mode`
  (`searchBar.ts:50-53`) have no `<label>`/`aria-label`; `#match-count` (`searchBar.ts:60`) has
  no `aria-live`, so match results are silent to SRs and `0 / 0` flips are announced as nothing.
  Fix: `aria-label="Search"` on the input, `aria-live="polite"` on `#match-count`.

- **L · [REG-adjacent] — match count text lost on full re-render.** `SearchBar.toHtml()`
  (`searchBar.ts:42-62`) regenerates `#match-count` empty; after a full render (savedEdits /
  external change / reload) highlights persist (`S.matchAddrs`) but "m+1 / n" disappears until
  the next navigation. Inconsistent status. Fix: re-push `setCount(S.matchAddrs.length, S.matchIdx)`
  after render (host `renderInitialViews`/`setupRenderedUi`).

- **L — Ctrl+F in record view is a silent no-op.** `setVisible(false)` hides `#search-box`, but
  `isFindShortcut` still focuses the hidden input (`searchBar.ts:136-150`; spec 4.74 admits this).
  User presses Ctrl+F in Records and nothing visible happens. Fix: no-op when `display:none`.

## 4. Toolbar

- **M — toolbar overflows at narrow webview widths.** `#toolbar` is fixed 35px, no wrap/scroll
  (`toolbar.css:2-7`); `#search-box` is `margin-left:auto` with a fixed 180px input plus mode
  select, pills and 4 icon buttons (`searchBar.css:2,29`). At narrow widths the rightmost search
  controls clip (app has `overflow:hidden`). Violation: responsiveness.
  Fix: allow `#toolbar` horizontal scroll, or shrink `#search-input` via `min-width:0` + flex.

- **L — Save has no keyboard shortcut.** Ctrl+S is available in the extension host; a webview
  Ctrl+S→`saveEdits` would be natural. Ctrl+Z undo exists (`hexViewer.ts:675-686`). Efficiency.

- **L — "N unsaved byte(s)" only.** The dirty count (`toolbar.ts:76`) omits "edits" unit meaning;
  fine. Save disabled at 0 (`toolbar.ts:147-153`) is correct feedback.

## 5. Edit-mode UX

- **L · [REG] C1 — edit-triggered memory re-render no longer gated on memory view.**
  `refreshAfterLocalEdit` (`hexViewer.ts:480-487`) calls `memRerender()` unconditionally; same
  for `applyFill` (`hexViewer.ts:1169-1176`) and `undoLastEdit` (`hexViewer.ts:1178-1186`),
  while `refreshAfterIntegrityEdits` (`hexViewer.ts:1158-1165`) kept the gate. In record view a
  paste/fill/undo rebuilds the hidden grid (wasted work; could disturb scroll state on return).
  Violation: efficiency. Fix: restore `if (S.currentView === 'memory')` gate (PRD C1).

- **L — Escape exits the whole nibble/selection, not just the current cell.** `handleEditEscape`
  (`hexViewer.ts:509-515`) clears nibble buffer *and* the selection. A user who mis-typed one
  nibble and wants to "cancel this byte" loses their selection. Violation: user control.
  Fix: Escape first clears only the nibble buffer; a second Escape (or when buffer empty) clears
  selection.

- **L — no redo.** Ctrl+Z (`hexViewer.ts:675-686`) has no Ctrl+Y counterpart. Undo-only is a
  common but nonstandard shortcut gap. Follow-up.

- **M — paste overflow is silent.** `buildPasteEdits` (`hexViewer.ts:589-598`) truncates at the
  first unmapped byte; `applyPasteBytes` returns silently. Pasting 20 bytes over a 5-byte
  selection writes 5 with no notice. Violation: error prevention / system status.
  Fix: status message ("pasted N of M bytes — hit unmapped region").

## 6. Context menu

- **S · [REG] C2 — single-byte "Copy ASCII" always shown, even for non-printable bytes.**
  `contextMenu.ts:148` always renders `Copy ASCII` with `'<char>'`; pre-refactor
  (`v2.17.1 contextMenu.ts buildSingleByteCtxMenu`) omitted ASCII when
  `formatAsciiByte(value) === '.'`. Now right-clicking byte `0x00` offers "Copy ASCII" whose
  preview is an empty quote. Violation: error prevention / match to mental model.
  Fix: gate the row on `isPrintableByte` (spec component-context-menu.md:49 update).

- **M — no ARIA menu semantics / keyboard support.** Menu is `<div class="ctx-row">` with no
  `role="menu"/"menuitem"`, no arrow-key navigation, no focus on open, no focus return; the
  Menu/context key doesn't open it (`hexView.ts:304` only listens to `contextmenu` event).
  Fix: `role="menu"` tree + arrow keys + Escape, or at minimum document mouse-only.
  Violation: accessibility basics.

- **L — Escape inside the custom-fill input dismisses the entire menu.** `handleFillKeydown`
  (`contextMenu.ts:238-242`): Escape hides the menu, not just the submenu/input. User canceling
  a typo in the fill box loses the whole menu. Fix: Escape clears input first, menu on second.

- **L — fill preset labels use literal spaces for alignment.** `contextMenu.ts:84-85`
  ("Zero              (0x00)") — brittle under font fallback. Use CSS gap/`.ctx-hint` like the
  rest of the menu. Polish.

- **L — disabled go-address relies on title-only "Not mapped" hint.** `contextMenu.ts:70`,
  `.ctx-disabled` at `contextMenu.css:91-92`. Documented decision (spec), but opacity-45% row
  with a tooltip is easy to miss; acceptable. Note for follow-up.

## 7. Sidebar shell

- **L — resizer is 6px, mouse-only, not keyboard-operable.** `sidebar.ts:161-193` handles
  `mousedown`; `#sidebar-resizer` is a plain `<div aria-label="Resize sidebar">` — no tabindex,
  no arrow-key resize. Violation: accessibility / fine-motor.
  Fix: add `role="separator" aria-orientation="vertical"` + keyboard arrows.

- **L — tab strip uses rotated text.** `sidebar.css:63-73` `writing-mode:vertical-rl` 28px strip.
  Distinctive but low legibility at 9px; active state is color + right-border only
  (`sidebar.css:73`) — okay contrast, but the vertical strip is easy to miss as interactive.
  Polish/follow-up.

- **L — header slot label reads "BYTE ORDER" in caps** (`hexViewer.ts:965`) consistent with
  section headers. LE/BE pills consistent with search pills. Good.

## 8. Panels

### Inspector
- **L — empty-name validation is dead code.** `readLabelName` (`inspectorLabelForm.ts:185-187`)
  falls back to `nextLabelName` when blank, so the declared "Name is required." error
  (`inspectorLabelForm.ts:172`) can never fire. Silent auto-naming (Label_0…) may surprise.
  Fix: either drop the dead check or surface the generated name in the form.

- **M — hover-reveal + span-only actions in the Labels list.** Edit/delete `.act-btn` are
  `opacity:0` until row hover (`base.css:135-147`), and all label actions (visibility ↑↓ ✎ 🗑)
  are `<span>`s with `title` only — not focusable, no aria-label, invisible on touch/keyboard.
  Violation: recognition / accessibility.
  Fix: real buttons, keep hover-reveal but also `:focus-within` reveal; add aria-labels.

- **L — multi-byte interpreter silently zero-pads across unmapped bytes.** `readSelectedByte`
  (`inspectorPanel.ts:216-218`) returns 0 for gaps; a selection spanning a gap shows a u32 of
  mostly zeros with no gap indicator (only the zero-pad note, `inspectorRender.ts:162-166`).
  Follow-up: mark padded/absent bytes distinctly.

- **L — copy chips are discoverable only by cursor + title.** `insp-hex-chip` etc.
  (`inspectorRender.ts:27-31`) have `title="Click to copy"`; fine but icon-less. Polish.

### Struct
- **L — move buttons reuse `→` rotated in CSS.** `structPanel.ts:670-671,719-720` both emit
  `&#x2192;`; `structPanel.css:256-257` rotates ±90°. Works, but relies on CSS trickery; an SR
  reading "→" for "Move up" is wrong. Fix: emit ↑/↓ glyphs.

- **L — "View type definition" button glyph `{&nbsp;}`** (`structPanel.ts:3461`) is cryptic;
  `title` mitigates. Rename to a clearer affordance (e.g. `</>` or "Type…"). Polish.

### Integrity
- **M — profile delete has no confirmation.** `deleteSelectedProfile`
  (`integrityProfiles.ts:172-176`) calls `onDeleteProfile` directly; every other destructive
  action in the UI (label/struct/pin/check delete) goes through `inlineConfirm`
  (`utils.ts:150-216`). Inconsistent + data-loss risk.
  Fix: route through `inlineConfirm` (spec integrity anti-patterns + validation matrix).

- **M — "Apply" profile overwrites current checks without warning.** `applySelectedProfile`
  (`integrityProfiles.ts:89-100`) replaces the whole check set (and persists) even when the user
  has unsaved add/edit drafts in the panel. Violation: error prevention.
  Fix: confirm when `addCheckDraft || editingCheckId` is open, or when checks changed since load.

- **L — icon-only profile buttons lack aria-labels.** ↻/✎/🗑 (`integrityProfiles.ts:208-210`)
  have `title` only. Screen-reader parity fix: `aria-label="Update/Rename/Delete profile"`.

- **L — `?` status symbol for "Not configured".** `integrityPanel.ts:72` maps 'Not configured' →
  `?`, which reads as unknown/questionable rather than "no result". Minor; the card body says
  "No result yet." Suggested `–` or `∅`.

- **L — status glyphs ✓/✕/∑/…/!/? get `aria-label` set dynamically (`integrityPanel.ts:627-635`)**
  — good accessibility practice, no action.

### Scripts
- **M — clicking Run on a second card while one runs is a silent no-op.** `runScript`
  (`scriptsPanel.ts:196-201`) early-returns on `this.runningPath`; the other cards' ▶ buttons
  stay visually enabled. Violation: visibility of system status / error prevention.
  Fix: disable all non-running run buttons while `runningPath` set (or show a transient tooltip).

- **L — long output doesn't auto-scroll.** Streaming log (`scriptsPanel.ts:342-347`) appends but
  never scrolls the `.script-output-log` to bottom; users watching a tail-following script must
  scroll manually. Polish: sticky-scroll when already at bottom.

- **L — status dots are color-only signals** (`scriptsPanel.css:32-35`), mitigated by `title`
  tooltips and the result header text. Acceptable; keep the tooltips.

## 9. External-change banners + lock

- **M — lock re-enables buttons that were already disabled before the lock.**
  `enableAllInteractiveElements` (`lock.ts:21-32`) un-disables every `[data-was-enabled]`
  element, including ones that were already `disabled` for state reasons (Save at 0 edits,
  "Fix all" with no mismatches, "＋ Add" while a draft is open). After unlock they become
  clickable and no-op. Violation: consistency / error prevention.
  Fix: snapshot each element's prior `disabled` state and restore exactly that (don't force
  `disabled=false`).

- **L — no "keep my edits" escape from the conflict banner.** `showConflict`
  (`externalChange.ts:81-95`) offers only "Reload & discard my edits"; correct per design (file
  must be reloaded), but the destructive button is the *only* interactive element. Consider
  making the destructive affordance red-consistency (`ecb-reload` is already red-tinted) — it is.
  No action beyond noting the decision is sound.

- **L — reload/error banner copy is clear and escaped** (`externalChange.ts:16-45`). Good.

## 10. Loading / error / empty states

- **L · [pre-existing] — active-load progress is written into an invisible element.**
  `renderActiveLoadProgress` (`hexViewer.ts:713-718`) writes "Loading X%…" into `#search-progress`
  and flips `aria-hidden`, but `.search-progress` is `visibility:hidden` unless `.active`
  (`searchBar.css:81-104`) and `.active` is never added. Pre-refactor behavior identical, so not
  a regression — but during a reload (parseResult already present) the user sees no progress at
  all. Fix: add `.active` when writing load text, or move reload progress to the stats bar.

- **L — load-error screen is good** (`hexViewer.ts:1052-1061`: eyebrow/title/message card).

## 11. Visual consistency

- **L — hard-coded colors outside tokens.** `#e5a800` (dirty underline `hexView.css:75` +
  pill `toolbar.css:39-43`), `#e57373/#4caf50` (`scriptsPanel.css:33-34`), `#cca700`,
  `#e67e22` (script error headers). Most map to VS Code values but a few are inline literals.
  Consolidate into `base.css` tokens. Polish.

- **L — `--val-primary-color/--val-secondary-color` legacy aliases** (`base.css:43-51`) are
  plumbing-only; no user-visible issue. Note for cleanup.

- **L — section-header pattern is consistent** (`.sb-hdr` uppercase + triangle,
  `sidebar.css:43-47,85-97`) across Inspector/Segments/Labels; Scripts breaks the pattern with a
  non-collapsible `.script-toolbar` (`scriptsPanel.css:6-11`) — acceptable (documented), but the
  "Scripts" header lacks the triangle the other sections have; minor inconsistency.

## 12. Microcopy / a11y sweep

- **L — `title` tooltips are used generously and well** (search buttons, go-address, status
  dots, script run states, integrity auto-fix). Keep.
- **M — context menu + icon buttons (label vis/↑↓, struct move/delete, profile CRUD, script
  run) are mouse-primary with title-only labels.** See per-area findings above; net a11y gap on
  keyboard/touch.

---

## Regression checklist (from the prior two-axis review — all verified against HEAD)

| ID | Verified | Status |
|---|---|---|
| B1 resize listener | `memoryGrid.ts` has zero resize listeners; `v2.17.1 memoryView.ts` had one | **regression, S** |
| B2 search mode/endian S sync | `searchBar.ts:152-162` writes component state only; `memoryGrid.getNeedleLen` reads stale `S.searchMode` | **regression, S** |
| C2 single-byte Copy ASCII gating | `contextMenu.ts:148` unconditional; `v2.17.1` gated on `formatAsciiByte(value) !== '.'` | **regression, S** |
| C1 memory-rerender view gate | `hexViewer.ts:483,1172,1182` ungated; only `1161` gated | **regression, L** |
| Search query survives re-render | `SearchBar.toHtml` regenerates from internal state | improvement, confirmed |
| Lock re-enable semantics | `lock.ts:21-32` un-disables previously-disabled buttons | pre-existing, M |
| Record-empty copy | `hexViewer.ts:78,249` misleading when `recordCount === 0` | pre-existing, M |
| Profile delete without confirm | `integrityProfiles.ts:172-176` | pre-existing, M |
| Scripts: second-run silent no-op | `scriptsPanel.ts:197` | pre-existing, M |

## Suggested in-task vs follow-up split

- **In-task (small, with the code-fix work):** B1, B2, C2, C1 — already in PRD. Add: search
  input `aria-label`, `#match-count` re-push after render, lock `data-was-enabled` restore fix.
- **Follow-up tickets:** context-menu keyboard/ARIA, hex-grid keyboard nav, profile-delete
  confirm + apply-confirm, scripts second-run disable, record empty copy, toolbar overflow,
  paste-overflow notice, reload-progress visibility, Save shortcut, redo.
