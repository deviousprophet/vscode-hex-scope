# Implement — Inspector self-contained component

Task: `.trellis/tasks/08-04-webview-inspector-panel-component`. Behavior-preserving extraction at the sidebar panel seam (parent design locked; no re-litigation).

## Preconditions
- Branch `feat/webview-inspector-component` (base main, PR #161 merged). lint/check-types/webview tests green before.

## Checklist

1. **Create `src/webview/components/Inspector/Inspector.ts`** — component class with `mount(root)` rendering the four section shells, `setSelection`/`setSegments`/`setLabels`/`setEndian` data paths, `onJumpTo`/`onLabelsChange` callbacks. Port code verbatim from `sidebar/inspector/index.ts` (inspector addr/vals, bits, multi-byte, popcount, hover) and `sidebar/sidebar.ts` (segments, labels, label form, range/validation logic). Collapse-state, bit-hover, label-form UI state live in the component; `esc`/`fmtB`/`actionBtnsHtml`/`wireActionBtns` imported from `utils`.
2. **Create `src/webview/components/Inspector/Inspector.css`** — move `.insp-*`, `.bit-*`, `.mi-*`, `.segment-*`, `.label-*`, `.lf-*` panel rules from `styles/sidebar.css`; `import './Inspector.css'`.
3. **Rewire host `hexViewer.ts`**
   - `const inspector = new Inspector({ onJumpTo, onLabelsChange });` with `applyInspectorLabels` (S.labels + saveLabels + buildMemRows + rerender.labels + memory rerender).
   - Panel descriptor `mount: root => inspector.mount(root)`.
   - Replace `updateInspector()`/`updateLabelFormSel()` → `inspector.setSelection(S.selStart, S.selEnd)`; segments effect → `inspector.setSegments(S.parseResult?.segments ?? [])`; `rerender.labels` + struct-tab effect → `inspector.setLabels(S.labels)`; endian → `inspector.setEndian(S.endian)`.
4. **Delete moved code**: `sidebar/sidebar.ts`, `sidebar/inspector/index.ts` (after confirming no remaining imports; update `hexViewer.ts` imports + any test imports of `renderSegments`/`renderLabels`/`renderInspectorSections`/`updateInspector`/`updateLabelFormSel`).
5. **Tests** `src/test/webview/components/inspector.test.ts` (see design.md).
6. **Validate**
   - `npm run lint`, `npm run check-types`, `npm run compile-tests`.
   - `npx mocha --ui tdd "out/test/webview/**/*.test.js"` (webview.test.ts inspector/endian/segments parity + inspector.test.ts).
   - `npm test` (full).
   - Fallow: `total_issues 0`, `findings 0`, `clone_groups 0`.

## Review gates
- `rg "renderInspectorSections|updateInspector|renderSegments|renderLabels|updateLabelFormSel|renderBits" src/webview/hexViewer.ts` — empty (all on `inspector.`).
- `rg "S\.|postProviderMessage" src/webview/components/Inspector/Inspector.ts` — empty.
- `sidebar.ts` + `sidebar/inspector/index.ts` deleted; `styles/sidebar.css` keeps only non-inspector panel rules.
- Markup/behavior parity: webview.test.ts inspector/endian/tab-round-trip/segments suites pass unchanged.

## Rollback
- One commit; `git revert` restores inline rendering + host calls + sidebar.css rules.
