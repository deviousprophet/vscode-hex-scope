# PRD — Fix ASCII struct field whitespace rendering

## Problem

A struct field declared as `ascii` whose bytes contain consecutive `0x20` spaces is
displayed incorrectly in the struct panel: runs of spaces collapse to a single space,
and leading/trailing spaces are trimmed.

## Root cause

`src/webview/components/sidebar/structPanel/structPanel.css:435` defines
`.si-f-val[data-val-type="ascii"]`, which inherits `white-space: nowrap` from the base
`.si-f-val` rule. HTML always collapses runs of whitespace in text nodes; `nowrap` only
prevents wrapping, it does not preserve spaces. The value string is inserted raw into the
cell (`structPanel.ts:1882`, `:1892`), so `0x20` runs render collapsed.

Non-printable bytes decode to `.` and only 0x20–0x7F survive decoding
(`structCodec.ts:411`, `asciiFromBytes` `structPanel.ts:1958`), so no tab/newline can
reach the ascii value — `0x20` is the only affected byte.

## Scope

- In scope: struct panel ASCII value cells only.
- Out of scope: numeric value cells (e.g. `uint8` renders `"255 (0xFF)"` with a
  pre-existing collapsed double space) — cosmetic-only, deliberate, unchanged.
- Out of scope: hex-view grid decoded column, inspector chip, copy-to-clipboard paths
  (per-char `<span>` cells / plain string — unaffected).
- Out of scope: fixing HTML whitespace behavior generally.

## Fix

One-property change: add `white-space: pre;` to `.si-f-val[data-val-type="ascii"]`.
Presentation-only; no string munging; leaves all other value types untouched.

## Acceptance criteria

1. `.si-f-val[data-val-type="ascii"]` in `structPanel.css` declares `white-space: pre`.
2. A test verifies the rule (markup/DOM text assertions pass before the change, so the
   test must assert the CSS rule directly).
3. An ascii field decoding bytes containing a `0x20` run still renders its decoded string
   unchanged; copy path (`row.decoded`) unaffected.
4. No change to any non-ascii value cell rendering.
5. `npm test` passes.

## Constraints

- No new dependencies. One CSS change + one test.
- Non-printable `.` substitution and `'…'` quoting unchanged.