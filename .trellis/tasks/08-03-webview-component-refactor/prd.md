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
| SearchBar | done (committed) | `08-03-webview-searchbar-component` |
| HexView grid | pending | future child task |
| RecordView | pending | future |
| Toolbar / stats | pending | future |
| Sidebar (inspector/integrity/scripts/struct) | pending | future |
| ContextMenu | pending | future |

Only the SearchBar component is scoped in this parent task's children so far. Remaining components are separate child tasks; the SearchBar child's `design.md`/`implement.md` document the pattern (component owns markup/UI-state/behaviours/styles, CSS imported in `.ts`, engine logic stays host-side).

## Parent responsibilities
- Owns the issue #151 requirement set and cross-component acceptance criteria (above).
- Owns the component roadmap; new components enter as child tasks.
- Final integration review across all child components before the issue can be closed.

## Child task ordering / dependencies
- None currently. Each component extraction is independent and behavior-preserving; a component may be planned/implemented/checked/archived independently.
- Shared conventions are documented in `.trellis/spec/frontend/` (`component-guidelines.md`, `css-guidelines.md`, `directory-structure.md`) and the per-component code-spec.
