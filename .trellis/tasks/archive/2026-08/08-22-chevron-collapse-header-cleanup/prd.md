# Chevron collapse affordances + struct types header + badge removal

## Goal

Three UI-consistency changes agreed via grilling.

## Requirements

### R1. Chevron `›` collapse affordance (app-wide)

- Canonical glyph: `›` (U+203A). Collapsed = `›` pointing right; open =
  rotate +90° (points down).
- Apply to **every** collapse/expand control:
  - Sidebar section head `.sb-section-chevron` (`sidebar.css`)
  - Inspector Bits sub-section `.sb-inner-toggle-icon` (`inspectorPanel.css`)
  - Scripts output block `.script-output-hdr::before` (`scriptsPanel.css`)
  - Struct tree expand buttons (`structPanel.ts` JS glyphs)
- Bits sub-section chevron = same font-size as parent section chevron (11px);
  keep its deeper 12px indent (subsection hierarchy stays via indent only).

### R2. Struct Types header

- Remove the `←` back/cancel button (`sm-close-btn`, `mountTypesAction`).
  The type editor and pin editor each carry their own Cancel already.
- Add a `＋ Add` header action to the Types section, styled like the
  Instances `＋ Add` (`sb-btn sb-btn-add sb-section-action`), opening the
  new-type editor.
- Remove the in-body "New type" button (`sm-new-btn` + `typePanelNewButtonHtml`).
- Disable the Types `＋ Add` while the type/instance editor is open (mirrors
  Instances `＋ Add` disabling while the add-pin form is open).

### R3. Remove section-header count badges

- Remove all header count badges: Struct Instances pin count, Scripts count,
  Integrity `N · M!` mismatch, Inspector labels/segments count.
- Remove the corresponding `setBadge(...)` calls. `setBadge` API may stay
  (unused) or be removed — do not leave dead call sites.
- Integrity mismatch status remains visible per-card; no header replacement.

### R4. Instance card actions always-visible

- Replace the `⋮` menu (`si-card-menu-wrap` / `.si-card-menu-pop`) with
  always-visible icon buttons on each instance card: Edit ✎, Delete 🗑,
  View type `{ }` (restore `actionBtnsHtml` pattern from main branch).
- Drop the ⋮ popup and its wiring (`closeMenuPopup`/menu handling for cards).

### R5. Chevron sizes

- All chevrons `14px` except struct tree expand buttons `12px`.
- Rotation is the only visual change on collapse/expand: each chevron sits in a
  fixed-size centered box so size/shape/position stay stable.

### R6. Instance creation requires a defined type

- Remove the inline `＋ new type` button from the add-instance form (both the
  type-row `＋` and the "no types yet" row) — a type must be defined first.
- Disable the Instances `＋ Add` header button when no struct types exist
  (`title`/`aria-label` "No struct types defined").
- Type-aware empty message: no types → "Define a struct type first."; types
  but no pins → "No instances yet. Click ＋ Add to create one."
- Remove the now-dead `fromAdd` field and its branches (`se-cancel`,
  `closeEditorAfterSave`).

### R7. Instance card action order + preview active state

- Action buttons ordered Edit → View type → Delete.
- View-type button carries `.active` (and renders it from `_previewedPins`) so
  the open-preview state is visible and survives re-render.

## Acceptance Criteria

- [x] All collapse affordances render `›`, rotate +90° when open.
- [x] Chevron sizes: 14px everywhere, 12px struct tree; rotation-only transform
      in fixed centered boxes (no size/position drift).
- [x] Struct Types header has `＋ Add`; no `←` back button; no in-body
      "New type" button; `＋ Add` disabled while editor open.
- [x] No count badges on any section header.
- [x] Instance cards show always-visible Edit/View-type/Delete buttons in that
      order; no `⋮` menu; view-type shows `.active` when preview open.
- [x] Instances `＋ Add` disabled with "No struct types defined" tooltip when
      no types; empty message type-aware; `sa-new-type-btn` + `fromAdd` removed.
- [x] `npm run lint` + `check-types` + tests green.
- [x] Specs (`css-guidelines.md`, `component-sidebar.md`,
      `component-sidebar-scripts-panel.md`, `struct-instance-display.md`,
      `scripting.md`) updated to `›` chevron + no badges + always-visible card
      actions + inline instance edit.
