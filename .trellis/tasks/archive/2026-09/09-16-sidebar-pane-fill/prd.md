# Fix sidebar section body void + premature scrollbar

## Goal

Fix the main-branch layout bug: sidebar section bodies show a blank void below content AND a premature scrollbar, even when content is short. The body must exactly fill its pane; short content top-aligns (VS Code standard), long content scrolls. No pin-to-bottom buttons — natural flow preserved.

## Background

Reported on release tag (main, no stretch code). Two symptoms observed simultaneously inside section bodies:
1. **Void**: empty space below content (body shorter than pane).
2. **Premature scrollbar**: `.sb-body` scrollbar visible even when content should fit.

Root cause identified by code analysis:
- `.sb-pane { transition: flex-basis .15s ease-out }` fires on EVERY `flex-basis` change — not just collapse/expand. When `layout()` recalculates pane sizes (resize, initial mount, sash drag), the pane's height animates over 150ms. The body and its content children are measured during this transitional state, producing stale heights that persist after the animation settles.
- `.si-editor-wrap { min-height: 100% }` (struct editor) resolves against the animating body height. On some machines/browsers it fails entirely (falls back to content height), creating a void regardless of transition.

VS Code does not have this problem: `SplitView` passes exact px heights imperatively; no CSS transition on sizing; `.pane-body` has `overflow: hidden` (not `auto`).

## Requirements

### R1 — Disable flex-basis transition during layout recalculations

Add/remove a class (e.g., `.sb-pane-view.no-transition`) on the pane-view element around `applyAllocation` calls in `layout()`. When the class is present, `flex-basis` changes are instant (no animation). Only enable the 150ms transition during collapse/expand animations (the intentional visual effect).

### R2 — Remove unreliable `min-height: 100%` from struct editor wrapper

Remove `min-height: 100%` from `.si-editor-wrap` in `structPanel.css`. The body already fills the pane via `flex: 1`. Short content stays top-aligned (VS Code standard). The wrapper does not need to fill — the body handles it.

### R3 — Body remains sole scroll container

`overflow-y: auto` on `.sb-body`. No inner scroller. No JS stretch idiom reintroduced.

### R4 — No visual changes to untargeted sections

Inspector, Integrity, Scripts, Labels: byte-identical to current main (minus the transition timing fix, which benefits all sections equally).

## Acceptance Criteria

- [ ] **AC1** — Short section content: body fills pane exactly, no void, no premature scrollbar.
- [ ] **AC2** — Long section content: body scrolls, no forced fill.
- [ ] **AC3** — Empty hints (`.sb-empty`) top-aligned, unchanged.
- [ ] **AC4** — Inspector/Integrity/Scripts/Labels: no visual change vs main (except no void/scrollbar).
- [ ] **AC5** — Collapse/expand animation preserved (150ms ease-out on flex-basis).
- [ ] **AC6** — Sash drag remains instant (no transition during drag).
- [ ] **AC7** — `npm run check-types` clean.
- [ ] **AC8** — Existing mocha suites pass (526 passing).
- [ ] **AC9** — `npx fallow` reports no new sidebar-related issues.
- [ ] **AC10** — `/code-review` run during trellis-check.

## Out of Scope

- JS stretch idiom (`setStretch`/`applyStretches`) — not wanted.
- Pin-to-bottom buttons — natural flow preserved.
- New empty-state designs.
- Pane-view / splitview shell structural changes.

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Transition fix | class-toggled, not JS measurement | Minimal CSS-only; avoids getBoundingClientRect timing issues |
| `min-height:100%` removal | remove entirely | Documented unreliable; body `flex:1` already handles fill |
| Short content behavior | top-aligned (VS Code standard) | User: "buttons should look like main" |

## Risks

- Removing transition during `layout()` may affect sash-drag smoothness — but `.sb-pane-view.dragging .sb-pane { transition: none }` already handles drag.
- `min-height:100%` removal changes struct editor CSS vs main — but the rule was a failed fill attempt; removing it makes behavior consistent across machines.

## Artifacts

- `prd.md` (this file)
- `design.md` (pending)
- `implement.md` (pending)
