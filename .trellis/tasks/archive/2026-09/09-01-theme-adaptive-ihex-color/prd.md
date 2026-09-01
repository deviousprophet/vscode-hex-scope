# Theme-adaptive ihex/srec syntax highlighting (drop tokenColorCustomizations)

## Goal

Remove the broken `contributes.configurationDefaults` / `editor.tokenColorCustomizations`
block from `package.json` (schema validator rejects it — VS Code diagnostics show
`Incorrect type. Expected "object".` at `textMateRules`), and remap the ihex/srec
TextMate grammar scopes onto **standard scope names that the user's active color theme
colors** (hex-fmt approach), so syntax highlighting keeps working without hard-coded colors.

## Requirements

- `package.json` must no longer contain `contributes.configurationDefaults` or any
  `editor.tokenColorCustomizations` / `textMateRules` entry — the schema squiggle disappears.
- Both `syntaxes/intel-hex.tmLanguage.json` and `syntaxes/srec.tmLanguage.json` must produce
  colors from the active theme instead of fixed foreground hex values.
  - Malformed/unrecognized lines (`invalid`) must remain visually distinct.
- Highlighting must stay adaptive: same file renders readably on dark, light, and
  high-contrast themes (current hard-coded `#ce9178`/`#9cdcfe` are unreadable on light themes).
- No behavior change to record parsing/regex — only capture `name` scope values change.
- No feature requests beyond the removal; this task does not add themes, settings, or docs pages.

## Acceptance Criteria

- [ ] `package.json`: `contributes.configurationDefaults` removed; zero references to
      `tokenColorCustomizations`, `textMateRules`, `meta.ihex.*`/`meta.srec.*`,
      `punctuation.ihex.*`/`punctuation.srec.*` remain. File still valid JSON.
- [ ] `syntaxes/intel-hex.tmLanguage.json` + `syntaxes/srec.tmLanguage.json` are valid JSON,
      regexes unchanged, and every capture uses a scope from the mapping in `design.md`;
      no `meta.ihex.*` / `punctuation.ihex.*` / `meta.srec.*` / `punctuation.srec.*` remain.
- [ ] Malformed lines mapped to `invalid.illegal` for both grammars.
- [ ] Gates green: `npm run lint`, `npm run check-types`, `npm test`.
- [ ] CHANGELOG updated (Unreleased) noting the switch to theme colors + grammar-scope remap.
- [ ] Verified in running VS Code: Problems panel shows no package.json schema error, and a
      `.hex` + `.srec` sample file color under the active theme.

## Notes

- hex-fmt (keroc/hex-fmt, MIT) is the reference approach: no custom colors, scopes like
  `keyword.operator`, `constant.numeric`, `variable.parameter`, `entity.name.type`. Only the
  convention is reused — no code is copied, so no attribution obligation beyond normal etiquette.
- The hex editor (webview) is unaffected; it renders its own memory grid, not TextMate tokens.