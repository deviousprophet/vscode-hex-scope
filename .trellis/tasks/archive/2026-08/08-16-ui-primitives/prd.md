# Shared sidebar UI primitives (child of ui-consistency)

## Goal

Create the shared `.sb-*` primitive set that all four sidebar panels migrate onto. Land as the first child — every panel child depends on these existing.

## Requirements

- Add to `components/sidebar/sidebar.css` (the sidebar shell file that already owns shared `.sb-section/.sb-hdr/.sb-body/.sb-badge/.sb-empty`):
  - `.sb-btn` base + variants: `.sb-btn-primary` (solid, `--btn-bg/-fg`, hover `--btn-hover`), `.sb-btn-secondary` (ghost, `--addr-fg` on `--border`), `.sb-btn-danger` (red-tinted), `.sb-btn-add` (single dashed accent spec replacing `.lf-add-btn`/`.si-add-btn`/`.struct-add-field-btn`/`.script-refresh-btn` divergent looks). `font-size: 10px; font-weight: 600` per `css-guidelines.md` Button Standards.
  - `.sb-input` (text input, native `--input-bg/-fg/-bdr`, `--focus-bdr` focus) and `.sb-select` (same tokens) — replacing the `rgba(0,0,0,.25)` dark-input and native-token split.
  - `.sb-card` + `.sb-card-hdr` / `.sb-card-info` families — one spec for instance/check/script cards.
  - `.sb-status-dot` using `--ok` / `--err` tokens (replaces hardcoded `#4caf50`/`#e57373`).
- Move `.compact-tabs` from `styles/sidebar.css` verbatim into `base.css` (shared across searchBar/struct/sidebar, not sidebar-owned).
- Add missing tokens to `base.css`: `--muted-fg` (→ `--addr-fg` equivalent), `--info-fg` (→ `--high-color`), preferred over inventing new hues.
- Delete `src/webview/styles/sidebar.css`.
- Remove `'sidebar'` from `cssFiles` list at `hexEditorSession.ts:780`.
- Refresh stale specs: `css-guidelines.md` (drop `styles/sidebar.css` row and the dead `.scripts-toolbar::before` note, document new primitives), `component-sidebar.md`, `directory-structure.md`.

## Acceptance criteria

- [ ] All `.sb-*` primitives defined in `components/sidebar/sidebar.css`; `.compact-tabs` present in `base.css` and absent from `styles/sidebar.css`.
- [ ] `styles/sidebar.css` deleted; `hexEditorSession.ts` cssFiles no longer lists `'sidebar'`.
- [ ] `.compact-tabs` still renders for all three existing users (searchBar/struct/sidebar) — verified via existing tests + manual check.
- [ ] `--muted-fg` / `--info-fg` resolved to real values.
- [ ] No panel markup changed in this child; primitives are additive and unused until panel children migrate. Visual parity: adding primitives must not alter any current panel rendering.
- [ ] Spec docs accurate.
- [ ] `npm run check-types`, `npm run lint`, `npm test` green.

## Dependencies

- Depends on: nothing (root of the tree).
- Required by: `ui-inspector`, `ui-struct`, `ui-integrity`, `ui-scripts`.