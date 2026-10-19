# Fix Types section alignment and filter control heights

## Goal

Make the Overlay **Types** list read as aligned columns, and stop the kind
`<select>` rendering taller than the name search input.

CSS/markup only: no behavior, persisted, sort/filter, or naming change.

## Background / evidence

- `.od-row` is a flex row (`overlayPanel.css:25`):
  `name (flex:1) | chip (shrink 0) | meta (shrink 0) | actions`.
  The chip width varies by label (`Struct` ≈ 40px, `Bit-field` ≈ 54px,
  `Enum` ≈ 34px) and the meta width varies by text (`4 fields · 8 B` vs
  `uint32 · 9/16 bits` vs `uint8 · 5 entries`). So every row resolves different
  column widths — the chip's left edge, the meta's left edge, and the name's
  right edge all drift. There is no vertical column structure at all.
- Filter controls (`overlayPanel.ts:1653-1656`):
  `<input class="od-filter sb-input sb-input-sm">` and
  `<select class="od-kind-filter sb-select sb-input-sm">`.
  `.sb-input-sm` (`sidebar.css:235`) only overrides `padding`, `border-radius`,
  `font-size` — **no `height`/`line-height`**. The input is a text control
  (`--font-editor`); the select is a **native replaced control** (`--font-ui`,
  UA metrics + dropdown arrow), so it resolves a taller intrinsic box. Hence the
  height mismatch.

## Decisions

- **D1. Grid rows, fixed tracks.**
  `.od-row { display: grid; grid-template-columns: minmax(0, 1fr) 56px minmax(0, 96px) auto; align-items: center; gap: 4px; }`
  — name | kind | meta | actions. Every row shares the same tracks, so columns
  line up across the list.
- **D2. Alignment inside the tracks.** `.od-name` ellipsis; `.od-kind`
  `justify-self: center` (one aligned kind column); `.od-meta`
  `text-align: right` with ellipsis (numbers line up on the right).
- **D3. Nothing becomes unreachable.** Give the name and meta spans a `title`
  with their full text, so an ellipsized cell is still readable on hover.
- **D4. Shared control box.** Both filter controls get one explicit box:
  `height: 20px; box-sizing: border-box; line-height: 1; font-family: var(--font-ui); font-size: 10px;`
  Keep the native select arrow (do not reset `appearance`) — setting an explicit
  height makes the native control honour it.
- **D5. No structural change.** Same ids/classes, same sort/filter behavior, no
  behavior change. The only markup change is adding `title` to two spans.

## Requirements

- R1. The Types list rows share one column grid: name, kind, meta, actions; the
  kind column, meta right edge, and actions line up across every row.
- R2. The name and meta ellipsize rather than wrap or overflow, and expose their
  full text via `title`.
- R3. The search input and the kind select render at the **same height** and
  share the same font family/size and vertical centring.
- R4. No behavior change: sort, filters, empty states, actions, and keyboard
  focus behavior are unchanged.
- R5. No id/class renames; no persisted, schema, decode, or C-preview change.
- R6. No issue reference in artifacts, code, or comments.

## Constraints

- C1. Component-local CSS only (`overlayPanel.css`); do not fork the shared
  `.sb-input` / `.sb-select` / `.sb-input-sm` primitives beyond the component
  overrides.
- C2. The grid must degrade at the sidebar's minimum width: the name is the
  flexible cell and ellipsizes first; the meta track is capped and ellipsizes
  with its `title`.
- C3. Gates: `npm run check-types`, `npm run lint`,
  `npm run compile-tests && npm test`; Fallow GREEN.

## Acceptance Criteria

- [ ] All Types rows render the same four tracks; the kind chips form one
  column, the meta values align on the right, and the action buttons align.
- [ ] No row wraps; long names and long meta ellipsize and carry a `title` with
  the full text.
- [ ] The filter input and kind select are the same height and baseline-aligned.
- [ ] Sort/filter/empty-state behavior is unchanged; the existing suite passes
  (1310 baseline; only presentation/DOM-attribute assertions may need updating).
- [ ] No ids/classes renamed; no persisted/schema/decode change.
- [ ] `check-types`, `lint`, `compile-tests && npm test` pass; Fallow GREEN.
- [ ] No issue references.

## Out of scope

- Two-line rows or a list-level grid (`display: contents`).
- Changing the sort, the filter behavior, the labels, or the meta content.
- Responsive/container-query behavior beyond the natural grid degradation.
