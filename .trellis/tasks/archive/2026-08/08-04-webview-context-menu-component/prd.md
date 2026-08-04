# PRD — Rework ContextMenu into self-contained component

## Origin
Child of `08-03-webview-component-refactor` ("Refactor webview UI into self-contained components"). ACs: per-component `.ts`+`.css`, colocated styles, shared styles only global. This task **reworks** the context menu UX (not pure extraction) per planning grills.

## Problem
Context menu is split across `contextMenu.ts` (render) + `contextMenuController.ts` (show/hide/position/wiring), CSS in `styles/context-menu.css`. Menu only offers Copy/Analyze/Patch submenus — no jump/selection/annotation; copy-only heavy; no component encapsulation.

## Goal
Self-contained `ContextMenu` component owning menu markup, positioning, dismiss, submenu + inline-input transient behavior, and colocated CSS. Host owns command execution (`handleCtxCommand`) + new action logic (go-address, select, label). Reworked UX: fewer clicks for frequent actions, added non-Copy actions.

Structure:
```text
src/webview/components/ContextMenu/
    ContextMenu.ts    pure render fns + class ContextMenu (show/hide, mount)
    ContextMenu.css   context-menu rules (moved verbatim from styles/)
```

## Design decisions (locked in planning grills)
- **Scope/purpose (Q1-B):** right-click menu shows frequent actions direct + "Copy as…" submenu; new non-Copy action categories added.
- **Layout (Q2-A, Q7-A):** top-level direct = **Copy Hex, Copy ASCII** (+ multi: C Array), **Go address** (4B), **Select all**, **Select segment**; submenus = **Copy as…** (remaining formats), **Analyze**, **Annotate** (Create label), **Patch/Fill** (edit mode only).
- **Single-byte (Q3):** same layout as multi; Copy Hex/ASCII direct, Copy as… (Decimal/Binary), Analyze, Patch.
- **Single-byte Analyze (Q4-B):** NOT added — analyzing 1 byte low signal; single-byte menu stays Copy + Patch.
- **Go address (Q5):** single item, follows **system endian** (`S.endian`), **only when selection is exactly 4 bytes**, shows preview `0x…` of target, jump only enabled when target address is mapped (valid).
- **Create label (Q6):** inline input in menu (type name, Enter applies; Escape closes menu); feeds sidebar labels.
- **Interaction (Q8):** component reports commands via `onCommand(cmd)`/`onCreateLabel(name)`; component owns menu markup + transient inline-input state; host owns label/select/go execution. Doc-delegated mount, click-outside/Escape dismiss, hover-submenu (existing `positionContextMenu`/`wireHoverSubmenus` utils reused or absorbed).

## Scope
In:
- `src/webview/components/ContextMenu/ContextMenu.ts` + `ContextMenu.css`.
- Host command mapping: new commands `go-address-le|be`? (follows system endian — single `go-address`), `select-segment`, `select-all`, `create-label`; host implements.
- `styles/context-menu.css` → `ContextMenu.css`; static link list updated.

Out:
- Copy/Analyze commands unchanged (`contextCommands.ts`/`byte-tools`).
- No bit ops / insert-delete / write-value (kept out; belong edit path elsewhere).

## Acceptance Criteria
- [ ] `components/ContextMenu/ContextMenu.ts` + `ContextMenu.css` exist; component owns menu markup, positioning, dismiss, submenu + inline-input behavior, styles. Zero `S` reads; no command execution.
- [ ] Reworked menu layout per decisions: direct Copy Hex/ASCII (+C Array multi), Go address (4B, endian-aware, preview, valid-gated), Select all, Select segment, Copy as…/Analyze/Annotate/Patch submenus.
- [ ] `onCommand`/`onCreateLabel` callbacks; host executes go-address (LE/BE via system endian), select-segment, select-all, label creation.
- [ ] Single-byte menu: Copy Hex/ASCII, Copy as… (Decimal/Binary), Patch. No Analyze.
- [ ] `styles/context-menu.css` moved verbatim into `ContextMenu.css`; static link list updated.
- [ ] `npm run lint`, `npm run check-types`, `npm run test` pass. Fallow green.
- [ ] Existing copy/analyze/fill behaviors preserved (format outputs unchanged via `contextCommands.ts`).
