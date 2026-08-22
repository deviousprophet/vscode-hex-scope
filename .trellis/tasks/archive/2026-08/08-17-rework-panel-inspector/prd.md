# Rework panel: Inspector

## Goal

Rewrite the Inspector panel on decisions from the UX grilling session. Panel becomes a coherent single-answer stream: selection → address → value → interpretation → bits, with segments/labels merged annotation domain. Everything below is a decided requirement, not a proposal.

## Background (audit findings driving this work)

- Bit View is the panel's lowest-frequency answer ("is bit N set?") but costs a default-collapsed section whose badge hints hidden content.
- Raw dump duplicates the hex chips, truncates copied bytes silently (inspectorRender.ts:38-41).
- Labels rows: 5 tiny icon-only actions (eye/up/down/edit/del) at ~20px, manual arrow reorder, no sort.
- Segments + Labels are two lists of the same anthropo-fact ("byte range meaning") with separate sections.

## Accepted grilling decisions (requirements)

1. **Bit View lives inside the Inspector section** — one section, one answer stream (address → value/interpreter → bits). No separate "Bit View" section.
2. **Sticky content-driven expand** — a fresh selection auto-expands the Bit View block; a user-collapse sticks for subsequent selections (per mounted panel). Remount resets. No localStorage.
3. **Bottom-dock for collapsed non-first sections** — collapsed sections (Labels) shrink to a compact dock pinned to the panel bottom (VS Code bottom-dock pattern); expanding rejoins the top stack. Inspector itself (first section) never docks.
4. **Raw dump merged, de-emphasized, honest copy** — byte line folded above the multi-byte interpreter as a plain mono line tagged `[N bytes] AA BB CC …`; copy returns exactly the rendered visible bytes (no silent truncation). Kill the styled grey-block "button" dressing; it is a data readout, not a control.
5. **Labels auto-sort by start address; manual reorder removed** — no ↑/↓ buttons; row order always address-sorted.
6. **Segments merged into Labels list** — segments render as permanent label rows (non-editable, marked as permanent, click-to-jump), interleaved with user labels, all address-sorted. The separate Segments section is removed.
7. **Segments are not deletable** (C). Only user labels can be deleted/edited. No suppression list needed.
8. **Labels section closed by default, collapses to bottom-dock pill** (B) — jump-map reachable in two clicks without scrolling or upfront vertical cost.
9. **Multi-byte width auto-scales 2/4/8 unchanged** (grilling skipped) — keep current `multiWidth` behavior + padding note.

## Out of scope

- Multi-byte interpreter width lock (Q3 skipped).
- Label editing data model change (label CRUD + color swatches stay current).
- Copy-feeback system and hit-size fixes — live in `ux-copy-affordance` / `ux-a11y-targets` tasks; this panel only stops *silently truncating* copies.
- Endian indicator in panel (current global strip stands).

## Acceptance Criteria

- [ ] Opening Inspector with a selection shows address → value chips → byte line → interpreter → bits in ONE scrollable section; no "Bit View" section header exists.
- [ ] New selection auto-expands bits; user-collapse of bits persists for later selections in the same mount; remount resets.
- [ ] Collapsed Labels (and any collapsed non-first section) docks to panel bottom as a compact pill; expanding moves it back to the top stack.
- [ ] Copying the merged byte line anywhere returns exactly the visible bytes (full selection or an explicit no-more-than-8 line with the count) — never silent `…` truncation.
- [ ] Labels list renders one address-sorted list containing permanent segment rows + editable user labels; segment rows marked permanent, no edit/delete controls on them.
- [ ] No Segments section remains.
- [ ] No ↑/↓ reorder controls remain on label rows.
- [ ] Labels default collapsed → docks; still jumpable via pill.
- [ ] Existing label add/edit/recolor/visibility/delete behavior for user labels unchanged.