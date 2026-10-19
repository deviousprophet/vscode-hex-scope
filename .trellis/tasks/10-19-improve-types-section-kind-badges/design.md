# Design — Improve the Types section: kind badges, meta and order

## 1. Scope / trigger

Presentational change to the Overlay **Types** list (plus the kind badge in the
type form, for consistency). No persisted, decode, C-preview, or navigation
change. Trigger: the kind is invisible for structs, the chip competes with the
meta, and the list is unsorted.

## 2. Boundaries

| Layer | File | What changes |
|---|---|---|
| List markup | `src/webview/components/sidebar/overlayPanel/overlayPanel.ts` | `typeRowsHtml`, `typeRowHtml`, the three meta helpers; a kind-label + kind-rank helper; the list sort; filter state + tools markup + list-only refresh |
| Filter wiring | `overlayPanel.ts` (`wireTypesPanelControls`, `resetViewState`) | live `input`/`change` listeners; transient state reset |
| Form badge | `overlayPanel.ts` (`kindDefEditorShellHtml`, `KindDefEditorParts`) | the badge label/accent matches the list |
| Styles | `overlayPanel/overlayPanel.css` | `.od-row` child order widths, `.od-kind` primitive (drop uppercase), per-kind modifiers, `.oe-kind-badge` alignment |
| Tests | `src/test/webview/components/sidebar/overlayPanel/overlayPanel.test.ts` | kind labels per row, struct chip present, sorted order, meta strings |

No core/codec, storage, schema, or router changes.

## 3. Model

```ts
type TypeDefKind = 'struct' | 'bitfield' | 'enum';

const KIND_LABEL: Record<TypeDefKind, string> = {
    struct: 'Struct',
    bitfield: 'Bit-field',   // hyphenated, matches the kind-chooser tile
    enum: 'Enum',
};
const KIND_RANK: Record<TypeDefKind, number> = { struct: 0, bitfield: 1, enum: 2 };

function typeKindLabel(kind: TypeDefKind): string;          // KIND_LABEL[kind]
function sortTypeDefs(defs: readonly TypeDef[]): TypeDef[];  // copy: rank, then name (localeCompare, sensitivity 'base')
```

`sortTypeDefs` is applied **only** in `typeRowsHtml`. `allTypes()` and every
picker/dropdown keep their existing order (R6) — sorting must not leak into the
shared array.

### 3.1 Meta (one line, no wrap)

| Kind | Meta | Source |
|---|---|---|
| struct | `N fields · X B` | `def.fields.length`; `typeByteSize(def, allDefs)` from `overlayCodec` (needs the full defs array for nested refs — thread `all` through `typeRowHtml`) |
| bit-field | `base · used/total bits` | `used = Σ bitWidth`; `total = fieldByteSize(baseType) * 8` |
| enum | `base · N entries` | `def.entries.length` |

Do **not** call `typeByteSize` on a `kind:'bitfield'` def — its `fields` is empty
and it returns `0` (documented gotcha); use the base width instead.

### 3.2 Row shape (D3)

```html
<div class="od-row">
  <span class="od-name">StatusReg</span>
  <span class="od-kind od-kind-struct">Struct</span>
  <span class="od-meta">4 fields · 8 B</span>
  <action buttons>
</div>
```

`.od-name` stays `flex: 1; min-width: 0` (ellipsis); `.od-kind` and `.od-meta`
are `flex-shrink: 0`; `gap` stays `4px`. The chip moves *before* the meta so the
classifier sits next to the name and the numeric detail sits next to the actions.

### 3.3 Filter bar (D7 / R10–R12)

Transient panel state (never persisted, never posted to the host):

```ts
private _typeFilter = '';                       // name substring
private _typeKindFilter: TypeDefKind | 'all' = 'all';
```

Markup in `typePanelBodyHtml`'s list branch, above `#om-list`:

```html
<div class="od-tools">
  <input id="om-filter" class="od-filter sb-input sb-input-sm" type="search"
         placeholder="Filter types" aria-label="Filter types by name" value="…">
  <select id="om-kind-filter" class="od-kind-filter" aria-label="Filter types by kind">
    <option value="all">All</option>
    <option value="struct">Struct</option>
    <option value="bitfield">Bit-field</option>
    <option value="enum">Enum</option>
  </select>
</div>
<div id="om-list">…rows…</div>
```

Pipeline in `typeRowsHtml` / a new `visibleTypeDefs(all)`:

```ts
filtered = all.filter(d =>
    (_typeKindFilter === 'all' || typeDefKind(d) === _typeKindFilter) &&
    (_typeFilter.trim() === '' || d.name.toLowerCase().includes(_typeFilter.trim().toLowerCase())));
rows = sortTypeDefs(filtered);
```

Empty states are distinct: `all.length === 0` → "No types defined yet.";
otherwise `filtered.length === 0` → "No types match.".

Wiring (`wireTypesPanelControls`): `input` on `#om-filter` and `change` on
`#om-kind-filter` update the two fields and rebuild **only `#om-list`**
(`refreshTypeList(sec)`), so the tools keep focus and the editor is untouched.
`resetViewState` clears both filters.

## 4. Visual contract

### 4.1 Badge primitive (C2 — one shared style)

`.od-kind` and `.oe-kind-badge` keep sharing one primitive:

```css
.od-kind, .oe-kind-badge {
    font-size: 10px; font-weight: 700;
    line-height: 1.5; letter-spacing: 0;      /* no .04em: sentence case */
    text-transform: none;                     /* D2 — was uppercase */
    border: 1px solid var(--border); border-radius: 2px;
    padding: 0 3px; font-family: var(--font-ui);
}
.od-kind { flex-shrink: 0; }
.oe-kind-badge { justify-self: start; }
```

### 4.2 Per-kind accents (D4 / C3)

Component-local tokens in `overlayPanel.css` — three distinguishable hues, no
new global tokens, no solid fills:

| Kind | Text / border | Background |
|---|---|---|
| struct | `var(--high-color)` `#9cdcfe` | `rgba(156,220,254,.10)` |
| bit-field | `var(--warn)` `#e5a800` | `rgba(229,168,0,.12)` |
| enum | `#c586c0` (VS Code keyword purple; component-local) | `rgba(197,134,192,.12)` |

Border uses a mid-alpha mix of the same hue (`rgba(hue,.45)`). Modifier classes:
`.od-kind-struct` / `.od-kind-bitfield` / `.od-kind-enum`, applied by the list and
by the form badge. Base `.od-kind`/`.oe-kind-badge` keeps a neutral fallback so
an unknown kind is still legible.

Rationale for three hues: the kind is the one attribute that changes how the row
behaves elsewhere (pin-ability, editor form), so a colour-coded marker earns its
place; the meta stays monochrome so it does not compete.

## 5. Form badge consistency (D8)

`KindDefEditorParts.badge` currently carries the raw `'bitfield'` / `'enum'`.
Change it to carry `typeKindLabel(kind)` and add the matching
`od-kind-<kind>` modifier to the `.oe-kind-badge` span, so the form header and
the list show the same word/colour. The struct editor has no kind badge (it shows
"type default"), so nothing is added there.

## 6. Compatibility / rollback

- **DOM contract**: no ids/classes are renamed; the chip keeps `.od-kind` and
  gains modifiers. Existing selectors (`.od-kind`, `.od-row`, `.od-name`,
  `.od-meta`) keep working.
- **Ordering change is visible** (kind-grouped then A-Z) — intended, and the only
  behavioural-looking delta. It affects list order only, never ids or references.
- **Tests**: assertions that rely on creation order or on struct having no badge
  must be updated to the new contract (not deleted).
- **Rollback**: revert the commit; no persisted data is touched, so there is
  nothing to migrate.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Sorting leaks into pickers/dropdowns | Sort only inside `typeRowsHtml`; never mutate `allTypes()` output |
| `typeByteSize` on a bit-field/enum def returns 0 | Only struct rows call it; bit-field/enum use base width |
| Nested structs without `defs` produce a short size | Pass the full `all` array into `typeRowHtml`/meta |
| Struct badge breaks assertions that assert its absence | Update those assertions to assert the new chip (documented contract change) |
| Row gets too dense in a narrow sidebar | Chip is shrink-0 at 10px; meta keeps `nowrap` + ellipsis; name is the only flexible cell |
| New purple lacks a token | Component-local value, documented; swap to an existing token in one line if the palette changes |
| Live filtering re-renders the whole panel and drops input focus | Rebuild **only `#om-list`** on filter events; the tools stay mounted (same pattern as `refreshFieldRows`) |
| Filter state leaks into persisted/host state | Keep it on the panel only; clear in `resetViewState`; never push to the host |
