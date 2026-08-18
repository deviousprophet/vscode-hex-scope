# PaneView: in-place collapse (no bottom-pack)

## Goal

Fix the PaneView collapse behavior (grill Q1-A): a collapsed pane stays in its DOM position at 22px — no forced bottom-pack move. Expanded panes flex-grow to fill the free space; collapsed headers end up at the bottom only when the panes above them are expanded (natural consequence, VS Code-true). Removes the pack/restore machinery added in `b93e57a`.

## Requirements

1. **Remove bottom-pack DOM move** — on collapse, the section stays where it is (flex-basis → 22px, 150ms ease-out). Delete the pack-to-bottom + expand-restore-order code (`restoreOrder`, any `moveCollapsedToBottom`/pack helpers).
2. **Static sashes** — sashes never move and never disable: remove `.disabled` sash state, `aria-disabled`/`tabindex` toggling, and dynamic sash `aria-label` re-derivation (labels are constant: pane above stays fixed). Sash is always draggable between its two panes.
3. **Sizing unchanged** — `layout()` free-space math stays: free = height − Σcollapsed·22 − (n−1)·SASH_H; expanded panes = persisted px clamped + proportional remainder; MIN_PANE floor.
4. **All other PaneView behavior unchanged** — whole-header toggle/keyboard, collapse animation, expand-restore-saved-size, persistence.

## Acceptance Criteria

- [ ] Collapsing the first pane leaves its header at the top in DOM order; no element moves in the pane-view.
- [ ] No `restoreOrder`/pack/`paintSashStates` disabled-sash code remains (grep clean).
- [ ] Sashes always `tabindex=0` + enabled; `aria-label` references their (fixed) pane above; no `.disabled` sash class.
- [ ] Expanded panes still fill free space; collapsed headers naturally sit below expanded content when expanded panes precede them.
- [ ] Persistence + expand-restore + 50/50 first-time + drag/arrows/dblclick all unchanged.
- [ ] Tests updated: in-place order preserved across collapse/expand cycles; no bottom-pack assertions; sash never disabled; existing PaneView suite green.
- [ ] `npm run check-types`, `npm run lint`, `npm test` green.

## Out of scope

- Any other PaneView change (drag, persistence, sizing model).