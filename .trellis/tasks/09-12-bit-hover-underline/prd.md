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

- `.si-bin-wrap` is `display: inline-block`; CSS gives an inline-block the baseline of its **last** in-flow line. `.si-f-body` uses `align-items: baseline`, so a wrapped (multi-line) bin value anchors the name and dotted leader to the value's **last** line. Desired: the whole header cluster — `>` chevron, field name, `(LE)`/allocation chips, dotted leader — sits together on that last binary line.
- Keep `.si-bin-wrap` as `display: inline-block` (last-line baseline). Add bitunit-header scoping so the chevron and chips join the baseline cluster: `.si-arr-grp-hdr.si-bitunit-hdr, .si-arr-el-hdr.si-bitunit-hdr { align-items: flex-end }`, `.si-bitunit-hdr .si-chip { align-self: flex-end }`, and `.si-bitunit-hdr .si-f-lead { align-self: baseline; margin-bottom: 0; height: 0 }` (zero-height leader box: its bottom edge == shared text baseline, so the dotted line lands exactly on the name/bit baseline; an auto-height empty leader mis-positions the line elsewhere in the row).
- Tree connector stub removed: the `.si-arr-grp-hdr::before` / `.si-arr-el-hdr::before` horizontal tree stub (`top: 50%`) is deleted for all expandable struct headers (not only bitunit) — on a wrapped u32/u64 bitunit header it floated mid-row and resisted aligning with the bottom cluster; consistent removal avoids per-header tuning. The `.si-arr-grp-body::before` / `.si-arr-el-body::before` vertical guide lines stay.
- Forced 16-bit `<br>` line breaks and soft-wrap (`white-space: normal`) unchanged; copy is text-based (`copyBitFieldValue`), highlight runs on `.si-bit` spans (DOM selectors unchanged).

## Constraints

- CSS-only in `src/webview/components/sidebar/structPanel/structPanel.css`; no TS changes.
- No new test infrastructure: webview CSS is swallowed in tests (`cssImportHook.ts` no-op require()); no CSS-assertion harness exists. Existing DOM tests asserting `br` counts / `textContent` / `data-bit-idx` must keep passing.
- Do not change alignment model for the general rows: `.si-f-body { align-items: baseline }` and `.si-field` grid layout stay as-is (single-line rows).

## Acceptance Criteria

- [ ] `structPanel.css` `.si-bit.hov` uses `box-shadow` (solid 1px line) and has no `border-bottom`.
- [ ] `.si-bit.sel.hov` rule deleted.
- [ ] `.si-bin-wrap` stays `display: inline-block`.
- [ ] `.si-arr-grp-hdr.si-bitunit-hdr, .si-arr-el-hdr.si-bitunit-hdr` use `align-items: flex-end`; `.si-bitunit-hdr .si-chip` uses `align-self: flex-end`; `.si-bitunit-hdr .si-f-lead` is baseline-aligned, zero-height, with no bottom margin.
- [ ] Manual (extension host): hover bits on a u32 bit-field bin view — no vertical jump; the solid underline appears under hovered bits.
- [ ] Manual: u32/u64 bit-field parent shown in binary — `>` chevron, field name, endian chip, dotted leader all sit on the binary value's **last** line; the dotted leader is on the same baseline as the name/bit text (no drop below it); no tree connector stub next to the chevron (any expandable struct header, not just bitunit).
- [ ] Manual: u8/u16 bit-field parent (single line) — header cluster alignment effectively unchanged.
- [ ] Manual: selection + hover on the same bit — background and shadow coexist, no shift.
- [ ] Lint + full test suite green (`npm run lint`, `npm test`).