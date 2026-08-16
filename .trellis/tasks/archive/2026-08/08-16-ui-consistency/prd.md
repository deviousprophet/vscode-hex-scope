# Sidebar panel UI consistency (parent)

## Goal

Align the four sidebar panels (Inspector, Struct, Integrity, Scripts) onto one shared visual-language surface — shared `.sb-*` primitives for buttons, inputs, cards, and status, with deliberate per-panel differences documented. Root cleanup: remove the leftover `styles/sidebar.css`, fix undefined tokens, refresh stale CSS specs.

## Task map

Children (all under this parent):

| child | deliverable |
|---|---|
| `ui-primitives` | Shared `.sb-btn-*` / `.sb-input` / `.sb-select` / `.sb-card` primitives in `components/sidebar/sidebar.css`; `.compact-tabs` → `base.css`; delete `styles/sidebar.css`; add `--muted-fg`/`--info-fg` tokens; spec refresh (`css-guidelines.md`, `component-sidebar.md`, `directory-structure.md`). **First** — all panel children depend on primitives existing. |
| `ui-inspector` | Inspector panel markup/CSS onto primitives. |
| `ui-struct` | Struct panel markup/CSS onto primitives. |
| `ui-integrity` | Integrity panel markup/CSS onto primitives. |
| `ui-scripts` | Scripts panel markup/CSS onto primitives. Visual-only (non-collapsible header stays). |

Dependency ordering encoded in each child's artifact: panel children require `ui-primitives` merged before `task.py start`.

## Cross-child acceptance criteria

- [ ] All four panels render their same-role controls with the same tokens/radii/paddings (verified via jsdom class + `getComputedStyle` token asserts; manual VS Code eyeball on dark + light themes).
- [ ] No visual regression tooling introduced; no new dependencies.
- [ ] `styles/sidebar.css` deleted, `'sidebar'` removed from `hexEditorSession.ts` cssFiles, no dead CSS or undefined token references remain (`--muted-fg`, `--info-fg`, `--muted-fg`).
- [ ] Exact-className test asserts updated for any renamed classes; full suite stays green (`npm run check-types`, `npm run lint`, `npm test`).
- [ ] Specs refreshed to match reality (no stale `.scripts-toolbar::before`, no stale `styles/sidebar.css` rows).
- [ ] `.compact-tabs` remains in `base.css`, still shared by searchBar endian + struct bit-order + sidebar endian.

## Confirmed decisions (from planning grill)

- D1: Structured primitives approach (Q1=B) — shared classes, not value-alignment-only.
- D2: Parent + child tree (Q2=B).
- D3: Scripts alignment is visual-only; non-collapsible header stays (Q3=A).
- D4: One look per role — panels converge, deliberate pixel deltas reviewed per child (Q4=A).

## Out of scope

- Behavior changes (collapse interaction for Scripts header).
- Panels outside the four sidebar panels (toolbar/searchBar/recordView untouched except `.compact-tabs` relocation, which is purely additive).
- Adding visual-regression test infra or any new dependency.
- Theme/palette redesign — tokens stay, we unify onto existing ones.