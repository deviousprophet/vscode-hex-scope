# Implementation: Hex Diff View

Task: `08-01-hex-diff-view` · Branch: `feat/hex-diff-view`

## Ordered Checklist

1. **`src/core/diff.ts`** — pure diff engine (`DiffResult`, union rows, status map, summary, runs). No `vscode`/DOM imports.
2. **Tests for core** — `src/test/core/diff.test.ts`: statuses, union rows + gaps, summary counts, run extraction, address `0`/huge gaps/empty results, cross-format pairs. Pair-URI encode/decode round-trip tests.
3. **Protocol** — `src/webviewProtocol.ts`: add `diffInit`, `diffUpdate`, `diffSwap`, `diffSearch` discriminators. Update `webviewMessageDispatcher.ts` + `webviewMessageModel.ts` (or diff equivalents). Add dispatch + unknown-message no-op tests.
4. **`src/editor/hexDiffProvider.ts`** — `CustomReadonlyEditorProvider` viewType `hexScope.hexDiff`, virtual doc with pair-keyed URI, `retainContextWhenHidden`. Register in `src/extension.ts`. Extends shared `ReadonlyEditorProviderBase` (`src/editor/readonlyEditorProvider.ts`).
5. **`src/editor/hexDiffSession.ts`** — parse both files, run `core/diff`, serialize `diffInit`, wire external-change watchers + 200ms debounce → `diffUpdate`, host-side search handler (both sides, union matches).
6. **Staging commands + decoration** — `hexScope.compareSelected` / `hexScope.selectAsFirst` / `hexScope.compareToStaged`, ephemeral staging state, `FileDecorationProvider` badge, pair validation on open (same-file refused; identical shows identical-state), live per-panel error states.
7. **`package.json`** — new custom editor entry, 3 commands, explorer/editor-title menus with `resourceLangId =~ /^(intel-hex|srec)$/`; `hexScope.compareSelected` in the `hexScope.actions` submenu gated by `listDoubleSelection`, staging items gated by `!listMultiSelection` (single select); no staging keybindings (menu-only flow; bare `Alt+↓/↑` reserved for diff-view navigation).
8. **Webview** — `src/webview/hexDiffViewer.ts` + `diff/` modules: two panels, summary bar, next/prev, swap (position-only, side tags A/B), union search UI (mode + endianness), per-panel selection + Ctrl+C copy (hex), per-panel parse-error state. **UI pass (R8):** `src/webview/styles/diff.css` loaded with `base.css` in `_getHtml`, `#status` present, CSP `unsafe-inline`, status colors amber/green/red + A/B accents blue/orange, visible gutter between panels. **Virtual scroll (R9):** 16-byte visual rows grouped from per-address rows (`groupVisualRows`), absolute `top: index × DIFF_ROW_HEIGHT`, flex-sized scroll container, no translateY, scrollTop restore on re-render.
9. **Extension tests** — command registration, staging lifecycle, multi-select `Uri[]`, readable tab title.
10. **UI/UX verification (AC9/AC10/AC11/AC24)** — diff opens styled like the hex editor, scroll is smooth, no console errors at bootstrap, loading/error/identical states render styled.
11. **Bug-fix + gap pass (TDD)** — clean test runs (`npm run clean` in pretest), readable diff tab title, Compare Selected menu entry + `Uri[]` handling, Alt+↓/↑ diff-nav (webview) + staging moved to Ctrl+Alt, per-address→visual-row grouping fix (critical), per-cell match highlight, search mode/endianness, per-panel parse-error state, per-panel selection + copy. New tests: `diff-renderer.test.ts`, `package-config.test.ts`, extension title/multi-select tests.

## Validation Commands

- `npm run check-types` (tsc)
- `npm run lint` (eslint)
- `npm run build` (esbuild bundles webview + diff CSS is copied/available)
- `npm test` (all suites; new core/webview/extension tests included)
- Manual: open pair via Compare Selected; verify swap keeps A/B tags; edit a file externally → diffUpdate; identical → "identical" state; unparseable → per-panel error. Verify the diff view is styled like the hex editor (R8), scroll is smooth (no frozen viewport, AC10), and the webview console is error-free at bootstrap (AC11).

## Risky Files / Rollback Points

| File | Risk | Rollback |
|---|---|---|
| `src/webviewProtocol.ts` + 4 seam files | Protocol change touches every seam | Revert protocol commit; keep core diff + tests |
| Pair-URI encoding | Round-trip failure → duplicate tabs | Unit-test round-trip before wiring commands |
| `src/webview/hexDiffViewer.ts` virtual scroll | Two-panel alignment under gaps | Covered by core tests + manual gap case |
| `src/extension.ts` staging | Ephemeral state leaks | Module-level state, cleared on open |

## Follow-up Checks Before `task.py start`

- [ ] PRD convergence pass done (no duplicate facts, no blocking open questions).
- [ ] Final planning summary shown; user explicitly approved.
- [ ] `task.py set-branch 08-01-hex-diff-view feat/hex-diff-view` (verify branch stamped in task.json).
- [ ] `task.py start 08-01-hex-diff-view`.
