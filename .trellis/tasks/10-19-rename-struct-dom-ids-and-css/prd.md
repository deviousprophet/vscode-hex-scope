# Rename struct-derived DOM ids and CSS prefixes

## Goal

Finish the Type Overlay rename in the **internal DOM/CSS vocabulary**. The
user-facing wording, the TypeScript identifiers, the module names, and the
persisted contract were renamed in `10-19-rename-struct-overlay-to-type-overlay`
(D5 deliberately deferred the DOM ids and class prefixes). This task completes
that: rename the struct-derived DOM ids / CSS classes and the abbreviation
prefixes so no internal token says "struct" without meaning the `kind:'struct'`
definition.

Internal only: **no user-visible change, no persisted-contract change, no
behavior change.**

## Background / inventory

185 distinct prefixed tokens, **1635 occurrences**, across **17** files:

| Prefix | Occurrences | Meaning |
|---|---|---|
| `si-` | 984 | Struct Instances (instance cards + decoded rows) |
| `sfe-` | 266 | Struct Field Editor (field / bit-child rows) |
| `se-` | 251 | Struct Editor (type editor shell) |
| `sa-` | 74 | Struct Add (add/edit-instance form) |
| `sm-` | 34 | Struct Manager (types list / kind picker) |
| `sd-` | ~15 | Struct Def (types-list rows: `.sd-row`, `.sd-kind`, `.sd-name`, `.sd-meta`, `.sd-empty`) |
| `stab-` | 15 | sidebar tab (`stab-<panelId>`) |
| `sbp-` | 11 | sidebar panel (`sbp-<panelId>`) |

Plus the literal-`struct` DOM names (~98 occurrences): `.struct-field-row` (34),
`.struct-h` (17), `.struct-arr-sep` (5), `.struct-addr-pfx` (3),
`.se-struct-default-{row,sel,lbl,ptr}` (17), `#s-struct-pins` (9),
`#s-struct` (2), `#sa-struct-sel` (2).

`stab-`/`sbp-` are not struct-derived prefixes; their **suffix is the sidebar
panel id**, currently `'struct'` (`hexViewer.ts` panels array).

## Decisions (explicit)

- **D1. Abbreviation families shift `s…` → `o…`** (Overlay), preserving the
  trailing letters' meaning and the existing family structure. No collision
  exists for any of the new prefixes (verified).

  | Now | New | Meaning |
  |---|---|---|
  | `si-*` | `oi-*` | Overlay Instances |
  | `se-*` | `oe-*` | Overlay Editor |
  | `sfe-*` | `ofe-*` | Overlay Field Editor |
  | `sa-*` | `oa-*` | Overlay Add |
  | `sm-*` | `om-*` | Overlay Manager |
  | `sd-*` | `od-*` | Overlay Def (types-list rows) |

- **D2. Literal names are renamed contextually**, not by token substitution —
  each name keeps the word that describes it:

  | Now | New | What it is |
  |---|---|---|
  | `#s-struct-pins` | `#s-overlay` | panel root (holds both sections) |
  | `#s-struct` | `#s-types` | the types list |
  | panel id `'struct'` | `'overlay'` | ⇒ `#stab-struct`→`#stab-overlay`, `#sbp-struct`→`#sbp-overlay` |
  | `.se-struct-default-{row,sel,lbl,ptr}` | `.oe-type-default-{…}` | the editor's "type default" row |
  | `.sa-struct-sel` | `.oa-type-sel` | type picker in the add-instance form |
  | `.struct-field-row` | `.field-row` | pure-struct field grid row |
  | `.struct-addr-pfx` | `.addr-pfx` | the `0x` address prefix span |
  | `.struct-h` | `.type-h` | hex-view highlight class for a type row's bytes |
  | `.struct-arr-sep` | `.type-arr-sep` | hex-view array-element separator highlight |

- **D3. `stab-` / `sbp-` prefixes themselves stay** — only the panel id suffix
  changes (they are generic sidebar scaffolding, not part of this vocabulary).

## Requirements

- R1. No DOM id or CSS class token contains `struct`/`Struct` except the
  exclusions in the Constraints section.
- R2. The `si-` / `se-` / `sfe-` / `sa-` / `sm-` / `sd-` families are gone **except the
  stats-item namespace** (`.si` / `.si-fmt`, C2); `oi-` / `oe-` / `ofe-` / `oa-`
  / `om-` are used consistently.
- R3. **Emitters and consumers agree**: every renamed class/id is updated in
  both the markup emitter (TS) and the CSS rule, and in every string selector
  (tests, `querySelector`, `closest`, `dataset`, callbacks that take a class
  name).
- R4. The hex-view highlight classes (`.type-h`, `.type-arr-sep`) are updated in
  `hexView.css` **and** every emit/clear call site (`onHighlightHex` /
  `onClearHighlightHex` in `overlayPanel.ts`) **and** `hexView.test.ts`.
- R5. The `.struct-addr-pfx` rename updates both the `overlayPanel.css` rule and
  the legacy local copy in `integrityPanel.css` (and its explanatory comment).
- R6. No user-visible change; no persisted-contract change; no behavior change.
- R7. Specs that document ids/classes are updated
  (`component-sidebar-overlay-panel.md`, `component-hex-view.md`,
  `overlay-instance-display.md`, `css-guidelines.md` where they name these).
- R8. No issue reference in artifacts, code, or comments.

## Constraints

- C1. **String selectors are not compiler-checked.** The full suite is the only
  real gate; for each renamed token, grep BOTH the emitter and every consumer
  before moving on. A missed `querySelector('#s-struct-pins')` fails silently.
- C2. **Excluded — do NOT rename:**
  - the **stats-item** namespace in `src/webview/styles/statsBar.css` +
    `src/webview/statsBar.ts` — the `.si` container and the `.si-fmt` modifier.
    `si` there abbreviates the stats **item**, not struct instances; it is a
    different, pre-existing namespace that merely shares the two-letter prefix.
    Leave `.si` / `.si-fmt` alone (a separate stats-vocabulary cleanup is out of
    scope); note that `.si-hex-prefix` / `.si-hex-body` are **not** part of it —
    those are the overlay-owned hex spans (their rule lives in
    `overlayPanel.css`) and DO rename to `oi-hex-*`;
  - the persisted / legacy-migration identifiers `structs.json`, `structPins`,
    `structId`, `refStructId`, `sourceStructId` (they are the on-disk contract
    and belong to the separate alias-cleanup follow-up);
  - the parity fold-back literal `data-source-struct-id` in
    `overlayPanel.test.ts` (an intentional historical reference that reproduces
    the pre-rename hash — it must keep saying `struct`);
  - kind vocabulary — `type: 'struct'`, `<optgroup label="Struct">`, the kind
    tile "Struct";
  - legacy Memento keys / markers — `hexScope.structs.*`,
    `hexScope.structPins.*`, `PER_FILE_*`, `STRUCTS_V*_KEY`;
  - English / platform words — `constructor`, `structuredClone`, `structural`,
    `structurally`, `restructure`, `destructive`, `construct`.
- C3. Pure rename — do not bundle any behavior, markup-structure, or style
  change.
- C4. Gates: `npm run check-types`, `npm run lint`,
  `npm run compile-tests && npm test`; Fallow GREEN.

## Acceptance Criteria

- [ ] `grep -rni "struct" src` returns only C2 exclusions (kind vocabulary,
  persisted/legacy identifiers, the parity fold-back literal, English words).
- [ ] No `si-` / `se-` / `sfe-` / `sa-` / `sm-` / `sd-` token remains except the
  stats-item `.si` / `.si-fmt` (C2); `oi-` / `oe-` / `ofe-` / `oa-` / `om-` used
  consistently.
- [ ] `#s-overlay`, `#s-types`, `#stab-overlay`, `#sbp-overlay` used in markup
  and selectors; panel id is `'overlay'`.
- [ ] No orphaned CSS rule and no class emitted without a rule (spot-check the
  renamed families).
- [ ] Hex-view highlight classes renamed in `hexView.css`, the `overlayPanel.ts`
  emit/clear sites, and `hexView.test.ts`.
- [ ] `check-types`, `lint`, `compile-tests && npm test` pass; suite count
  unchanged (1288 passing / 0 failing) except renamed test titles; Fallow GREEN.
- [ ] Specs updated; no issue references.

## Out of scope

- The persisted/legacy `struct*` identifiers and the back-compat alias removal
  (separate follow-up task).
- Any behavior, layout, or visual change.
- The `stab-` / `sbp-` scaffolding prefixes.
