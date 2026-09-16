# Design — Fix sidebar section body void + premature scrollbar

## Root Cause

`.sb-pane { transition: flex-basis .15s ease-out }` fires on every flex-basis change, including `layout()` recalculations. During the 150ms animation, the body and its content are measured at transitional heights. After the animation settles, nothing re-measures — stale heights persist as void + premature scrollbar.

Additionally, `.si-editor-wrap { min-height: 100% }` resolves unreliably against flex-derived heights across machines, creating voids independent of the transition.

## Fix: Two Changes

### 1. Toggle transition off during `layout()`

Add a class `.sb-pane-view.no-transition` to the pane-view element. While present, `.sb-pane` flex-basis changes are instant. Remove the class after `layout()` completes (or use rAF). Only enable the 150ms transition during collapse/expand (the intentional visual effect).

**CSS addition (sidebar.css):**
```css
.sb-pane-view.no-transition .sb-pane { transition: none !important; }
```

**JS change (sidebar.ts):**
In `layout()`, add class before `applyAllocation` loop, remove after (or via rAF):
```ts
this.paneView.classList.add('no-transition');
for (const id of ids) {
    this.applyAllocation(id, alloc.get(id)!);
}
this.paintSashStates();
// Remove after browser paints the instant changes
requestAnimationFrame(() => {
    this.paneView.classList.remove('no-transition');
});
```

**Collapse/expand still animates:** `setCollapsed()` calls `this.layout()` which adds `no-transition`, but the collapse also toggles `entry.section.classList.toggle('collapsed')`. The CSS `.sb-pane { transition: flex-basis .15s ease-out }` fires on the NEXT layout after the class is removed. To preserve collapse animation: in `setCollapsed`, add a flag or re-add transition after the class removal.

Actually, simpler: the collapse animation works because `setCollapsed` toggles `collapsed` class, which changes the section's visual state. The `flex-basis` transition animates this change. If we disable the transition during `layout()`, the collapse happens instantly — but that's fine for the layout pass. The visual animation comes from the CSS `transition` on the section's `flex-basis` being set in `applyAllocation`. Since we remove `no-transition` after rAF, the NEXT layout call (triggered by ResizeObserver or user interaction) will have the transition enabled again.

But for the SPECIFIC collapse case: `setCollapsed` → `layout()` → panes resized → flex-basis changes → if transition is disabled, change is instant → no animation. We want the animation.

**Revised approach:** Only add `no-transition` during `layout()` calls that are NOT triggered by collapse/expand. Use a flag:

```ts
private collapseAnimating = false;

setCollapsed(id: string, collapsed: boolean): void {
    // ...
    this.collapseAnimating = true;
    this.layout();
    this.collapseAnimating = false;
}

private layout(): void {
    if (!this.collapseAnimating) {
        this.paneView.classList.add('no-transition');
    }
    // ... allocate ...
    if (!this.collapseAnimating) {
        requestAnimationFrame(() => this.paneView.classList.remove('no-transition'));
    }
}
```

This way: collapse/expand keeps its 150ms animation. All other layout calls (resize, initial mount, sash) are instant.

### 2. Remove `min-height: 100%` from `.si-editor-wrap`

**structPanel.css:** Remove `min-height: 100%;` from `.si-editor-wrap`. Keep `display: flex; flex-direction: column;`.

The body fills the pane via `flex: 1`. Short content stays top-aligned. Long content scrolls. No wrapper fill needed.

## Contracts

- `layout()` is the only place pane flex-basis is set (via `applyAllocation`).
- `setCollapsed` is the only place collapse animation is desired.
- `shiftPane` / `resetSash` (sash drag) already disable transition via `.sb-pane-view.dragging .sb-pane { transition: none }`.

## Compatibility

- Changes are purely behavioral (no API changes).
- `setCollapsed` animation preserved.
- Sash drag already has `transition: none` via `.dragging` class.
- Rollback: remove `.no-transition` CSS rule, remove JS class toggle, restore `.si-editor-wrap` CSS.

## Trade-offs

| Option | Pros | Cons |
|---|---|---|
| Class-toggled transition (chosen) | Minimal CSS/JS; no measurement; collapse animation preserved | Needs flag to distinguish collapse vs other layout |
| requestAnimationFrame defer | Simple | Doesn't preserve collapse animation; adds frame delay |
| JS measurement (getBoundingClientRect) | Precise | Timing-sensitive; reintroduces the bugs we're fixing |
