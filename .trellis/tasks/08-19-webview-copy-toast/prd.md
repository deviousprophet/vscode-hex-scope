# Webview copy toast component

## Goal

A small generic webview toast shown transiently at the point of interaction for copy actions. Single confirmation channel — replaces the host status-bar notice. The component takes the message as a **required param (no default)**; copy call sites pass `"Copied ✓"`.

## Requirements

1. **Generic component, message required** — `showToast(message: string, opts?)`: no default text. Callers own the string (`"Copied ✓"` for copies today; custom text possible later).
2. **Placement** — rendered near the interaction point `(clientX, clientY)` when provided; clamped to the webview viewport; **fallback top-center** of the webview when no coords or the position can't fit.
3. **Lifecycle** — fade-in ~150ms, hold ~1s, fade-out ~250ms (≈1.4s total). Rapid repeated calls replace the current toast (reset the timer), never queue. `prefers-reduced-motion` → instant show/hide.
4. **Accessibility** — `aria-live="polite"` (screen readers announce), `role="status"`.
5. **Wiring** — every copy site shows the toast: inspector hex/dec/binary chips, merged byte-line, `.mi-dec`/`.mi-hex` values, integrity value-pane copy button. Click coordinates passed through.
6. **Single channel** — the host `copyText` handler stops showing the status-bar "Copied: …" notice (clipboard write stays). No other copy feedback (the local `.copied` green tint may stay as a non-text cue or be removed — decide in review; text swap stays removed).

## Acceptance Criteria

- [ ] `showToast(message)` renders a floating element; text is exactly the passed message (no default).
- [ ] Near-click placement for coordinate-provided calls; clamped inside the webview; top-center fallback otherwise.
- [ ] Fades in/out per lifecycle; rapid calls replace (single live toast); reduced-motion = instant.
- [ ] `role="status"` + `aria-live="polite"`.
- [ ] All 4 copy surfaces trigger the toast with `Copied ✓`.
- [ ] Host `copyText` no longer shows any notification (clipboard write intact).
- [ ] `npm run check-types`, `npm run lint`, `npm test` green; tests cover toast lifecycle/placement/replace/reduced-motion and copy-site triggering.

## Out of scope

- Toasts for non-copy actions (component is generic but only copy is wired).
- Queueing/stacks of toasts.