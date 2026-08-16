# Sidebar section framework (header + collapse in shell)

## Goal

Centralize `.sb-section` header rendering and the collapse toggle in the sidebar component; panels mount body content (and optionally header-action chrome). Backlog follow-up — NOT in scope of `ui-spacing`; no dependencies on initiating now.

## Requirement intent

- Sidebar shell renders the section header (`label`, disclosure/collapse control, optional `actionsSlot`) for each panel section.
- Panel components supply only the body content (+ header actions where needed).
- One shared collapse implementation replaces the per-panel duplicated `applyCollapsibleSection` (`inspectorPanel.ts:119`) and `dataset.collapsed` hand-rolling.

## Outline design (deep-dive result)

Panel config grows a section descriptor:

```typescript
interface SidebarSection {
    id: string;
    label: string;
    collapsible: boolean;          // false allows non-collapsible headers (scripts toolbar)
    actionsSlot?: (root: HTMLElement) => void;  // struct "Add"/toggles, integrity selects/fix-all
    defaultCollapsed?: boolean;
}
type SidebarPanel =
    | { kind: 'single', mountBody: (root: HTMLElement) => void }
    | { kind: 'sections', sections: SidebarSection[], mountBody: (secId: string, root: HTMLElement) => void };
```

## Pros (why this is worth doing later)

1. One collapse implementation + shared a11y (button role, `aria-expanded`) — kills `applyCollapsibleSection` duplication.
2. Header markup leaves the four panel render files; panels' TS shrinks to body-only.
3. Structural spacing consistency forever — header 8px margin, section padding become one `.sb-section` definition (the root cause of the ui-spacing task gets a permanent cure).
4. `SidebarPanel` config becomes the single place section identity lives.

## Cons / frictions (bounded, documented)

1. **Headers are not uniform.** Struct `.sb-hdr-row` and integrity `.integrity-hdr-row` carry action chrome (Add, bit-order toggles, profile select, fix-all). Requires `actionsSlot` second injection seam; those two headers don't flatten to a bare label.
2. **Different collapse hierarchies.** Inspector collapses section bodies; scripts collapses *inner result blocks* inside cards (`.script-output-block` at `scriptsPanel.ts:442`). The result-block collapse must stay panel-owned — the framework covers panel sections only. Scripts' own header is deliberately **non-collapsible** (D3, list-scroll model) — needs `collapsible:false`.
3. **Shell contract scope-expansion.** `component-sidebar.md` currently promises a feature-blind shell. Section framework adds section awareness — documented spec change, new primitive tests.
4. **Half-adoption trap.** Struct/integrity do not collapse today. Either force collapse (behavior change) or let them use `collapsible:false` — otherwise two header systems coexist.
5. **Test churn.** Panel render tests assert `.sb-hdr` markup; moving markup into the shell changes `mount` contracts (body-only mount) → sizeable test rewrite.

## Boundaries / rules for future implementation

- Scripts result-block collapse (`.script-output-*`) stays in `scriptsPanel` — not part of the framework.
- `.sb-section` CSS pattern stays in `sidebar.css` (already shared-owned).
- `SidebarCallbacks`/host wiring unchanged (still feature-blind about content); only the panel descriptor shape grows.
- Acceptance: visual parity across all four panels after migration; inspector's 4 sections, struct/integrity with actionsSlot, scripts with `collapsible:false` + body.

## Status

- Created as backlog task `08-16-ui-section-framework`. Not started, no git work. Design above is the planning seed; produce `design.md`/`implement.md` (this task is complex) before `task.py start` in a later session.