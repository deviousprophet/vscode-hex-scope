# UX copy: feedback + endian visibility

## Goal

Cross-panel copy interactions stop being silent: give visible copy affordance + confirm feedback, and make the multi-byte interpreter's endian-dependent values readable without hunting the 9px global strip.

## Background

- The silent-truncation raw-dump copy was FIXED in the Inspector rework (byte line now copies exactly its visible bytes, no literal `…`).
- Remaining: copy-to-clipboard everywhere is fire-and-forget. Copy targets exist on inspector chips (`data-copy`), multi-byte values (`.mi-dec`/`.mi-hex`), the merged byte line, and integrity value panes — all affordance is `title` tooltip only, zero feedback after click.
- Multi-byte interpreter values are endian-dependent (`S.endian`), but the panel shows no endian tag; users reading a u16/u64 can misread byte order.

## Requirements

R1. **Copy feedback** — clicking any copy target gives immediate visible confirmation (flash/toast on the click target, e.g. a `.copied` 1s class swap label "Copied" + brief CSS transition), in the Inspector panel and Integrity value panes. Consistent across all copy sites in the sidebar.
R2. **Visible copy affordance** — copy targets get a discoverable cue beyond `title`: subtle copy glyph/underline or `.copyable` affordance on hover + persistent affordance on the primary hex/byte-line (established: chips keep click-to-copy, byte line is a data readout but copyable — keep low-key, don't restyle into buttons).
R3. **Endian + width tag on the multi-byte interpreter** — the interpreter block shows its decode context (e.g. `[LE · 2-byte]`/`[BE · 8-byte]`), moving with the width rule (2/4/8). Match the existing pad-note styling language; no new control.
R4. No new host round-trips: feedback is pure DOM/CSS (clipboard writes unchanged via existing `onCopy` callbacks).

## Acceptance Criteria

- [ ] Clicking inspector hex/dec/binary chips, byte line, `.mi-dec`/`.mi-hex`, and integrity code/value panes shows a visible "copied" confirmation (~1s) on the clicked element.
- [ ] Copy content unchanged (same strings as today; byte line copies exactly rendered bytes).
- [ ] Copy targets show a discoverable affordance (glyph/hover) without being restyled as buttons in a way that changes panel density.
- [ ] Multi-byte interpreter header/line shows endian + width (e.g. `[LE · 4-byte]`) reflecting `S.endian` and `multiWidth(selLen)`.
- [ ] No change to any panel layout/behavior otherwise; suite green.

## Out of scope

- Making non-copyable ascii chip copyable (not decided).
- Copy-to-fully-selected byte-line content policy (already resolved).
- Global toast system/notification center — local target feedback only.