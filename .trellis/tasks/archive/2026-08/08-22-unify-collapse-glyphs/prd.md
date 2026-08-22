# Unify collapse glyphs app-wide

## Goal

Four collapse/expand affordances use four different glyph conventions:

| Affordance | Open | Collapsed | Mechanism |
|------------|------|-----------|-----------|
| Sidebar section chevron | `▼` `\25BC` | rotate(-90deg) | CSS rotate |
| Inspector Bits toggle | `▶` `&#9658;` rotated +90 | `▶` `&#9658;` | CSS rotate (inverted) |
| Scripts output header | `▼` | `▶` | CSS content-swap |
| Struct expand buttons | `▾` `\u25be` | `▸` `\u25b8` | JS string |

Unify on one canonical pair.

## Canonical pair

- **Open/expanded**: `▼` (U+25BC)
- **Collapsed/right**: `▶` (U+25B6)

Mechanism stays local (CSS rotate for sidebar/inspector, CSS content-swap for
scripts, JS string for struct) — only the visible glyph characters unify.
Sidebar (`\25BC` + rotate -90) and scripts (`▼`/`▶`) already match; no change.

## Requirements

- R1. Inspector Bits toggle: `&#9658;` → `▼`; collapsed state `rotate(-90deg)`
  (mirror `.sb-section-chevron`); drop the open-state `rotate(90deg)` rule.
- R2. Inspector Bits toggle: `.sb-inner-toggle` gets `height: 22px` to match
  the sidebar section head row (fixes the "thinner" button).
- R2a. Inspector Bits is a sub-section of Inspector: its glyph must be smaller
  than the parent section chevron (10px vs 11px) and its header indented deeper
  (`.sb-inner-toggle` `padding-left: 12px`) so the hierarchy is visible.
- R3. Struct panel: every expand/collapse button glyph `▾`→`▼` and `▸`→`▶`,
  including `expandGlyph()`, the `\u25be`/`\u25b8` literals, and the
  `expBtn.textContent` assignments.
- R4. Non-collapse affordances stay untouched: context-menu submenu `▸`
  (`contextMenu.css:42`) and searchBar prev/next `▲`/`▼`.
- R5. Sidebar section head: chevron sits flush at the left edge (no horizontal
  padding on `.sb-section-head`). Add `padding-left: 12px` (matches
  `.sb-body` / `#sidebar-common-settings` left inset) so the chevron is
  indented from the sidebar edge.

## Acceptance Criteria

- [x] No `▾`, `▸`, `\u25be`, `\u25b8`, or `&#9658;` remain in any collapse
      affordance source.
- [x] Inspector Bits button row height is 22px, matching section heads.
- [x] Bits sub-section glyph is smaller (10px) than parent chevron (11px) and
      indented deeper than the section header.
- [x] Section-head chevron has 12px left inset (not flush against edge).
- [x] `npm run lint` + typecheck + webview tests green.
- [x] Spec diagrams referencing the struct glyphs (`struct-instance-display.md`,
      `scripting.md`) updated to `▼`/`▶` where they depict collapse controls.
