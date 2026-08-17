# UX typography: font floor + labeled controls

## Goal

Raise the sidebar's sub-8px microtype off the legibility floor and make icon-only controls discoverable (labels/aria). Cross-panel density pass, no layout redesign.

## Background (what changed since audit)

- The audit flagged: 8px `si-f-type`, 9px meta/headers, 5-icon label rows, dead `.si-del-btn`, dual header styles. Since then the panel reworks already removed: label reorder icons, `.si-del-btn`, hover-only card controls, slide-era CSS. Remaining work is the **type-size floor** and **control labeling**.

## Requirements

R1. **Type floor** — no sidebar UI text below 10px. Minimums:
   - `si-f-type` 8→10px, `si-f-off`/`si-f-pri`/`si-f-val`/meta rows (`sd-meta`, `si-cmeta-*`, `si-caddr` 9px) → 10px.
   - Grid header rows at 9px (`se-field-hdr`, integrity card meta/values 9px) → 10px where legibility matters (dense table columns may stay 9px ONLY with a documented ponytail: field tables where 10px would overflow — audit each).
   - `.si-toggle-group`/compact-tabs text already 9-10px; unify to 10px.
   - Verify em/letter-spacing doesn't shrink below the floor after change.
R2. **Labeled controls** — every icon-only button in the sidebar gets a persistent visible label OR `aria-label` + `title` (audit: script run ▶, card ⋮ menus, label eye, profile menu button, pointer field menu entry, integrity copy ⧉, scripts refresh ↻, struct Add/Back — Add/Back already have text). Priority: controls whose icon is ambiguous (run/pause, refresh) get `aria-label` if a visible label would add noise; the audit intent is no *unlabeled* icon affordances remain.
R3. **Unify legacy header** — the label-form title still uses legacy `.sb-hdr` (inspectorLabels.ts) while the framework uses `.sb-section-label`. Fold the label-form title into the framework look (`.sb-section-label` style) and delete `.sb-hdr` from sidebar.css if no other user remains.
R4. No behavior/layout change beyond type size and labels; suite green.

## Acceptance Criteria

- [ ] No CSS rule in `src/webview/components/sidebar/` renders sidebar UI text below 10px, except documented ponytail exceptions for dense table columns (each exception carries a `ponytail:` comment naming when it can be raised).
- [ ] Every icon-only sidebar control either has a visible text label or both `aria-label` and a `title` explaining it.
- [ ] `.sb-hdr` either gone from sidebar.css or has an unambiguous remaining user (nothing else renders legacy style).
- [ ] Struct field table legibility visibly improved (type column readable at 10px), unit tests across panels unchanged except updated size/style assertions.
- [ ] `npm run check-types`, `npm run lint`, `npm test` green.

## Out of scope

- Full design-system audit (dbases/dark-theme contrast) — future.
- Touch-target minimums (covered by `ux-a11y-targets`, done).
- Grid column re-layout (typography only, not rebuild column math).