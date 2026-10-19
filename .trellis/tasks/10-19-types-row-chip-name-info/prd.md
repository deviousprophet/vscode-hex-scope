# Reorder Types rows: fixed kind chip, name, full info

## Goal

Reorder the Overlay **Types** row to `chip → name → info → actions`. Every kind
badge must render at the **same width** so the chips form one aligned column. The
info (meta) must be **fully shown** when there is room, and **hidden entirely**
when the sidebar is too narrow — rather than being squeezed or ellipsized.

Presentation only: no sort/filter/behavior, persisted, schema, or naming change.

## Background / current state

- Markup order (`typeRowHtml`): `name → badge → meta → actions`.
- Grid (`overlayPanel.css`): `minmax(0,1fr) 52px 58px auto auto`.
- `.od-kind { justify-self: center }` — the chip is *centered in* its track but
  still hugs its own text, so `Struct` / `Bit-field` / `Enum` have three
  different widths.
- `.od-meta` is capped to a 58px track and ellipsized — **this is what hides the
  info** the user wants to see.
- Engines target VS Code `^1.125.0`, so CSS **container queries** are available
  (no ResizeObserver needed).

## Decisions

- **D1. Order is chip → name → info → actions.** The badge moves from after the
  name to before it (leading). Markup order and grid order change together.
- **D2. One fixed chip width.** A fixed leading track (56px) and the chip fills
  it (`width: 100%`, `box-sizing: border-box`, centered text), so all three
  labels render as **identical-width badges** in one aligned column. 56px leaves
  room for the widest label (`Bit-field`).
- **D3. Info is never truncated when visible.** The meta track is
  `minmax(0, max-content)` (content-sized, shrink only as an overflow
  safety-valve) instead of a 58px cap, so `4 fields · 8 B` /
  `uint32 · 9/16 bits` / `uint8 · 5 entries` show in full.
- **D4. Name is the flexible cell.** `minmax(0, 1fr)` with ellipsis and a
  `title`, so it absorbs slack and is the only thing that truncates when the
  info is visible.
- **D5. Hide the info when the sidebar is too narrow.** Container query on the
  list (`#om-list { container-type: inline-size }`). Hiding the item alone is
  not enough — the grid track would stay reserved — so the narrow rule drops the
  meta track too:
  ```css
  @container (max-width: 299px) {
    .od-row  { grid-template-columns: 56px minmax(0, 1fr) auto auto; }
    .od-meta { display: none; }
  }
  ```
  Threshold rationale: with the info shown, the name needs `container − 4 (row
  padding) − 56 (chip) − ~99 (info) − 36 (actions) − 16 (gaps)`; at **300px** the
  name keeps ≈ 89px. Below that the info is hidden, its track is removed, and the
  name gets ≈ 190px. **300px** is the proposed threshold (the sidebar minimum is
  260px).
- **D6. Nothing becomes unrecoverable.** The row gets
  `title="${name} — ${info}"`; the name keeps its own `title`. Hovering the row
  (chip/actions) still reveals the info when it is hidden.
- **D7. Everything else unchanged.** Sort (kind then name), filters, empty
  states, actions, the 20px shared filter control box, ids/classes, and
  persisted shape are untouched.

## Requirements

- R1. Row content order is chip → name → info → actions.
- R2. The chip column is a fixed width and the chip fills it, so every badge is
  the same size and they align vertically across rows.
- R3. When visible, the info renders its full text (no ellipsis, no cap).
- R4. When the list container is below the threshold (300px), the info is
  hidden (`display: none`); at or above it, the info is shown.
- R5. The name is the only truncating cell when info is visible, and it exposes
  its full text via `title`; the row exposes `name — info` via `title`.
- R6. No behavior change: sort/filter/empty states/actions unchanged; no
  id/class renames; no persisted/schema/decode/C-preview change.
- R7. No issue reference in artifacts, code, or comments.

## Constraints

- C1. Component-local CSS only; do not fork the shared `.sb-input*` / `.sb-select`
  primitives or rename `.od-*` classes.
- C2. The hide rule must be a **container** query on the list, not a viewport
  media query (the sidebar width is not the viewport).
- C3. No row may wrap or overflow horizontally at any width: the name shrinks
  first, then the info hides at the threshold, then the info may shrink as the
  final safety-valve.
- C4. Gates: `npm run check-types`, `npm run lint`,
  `npm run compile-tests && npm test`; Fallow GREEN.

## Acceptance Criteria

- [ ] Markup order is chip → name → info → actions.
- [ ] All three kinds render chips of identical width in one aligned column.
- [ ] At a normal width the info text is fully visible (no ellipsis); the name
  ellipsizes and carries a `title`.
- [ ] At a container width below 300px the info is hidden, its grid track is
  removed, and the name expands; at ≥300px the info is shown.
- [ ] The row carries `title = "<name> — <info>"` so hidden info stays
  discoverable.
- [ ] No row wraps or overflows horizontally at 260 / 300 / 400px.
- [ ] No behavior/persisted/decode/C-preview change; ids/classes unchanged.
- [ ] `check-types`, `lint`, suite pass; Fallow GREEN.
- [ ] No issue references.

## Out of scope

- Two-line rows, a list-level `display: contents` grid, or a JS resize observer.
- Changing the meta text, the labels/colours, the sort, or the filters.
- A user-adjustable threshold (fixed at 300px for now).
