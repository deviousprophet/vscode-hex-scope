# Sidebar section framework — Technical Design

## Scope

Build a sidebar-owned section framework and migrate **all four panels**. Inspector sections remain collapsible; Struct, Integrity, and Scripts use framework headers with `collapsible:false`, preserving their current always-visible content. The framework is generic now (actions slot + non-collapsible mode).

## Ownership

| layer | owns |
|---|---|
| `components/sidebar/sidebar.ts` | section shell DOM, disclosure button, `aria-expanded`/`aria-controls`, collapse state, `setCollapsed`, title/badge updates, actions-slot root |
| `components/sidebar/sidebar.css` | section shell/header/disclosure/action/body visual language; existing legacy `.sb-section/.sb-hdr/.sb-body` remains during staged migration |
| panel (`InspectorPanel`) | section definitions, body rendering, dynamic content, which section to expand after a panel-specific action |
| future panels | their body content plus action-slot content only when it must remain usable while collapsed |

Scripts result blocks remain panel-owned because they are nested, per-run collapse controls rather than sidebar sections.

## Public API

Export the following from `sidebar.ts`:

```typescript
export interface SidebarSectionSpec {
    id: string;
    label: string;
    defaultCollapsed?: boolean;
    collapsible?: boolean;
    mountActions?: (root: HTMLElement) => void;
}

export class SidebarSections {
    constructor(root: HTMLElement, idPrefix: string, sections: readonly SidebarSectionSpec[]);
    body(id: string): HTMLElement | null;
    setLabel(id: string, label: string): void;
    setBadge(id: string, text: string | null): void;
    setCollapsed(id: string, collapsed: boolean): void;
    isCollapsed(id: string): boolean;
}
```

`SidebarSections` renders the section shells once per panel mount. Panels write/rewrite only `body(id)` contents. It preserves collapse state for body re-renders and resets it on a full panel remount — exactly the current Inspector lifecycle.

`setBadge` gives Inspector dynamic Bit View/Segments/Labels counts without panel code recreating header markup. Labels stay text-only; no arbitrary title HTML slot is added until a consumer proves one is needed.

## Rendered DOM

Collapsible section:

```html
<section class="sb-section" id="<prefix>-<id>">
  <div class="sb-section-head">
    <h3 class="sb-section-title">
      <button class="sb-section-toggle" type="button"
        aria-expanded="true" aria-controls="<prefix>-<id>-body">
        <span class="sb-section-label">Label</span>
        <span class="sb-badge" hidden></span>
      </button>
    </h3>
    <div class="sb-section-actions"></div>
  </div>
  <div class="sb-body" id="<prefix>-<id>-body" role="region"></div>
</section>
```

Non-collapsible section:

- Uses `.sb-section-head` and plain `.sb-section-title`/`.sb-section-label`, not a disclosure button.
- No `aria-expanded`; body remains visible.
- `mountActions` remains a sibling action root in both variants.
- Uses the same `8px` header→body gap as the collapsible header rhythm, with no border separator. Scripts drops its toolbar border; no separator variant is introduced.

The disclosure button alone toggles collapse. Action-slot controls are siblings, so no `stopPropagation` is needed. Keyboard behavior comes from native `<button>` semantics (Enter/Space).

### Header action sizing

`.sb-section-head` owns the standard header height. `.sb-section-actions` is `flex-shrink:0` and does not wrap. Header action controls use a compact framework class (10px type, `2px 8px` padding, `line-height:1.2`, `max-height:22px`) so action chrome cannot enlarge a header. If a panel needs multiple rows, wide selects, or a taller action, it belongs in the body under the hybrid placement rule.

## Action placement rule

- **Header actions:** primary/status controls usable while collapsed. Example future consumers: Struct Add; Integrity profile selector/count.
- **Body controls:** secondary/configuration controls or actions meaningful only with visible content. Example future consumers: Struct bit-order controls; Integrity Fix All.
- **Scripts:** static non-collapsible toolbar; inner result collapse remains local.

The generic `mountActions` seam is intentionally present now (decision B). Existing controls map as follows:

| panel | header action | body controls |
|---|---|---|
| Inspector | none | all existing content |
| Struct Instances | Add | bit-order toggles, Types/manage control |
| Struct Types | ← Back/Cancel | New type |
| Integrity | none (title/count only) | profile selector, Fix All, Add |
| Scripts | Refresh | list/result controls |

No panel is forced to collapse in this task outside Inspector's existing sections. This keeps every framework header one-line and the same visual height.

## Panel migrations (all-panel rollout)

### Inspector — collapsible sections

1. `InspectorPanel.mount()` creates `SidebarSections` with inspector, bits, segments, labels specs.
2. Existing `renderInspectorShell`, `renderBits`, `renderBitsMulti`, `renderSegments`, `renderLabels` write into each section body instead of recreating `.sb-hdr/.sb-body` markup.
3. Replace `applyCollapsibleSection` with framework state methods; remove duplicated click listeners and `dataset.collapsed` handling.
4. `updateLabelFormSel` expands Labels through a narrow Inspector bridge.
5. Preserve all existing body IDs and copy/form interactions.

### Struct — non-collapsible framework sections inside current slide track

- Instances: framework title/badge + compact Add action. Keep bit-order and Types/manage controls as first body controls.
- Types: framework title + compact ← Back/Cancel navigation action. Move New type into the body.
- Preserve `.si-panel-track`, type/editor state, all IDs, field grids, and action wiring. No collapse state is added.

### Integrity — non-collapsible framework section

- Framework title/count only. Move Fix all and Add, plus the existing profile selector/library, into the body.
- Preserve all check/profile form IDs, calculation/highlight/auto-fix behavior, card controls, and action-error placement. No collapse state is added.

### Scripts — non-collapsible framework section

- Framework title/count + compact Refresh action. Preserve list/result body hierarchy and result-block local collapse.
- Drop the toolbar border; the framework body supplies the shared 8px header→body gap. Preserve script list/run/cancel IDs and state machine.

## CSS migration

- Add `.sb-section-head`, `.sb-section-title`, `.sb-section-toggle`, `.sb-section-label`, `.sb-section-actions`, and compact `.sb-section-action` to `sidebar.css`.
- Move disclosure triangle styling from `.sb-section .sb-hdr::before` to `.sb-section-toggle::before`; remove legacy `.sb-hdr` usage after all four top-level headers migrate.
- `.collapsed .sb-body { display:none }` remains shared and only Inspector uses it initially.
- Panel-specific body visuals stay in their colocated CSS files.

## Compatibility / rollback

- Inspector's visible default states stay: Inspector/Segments expanded; Bit View/Labels collapsed.
- No localStorage persistence. State remains per mounted panel instance.
- Struct/Integrity/Scripts retain their current always-visible top-level body behavior through `collapsible:false`; Scripts result-block collapse remains local.
- One commit can be reverted to restore panel-local legacy header markup and Inspector's local collapse behavior.

## Risks

| risk | mitigation |
|---|---|
| Dynamic Inspector/Struct/Integrity/Scripts badges need header updates | `setBadge(id, text)` is framework-owned; panels no longer write header HTML. |
| Label form needs to open collapsed Labels | expose a narrow Inspector `expandLabels()` bridge to `SidebarSections.setCollapsed`. |
| Framework overgeneralizes before consumers | action/non-collapsible shape is defined by concrete Struct/Integrity/Scripts requirements; no arbitrary title HTML/config options. |
| All-panel layout regression | preserve each panel's body track/list/form hierarchy; migrate only top-level header shells; test each panel plus manual dark/light inspection. |