# Improve the Types section: kind badges, meta and order

## Goal

Make the **Types** list in the Overlay sidebar legible and scannable. Today the
kind is only shown for non-struct types, the chip is visually the same as the
meta text, the meta carries weak numbers, and the list is in creation order.

Presentational only: no grouping/filter/search, no row-click navigation, no
persisted or behavior change.

## Background / evidence

- `typeRowHtml` (`overlayPanel.ts:1441`) renders the badge as
  `kind === 'struct' ? '' : 'bitfield' | 'enum'` — **plain structs show nothing**,
  so the absence of a badge has to be read as "struct".
- `.od-kind` (`overlayPanel.css:46`) uses `var(--addr-fg)` — the *same muted grey
  as `.od-meta` — at 10px/700 uppercase with `letter-spacing .04em` and a 1px
  border. Two same-weight grey labels compete in one 4px-gap flex row.
- The raw kind string is uppercased by CSS, so the user sees `BITFIELD` (no
  hyphen) while the kind chooser says "Bit-field".
- Meta is weak: struct = `N fields`, bit-field = `uint16 · N children`,
  enum = `uint8 · N entries` — no size/bit usage.
- `typeRowsHtml` maps `allTypes()` in stored order (creation order).

## Decisions (settled)

- **D1. Badge every kind**, including `Struct`. One consistent chip per row.
- **D2. Sentence case, hyphenated**: `Struct` / `Bit-field` / `Enum` — matching
  the kind-chooser tiles. No uppercase transform.
- **D3. Row order** `name → kind chip → meta → actions`. The name keeps the
  flexible width; the kind stays adjacent to the name (the classifier), the meta
  sits before the actions.
- **D4. One subtle accent per kind** (text + border + a very low-alpha
  background), no fills; reuse the shared `.od-kind` primitive rather than a
  second style. The editor's kind badge (`.oe-kind-badge`) uses the same labels
  and accents so the list and the form agree.
- **D5. Richer meta**, one line, right-cell:
  - struct: `N fields · X B` (byte size via the existing size function)
  - bit-field: `base · used/total bits` (e.g. `uint16 · 4/16 bits`)
  - enum: `base · N entries`
- **D6. Sort kind-grouped then name A-Z** (structs → bit-fields → enums;
  case-insensitive natural order within a group). Sort a copy for the list only —
  do not change the shared `allTypes()` order used by pickers.
- **D7. Kind-sorting makes kinds contiguous; add a filter bar in v1.** A compact
  bar above the list: a **name search** (case-insensitive substring) plus a
  **kind filter** (`All` / `Struct` / `Bit-field` / `Enum`). Collapsible kind
  sections stay deferred (the filter covers the "find it" need without chrome).
- **D10. Filter state is transient view state** (not persisted): held on the
  panel, reset with the rest of the view state (`resetViewState`), and never
  pushed to the host.
- **D8. The editor's kind badge follows D1/D2/D4** (consistency between list and
  form).
- **D9. Explicit non-goals for v1**: row-click-to-edit, "used by N instances",
  duplicate action, collapsible kind sections, filter chips, search.

## Requirements

- R1. Every row renders a kind chip with the label `Struct`, `Bit-field`, or
  `Enum`.
- R2. The chip is visually distinct from the meta (own colour/accent, not the
  meta's muted grey) and each kind has a distinct accent.
- R3. No uppercase transform; `Bit-field` is hyphenated.
- R4. Row order is `name → kind chip → meta → actions`.
- R5. Meta shows the numbers in D5; struct rows include a byte size; bit-field
  rows include used/total bits.
- R6. The list is sorted kind-grouped then name A-Z; the underlying type array
  and every picker order are unchanged.
- R7. The editor's kind badge uses the same label/accent mapping (list and form
  agree).
- R8. No user-visible behavior change beyond ordering/appearance; no persisted,
  schema, decode, or C-preview change.
- R9. No issue reference in artifacts, code, or comments.
- R10. The Types list has a filter bar above it: a **name search** input
  (case-insensitive substring match) and a **kind filter** select
  (`All` / `Struct` / `Bit-field` / `Enum`).
- R11. Filtering is live and composes with the sort; it shows a distinct empty
  state ("No types match.") when nothing matches, and does not rebuild the type
  editor or lose input focus.
- R12. Filter state is transient view state — not persisted, not sent to the
  host, and cleared by `resetViewState`.

## Constraints

- C1. Presentational scope: keep the existing `.od-*` class names/ids (add
  modifier classes, don't rename) so selectors and tests stay stable.
- C2. Reuse the existing shared chip primitive (`.od-kind` / `.oe-kind-badge`);
  do not fork a second badge style.
- C3. Use existing design tokens where they exist; if a per-kind accent needs a
  new token, keep it component-local (`overlayPanel.css`), not global.
- C4. Meta stays a single line (no wrap) and keeps its existing ellipsis/nowrap
  behaviour.
- C5. Gates: `npm run check-types`, `npm run lint`,
  `npm run compile-tests && npm test`; Fallow GREEN.

## Acceptance Criteria

- [ ] A plain struct row shows a `Struct` chip (regression: none is shown today).
- [ ] All three kinds show the correct sentence-case label; `Bit-field` is
  hyphenated; no uppercase styling remains on the badge.
- [ ] The chip is visually distinguishable from the meta and the three kinds are
  distinguishable from each other.
- [ ] Row order is name → chip → meta → actions.
- [ ] Struct meta includes a byte size; bit-field meta includes used/total bits;
  enum meta keeps its entry count and base type.
- [ ] The list is sorted struct → bit-field → enum, then A-Z within each group;
  pickers elsewhere keep their previous order.
- [ ] The editor's kind badge shows the same label/accent as the list.
- [ ] A name search narrows the list live (case-insensitive substring); a kind
  filter narrows to one kind or All; the two compose.
- [ ] A no-match state renders "No types match." distinct from the no-types
  empty state; clearing restores the full sorted list.
- [ ] Filtering preserves the search input's focus and does not re-render the
  type editor; the filter state is not persisted and resets with the view state.
- [ ] No behavior/persisted/decode/C-preview change; suite green (1288 baseline,
  only order/appearance assertions change); Fallow GREEN.
- [ ] No issue references.

## Out of scope (deferred, recorded here so they aren't lost)

- Collapsible kind sections — the filter bar covers "find it" without chrome;
  revisit if kind filtering proves insufficient.
- Row-click-to-edit, keyboard row activation.
- "Used by N instances" / type-usage counts.
- Duplicate-type action.
- Any change to how type instances are pinned or decoded.
