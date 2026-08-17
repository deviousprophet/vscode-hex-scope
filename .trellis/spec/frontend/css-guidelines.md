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
- Avoid `!important`. The only exception is overrides suppressing collapsible-triangle inheritance from `.sb-section .sb-hdr::before`.
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

Sidebar primitives own shared rhythm: panel roots use `10px 12px`, header-to-body space is `8px`, card stacks use `4px`, and normal `.sb-btn` controls use `2px 8px` padding. Panels must not restate those values. Document an exception only for genuinely denser controls: Struct field-grid inputs and bit-field-child add buttons; Integrity compact profile actions. Header actions use the framework compact contract (`.sb-section-action`) and must not enlarge the header; Scripts uses the shared non-collapsible header (no border separator).

## Section / Header Pattern

Sidebar sections are rendered by the `SidebarSections` framework (`sidebar.ts`) using the `.sb-section` → `.sb-section-head` → `.sb-body` pattern:

```css
.sb-section { padding: 10px 12px; border-bottom: 1px solid var(--border); }
.sb-section-head { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.sb-section-title { flex: 1; min-width: 0; margin: 0; font: inherit; color: inherit; }
.sb-section-label { /* 10px uppercase bold header type, --addr-fg */ }
.sb-section-toggle { /* native disclosure button; padding-left: 14px for the triangle */ }
.sb-section-actions { display: flex; gap: 4px; flex-shrink: 0; margin-left: auto; }
.sb-section-action { /* compact contract: 10px / 2px 8px / 1.2 / max-height 22px */ }
```

The collapsible toggle triangle (▶) is injected via `.sb-section-toggle::before` (absolute, `left: 0; top: 50%; margin-top: -6px`), rotating 90° when the section is open. `.sb-section.collapsed .sb-body { display: none }` hides the body; `aria-expanded`/`aria-controls` live on the toggle button. Non-collapsible sections (`collapsible: false`) use the plain `.sb-section-label` — same `8px` header→body gap, no border separator.

Legacy `.sb-hdr` (block-level flex header) survives only for body-level form titles (e.g. the label form); top-level panel headers must not use it. The old `.sb-section .sb-hdr::before` triangle rule is gone — `!important` overrides for it are obsolete.

## Button Standards

- **Toggle groups** (endian, bit layout, compact-tabs): inherit from `.compact-tabs button` — font-size 10px, active state with `var(--btn-bg)`/`var(--btn-fg)`. Do NOT override font-size per-context.
- **Primary actions** (Add, Apply): `font-size: 10px; font-weight: 600;` with accent border/background.
- **Ghost/secondary**: transparent background, `var(--addr-fg)` color, `var(--border)` border.
- **Icon buttons** (edit/delete): 18×18px, `font-size: 11px`, opacity-reveal on parent hover.

## Layout Properties

- Sidebar panels use `scrollbar-gutter: stable` to prevent content shift when scrollbar appears/disappears
- Tab strip buttons use `writing-mode: vertical-rl` for compact vertical labels
- Horizontal spacing baseline: `12px` (sidebar padding), `6px` (gap between related items)
- Font-size baseline: `10px` for dense UI labels, `9px` for metadata/badges
