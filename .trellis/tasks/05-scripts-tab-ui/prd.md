# Implement scripts tab UI per finalized spec

## Goal

Implement the scripts tab UI as designed in `.trellis/spec/frontend/scripting.md` section 7 (UI Component States). The spec contains all 13 design decisions (D1–D13) and the complete button state machine, card layout, and result block behavior derived from the grilling session.

## Source spec

`.trellis/spec/frontend/scripting.md` sections 3, 7, and 8 contain the authoritative design. Read those before implementing.

## Key deliverables

1. Toolbar header with script count badge and Refresh ↻ button (replaces collapsible `sb-hdr`)
2. Script card with: filename, extension badge, status dot (green/red/gray), Run/Cancel icon button
3. Button state machine: ▶ Play → ⟳ Spinner (200ms) → ⏹ Stop → ▶ Play. Icons only, fixed-width slot, no text
4. Cancel via `AbortController` — Stop button triggers abort
5. Result block auto-expands on new result, collapsible via header click (▶/▼)
6. Distinct error headers: compile ⚠️ yellow, runtime 🔴 red, timeout ⏱️ orange
7. Result persists across tab switches, replaced on re-run
8. Output batching: first 100 calls immediate, then `setTimeout(flush, 0)` debounce
9. `.ts` files shown with disabled Run button + "requires esbuild" tooltip
10. Script list sorted alphabetically
