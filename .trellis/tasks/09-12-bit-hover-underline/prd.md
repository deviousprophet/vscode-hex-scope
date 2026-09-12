# fix(bit): hover highlight uses box-shadow to stop underline jump

## Goal

Two CSS-only fixes in the struct bit-field binary view, same area `structPanel.css`:

1. Hovering bits no longer makes the binary display "jump" vertically (the underline took layout space).
2. When a bit-field value renders across two lines (u32/u64 binary), the field name no longer drops below the endian chip and `>` chevron.

## Requirements

### Fix 1 — hover underline layout shift

- `.si-bit.hov` currently uses `border-bottom: 1px dashed` on an `inline-block` span; the 1px border takes layout space, shifting glyph baselines and growing the line box on hover ("jump").
- Replace the border with `box-shadow: 0 1px 0 rgba(79,195,247,.55)` on `.si-bit.hov` — same line visual, zero layout effect.
- Keep the existing hover background and `border-radius` behavior.
- `box-shadow` renders solid (no dashes). Accepting the dashed→solid visual change.
- Remove the now-dead rule `.si-bit.sel.hov { border-bottom: 0; }` (existed only to cancel the dashed border on selected+hovered bits).

### Fix 2 — field name drops on multi-line binary value

- `.si-bin-wrap` is `display: inline-block`; CSS gives an inline-block the baseline of its **last** in-flow line. `.si-f-body` uses `align-items: baseline`, so when the bin value wraps to 2 lines (u32/u64 at 16 bits/line), the name (and dotted leader) sink to the value's **second** line while the chip (`align-self: center`) and `>` chevron (header `align-items: center`) stay centered — name visually drops below them.
- Change `.si-bin-wrap` to `display: inline` so the value's block baseline reverts to the **first** line; the name/dotted-leader baseline-align back to the value's top line. Fixes grp-headers, element headers, and any other 2-line bin value in one place.
- Forced 16-bit `<br>` line breaks and soft-wrap (`white-space: normal`) unchanged; copy is text-based (`copyBitFieldValue`), highlight runs on `.si-bit` spans (DOM selectors unchanged).

## Constraints

- No JS/TS changes. CSS only (`src/webview/components/sidebar/structPanel/structPanel.css`).
- No new test infrastructure: webview CSS is swallowed in tests (`cssImportHook.ts` no-op require()); no CSS-assertion harness exists. Existing DOM tests asserting `br` counts / `textContent` / `data-bit-idx` must keep passing.
- Do not change alignment model for the general rows: `.si-f-body { align-items: baseline }` and `.si-field` grid layout stay as-is (single-line rows).

## Acceptance Criteria

- [ ] `structPanel.css` `.si-bit.hov` uses `box-shadow` (solid 1px line) and has no `border-bottom`.
- [ ] `.si-bit.sel.hov` rule deleted.
- [ ] `.si-bin-wrap` is `display: inline`.
- [ ] Manual (extension host): hover bits on a u32 bit-field bin view — no vertical jump; dashed underline is now a solid line under hovered bits.
- [ ] Manual: u32/u64 bit-field parent shown in binary — field name and dotted leader align with the value's first line; no longer lower than the endian/`>` chip.
- [ ] Manual: selection + hover on the same bit — background and shadow coexist, no shift.
- [ ] Manual: u16 bit-field binary (single line) — alignment unchanged from baseline behavior.
- [ ] Lint + full test suite green (`npm run lint`, `npm test`).