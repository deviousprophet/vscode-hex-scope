# CSS Guidelines

## File Placement

All CSS belongs under `src/webview/styles/`. One file per feature area:

| File | Content |
|---|---|
| `base.css` | Reset, design tokens (`:root` vars), shared utility classes (incl. `.compact-tabs`) |
| `layout.css` | Two-pane layout |
| `statsBar.css` | Stats bar (bytes/records/segments/format) |
| `hexView.css` (in components/hexView/) | Memory hex grid (component-owned) |
| `sidebar.css` (in components/sidebar/) | Sidebar shell: skeleton, tabs, resizer, common settings, shared section pattern + shared `.sb-*` UI primitives |
| `inspectorPanel.css` (in components/sidebar/inspectorPanel/) | Inspector panel: address/vals, bit view, multi-byte, segments, labels, label form |
| `structPanel.css` (in components/sidebar/structPanel/) | Struct panel: editor, instances/cards, field rows, C preview |
| `integrityPanel.css` (in components/sidebar/integrityPanel/) | Integrity panel: profiles, checks, comparison panes, auto-fix |
| `scriptsPanel.css` (in components/sidebar/scriptsPanel/) | Scripts panel: toolbar, cards, run/cancel button, result blocks, output log |
| `record-view.css` | Record table |
| `context-menu.css` | Right-click menu |

Extracted self-contained components move their component-specific rules out of `styles/` into a colocated CSS file imported by the component's `.ts`:

```text
src/webview/components/searchBar/
    searchBar.ts     import './searchBar.css';
    searchBar.css    all .search-* / #search-* rules
```

Once a component's rules are extracted, `styles/` holds only shared/global concerns. See [SearchBar Component](./components/component-search-bar.md).

No inline `<style>` tags in TS/HTML. No CSS in TS template strings beyond class names.

## Design Tokens

Use `:root` CSS custom properties defined in `base.css`. Never hardcode colors, fonts, or sizes that have a token:

- `var(--bg)`, `var(--fg)`, `var(--border)` — base theme
- `var(--font-editor)`, `var(--font-ui)` — font families
- `var(--high-color)`, `var(--addr-fg)`, `var(--non-graphic)` — semantic colors
- `var(--btn-bg)`, `var(--btn-fg)`, `var(--btn-hover)` — button tokens
- `var(--input-bg)`, `var(--input-fg)`, `var(--input-bdr)` — input tokens

Before adding a new hardcoded color, check if an existing token covers the need.

## Selector Patterns

- Prefer `#id` for unique singletons, `.class` for repeatable patterns
- Avoid `!important`.
- Chain selectors no deeper than 3 levels (`.parent .child .grandchild`)
- Use `--custom-property` scoped to a parent class instead of deep selector chains

## Sidebar Primitives

The four sidebar panels converge on shared `.sb-*` primitives defined in `components/sidebar/sidebar.css`:

| Primitive | Use |
|---|---|
| `.sb-btn` | Base button (inline-flex, 10px, 600, radius 3px, `padding: 2px 8px`). Variants: `-primary` (solid `--btn-bg/-fg`), `-secondary` (ghost, `--addr-fg` on `--border`), `-danger` (red-tinted), `-add` (dashed accent, `padding: 5px 8px`). |
| `.sb-input` / `.sb-select` | Text input / select using native `--input-bg/-fg/-bdr` tokens, `--focus-bdr` on focus. |
| `.sb-card` / `.sb-card-hdr` / `.sb-card-info` | Card container (including `margin-bottom: 4px`) + clickable header + info column. |
| `.sb-status-dot` | `.ok` → `var(--ok)`, `.err` → `var(--err)`, `.idle` → dimmed. |

### Spacing Ownership

Sidebar primitives own shared rhythm: panel roots use `10px 12px`, header-to-body space is `8px`, card stacks use `4px`, and normal `.sb-btn` controls use `2px 8px` padding. Panels must not restate those values. Document an exception only for genuinely denser controls: Struct field-grid inputs and bit-field-child add buttons; Integrity compact profile actions. Header actions use the framework compact contract (`.sb-section-action`) and must not enlarge the header.

## Section / Header Pattern

Sidebar sections are rendered by the `SidebarSections` framework (`sidebar.ts`) as a **PaneView/SplitView** (`paneview.ts`/`splitview.ts`): each section is a resizable pane, `.sb-pane-view` → `.sb-pane` (`.sb-section`) → `.sb-section-head` → `.sb-body`, with `.sb-pane-sash` dividers between panes:

```css
.sb-pane-view { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.sb-pane { display: flex; flex-direction: column; flex: 0 0 auto; min-height: 0; overflow: hidden; box-sizing: border-box; transition: flex-basis .15s ease-out; } /* flex-basis: <px> managed inline by SidebarSections */
.sb-pane .sb-body { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 10px 12px; box-sizing: border-box; } /* each expanded pane scrolls itself; panel root never scrolls */
.sb-pane-sash { height: 3px; flex: 0 0 auto; cursor: row-resize; border-top: 1px solid var(--border); }
.sb-section-head { display: flex; align-items: center; gap: 6px; height: 22px; line-height: 22px; overflow: hidden; flex-shrink: 0; box-sizing: border-box; padding-left: 12px; }
.sb-section-title { flex: 1; min-width: 0; margin: 0; font: inherit; color: inherit; }
.sb-section-chevron { /* decorative aria-hidden chevron `›` (U+203A); rotate(90deg) when open (points down), no transform when collapsed (points right) */ }
.sb-section-label { /* 11px bold uppercase header type (VS Code), nowrap + ellipsis + min-width 3ch, --addr-fg */ }
.sb-section-actions { display: flex; align-items: center; gap: 4px; margin-left: auto; margin-right: 8px; flex-shrink: 0; }
.sb-section-action { /* compact contract: 10px / 2px 8px / 1.2 / max-height 22px */ }
@media (prefers-reduced-motion: reduce) { .sb-pane, .sb-section-chevron { transition-duration: 0s !important; } }
```

The section header is the collapse control (VS Code model): every `.sb-section-head` carries `role="button"`, `tabindex="0"`, `aria-expanded`/`aria-controls`/`aria-label` (all sections are collapsible — there is no non-collapsible variant); a decorative `.sb-section-chevron` span (aria-hidden, first child — reads "› Section Name") is a chevron `›` (U+203A) pointing right when collapsed and rotated 90° (pointing down) when open. Section headers carry no count badge. The head is a fixed 22px row (VS Code `--pane-header-size`), 11px bold uppercase nowrap-ellipsis title with a 12px left inset. The whole head toggles on click/Enter/Space/ArrowLeft/ArrowRight; `.sb-section-actions` stopPropagation so actions never toggle. Collapse animates `flex-basis` to 22px (150ms ease-out, VS Code duration) with the body clipped (overflow hidden on the pane); the body stays in the DOM and the collapsed pane is packed to the bottom of the pane-view. Sash drag resizes the pane above (ArrowUp/Down ±10px, double-click 50/50); sashes adjacent to a collapsed pane get `.disabled`.

`.sb-hdr` was removed in the 10px type-floor pass; body-level form titles (e.g. the label form) render as plain `.lbl-form` titles with the shared 10px metadata floor. There is no `.sb-hdr` fallback and no collapsible-triangle inheritance to override.

## Button Standards

- **Toggle groups** (endian, bit layout, compact-tabs): inherit from `.compact-tabs button` — font-size 10px, active state with `var(--btn-bg)`/`var(--btn-fg)`. Do NOT override font-size per-context.
- **Primary actions** (Add, Apply): `font-size: 10px; font-weight: 600;` with accent border/background.
- **Ghost/secondary**: transparent background, `var(--addr-fg)` color, `var(--border)` border.
- **Icon buttons** (edit/delete): 18×18px, `font-size: 11px`, opacity-reveal on parent hover.

## Layout Properties

- Sidebar panels use `scrollbar-gutter: stable` to prevent content shift when scrollbar appears/disappears
- Tab strip buttons use `writing-mode: vertical-rl` for compact vertical labels
- Horizontal spacing baseline: `12px` (sidebar padding), `6px` (gap between related items)
- Font-size baseline: `10px` for dense UI labels and metadata/badges (10px type floor; record-view grid tags are the sole retained `9px` exception)
