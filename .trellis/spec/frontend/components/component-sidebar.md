# Component Spec — Sidebar

> **Naming rule:** every webview component spec lives at `.trellis/spec/frontend/component-<name>.md`. This file documents the generic config-driven tabbed sidebar shell extracted as part of the webview component refactor.

## Scope / Trigger

Owns `src/webview/components/sidebar/sidebar.ts` + `sidebar.css`: the generic tabbed sidebar shell — `#sidebar` + `#side-tabs` + `#sidebar-resizer` + `#sidebar-common-settings` markup, tab switching/visibility, and the resizer drag (with width persistence). Panels are **injected** via a `panels` config; the shell never imports panel modules, never reads/writes the `S` global, never posts provider messages, and holds no feature/panel logic.

`sidebar.ts` also exports the **section-shell framework** (`SidebarSectionSpec` + `SidebarSections`): one shared section header + collapse implementation modeled on VS Code's pane header (`viewPane.ts`/`paneview.ts`). The whole `.sb-section-head` row is the collapse control (`role=button`, `tabindex`, `aria-expanded`) with a decorative chevron; panels write/rewrite only body content. This replaced per-panel `applyCollapsibleSection` / `dataset.collapsed` hand-rolling (staged migration, all four panels adopted).

Host (`hexViewer.ts`) owns: panel descriptors (wrapping existing render fns), the header slot (endian toggle), per-tab activation side effects, `S.sidebarTab`, and record-view sidebar visibility (`updateMemoryOnlyControls`).

Boundary rule: each component owns its markup, UI state, input behaviours, and styles as one unit. This shell is feature-blind about content — panels and the header slot are supplied by the host; section identity lives in each panel's `SidebarSections` spec.

## Layout

```text
src/webview/components/sidebar/
    sidebar.ts       types + class Sidebar (generic tabbed shell: panels + headerSlot config)
                     + SidebarSectionSpec + class SidebarSections (section-shell framework)
    sidebar.css      shell rules (moved from styles/layout.css + styles/sidebar.css) + shared `.sb-*` UI primitives (`.sb-btn*`, `.sb-input`/`.sb-select`, `.sb-card*`, `.sb-status-dot`) + framework `.sb-section-head/-title/-chevron/-label/-actions/-action`
src/webview/hexViewer.ts    host wiring (panel config + tab orchestration + activation side effects)
src/test/webview/components/sidebar.test.ts   (mocha + jsdom)
```

`src/webview/styles/sidebar.css` was deleted during the primitives task — its last rule, the shared `.compact-tabs` toggle pattern, moved to `base.css` (used beyond the sidebar: searchBar endian, struct bit-order, sidebar endian). Panel panels claim content CSS into their own colocated files (`inspectorPanel.css`, `structPanel.css`, `integrityPanel.css`, `scriptsPanel.css`).

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

// Section-shell framework (one shared header/collapse/pane-resize implementation).
interface SidebarSectionSpec {
    id: string;                       // unique within the section list (constructor throws on duplicates)
    label: string;                    // text-only heading; escaped into the rendered DOM
    defaultCollapsed?: boolean;       // collapsed on first render; default false. Every section is collapsible
    mountActions?: (root: HTMLElement) => void;  // compact header-action chrome, mounted once
}

class SidebarSections {
    constructor(root: HTMLElement, idPrefix: string, sections: readonly SidebarSectionSpec[], panelId?: string);
    body(id: string): HTMLElement | null;        // section body root — panels write/rewrite only this
    setLabel(id: string, label: string): void;
    setBadge(id: string, text: string | null): void;  // legacy — section headers carry no count badge (no callers)
    setCollapsed(id: string, collapsed: boolean): void;
    isCollapsed(id: string): boolean;
}
```

## Section-shell contract

The section shell is a **PaneView/SplitView port** (VS Code `paneview.ts`/`splitview.ts`, Extensions-view style): each section is a resizable pane with a fixed 22px whole-header toggle, an independently scrolling body, and a drag sash between consecutive sections (sashes are static — never disabled, never relabeled). Collapsed panes shrink in place to the 22px header (in-place collapse, VS Code-true — no DOM moves); expanded panes fill the free space, so collapsed headers sit below expanded content naturally when expanded panes precede them. Re-expanding restores the pane's saved height. Sizes persist per panel/section in `localStorage` under `hexScope.sidebarPanes.<panelId>.<sectionId>` (clamped on restore, malformed values dropped).

- Rendered DOM: `<div class="sb-pane-view">` (flex:1 column) containing per-section `<section class="sb-section sb-pane" id="<prefix>-<id>" [.collapsed]>` with `style="flex-basis:<px>px"`, separated by `<div class="sb-pane-sash" role="separator" aria-orientation="vertical" tabindex="0" aria-label="Resize <above> section">` (only when there are ≥2 sections; single-section panels degrade to one pane filling the panel, no sash).
- Each `.sb-pane` → `.sb-section-head` (`role="button"`, `tabindex="0"`, `aria-expanded`, `aria-controls="<prefix>-<id>-body"`, `aria-label` = section label) whose **first child** is a decorative `.sb-section-chevron` span (`aria-hidden="true"`, chevron `›` (U+203A) — rotated 90° down when open, points right when collapsed — reads "› Section Name"), followed by `.sb-section-title` `h3` (`.sb-section-label`) and optional `.sb-section-actions` → `.sb-body` (id `<prefix>-<id>-body`, `role="region"`, `aria-labelledby="<prefix>-<id>-title"`, `overflow-y:auto` — each expanded pane scrolls itself; the panel root never scrolls). Header is a fixed 22px row (VS Code `--pane-header-size`), 11px bold uppercase nowrap-ellipsis title with a 12px left inset. Every section is collapsible — there is no non-collapsible variant.
- Collapse state is per mounted instance (map), survives body re-renders, resets when the panel shell is rebuilt. Collapse keeps the pane in DOM order and animates `flex-basis` to 22px (150ms ease-out, VS Code duration; `prefers-reduced-motion` → 0s); the body stays in the DOM (clipped by the 22px pane). Expand restores the saved px; a **first-time** expand (no persisted size) defaults to an **even split** across all expanded panes (siblings' saved sizes are not kept); siblings shrink proportionally. User adjustments (drag/arrows/dblclick) persist. Sash drags disable the flex-basis transition (`.sb-pane-view.dragging`) so panes track the cursor exactly. No grid rows, no reparent, no timers, no disabled-sash state.
- The whole header row is the toggle (VS Code model): click anywhere on `.sb-section-head` except `.sb-section-actions` toggles; Enter/Space toggle; ArrowLeft collapses; ArrowRight expands. The chevron is decorative, never a separate button. ArrowUp/ArrowDown on a focused header moves focus to the adjacent section header (stop at ends).
- Sash UX: drag resizes the pane above (clamped so every pane keeps min = header 22px + 60px); ArrowUp/ArrowDown resize by ±10px; double-click resets the two adjacent panes' combined space 50/50. Sashes adjacent to a collapsed pane get `.disabled` (inert; out of the tab order, `aria-disabled`). Sash drags persist the adjacent sizes continuously during the drag; arrow-resize and dblclick persist immediately.
- Header-action controls are inside the head; the actions container `stopPropagation`s click/keydown so actions never toggle the header. They are primary/status controls usable while collapsed; body controls are secondary/configuration. Current placement: Inspector none; Struct Instances ＋ Add; Struct Types ＋ Add; Integrity none; Scripts Refresh. All sections are collapsible; Scripts result-block collapse stays panel-owned.
- Every framework section exposes an `h3` heading; the decorative chevron precedes it as a header-row sibling.
- `.sb-section-actions` must not wrap and header-action controls use the compact `.sb-section-action` contract (`font-size: 10px; padding: 2px 8px; line-height: 1.2; max-height: 22px`) so action chrome cannot enlarge the header. Controls that need more room (wide selects, multi-row layout, secondary/configuration) belong in the section body.
- Persistence: `hexScope.sidebarPanes.<panelId>.<sectionId>` stores the pane's last expanded px (collapse keeps it so re-expand restores). Restore parses, clamps to the valid minimum, and drops NaN/≤0 entries (removing the key); oversized values clamp to the available pool on the first layout. First-time default shares (50/50 among expanded) are not persisted until the user drags or resizes.

## Rules

- `toHtml()` derives tabs + panel slots from the `panels` config; no hardcoded panel ids/labels. Adding a panel = host config edit, zero shell change.
- `mount()` is idempotent (document-delegated listeners attach once); header slot + `--sidebar-w` init rerun per full render.
- `setTab(tab)`: toggles `.active` on `#stab-*` + `.active`/visibility on `#sbp-*`; calls `onPanelActivate(tab)` only when the tab changes; default tab = first configured panel.
- Tab click reports `onTabChange(tab)`; the host owns `S.sidebarTab` and per-tab activation side effects.
- Panel content mounts lazily **once per rendered shell** (host `onPanelActivate` guards `if (!root.hasChildNodes())`); switching away and back toggles visibility only, so panel collapse state and script output survive. Behavior-preserving (pre-refactor tab switch was side effects + `applySidebarState` class toggles, no content re-render).
- Resizer: reads `--sidebar-w` css default (fallback 360), restores saved `localStorage` width `hexScope.sidebarWidth`, clamps to a viewport-fit max (pre-refactor `sidebarResize.ts` parity), persists on mouseup, sets `document.body` cursor/userSelect during drag.
- Header slot renders feature-specific chrome (endian LE/BE toggle) into `#sidebar-common-settings`; the shell is feature-blind.
- `SidebarSections` uses document-local roots only (no global selectors), validates unique section ids, and escapes labels into text nodes.
- Markup matches pre-refactor (same ids/classes: `#sidebar`, `#sidebar-resizer` + `.dragging`, `#side-tabs`/`.stab`, `#sidebar-common-settings`, `#sbp-<id>` slots, `.sb-tab-panel(.active)`). Sole deviation: slot/tab ids derive from the panel config id, so the inspector becomes `#sbp-inspector`/`#stab-inspector` (pre-refactor: `#sbp-insp`/`#stab-insp`); intentional, config-driven, and consumers of the old ids (none in-repo) are unaffected.
- Untrusted labels escaped with `esc()` from `src/webview/utils.ts`.

## Behaviour

- Default tab is `inspector` (matches pre-refactor); no tab persistence.
- Record-view sidebar visibility stays host-managed (`updateMemoryOnlyControls` toggles `#sidebar`/`#side-tabs` display); the shell is unaware of the view.
- The shared PaneView pattern (`.sb-pane-view`/`.sb-pane`/`.sb-pane-sash`/`.sb-section-head`/`.sb-section-title`/`.sb-section-chevron`/`.sb-section-label`/`.sb-section-actions`/`.sb-body` + flex-basis transition) lives in `sidebar.css`; panel sections use it via `SidebarSections`. `.sb-hdr` was removed (10px type floor); body-level form titles (label form) are plain `.lbl-form` titles. There is no bottom dock and no `.sb-dock`/`.sb-panel-scroll`.

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

`src/test/webview/components/sidebar.test.ts` (mocha + jsdom + cssImportHook): generic render (tabs/slots/header slot from config, arbitrary panel ids/labels verbatim), tab switch (active classes + slot visibility + `onTabChange`/`onPanelActivate`), lazy first-activation mount once, idempotent mount, `setCallbacks`, resizer (width init/restore/drag/persist/clamp), and the **section-shell split model** (whole-head role/tabindex/aria-expanded/aria-label + decorative chevron on every section, click/Enter/Space/ArrowLeft/ArrowRight toggle, actions stopPropagation, ArrowUp/Down header nav stop-at-ends, split DOM with `.sb-pane-view`/sash role+aria, single-pane no-sash, equal-share first mount, in-place collapse keeping DOM order + sibling growth, expand-restore saved size, sash drag/arrows/±10px/dblclick-50/50 with clamp + persist, localStorage round-trip + invalid-drop). Existing `webview.test.ts` sidebar/tab/endian/resizer assertions pass unchanged (parity gate).

## Anti-patterns

- `sidebar.ts` importing `S`, panel modules, feature logic, or `postProviderMessage`.
- Hardcoded panel id/label inside the shell.
- Host writing shell DOM directly instead of `toHtml()`/`setTab()`.
- Resizer logic living outside the component (`sidebarResize.ts` was deleted; drag + persistence moved in).
