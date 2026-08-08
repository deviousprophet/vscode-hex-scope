# Implement — Integrity self-contained component

Task: `.trellis/tasks/08-04-webview-integrity-panel-component`. Behavior-preserving extraction at the sidebar panel seam (parent design locked; mirror the archived Struct task `archive/2026-08/08-04-webview-struct-panel-component/`).

## Preconditions
- Branch `feat/webview-integrity-component` (checked out from updated `main`). lint/check-types/webview tests green before.
- Read specs: `component-template.md`, `component-sidebar.md`, `component-sidebar-inspector.md` (sibling seam), `css-guidelines.md`, `state-management.md`, `integrity-checks.md`.

## Checklist

1. **Create `src/webview/components/IntegrityPanel/IntegrityPanel.ts`** — component class per `design.md`. Port code verbatim from `sidebar/integrity/index.ts` (~1100 LOC): profiles header (selector, save-as/rename/update/delete, fix-all, profile-name form), check cards (add/edit/delete forms, algorithm + address/stored inputs, auto-fix toggle, expand/collapse highlight), result panes (calculated/stored comparison, copy, status symbols, debounced calc + auto-fix suppression). All module-level state becomes instance fields. Remove `getByte`, `S`, `rerender`, `postProviderMessage` imports: byte reads via injected `readByte`; highlight exits via `onHighlightChange`; persistence exits via callbacks; selection via `getSelection`; auto-fix edits via `onStoredValueEdits`.
2. **Move `sidebar/integrity/integrityCheckModel.ts`** → `components/IntegrityPanel/integrityCheckModel.ts` (pure, unchanged). Update its importer + `integrity-check-model.test.ts` import path.
3. **Create `src/webview/components/IntegrityPanel/IntegrityPanel.css`** — move all rules from `styles/integrity.css`; `import './IntegrityPanel.css'`.
4. **Rewire host `hexViewer.ts`**
   - `const integrityPanel = new IntegrityPanel({ readByte: getByte, onStoredValueEdits: stageIntegrityEdits, onHighlightChange: applyIntegrityHighlight, onCopyText: ..., onPersistChecks: ..., onCreateProfile/onUpdateProfile/onRenameProfile/onDeleteProfile: ..., getSelection: ... });` per design.
   - Panel descriptor `{ id: 'integrity', label: 'Integrity', mount: root => integrityPanel.mount(root) }`.
   - Replace `renderIntegrity()` → `integrityPanel.render()`; `activateIntegrity` in `SIDEBAR_TAB_EFFECTS` → `integrityPanel.setTabActive(...)`; `setIntegrityProfiles` → `setProfiles`; `notifyIntegrityBytesChanged`/`notifyIntegrityEditsDiscarded`/`notifyIntegrityEndianChanged` → `notifyBytesChanged`/`notifyEditsDiscarded`/`notifyEndianChanged`; drop `setIntegrityEditHandler`.
5. **Delete moved code**: `sidebar/integrity/index.ts`, `integrityPersistence.ts` (after confirming no remaining imports), `styles/integrity.css` (emptied or deleted).
6. **Tests** `src/test/webview/components/integrity.test.ts` (see design.md); update `integrity-check-model.test.ts` import path.
7. **Add component spec** `component-sidebar-integrity-panel.md` under `src/../.trellis/spec/frontend/components/` (copy `component-template.md`, follow the struct/inspector spec style) + index row in `components` table.
8. **Validate**
   - `npm run lint`, `npm run check-types`, `npm run compile-tests`.
   - `npx mocha --ui tdd "out/test/webview/**/*.test.js"` (integrity + integrity-check-model + webview.test.ts integrity suite).
   - `npm test` (full).
   - Fallow: `total_issues 0`, `findings 0`, `clone_groups 0`.

## Review gates
- `Select-String "renderIntegrity|activateIntegrity|setIntegrity|notifyIntegrity" src/webview/hexViewer.ts` — empty (all on `integrityPanel.`).
- Component file contains no `S.`, `postProviderMessage`, `rerender`, `getByte`, or `state` import.
- `sidebar/integrity/` deleted; `styles/integrity.css` deleted or emptied.
- Markup/behavior parity: `webview.test.ts` `Integrity Checks sidebar` suite + `integrity-check-model.test.ts` pass unchanged.

## Rollback
- One commit; `git revert` restores inline rendering + host calls + `styles/integrity.css` rules.
