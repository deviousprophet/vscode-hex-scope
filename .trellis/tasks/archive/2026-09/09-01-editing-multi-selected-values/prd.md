# Allow editing multiple selected hex values

## Goal

Typing stays inert while multiple hex bytes are selected, but the user can opt in: a context-menu item **Edit selected bytes** (visible when ≥2 mapped bytes are selected) opens a selection-edit session that confines every typed edit to the selected range.

Reported by Markus. Accepted design: user-activated guard + Approach-A (restrict edits to selection) walk semantics.

## Background / Confirmed Facts

- Direct-typing gate today: `onEditKeydown` in `src/webview/hexViewer.ts:599` — `!isSingleByteSelected()` → `clearNibbleBuffer(); return`. Multi-byte selection: typing inert. Single-byte selection: typing works, `advanceSel` walks + collapses selection.
- Typing path: `processEditKeypress` → `handleEditBufferChar` / `handleCharColumnEdit` → `applyTypedEdit` (pushes one `S.undoStack` entry per byte) → `refreshAfterLocalEdit`.
- Nibble preview affordance exists: `paintCell` + `.data-cell.editing` outline (hexView.css:79).
- Paste already fills a whole selection (`doPasteToSelection` → `buildPasteEdits`) and is unchanged.
- Edit Mode (toolbar) gates all editing; dirty/save model lives in `S.edits` + `stageIntegrityEdit` / `stageIntegrityEditTransaction`; only mapped addresses accept edits.
- Context menu is MenuController-driven (`src/webview/contextCommands.ts`, `.trellis/spec/frontend/components/component-menu-controller.md`) — hex-grid commands (go-address, select-all, select-segment) register there.
- Test harness: `src/test/webview/webview.test.ts` (JSDOM + `resetState()`); pure modules like `editTransactions.ts` unit-test directly.
- Spec to update: `editing-save-external-change.md:55-59` (key-filter + advance contract).

## Requirements

- R1: Multi-byte selection alone still blocks typing (guard retained); single-byte editing keeps today's behavior.
- R2: Context menu shows **Edit selected bytes** **only while Edit Mode is on**, grouped with the **Patch / Fill** item in the edit-action group; hidden when Edit Mode is off. Requires the current selection to span ≥2 mapped bytes (single-byte/1-mapped-gap selections omit the row); disabled (tooltip) when the file is locked.
- R3: Activation opens a delimited session: typing applies only to bytes inside the selection, walking left→right over mapped bytes, stopping at the range end; selection stays highlighted while active.
- R4: The session covers both hex-column and ASCII (decoded-text) column typing.
- R5: Session ends on Escape or any selection-modifying input (arrows, click/drag outside, shift+click, deselect). On exit the session commits; a partially-typed nibble is discarded silently.
- R6: Each typed byte stages into `S.edits` **immediately** (grid shows the new value + dirty underline live, like single-byte editing); the session's accumulated snapshot flushes as **one** undo transaction at exit; dirty count / save model unchanged.
- R7: Paste behavior is unchanged and does not end the session.
- R8: Gaps/unmapped bytes inside the range are skipped; only mapped bytes are edited.
- R9: While active, a **sibling toolbar chip** `SELECTION · N B` (static activation count) appears next to the unchanged `EDITING` pill; hidden on exit. Save/Cancel stay in normal content flow (chip reflow is accepted).

## Acceptance Criteria

- [ ] AC1: Context menu on a multi-byte (≥2 mapped bytes) selection shows **Edit selected bytes**; absent for single-byte/no selection.
- [ ] AC2: Item is disabled (tooltip) when Edit Mode is off or file locked; enabled in Edit Mode.
- [ ] AC3: Activating starts a session; typing applies bytes inside the selection left→right and selection stays highlighted.
- [ ] AC4: ASCII-column typing inside the session is confined the same way as hex-column.
- [ ] AC5: Typing past the range end modifies nothing outside the range (re-edits last byte).
- [ ] AC6: Unmapped/gap bytes in range are skipped; only mapped bytes edited.
- [ ] AC7: Escape exits, commits staged bytes, discards an incomplete nibble, and keeps the selection.
- [ ] AC8: Any selection-modifying input (arrows, click-outside, drag, shift+click) exits and commits the session.
- [ ] AC9: One Ctrl+Z reverts the whole session; redo restores it; paste/fill/single-byte editing unchanged.
- [ ] AC10: The sibling SELECTION chip shows while a session runs (EDITING pill unchanged) and hides on commit.
- [ ] AC11: `npm run check-types`, `npm run lint`, `npm test` pass; session flow covered by focused tests.
- [ ] AC12: `editing-save-external-change.md` (and menu spec if the menu contract changes) updated.
- [ ] AC13: A typed session byte is rendered by the grid immediately (live staging regression guard), and the active range is visibly tinted (`.sel-edit`) distinct from plain selection while the session runs.

## Out of Scope

- Editing via sidebar Inspector / byte tools / fill-selection.
- Paste semantics, copy formatting, record view.
- Making multi-byte typing work implicitly (rejected approach B; rejected implicit activation).
- Save/reload/external-change semantics.

## Key Decisions

- DEC1 (Q1): Delimited **selection edit session** with Approach-A walk (not implicit typing).
- DEC2 (Q2): Session requires Edit Mode already on; menu item disabled otherwise.
- DEC3 (Q3): Exit = Escape or click-outside; partial nibble discarded silently.
- DEC4 (Q4): Affordance = sibling toolbar chip `SELECTION · N B` (keeps `EDITING` pill byte-identical; informative-only, not clickable; static mapped count).
- DEC5 (Q5): Item appears only in Edit Mode, in the same **Patch / Fill** edit group; needs ≥2 mapped bytes (single-byte/1-mapped-gap hides it); disabled w/ tooltip only when file locked; gates hex + ASCII columns; gaps skipped.
- DEC6 (Q6): One undo transaction per session, committed at exit.
- DEC7 (Q7): Typing cursor starts at selection start each activation.
- DEC8 (Q8): Any selection-modifying input exits + commits.
- DEC9 (Q9): Paste unchanged; session stays active.
- DEC10: Branch `feat/editing-multi-selected-values`; no issue reference in task/branch names.

## Open Questions

None.