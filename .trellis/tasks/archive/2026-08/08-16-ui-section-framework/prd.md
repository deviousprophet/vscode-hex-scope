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

## Header action placement (decision)

Use the hybrid rule rather than forcing every action into one location:

- **Header `actionsSlot`:** primary/status controls that must remain usable when the section is collapsed (for example Struct Add, Integrity profile selector/count).
- **Body content:** secondary/configuration controls and actions meaningful only alongside visible content (for example Struct bit-order controls, Integrity Fix All).
- **Scripts:** panel toolbar remains non-collapsible; result-block collapse remains panel-owned.

The framework exposes only the optional sibling `actionsSlot`; body controls stay ordinary panel body markup. The collapse disclosure itself is never the whole header row, so action controls need no propagation workarounds.

### Header action size contract

Header actions must not make a section header taller than its standard target. They use compact controls only: `font-size: 10px`, `padding: 2px 8px`, `line-height: 1.2`, `max-height: 22px`; no multi-row/wrapping action layout. The disclosure label keeps flexible width and the actions slot is non-shrinking. Secondary/configuration controls move into the section body.

### Existing control placement (decision)

- Inspector: no header actions.
- Struct Instances: Add is the only header action; bit-order controls and type-management controls stay/move into the body.
- Struct Types: ← Back/Cancel is the sole compact navigation header action; New type moves into the body.
- Integrity: title/count only; profile selector, Fix All, and Add stay in the body.
- Scripts: refresh is the sole compact header action; result controls remain body-owned.

This is an all-panel rollout with minimal header chrome; controls that would make headers uneven are body content.

### Non-collapsible header layout (decision)

All framework non-collapsible headers use the shared header→body `8px` gap with **no border separator**. Scripts removes its current toolbar bottom border and adopts this language. Inspector's existing collapsible sections retain their section borders; no `separator` option is added.

### Semantic headings (decision)

Every framework section exposes an `h3` heading. Collapsible sections nest their native disclosure button inside the heading; non-collapsible sections render the plain title inside it. This adds heading navigation for Inspector/Struct/Integrity/Scripts without visual layout changes.

## Status

- All-panel rollout selected; future-generic descriptor shape selected.
- Inspector sections stay collapsible. Struct, Integrity, and Scripts adopt framework headers with `collapsible:false` initially — no new hide/show behavior.
- Planning continues: revise `design.md` and `implement.md`, present final review, then require fresh approval before `task.py start`.