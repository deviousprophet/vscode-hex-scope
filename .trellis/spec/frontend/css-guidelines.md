# CSS Guidelines

## File Placement

All CSS belongs under `src/webview/styles/`. One file per feature area:

| File | Content |
|---|---|
| `base.css` | Reset, design tokens (`:root` vars), shared utility classes |
| `layout.css` | Two-pane layout, sidebar skeleton, sidebar tabs |
| `sidebar.css` | Inspector, scripts, label form, shared section patterns |
| `struct.css` | Struct editor, instance cards, field rows |
| `integrity.css` | Integrity checks panel, profile library, comparison UI |
| `toolbar.css` | Top toolbar, search box, view tabs |
| `memory-view.css` | Memory hex grid |
| `record-view.css` | Record table |
| `context-menu.css` | Right-click menu |

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
- Avoid `!important`. The only exception is overrides in `.scripts-toolbar::before` (suppressing collapsible-triangle inheritance from `.sb-section .sb-hdr::before`).
- Chain selectors no deeper than 3 levels (`.parent .child .grandchild`)
- Use `--custom-property` scoped to a parent class instead of deep selector chains

## Section / Header Pattern

Sidebar sections use the `.sb-section` → `.sb-hdr` → `.sb-body` pattern:

```css
.sb-section { padding: 10px 12px; border-bottom: 1px solid var(--border); }
.sb-hdr {
    display: flex; align-items: center; gap: 6px;
    font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .07em; color: var(--addr-fg); margin-bottom: 8px;
}
.sb-body { /* inherits padding from section */ }
```

`.sb-hdr` is a block-level flex container. The collapsible toggle triangle (▶) is injected via `.sb-section .sb-hdr::before` (absolute, `left: 0; top: 50%; margin-top: -6px`). The triangle is taken out of flow so it doesn't affect text position — text sits at `.sb-hdr`'s `padding-left: 14px`.

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
