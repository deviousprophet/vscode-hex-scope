# Reuse UI components in single hex view

Parent task. Adopt the reusable UI components (built for the diff view) as the single-file hex editor's UI, replacing hand-rolled markup and glue. One branch: `feat/reuse-ui-components-single-view`.

## Task Map

| Child | Scope | Owns |
|---|---|---|
| `08-02-reuse-searchbar-single-view` | Search bar swap (control surface only) | SearchBarComponent seed API, single-view host wiring, delete `searchControls.ts`, search-bar CSS consolidation, Ctrl+Z undo re-home, `search-bar-component.test.ts` → `src/test/webview/ui-components/` |
| `08-02-reuse-hexview-single-view` | Memory grid reuse (interaction layer and/or full grid rebuild) | HexViewComponent adoption in single view, `hex-view-component.test.ts` → `src/test/webview/ui-components/`; needs its own brainstorm before design/implement |

## Dependencies / Ordering

- `reuse-searchbar-single-view` first (smaller, well-scoped; establishes the host+component + component-CSS patterns the hex-view child reuses). Write ordering into child artifacts — no tree-position dependency.
- `reuse-hexview-single-view` depends on the component-seed / host-adapter pattern from the search-bar child.

## Cross-Child Requirements

- C1. Component tests live in `src/test/webview/ui-components/` (isolated from view/model tests). Test glob `out/test/**/*.test.js` is recursive — subfolder is safe.
- C2. Each component owns its own CSS (`ui-components/*/<name>Component.css`); shared non-component chrome stays in `base.css`; host-specific rules stay host-side.
- C3. `S` (single-view state) stays the single source for host-derived values; components never write `S` directly (seed + callbacks only).
- C4. Diff view behavior unchanged by both children.

## Acceptance Criteria

- [ ] AC1. Both children done: single view renders its search bar and memory grid from the shared components; hand-rolled markup/glue removed.
- [ ] AC2. Diff view unchanged (`npm test` green; diff suites kept).
- [ ] AC3. Component tests isolated in `src/test/webview/ui-components/`; no duplicate/legacy test files at the old paths.
- [ ] AC4. Full verification green after final integration review: `npm run compile`, `npm run lint`, `npm test`, `npx fallow`.

## Out of Scope

- New components beyond SearchBarComponent / HexViewComponent.
- Any change to `core/search.ts`, `core/search`, or diff-view-only logic.
