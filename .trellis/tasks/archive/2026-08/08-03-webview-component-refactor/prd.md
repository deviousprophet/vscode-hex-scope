# PRD — Refactor webview UI into self-contained components (issue #151)

## Origin
Issue #151 — "Refactor webview UI into self-contained components". Move webview UI to a component-based structure where each component owns its logic and styles.

## Target structure

```text
src/
└── webview/
    └── components/
        ├── ComponentA/
        │   ├── ComponentA.ts
        │   └── ComponentA.css
        ├── ComponentB/
        │   ├── ComponentB.ts
        │   └── ComponentB.css
        └── ...
```

## Issue Acceptance Criteria
- [x] Each component has its own `.ts` `.css` files.
- [x] Component styles are colocated with the component.
- [x] Shared styles kept only global concerns (e.g. theme variables, resets).
- [x] No functional or visual change to the UI.

## Component map (roadmap)

| Component | Status | Task |
|---|---|---|
| SearchBar | done (merged #152) | archived `08-03-webview-searchbar-component` |
| HexView grid | done (merged #153) | archived `08-03-webview-hexview-component` |
| Toolbar | done (merged #154) | archived `08-04-webview-toolbar-component` |
| External-change banners | done (merged #155) | archived `08-04-webview-external-change-component` |
| RecordView | done (merged #156) | archived `08-04-webview-recordview-component` |
| ContextMenu | done (merged #157) | archived `08-04-webview-context-menu-component` |
| Sidebar (shell) | done (merged #160) | archived `08-04-webview-sidebar-component` |
| ├─ Inspector panel | done (PR #163) | `08-04-webview-inspector-panel-component` |
| ├─ Struct panel | planning | `08-04-webview-struct-panel-component` |
| ├─ Integrity panel | planning | `08-04-webview-integrity-panel-component` |
| └─ Scripts panel | planning | `08-04-webview-scripts-panel-component` |

Execution order (adopted from architecture review): Toolbar + ContextMenu first (small, clean seams), then RecordView (mirrors the established HexView deep-module pattern), then Sidebar as a parent task decomposed into per-panel children. SearchBar/HexView/Toolbar/ExternalChange/RecordView/ContextMenu/Sidebar done; the four sidebar panels remain as separate child tasks. The established pattern is documented in `.trellis/spec/frontend/components/component-template.md` + per-component code-specs.

## Known issues to fix during component splits
- ~~Inspector panel: endian toggle wipes inspector data~~ — FIXED in `08-04-webview-sidebar-component` (#160): `setFileEndian` now calls data-path `updateInspector()`; regression test added. The Inspector child task re-verifies via its own component tests.

## Parent responsibilities
- Owns the issue #151 requirement set and cross-component acceptance criteria (above).
- Owns the component roadmap; new components enter as child tasks.
- Final integration review across all child components before the issue can be closed.

## Child task ordering / dependencies
- None currently. Each component extraction is independent and behavior-preserving; a component may be planned/implemented/checked/archived independently.
- Shared conventions are documented in `.trellis/spec/frontend/` (`component-guidelines.md`, `css-guidelines.md`, `directory-structure.md`) and the per-component code-spec.
