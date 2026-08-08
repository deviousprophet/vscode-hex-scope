# Component Spec — Sidebar

> **Naming rule:** every webview component spec lives at `.trellis/spec/frontend/component-<name>.md`. This file documents the generic config-driven tabbed sidebar shell extracted as part of the webview component refactor.

## Scope / Trigger

Owns `src/webview/components/sidebar/sidebar.ts` + `sidebar.css`: the generic tabbed sidebar shell — `#sidebar` + `#side-tabs` + `#sidebar-resizer` + `#sidebar-common-settings` markup, tab switching/visibility, and the resizer drag (with width persistence). Panels are **injected** via a `panels` config; the shell never imports panel modules, never reads/writes the `S` global, never posts provider messages, and holds no feature/panel logic.

Host (`hexViewer.ts`) owns: panel descriptors (wrapping existing render fns), the header slot (endian toggle), per-tab activation side effects, `S.sidebarTab`, and record-view sidebar visibility (`updateMemoryOnlyControls`).

Boundary rule: each component owns its markup, UI state, input behaviours, and styles as one unit. This shell is feature-blind — panels and the header slot are supplied by the host.

## Layout

```text
src/webview/components/sidebar/
    sidebar.ts       types + class Sidebar (generic tabbed shell: panels + headerSlot config)
    sidebar.css      shell rules (moved from styles/layout.css + styles/sidebar.css)
src/webview/hexViewer.ts    host wiring (panel config + tab orchestration + activation side effects)
src/test/webview/components/sidebar.test.ts   (mocha + jsdom)
```

Panel-content CSS stays in `src/webview/styles/sidebar.css` until each panel child task claims it.

## Contract

```typescript
// src/webview/components/sidebar/sidebar.ts
interface SidebarPanel {
    id: SidebarTab;                       // 'inspector' | 'struct' | 'integrity' | 'scripts'
    label: string;                        // tab label
    mount: (root: HTMLElement) => void;   // panel mounts/renders content into its slot root
}

interface SidebarCallbacks {
    onTabChange?: (tab: SidebarTab) => void;      // host sets S.sidebarTab + runs per-tab side effects
    onPanelActivate?: (tab: SidebarTab) => void;  // host mounts-or-rerenders the lazy panel
}

class Sidebar {
    constructor(options: { panels: SidebarPanel[]; headerSlot?: (root: HTMLElement) => void; cb?: SidebarCallbacks });
    setCallbacks(cb: SidebarCallbacks): void;
    mount(): void;                    // idempotent doc-delegated: tab clicks, resizer drag, header slot + width init
    setTab(tab: SidebarTab): void;    // active-tab classes + #sbp-* visibility; lazy-activates on change
    toHtml(): string;                 // full shell markup regenerated from the panels config
}
```

## Rules

- `toHtml()` derives tabs + panel slots from the `panels` config; no hardcoded panel ids/labels. Adding a panel = host config edit, zero shell change.
- `mount()` is idempotent (document-delegated listeners attach once); header slot + `--sidebar-w` init rerun per full render.
- `setTab(tab)`: toggles `.active` on `#stab-*` + `.active`/visibility on `#sbp-*`; calls `onPanelActivate(tab)` only when the tab changes; default tab = first configured panel.
- Tab click reports `onTabChange(tab)`; the host owns `S.sidebarTab` and per-tab activation side effects.
- Panel content mounts lazily **once per rendered shell** (host `onPanelActivate` guards `if (!root.hasChildNodes())`); switching away and back toggles visibility only, so panel collapse state and script output survive. Behavior-preserving (pre-refactor tab switch was side effects + `applySidebarState` class toggles, no content re-render).
- Resizer: reads `--sidebar-w` css default (fallback 360), restores saved `localStorage` width `hexScope.sidebarWidth`, clamps to a viewport-fit max (pre-refactor `sidebarResize.ts` parity), persists on mouseup, sets `document.body` cursor/userSelect during drag.
- Header slot renders feature-specific chrome (endian LE/BE toggle) into `#sidebar-common-settings`; the shell is feature-blind.
- Markup matches pre-refactor (same ids/classes: `#sidebar`, `#sidebar-resizer` + `.dragging`, `#side-tabs`/`.stab`, `#sidebar-common-settings`, `#sbp-<id>` slots, `.sb-tab-panel(.active)`). Sole deviation: slot/tab ids derive from the panel config id, so the inspector becomes `#sbp-inspector`/`#stab-inspector` (pre-refactor: `#sbp-insp`/`#stab-insp`); intentional, config-driven, and consumers of the old ids (none in-repo) are unaffected.
- Untrusted labels escaped with `esc()` from `src/webview/utils.ts`.

## Behaviour

- Default tab is `inspector` (matches pre-refactor); no tab persistence.
- Record-view sidebar visibility stays host-managed (`updateMemoryOnlyControls` toggles `#sidebar`/`#side-tabs` display); the shell is unaware of the view.
- The shared collapsible-section pattern (`.sb-section`/`.sb-hdr`/`.sb-body` + `.sb-section .sb-hdr::before` triangle + `.sb-section.collapsed`) lives in `sidebar.css`; panel sections use it.

## Known-bug (fixed in this task)

Endian toggle previously wiped inspector data: host `setFileEndian` called shell-rebuild `renderInspector()` (reset `#insp-vals` to the empty placeholder) instead of data-path `updateInspector()` (re-decodes the current selection). Fix: `setFileEndian` → `updateInspector()`; multi-byte interpreter re-decodes per new endian. Regression test covers selection survival + uint16 re-decode on toggle.

## Validation & Error Matrix

| Condition | Behaviour |
|---|---|
| Tab click on inactive panel | `.active` moves; `onTabChange` + `onPanelActivate` reported; panel mounts on first activation |
| Tab click on active panel | Re-render of tab state only; `onPanelActivate` not re-reported |
| Re-mount after full render | Doc-delegated listeners not duplicated; header slot + width re-inited |
| Drag beyond max | Width clamps to viewport-fit max |
| Drag below min | Width clamps to 260px |
| No saved width | Uses `--sidebar-w` css default (360) |
| Saved width present | Restored from `localStorage` `hexScope.sidebarWidth` |

## Tests Required

`src/test/webview/components/sidebar.test.ts` (mocha + jsdom + cssImportHook): generic render (tabs/slots/header slot from config, arbitrary panel ids/labels verbatim), tab switch (active classes + slot visibility + `onTabChange`/`onPanelActivate`), lazy first-activation mount once, idempotent mount, `setCallbacks`, resizer (width init/restore/drag/persist/clamp). Existing `webview.test.ts` sidebar/tab/endian/resizer assertions pass unchanged (parity gate).

## Anti-patterns

- `sidebar.ts` importing `S`, panel modules, feature logic, or `postProviderMessage`.
- Hardcoded panel id/label inside the shell.
- Host writing shell DOM directly instead of `toHtml()`/`setTab()`.
- Resizer logic living outside the component (`sidebarResize.ts` was deleted; drag + persistence moved in).
