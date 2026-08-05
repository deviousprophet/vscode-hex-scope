# PRD — Extract Sidebar shell into generic config-driven component

## Origin
Child of `08-03-webview-component-refactor` ("Refactor webview UI into self-contained components"). ACs: per-component `.ts`+`.css`, colocated styles, shared styles only global, no functional/visual change. This is the **parent** sidebar task; panel children (Inspector/Struct/Integrity/Scripts) are separate child tasks.

## Problem
Sidebar shell + tabs + resizer live scattered: `#sidebar`/`#side-tabs` markup in `hexViewer.ts` render(); tab/endian/resizer listeners in `hexViewer.ts`; resizer logic in `sidebarResize.ts`; CSS in shared `styles/sidebar.css`. Panels render into global-id slots (`#s-insp` etc.) with host-driven activation side effects. No encapsulation.

## Goal
Generic config-driven `Sidebar` component owning the tabbed sidebar shell: `#sidebar` + `#side-tabs` + `#sidebar-resizer` + `#sidebar-common-settings` (header slot), resizer interaction, tab switching/visibility, colocated CSS. Panels are **injected** via a `panels` config — the shell never imports panel modules. Established seam: panels register as `{ id, label, mount(root) }`; this task's host wires the descriptors to existing render fns (which are refactored to render into a `root` param). Children later deepen each panel into a real component at the same seam.

Structure:
```text
src/webview/components/Sidebar/
    Sidebar.ts    types + class Sidebar (generic tabbed shell: panels + headerSlot config)
    Sidebar.css   shell rules (moved from styles/sidebar.css)
src/webview/hexViewer.ts    host wiring (panel config + tab orchestration + activation side effects)
src/webview/sidebar/sidebar.ts   orchestration moved host-side; content render stays (Inspector child)
src/webview/sidebar/sidebarResize.ts   absorbed into Sidebar
```

## Design decisions (locked in planning grills)
- **Generic config-driven (not slot-injection):** `Sidebar` accepts `panels: SidebarPanel[]` + optional `headerSlot`. Parent has NO hardcoded panel names/imports; adding a panel = host config edit, zero shell change.
- **Parent scope (A):** shell only + panel-descriptor seam. Children own panel components later.
- **Resizer (A):** absorbed into Sidebar; persists width (existing localStorage `hexScope.sidebarWidth` via `--sidebar-w`); behavior unchanged.
- **Tab state:** `setTab(tab)` (active classes + `#sbp-*` visibility); reports `onTabChange(tab)`; `onPanelActivate(tab)` (host mounts-or-rerenders lazy panel). Host owns `S.sidebarTab`.
- **Tab activation side effects host-owned (A):** parent only reports; host runs `resetStructViewState`/`renderLabels`/`activateIntegrity`/`activateScripts` per tab (moves existing `setupSideTabs` switch to host).
- **Panel mount timing (A lazy):** panel mounts on first activation; stays mounted thereafter (avoid building 192KB Struct at boot).
- **Endian header slot (A):** common-settings endian LE/BE is feature-specific → injected via `headerSlot` (host supplies endian component/render); shell feature-blind.
- **Resizer persistence no new feature (A-lite):** default tab `inspector` (matches current), no tab persistence. Sidebar visibility in record view stays host (`updateMemoryOnlyControls`) — shell unaware of view.
- **Panel seam wrapping existing renders:** this task's host builds descriptors whose `mount(root)` calls existing `renderInspectorSections`/`renderStructPins`/`renderIntegrity`/`renderScripts`, refactored to render into a `root` param (defaults `document.getElementById('<slot>')`); children deepen each mount into a real component later.
- **CSS (A):** `Sidebar.css` = shell chrome (`#sidebar`, `#sidebar-resizer` + `.dragging`, `#side-tabs`/`.stab`, `#sidebar-common-settings`, shared `.sb-section/.sb-hdr/.sb-body` pattern used by all panels). `sidebar.css` keeps panel-content rules (`.insp-*`, bits, labels, struct, integrity, scripts) until each child claims them.

## Scope
In:
- `src/webview/components/Sidebar/Sidebar.ts` + `Sidebar.css`.
- `hexViewer.ts` — build panel descriptors + headerSlot; wire `onTabChange`/`onPanelActivate`; move tab side-effect switch host-side; replace inline `#sidebar`/`#side-tabs` markup.
- `sidebarResize.ts` — absorbed into Sidebar (deleted).
- `sidebar.ts` — shell orchestration parts move host-side; content render fns refactored to accept `root` param.
- `styles/sidebar.css` — shell rules moved to `Sidebar.css`.

Out:
- Panel components (Inspector/Struct/Integrity/Scripts) — separate child tasks deepen the established seam.
- Panel-content CSS in `sidebar.css` — stays until children claim.
- Tab persistence, labels rework — not this task.

## Known issue (taken over from parent refactor task)
- Endian toggle wipes inspector data: `hexViewer.ts setFileEndian` called shell-rebuild `renderInspector()` (reset `#insp-vals` to the empty placeholder) instead of data-path `updateInspector()` (re-decodes current selection). Fixed in this task: `setFileEndian` now calls `updateInspector()`; multi-byte interpretation re-decodes per new endian. Regression test added in `webview.test.ts` (endian toggle preserves inspector selection + re-decodes uint16).

## Acceptance Criteria
- [ ] `components/Sidebar/Sidebar.ts` + `Sidebar.css` exist; generic config-driven shell (panels + headerSlot), owns markup, tab switching/visibility, resizer+persistence, styles. Zero `S` reads; no panel module imports; no feature logic.
- [ ] Renders byte-identical shell (`#sidebar`, `#side-tabs`/`#stab-*`, panel `#sbp-*` slots, `#sidebar-common-settings`) as pre-refactor.
- [ ] Panel descriptors wire existing render fns into `root` param; lazy mount on first activation; active tab runs host side effects (`activateIntegrity` etc.).
- [ ] Resizer persists width via `--sidebar-w`/localStorage identically; default tab inspector; record-view visibility host-managed.
- [ ] `styles/sidebar.css` shell rules moved verbatim to `Sidebar.css`; `sidebarResize.ts` deleted.
- [ ] `npm run lint`, `npm run check-types`, `npm run test` pass. Fallow green.
- [ ] No functional/visual change to sidebar, tabs, resizer, endian, or panel switching in the running extension.