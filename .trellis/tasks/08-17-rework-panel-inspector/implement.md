# Rework Inspector — Execution Plan

## Preconditions

Decisions from grilling session are fixed requirements (see prd.md). No localStorage / persistence added.

## Implementation checklist

1. **SidebarSections dock support (sidebar.ts)**
   - Add optional `dockContainer?: HTMLElement` ctor param.
   - Track per-section original index (insertion order).
   - `setCollapsed(id, true)` → if dockContainer, reparent section node into dock (appendChild); `false` → reinsert at original index in root.
   - Empty dock hides itself; non-empty shows.
   - Keep existing owner/collapse map/aria behavior intact.
2. **Drop Bit View section; fold into Inspector block (inspectorPanel.ts)**
   - Mount sections: `insp` (collapsible, default open), `labels` (collapsible, `defaultCollapsed: true`, dock).
   - Delete `#s-bits` section usage; render bits inside `#insp` body as an internal `#insp-bits` block with its own local disclosure header (pattern: scripts output-block collapse), sticky per-mount via `bitsCollapsed` field.
   - `renderBits`/`renderBitsMulti` target `#insp-bits` + internal count badge text (inline, not framework badge).
   - New selection paint: expand bits unless `bitsCollapsed`.
3. **Merged byte line (inspectorRender.ts / inspectorPanel.ts)**
   - Replace `multiByteInspectorHtml` dump block with mono data line `[N bytes] AA BB CC … (first ≤8 shown)`.
   - Copy = exactly rendered bytes; no literal `…` in copied string. Expose helper returning `{ display, copy, truncated }`; wire once in paint + `wireInspectorCopies`.
4. **Labels merge + permanent segments (inspectorRender.ts / inspectorLabels.ts)**
   - `labelItemsHtml` accepts segments; emit segment rows first-class (`label-perma`, click-to-jump, no edit/delete/eye), user rows unchanged minus reorder.
   - Drop up/down buttons + wiring (`wireLabelMoveUp/Down`, `.label-up/.label-dn` CSS).
   - MergeFn: `[...segmentsAsLabels, ...userLabels]` sorted by start address (stable, segments first on tie).
   - Update `renderSegments()` removal — host `setSegments` now only stores; single `renderLabels()` renders merged list; badge counts total rows.
5. **Remove Segments section**
   - Delete Segments section creation; remove `segmentItemsHtml` consumers; keep host data flow.
   - Update tests: `#s-segments`/`.segment-item` → merged rows `.label-perma` under labels; jump behavior tested through row click.
6. **CSS (inspectorPanel.css / sidebar.css)**
   - `.sb-dock` (sidebar.css, border-top + compact pills), `.sb-section.docked` registry.
   - `.label-perma` (dimmer label, pinned glyph, no action affordance), `.label-perma:hover` = jump hint only.
   - Mono byte-line class (plain data readout).
7. **Tests** (inspectorPanel.test.ts, webview.test.ts)
   - docking: collapse/labels reparents to dock, expand returns slot;
   - bits auto-expand + sticky collapse;
   - byte line copy = exact visible bytes;
   - merged list order + permanent-row exclusion from edit/delete;
   - labels default collapsed → dock pill present.

## Validation

- `npm run check-types`
- `npm run lint`
- `npm test`
- Manual EDH: dark+light; select 1 / 3 / 8+ bytes; toggle bits then new selection (stays collapsed); collapse labels → dock pill appears/pins bottom; expand → slot restored; delete user label only; click segment row jumps.

## Review gates

- No `#s-bits`/`#s-segments` in DOM or tests.
- No reorder controls in labels.
- Copy never contains silent `…`.
- Docking works for multiple collapsed sections ordering.
- Non-Inspector panels unaffected by dock change.

## Rollback

One commit revert restores 4-section Inspector, separate Segments, old byte dump. No persistence.