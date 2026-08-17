# Rework Inspector — Technical Design

## Scope

Restructure the Inspector panel per the decided PRD: one answer-stream section (Bit View folded in), bottom-dock for collapsed non-first sections, merged Segments/Labels annotation list (segments permanent, address-sorted), merged honest-copy byte line, sticky content-driven bit expand.

## Ownership

| layer | change |
|---|---|
| `SidebarSections` (sidebar.ts) | add bottom-dock support: movement target container for collapsed sections OR expose collapse-reparent hook. Prefer framework option: `SidebarSections.collapsedDockTo(root)`? No — inline flag `dock: true` in spec is YAGNI; only Inspector uses it. Implement minimal: new optional ctor param `dockContainer?: HTMLElement`; `setCollapsed(id,true)` reparents the section node into dock, false returns it to its original index slot. Track original index per section. |
| `inspectorPanel.ts` | remove `applyCollapsibleSection` remnants; build sections `insp` (contains bits internally), `labels` (dock:true). Bits block moves from its own `SidebarSectionSpec` to an internal block inside `insp` body, sticky-collapsible via a small local `data-collapse` + class toggle (framework covers section collapse, not internal blocks — scripts already does exactly this). |
| `inspectorRender.ts` | segments → permanent label rows: emit segment rows in `labelItemsHtml` (marked `label-perma`, no action buttons); address-sort merged list; merged byte line render + full-visible-bytes copy. Delete `segmentItemsHtml`/Segments-specific helpers. |
| `inspectorLabels.ts` | remove reorder buttons (up/down); keep eye/edit/del for user labels only; segment rows jumpable, op perm. |
| `inspectorPanel.css` | `.label-perma` styling (dimmer/pinned glyph); dock pill style; byte-line style (mono, plain, no bg-button look). |

## Data flow

- Labels merged list: `mergeForDisplay(labels, segments)` → sort by start address → render rows with `isPermanent` flag. Purely derived; no state merge. Segments stay source of truth from host; suppression not needed (C decision).
- Copy byte line: copy exact bytes rendered (first ≤8 shown + `N bytes` count); never append literal `…` to the copied string.
- Bit block sticky: keep a `bitsCollapsed` field on InspectorPanel; on selection paint, if `!bitsCollapsed` → expanded; user toggle sets the field. Remount resets. Use existing `.sb-collapse`-style toggler inside `#insp` body (same as scripts output blocks).

## Rendered DOM sketch

```
<section.sb-section#s-insp>
  head: label "Inspector" + discl
  body:
    #insp-addr
    #insp-vals  (value chips)
    [byte-line: `[N bytes] AA BB CC DD …` mono, copyable, honest]
    #insp-multi (interpreter; pad note)
    div#insp-bits (local sticky collapsible: header btn "Bits" + grid)   <-- from old Bit View
</section>
<section.sb-section.collapsed#s-labels> → dock container when collapsed
  body:
    label-perma rows (segments)
    label rows (user)
    + Add Segment Label
</section>
<div.sb-dock>  (reparent target; hidden when empty)
```

## Compatibility / rollback

- Segments section removal changes DOM contract (`#s-segments`, `.segment-item`) — tests updated.
- Old Bit View section `#s-bits` gone; badge logic moves to internal header count.
- One commit revertable; no persistence/localStorage.
- Docking only applies Inspector panel; Struct/Integrity/Scripts untouched (stacked/non-collapsible).

## Risks

| risk | mitigation |
|---|---|
| Dock reparent breaks collapse state map | framework tracks original index; expand returns node to exact slot |
| Merged list ordering drift (labels vs segments same addr) | total address sort stable, segments first on tie (stable sort input order) |
| Bit block auto-expand flash for users who disabled | sticky field persists across selections in mount |
| Test churn on section removal | update panel tests to new DOM (acceptance list in PRD) |