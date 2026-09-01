# Design — theme-adaptive ihex/srec scopes

## Context

`contributes.configurationDefaults` in an extension `package.json` is validated against
VS Code's `vscode://schemas/settings/configurationDefaults` schema, which whitelists only
application/machine-scoped defaultable settings plus `[lang]` override keys.
`editor.tokenColorCustomizations` is window-scoped (registered in the theme service under
`id: "editor"`), so it is not whitelisted — the validator rejects the nested object and
flags `textMateRules` (an array) as `Incorrect type. Expected "object".` at package.json:203:26.
VS Code's runtime would consume the value, but the schema error is permanent.

Remedy: delete the block and map grammar captures to **standard TextMate scope names** that
every VS Code color theme (Dark+, Light+, High Contrast, One Dark, etc.) already styles.
Reference: keroc/hex-fmt ships exactly this — no custom colors, four standard scopes.

## Scope mapping

| Element      | Example       | Current (custom) scope              | New scope            | Theme role          |
|--------------|---------------|-------------------------------------|----------------------|---------------------|
| start code   | `:` / `S`     | `punctuation.ihex.start-code` etc.  | `keyword.operator`   | operators           |
| byte count   | `10`          | `meta.ihex.byte-count` etc.         | `constant.numeric`   | numbers             |
| address      | `0000`…`00004000` | `meta.ihex.address` etc.         | `variable.parameter` | distinct param tint |
| record type  | `00`,`01` / `S1`…`S9` digit | `meta.ihex.record-type.*` / `meta.srec.record-type.*` | `entity.name.type` | type tint, uniform  |
| data         | `7F...`       | `meta.ihex.data` / `meta.srec.data` | *(none — left UI-colored by theme foreground)* | default foreground |
| value (02/04/03/05 records) | `0000`…`FFFF` | `meta.ihex.extended-address-value` | `constant.numeric`   | numbers             |
| checksum     | `F1`          | `meta.ihex.checksum` etc.           | `markup.bold`        | bold emphasis       |
| malformed    | any bad line  | `invalid.illegal.ihex` / `.srec`    | `invalid.illegal`    | theme error color   |

Notes:

- Data stays **unscoped** on purpose (hex-fmt parity): an all-cyan/`constant.numeric` sea is
  hard to read; four accent classes keep the line scannable.
- Record-type sub-kinds (data/eof/extended/start) collapse to one uniform `entity.name.type`;
  the mandatory eof-record color distinction is intentionally lost in favor of theme fidelity.
- Checksum `markup.bold` renders as bold text in themes that map it; it does not guarantee a
  distinct hue — acceptable, matches hex-fmt.
- `invalid.illegal` keeps the canonical (dropped-language-tail) scope so down-level themes that
  only style `invalid` still catch it.

## Files

- `package.json` — remove `contributes.configurationDefaults` (whole block, lines ~201–335).
- `syntaxes/intel-hex.tmLanguage.json` — capture names only (+ unknown-record name).
- `syntaxes/srec.tmLanguage.json` — capture names only (+ unknown-record name).
- `CHANGELOG.md` — Unreleased entry (current top is released `[2.20.0] - 2026-09-01`; add a new
  Unreleased `### Changed` section per the update-changelog skill in phase 3).

## Rollout / rollback

- Single commit; rollback = revert commit (`git revert`), restored config + old scopes intact.
- No settings migration, no workspace data, no webview dependency on these scopes (grep-confirmed:
  only `package.json` + the two grammar files reference the removed scope names).