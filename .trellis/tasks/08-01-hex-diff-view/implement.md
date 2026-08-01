# Implementation: Hex Diff View

Task: `08-01-hex-diff-view` · Branch: `feat/hex-diff-view`

## Ordered Checklist

1. **`src/core/diff.ts`** — pure diff engine (`DiffResult`, union rows, status map, summary, runs). No `vscode`/DOM imports.
2. **Tests for core** — `src/test/core/diff.test.ts`: statuses, union rows + gaps, summary counts, run extraction, address `0`/huge gaps/empty results, cross-format pairs. Pair-URI encode/decode round-trip tests.
3. **Protocol** — `src/webviewProtocol.ts`: add `diffInit`, `diffUpdate`, `diffSwap`, `diffSearch` discriminators. Update `webviewMessageDispatcher.ts` + `webviewMessageModel.ts` (or diff equivalents). Add dispatch + unknown-message no-op tests.
4. **`src/hexDiffProvider.ts`** — `CustomReadonlyEditorProvider` viewType `hexScope.hexDiff`, virtual doc with pair-keyed URI, `retainContextWhenHidden`. Register in `src/extension.ts`.
5. **`src/hexDiffSession.ts`** — parse both files, run `core/diff`, serialize `diffInit`, wire external-change watchers + 200ms debounce → `diffUpdate`, read per-uri labels (union + side tags), host-side search handler (both sides, union matches).
6. **Staging commands + decoration** — `hexScope.compareSelected` / `hexScope.selectAsFirst` / `hexScope.compareToStaged`, ephemeral staging state, `FileDecorationProvider` badge (D18), D8/D9 validation on open, identical/unparseable live states (D15).
7. **`package.json`** — new custom editor entry, 3 commands, explorer/editor-title menus with `resourceLangId =~ /^(intel-hex|srec)$/`, keybindings `Alt+↓/↑`.
8. **Webview** — `src/webview/hexDiffViewer.ts` + `diff/` modules: two panels, shared label rail, summary bar, next/prev, swap (position-only, side tags A/B), union search UI reusing search controls/engine glue.
9. **Extension tests** — command registration + staging lifecycle.

## Validation Commands

- `npm run check-types` (tsc)
- `npm run lint` (eslint)
- `npm test` (all suites; new core/webview/extension tests included)
- Manual: open pair via Compare Selected; verify swap keeps A/B tags; edit a file externally → diffUpdate; identical → "identical" state; unparseable → per-panel error.

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
