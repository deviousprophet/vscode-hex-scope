# Design — Sidebar generic tabbed-shell component

## Component contract

```ts
// src/webview/components/Sidebar/Sidebar.ts

interface SidebarPanel {
    id: SidebarTab;                       // 'inspector' | 'struct' | 'integrity' | 'scripts'
    label: string;                        // tab label
    mount: (root: HTMLElement) => void;   // panel mounts/renders its content into slot root
}

interface SidebarCallbacks {
    onTabChange?: (tab: SidebarTab) => void;     // host sets S.sidebarTab + runs activation side effects
    onPanelActivate?: (tab: SidebarTab) => void; // host mounts-or-rerenders the lazy panel
}

export class Sidebar {
    constructor(options: { panels: SidebarPanel[]; headerSlot?: (root: HTMLElement) => void; cb?: SidebarCallbacks });
    setCallbacks(cb: SidebarCallbacks): void;
    mount(): void;                    // idempotent doc-delegated: tab clicks, resizer drag, header slot mount
    setTab(tab: SidebarTab): void;    // active tab classes + #sbp-* visibility; lazy panel activate
    toHtml(): string;                 // full shell markup regenerated from panels config
}
```

## Generic shell (config-driven)

- `toHtml()` renders: `#sidebar` → `#sidebar-common-settings` (headerSlot placeholder), `#sbp-<id>` panel slots from `panels`; `#side-tabs` → `#stab-<id>` buttons from `panels` labels. No hardcoded panel ids/labels/imports.
- Header slot: host supplies a `headerSlot(root)` render (endian LE/BE buttons) mounted once; shell feature-blind.
- Tab buttons click → `setTab(id)` internally then `onTabChange(id)`; host `onPanelActivate` triggers lazy mount (first activation) / rerender (subsequent).

## Interaction

- `mount()` doc-delegated: tab click dispatch (from `panels` ids), resizer mousedown/mousemove/mouseup drag (absorb `sidebarResize.ts`: reads `--sidebar-w` default + saved width, writes `--sidebar-w`, persists localStorage `hexScope.sidebarWidth`, clamps MIN/MAX, `document.body` cursor/userSelect during drag), headerSlot mount once.
- `setTab(tab)`: toggles `.active` on `#stab-*` + visibility on `#sbp-*`; calls `onPanelActivate(tab)` when tab changes; default `inspector` on first `toHtml`.

## Host wiring (hexViewer.ts)

1. `const sidebar = new Sidebar({ panels, headerSlot: root => renderEndianToggle(root), cb })`; `sidebar.mount()`.
2. `panels`: descriptors wrapping existing render fns (refactored `renderX(root = document.getElementById(slot))`):
   - inspector → `renderInspectorSections(root)` (labels/segments/bits; `sidebar.ts` + `inspector/index.ts`)
   - struct → `renderStructPins(root)`; integrity → `renderIntegrity(root)`; scripts → `renderScripts(root)` (activation via host side effects)
3. `onTabChange(tab)` → `S.sidebarTab = tab`; `sidebar.setTab(tab)`; run per-tab side-effect switch (moved from `setupSideTabs`): resetStructViewState/renderLabels/activateIntegrity/activateScripts.
4. `onPanelActivate(tab)` → lazy-mount map: mount the panel content **once per rendered shell** (`if (!root.hasChildNodes())`). Tab switching toggles visibility only — behavior-preserving (pre-refactor `applySidebarState` never re-rendered panel content; re-rendering on every switch would wipe inspector collapse state and script output).
5. Replace inline `#sidebar`/`#side-tabs` markup in render() with `${sidebar.toHtml()}`; remove `setupSideTabs`/`applySidebarState`/`setupSidebarResize`.
6. Record-view sidebar visibility stays host (`updateMemoryOnlyControls` toggles `#sidebar`/`#side-tabs` display — shell unaware of view).

## CSS

- `src/webview/components/Sidebar/Sidebar.css` = shell rules moved verbatim from `styles/sidebar.css`: `#sidebar`, `#sidebar-resizer` (+`.dragging`), `#side-tabs`/`.stab`, `#sidebar-common-settings`, shared `.sb-section/.sb-hdr/.sb-body` pattern.
- `styles/sidebar.css` keeps panel-content rules (`.insp-*`, bits, labels, struct, integrity, scripts) — children claim later.
- `import './Sidebar.css'` in Sidebar.ts; bundled via esbuild.

## Panel seam (future children)

Each child task converts a descriptor's `mount(root)` into a real component (e.g. `new Inspector(root, callbacks)`), replaced at the same seam — no shell change. `SidebarTab` union stays shared (`sidebarTypes.ts`/`webviewProtocol`).

## Tests

- `src/test/webview/components/sidebar.test.ts` (mocha + jsdom + css-import-hook): generic render (tabs from config, slots, header slot), tab switch (active classes + slot visibility + onTabChange/onPanelActivate), lazy first-activation mount once, resizer drag (width clamp + localStorage persist + `--sidebar-w`), no-panel-name coupling (adding config panel renders new tab). Existing `webview.test.ts` sidebar assertions pass unchanged (parity).

## Rollback

- One commit; `git revert` restores inline sidebar markup + `sidebarResize.ts` + `sidebar.ts` orchestration + sidebar.css.
