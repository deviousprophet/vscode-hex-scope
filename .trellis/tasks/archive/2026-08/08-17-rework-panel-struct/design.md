# Rework Struct — Technical Design

## Scope

Replace the slide-track with stacked framework sections; move instance actions into an always-visible "⋮" menu; unify instance editing into the full-width editor; move pointer/reference into a per-field context menu.

## Ownership

| layer | change |
|---|---|
| `structPanel.ts` | mount two `SidebarSections` in `#si-track`→ replace with normal stack (root .sb-section children); `types` collapsible:true default open? — default **open** (decided stacked, discoverable; user can collapse). Instance card: replace hover icon cluster with `.si-card-menu` "⋮" (native `<details>`-style or local popover) containing Edit/Delete/View type. Instance edit: open full-width editor region (reuse type editor mounting) instead of `si-pin-edit-form` expansion. Pointer: context menu per field row (right-click or "⋮" on field) exposing pointer toggle + "attach reference/clear". Remove `si-panel-clip`/`si-panel-track` slide logic + `si-showing-types`. |
| `structPanel.css` | delete `.si-panel-*` slide rules + hover-only opacity controls; add `.si-card-menu`, popover/list/menu styling, `.label` per-card, editor unification shared shape. Field context menu styles (reuse `.si-val-menu` pattern for a per-field menu). |
| `structPanel.test.ts` | update for stacked sections, menu-driven actions, editor flow. |

## Data flow

- No state model changes: `_pins`, `_structs`, `_editingType`, `_addingPin` stay. `_managingTypes` replaced by Types section collapsed state (framework).
- "⋮" menu: single button per card; menu items act on `pin.id`. Keyboard: button focusable; menu items focusable; Escape closes.
- Editor: one mount point — the Types section body. When editing an instance, Types section expands + editor full-width (title "Edit Instance"; back → collapse/resume list). Reuses `editorHtml` shape with instance save/cancel callbacks.
- Pointer references: keep current reference model (field ↔ address); only the entry point moves into field context menu.

## Rendered DOM sketch

```
<section.sb-section#si-instances>
  head: "Struct Instances" [+ badge count, + Add action]
  body: [bit-order LSB/MSB row] [+ add form] [instance cards]
    card: name/type/addr + ⋮-menu (Edit | Delete | View type)
<section.sb-section#si-types>
  head: "Struct Types"
  body: [New type] [type rows | full-width editor]
```

## Compatibility / rollback

- `si-*` IDs preserved where feasible (`#si-add-btn`, `#sm-new-btn`, `#sm-close-btn`); slide DOM removed.
- Editor behavior for types unchanged; instance edit gains same editor.
- One commit revert restores slide + hover icons.

## Risks

| risk | mitigation |
|---|---|
| Removing slide loses "focus one panel" behavior | stacked + collapsible Types preserves focus via collapse |
| ⋮ menu accessibility | native button + focusable menu items + Escape; `aria-haspopup`/`aria-expanded`; click-outside close |
| Field context menu discoverability vs old row button | menu reachable also by keyboard (field row focus + Enter or Shift+F10) |
| Instance-edit in editor changes save flow | reuse existing draft/save/cancel validation; tests cover add/edit instance via editor |
| 200% track tests break | rewrite slide tests to stacked assertions |