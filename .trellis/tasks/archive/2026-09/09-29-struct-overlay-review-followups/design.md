# Design — Struct overlay review follow-ups

## Boundaries

- `src/core/structCodec.ts` — export the shared width predicate and byte fold;
  harden `materializeStructField`; comment the migrated-id scan.
- `src/core/types.ts` — add `STRUCT_BASE_TYPES` (runtime mirror).
- `src/webview/components/sidebar/structPanel/structPanel.ts` — consume the
  shared helpers; one `isPointerBlocked`; in-place show-hidden update; restore
  the bit-field-ref `Alloc` control.
- `src/webview/components/sidebar/structPanel/structPinsModel.ts` — deletion
  confirmation referencing-field count.
- `src/webview/components/sidebar/structPanel/structPanel.css` — shared badge
  primitive at 10px.
- `src/hexEditorSession.ts` — `saveShowHiddenFields` uses `showHiddenFieldsOrDefault`.
- `schemas/structs.schema.json` — parity-only (no shape coupling).
- Tests: `struct.test.ts`, `structNormalization.test.ts`, `structPanel.test.ts`,
  `structPinsModel.test.ts`, `webviewMessageModel.test.ts`, `hexScopeStorage.test.ts`,
  `schemaValidation.test.ts`.
- Living specs: `struct-model.md`, `struct-instance-display.md`,
  `component-sidebar-struct-panel.md`, `css-guidelines.md`, `state-management.md`,
  `type-safety.md`.

## Shared helpers (R1, R2, R3)

- `isUnsignedScalarType` is declared twice (`structCodec.ts:48`,
  `structPanel.ts:978`). Keep the core declaration; export it; the panel imports
  it and its private copy is deleted. `isUnsignedBaseType` (core) and
  `readBaseType` (panel) stay as-is — they read a raw string / narrow an editor
  value, distinct concerns, but `readBaseType` delegates to the imported
  predicate.
- `bytesToBigUint` (`structCodec.ts:142`) is module-private; export it. Panel
  `bytesToValue` (468) and `unsignedValueFromBytes` (2522) are byte-for-byte
  clones — delete both and call the core fold.
- Add `private isPointerBlocked(f: StructField): boolean` to the panel and
  replace the three hand-written disjunctions (921, 2007, 2031).

## CSS (R4, R5)

- One `.se-kind-badge` primitive (the shared declarations); `.sd-kind` becomes a
  layout-only modifier (or the list reuses `.se-kind-badge` with a modifier).
  Both render at `10px`.
- `css-guidelines.md`: correct the "sole 9px exception" wording and reconcile the
  pre-existing `.si-chip` 9px rule (record it in the Exception Log or raise it),
  so the doc matches reality.

## Show-hidden seam (R6, R8, R20)

- `hexEditorSession.ts:999` `saveShowHiddenFields` replaces
  `typeof msg.showHiddenFields !== 'boolean'` with `showHiddenFieldsOrDefault(msg.showHiddenFields)`.
- `refreshInstances()` currently sets the instances body `innerHTML`. Replace with
  an in-place visibility update: keep the existing DOM, toggle a hidden-row class
  / recompute only the affected rows so the `#si-show-hidden-chk` node (and focus
  + scroll) survive. Reuse the file's in-place precedents
  (`syncTypeAddButton`, `refreshFieldRows`).
- Tests: invoke the host handler with a real message; drive
  `showHiddenFieldsChanged` through `applyScopedInvalidations` and assert
  `setShowHiddenFields` / rendered output.

## Restored allocation authoring (R11)

- The pure-struct trim removed `Alloc` from every row. Re-add an `Alloc` select
  **only** for rows whose field is a reusable bit-field reference
  (`isBitFieldRefField`), wired to the field's `allocation`; `readEditorFieldRow`
  reads it back for those rows only. Pure scalars/structs/enums author none.
- Grid: the bit-field-ref row carries the control in the Alloc column; re-check
  the column template (a bit-field-ref row may need the alloc cell back while
  other rows keep the placeholder). Confirm with a panel test.
- Specs: `component-sidebar-struct-panel.md` states the alloc control is
  authored on bit-field-reference rows; `struct-model.md` notes the override is
  usage-scoped.

## Deletion confirmation (R12)

- `withoutStructDefinition` already strips every matching `refStructId`
  (`structPinsModel.ts:80`) — keep. Add a count of referencing fields across the
  pool and thread it into the delete confirmation text next to the pin count, so
  the user is warned the parent layout changes. Add a nested-`type:'struct'`
  deletion test.

## Edge-case rulings (R9, R10, R13, R14, R15, R16, R17)

- R9: in `materializeStructField`, when rewriting a `type:'bitfield'` field,
  drop `isPointer` (a container cannot be a pointer) so the materialized field is
  never pointer-typed; validation still rejects the authored shape.
- R10: comment above `nextMigratedBitFieldId` explaining the whole-pool-seeded
  scan.
- R13: document `bitFieldDefToC`/`enumDefToC` (def-level typedef preview) in
  `struct-model.md`.
- R14: spec text says the hex-digit count follows the field width; the AC wording
  in this task supersedes the archived `NAME (0xNN)` phrasing.
- R15: `struct-model.md` states load preserves `hidden:false` identity; the
  editor omits `false`.
- R16: `struct-model.md` states the schema is syntax-level; cross-kind shape
  rules are enforced by `validateStructs`.
- R17: `struct-model.md` validation matrix distinguishes authoring error from
  load-time defensive drop.

## Composition + parity tests (R18, R19)

- R18: extend `structPanel.test.ts` with a fixture: one def containing a hidden
  scalar, a field `type:'bitfield'` + `refStructId`, and an enum field + an
  enum-ref bit child; assert the rendered rows with the toggle off/on.
- R19: add a golden test capturing the instance-view HTML and the C preview for a
  pool where no new feature is used, asserting equality against a fixed expected
  string (the pre-change behaviour), so a future change that alters unused-feature
  output fails.

## Ordering

1. Shared helpers (R1–R3, R10) — pure refactor, no behaviour change.
2. Materialize hardening (R9).
3. CSS (R4–R5).
4. Show-hidden seam (R6, R8, R20).
5. Restored allocation authoring (R11).
6. Deletion confirmation (R12).
7. Edge rulings + living-spec docs (R13–R17).
8. Composition + parity tests (R18–R19).

## Compatibility / rollback

- Every change is either a pure refactor, a re-authored optional key, or a spec
  correction. No persisted shape changes (C3); pools stay identity-preserving
  when valid (C4). Rollback = revert the edit set.

## Deliberate simplifications

`ponytail:` reuse existing helpers/patterns; no new abstraction layer. The
module split is deferred (D1), and the two-site strip extraction is skipped.
