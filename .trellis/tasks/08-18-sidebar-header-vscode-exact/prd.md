# Sidebar header — duplicate VS Code look

## Goal

Apply the confirmed VS Code `paneview.css`/`paneviewlet.css` header hyper-params to our `SidebarSections` header so the sidebar section header looks and animates like VS Code's (decision Q1-A + Q2-A, grilled).

## Requirements

1. **Fixed 22px header geometry** — `.sb-section-head`: `height: 22px; line-height: 22px; overflow: hidden; display: flex; align-items: center; box-sizing: border-box; cursor: pointer` (collapsible) / `cursor: default` (`.not-collapsible`). Deterministic single-line row like `.pane-header`.
2. **Type** — `.sb-section-label` (equivalent of `h3.title`): `font-size: 11px; font-weight: bold; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; min-width: 3ch`; keep `text-transform: uppercase` + `letter-spacing` only if it does not break the VS Code look (VS Code uses plain uppercase 11px bold).
3. **Chevron is a header-row sibling** (VS Code `.twisty-container`) — rendered FIRST inside `.sb-section-head`, before the `h3.sb-section-title` (so the row reads **"> Section Name"**), vertically centered by the head flex. Glyph `▼` (codicon chevron-down equivalent); when the section `.collapsed` it `rotate(-90deg)` (reads chevron-right); when open `translateY(1px)` (VS Code `.expanded > .codicon:first-of-type` nudges). `aria-hidden="true"` stays. Non-collapsible heads render no chevron span.
4. **First-section border** — `.sb-section:first-child` no top border and no doubling (VS Code: "do not show any border for first views"); `border-bottom` still separates subsequent sections.
5. **Actions** — `.sb-section-actions { margin-left: auto; margin-right: 8px; }` (VS Code `.actions` right spacing); keep always-visible compact contract + stopPropagation.
6. **Non-collapsible** — `.sb-section-head.not-collapsible` no twisty (already), title `margin-left: 8px` (VS Code indent where the twisty would be), `cursor: default`, keeps `tabindex="-1"` (our header-nav focusability — intentional divergence).
7. **Animation** — collapse/expand transition `150ms ease-out` (was 180ms ease) with `@media (prefers-reduced-motion: reduce) { transition-duration: 0s !important; }`. Body stays in the DOM (no detach), grid `auto 1fr → auto 0fr` + `.sb-body` overflow hidden (net effect == VS Code outer-height clip).

## Acceptance Criteria

- [ ] Header renders as a fixed-height 22px row; title 11px bold uppercase nowrap-ellipsis, `min-width: 3ch`.
- [ ] Rendered DOM: `<div.sb-section-head> → <span.sb-section-chevron> + <h3.sb-section-title>… + <div.sb-section-actions>` (chevron is a header-row sibling before the title — reads "> Section Name").
- [ ] Chevron reads chevron-down when open (`translateY(1px)`) and chevron-right when collapsed (`rotate(-90deg)`), `aria-hidden`.
- [ ] First `.sb-section` shows no top border; divider appears only between/after sections.
- [ ] Actions row: `margin-right: 8px`, always visible, still never toggles the header.
- [ ] Non-collapsible header: no chevron, title indented 8px, `cursor: default`.
- [ ] Collapse animation: 150ms ease-out; reduced-motion sets 0s.
- [ ] Body stays in DOM when collapsed (grep: no `body.remove`).
- [ ] Existing whole-header toggle + keyboard behavior unchanged; `npm run check-types`, `npm run lint`, `npm test` green.

## Out of scope

- Hover-reveal actions, `.show-expanded` gating, action-visibility settings (decided against).
- Body detach (decided against).
- Description/`renderLabelWithIcons` title descriptions (no consumer).