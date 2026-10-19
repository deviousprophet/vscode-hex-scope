# Implement — Improve the Types section: kind badges, meta and order

Ordered checklist. Compile + lint after each code step; full suite + Fallow at
the end. Read `design.md` §3–§5 before starting.

- [ ] 1. **Helpers** (`overlayPanel.ts`): add `KIND_LABEL`
      (`Struct` / `Bit-field` / `Enum`), `KIND_RANK`
      (`struct:0, bitfield:1, enum:2`), `typeKindLabel(kind)`, and
      `sortTypeDefs(defs)` — a **copy** sorted by rank then
      `localeCompare(name, undefined, { sensitivity: 'base' })`. Do not mutate
      `allTypes()` output.

- [ ] 2. **Filter state + pipeline** (D7/R10–R12): add
      `_typeFilter = ''` and `_typeKindFilter: TypeDefKind | 'all' = 'all'` to the
      panel; add `visibleTypeDefs(all)` = kind filter → name substring
      (case-insensitive, trimmed) → `sortTypeDefs`. Clear both in
      `resetViewState`. Never persist or post them.

- [ ] 3. **Filter tools markup** (`typePanelBodyHtml` list branch): a
      `.od-tools` bar above `#om-list` with
      `<input id="om-filter" type="search" …>` and
      `<select id="om-kind-filter">` (`all` / `struct` / `bitfield` / `enum`,
      labels `All` / `Struct` / `Bit-field` / `Enum`). Give both `aria-label`s
      and reflect the current state (`value` / `selected`).

- [ ] 4. **Filter wiring + list-only refresh** (`wireTypesPanelControls`):
      `input` on `#om-filter`, `change` on `#om-kind-filter` → update state and
      rebuild **only `#om-list`** via a new `refreshTypeList(sec)` (never the
      whole body, never the editor). The tools keep focus.
      Empty states: `all.length === 0` → "No types defined yet."; otherwise
      `visible.length === 0` → **"No types match."**.

- [ ] 5. **List order** (`typeRowsHtml`): render `visibleTypeDefs(all)`.

- [ ] 6. **Row markup** (`typeRowHtml`, thread the full `all` array in for sizes):
      badge for **every** kind — `<span class="od-kind od-kind-${kind}">${typeKindLabel(kind)}</span>`
      — and the order `name → kind → meta → actions`. Remove the
      `kind === 'struct' ? ''` special case.

- [ ] 7. **Meta** (D5):
      - struct → `` `${fields} field${s} · ${typeByteSize(def, all)} B` ``
      - bit-field → `` `${base} · ${used}/${total} bits` `` where used = Σ
        `bitWidth`, total = `fieldByteSize(baseType) * 8`
      - enum → unchanged (`base · N entries`)
      Do **not** call `typeByteSize` for bit-field/enum defs (returns 0).

- [ ] 8. **Form badge** (`KindDefEditorParts` + `kindDefEditorShellHtml`): pass
      `typeKindLabel(kind)` instead of the raw kind, and add the matching
      `od-kind-<kind>` modifier to the `.oe-kind-badge` span.

- [ ] 9. **CSS** (`overlayPanel.css`):
      - `.od-kind, .oe-kind-badge`: remove `text-transform: uppercase` and
        `letter-spacing: .04em`; keep 10px/700, border, radius, padding,
        `--font-ui`.
      - Add component-local hues + modifiers `.od-kind-struct`
        (`--high-color` / `rgba(156,220,254,.10)`), `.od-kind-bitfield`
        (`--warn` / `rgba(229,168,0,.12)`), `.od-kind-enum` (`#c586c0` /
        `rgba(197,134,192,.12)`), each with a mid-alpha hue border.
      - `.od-row`: keep flex + 4px gap; `.od-name` flexible, `.od-kind` and
        `.od-meta` `flex-shrink: 0`; meta keeps `nowrap` + ellipsis.
      - `.od-tools`: compact flex row (filter input grows, kind select shrinks)
        with the sidebar's existing small-input styling; `.od-filter` /
        `.od-kind-filter` sizing.

- [ ] 10. **Tests** (`overlayPanel.test.ts`):
      - struct row renders a `Struct` chip (regression: today it does not);
      - the three labels are sentence case and `Bit-field` is hyphenated;
      - the modifier class per kind;
      - order is struct → bit-field → enum then A-Z (update existing
        creation-order assertions — do not delete them);
      - struct meta contains a byte size; bit-field meta contains `used/total`;
      - filter by name (substring, case-insensitive), filter by kind, and both
        composed; clearing restores the full sorted list;
      - no-match shows "No types match." (and the no-types state still differs);
      - filtering keeps `#om-filter` focus and does not rebuild the editor;
      - the filter state clears on `resetViewState`.
      Do not weaken unrelated assertions.

- [ ] 11. **Spec** (`.trellis/spec/frontend/components/component-sidebar-overlay-panel.md`):
      document the kind chip (all three kinds, sentence case, per-kind accent),
      row order, meta fields, kind-then-name sort, and the filter bar
      (name + kind, live, list-only refresh, transient, reset with view state).
      Note that pickers keep the stored order.

- [ ] 12. **Gates + fallow**:
      - `npm run check-types`
      - `npm run lint`
      - `npm run compile-tests && npm test` (baseline 1288; expect 0 failing —
        only types-list order/appearance assertions change, plus the new filter
        tests)
      - `node .agents/skills/fallow-fix/scripts/fallow-extract.mjs` → GREEN

## Validation

- Struct/bit-field/enum rows each show the correct chip + accent.
- List order is deterministic (kind rank, then case-insensitive name).
- Meta numbers are correct for nested structs (`typeByteSize` with `all`).
- Filter composes with sort; focus is preserved; empty states are distinct.
- Filters are transient and reset with the view state.
- Form badge and list badge agree; pickers unchanged in order.
- Suite green; Fallow GREEN.

## Review gates

- After step 6: markup/contract review (badge for all kinds, row order, helpers).
- After step 9: visual review (contrast, chip weight, narrow-sidebar fit, tools bar).
- After step 11: spec review (documented contract matches the code).
- Before finish: full suite + fallow.

## Rollback points

- Each step is a self-contained commit; revert it to fall back.
- No persisted data is touched, so rollback never needs data repair.

## Out-of-scope guard

No collapsible kind sections, row-click-to-edit, usage counts, or duplicate
action. No class/id renames (add modifiers only). No persisted/schema/decode/
C-preview change.
