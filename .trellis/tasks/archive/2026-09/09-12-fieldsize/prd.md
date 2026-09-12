# Array size unlimited + bit editor in-place refresh

## Background

Reported bug: array element count cannot exceed 256. The editor clamps the value
(`Math.min(v, 256)`) and the count input truncates digits (`slice(0, 3)`), so
e.g. `270` silently becomes `256` / `27`.

Unrelated editor bug: the bit-field container's "+ Add bit" button stays disabled
after editing an existing child's width down in place (e.g. u8 container with
children width 3+5 = full; shrink 3 -> 1 -> total 6, but "+ Add bit" remains
disabled until save + reopen).

## Requirements

- Array element count in the struct editor must accept values with no artificial
  numeric cap beyond what a usable integer allows (previously capped at 256).
- Editing a bit-field child width must update the container's remaining-bit state
  live, so "+ Add bit" re-enables as soon as total child width drops below the
  container capacity (u8 = 8, u16 = 16, u32 = 32, u64 = 64).
- Bit-field child width behavior otherwise unchanged: over-capacity totals still
  fail existing save-time validation.

## Acceptance Criteria

- [ ] Entering an array count larger than 256 (e.g. 270, and a large value like
      123456) renders, edits, and saves with exactly that count.
- [ ] Existing array count 1 and 2-digit entries behave as before.
- [ ] u8 bit-field container: children width 3+5 -> "+ Add bit" disabled; shrink
      first child to 1 -> total 6 -> "+ Add bit" enabled immediately, without
      saving/reopening.
- [ ] "+ Add bit" remains disabled whenever total child width is at or above
      container capacity.
- [ ] No regressions in struct save/validation, rounding of array counts < 256.

## Notes

- Scope: array count cap removal + bit editor in-place refresh only. Child bit
  width clamp (64) and core validation unchanged.
- Regression tests live in `src/test/webview/components/sidebar/structPanel/structPanel.test.ts`.