# Implement — ExternalChange component extraction

Task: `.trellis/tasks/08-04-webview-external-change-component`. Design decisions locked; do not re-litigate.

## Preconditions
- Branch `feat/webview-external-change-component` (base main, Toolbar merged). `npm run check-types` + tests green before.

## Checklist

1. **Study baseline** — read `src/webview/externalChangeUi.ts` (all 166 lines); its callers in `hexViewer.ts` (`applyExternalChangeUpdate`/`applyExternalChangeErrorUpdate`/lock invalidation); banner CSS rules in `styles/stats-bar.css`; `webview.test.ts` external-change assertions. Catalog ids/classes (ext-conflict-banner/ext-reload-banner/ext-error-banner, ecb-*/erb-*/eeb-* classes, ecb-reload/erb-reload/eeb-repair/eeb-view-text ids).
2. **Create component** `src/webview/components/ExternalChange/ExternalChange.ts`
   - `class ExternalChange` with `showConflict(incoming, count, onReload)`, `showReload(incoming, onReload)`, `showError(errors, malformed, canRepair, onRepair, onViewText)`, `clearAll()`. NO `S` import, no reload/repair logic, no `IncomingFile` mutation.
3. **Create `ExternalChange.css`** — move banner rules verbatim from `styles/stats-bar.css`; `import './ExternalChange.css'` in ExternalChange.ts.
4. **Create `src/webview/lock.ts`** — move `updateExternalChangeLockState` + disable/enable + forEachLockableRoot verbatim.
5. **Rewrite host** `hexViewer.ts` — replace externalChangeUi imports with `const externalChange = new ExternalChange()` calls; lock-state from `lock.ts`.
6. **Delete** `src/webview/externalChangeUi.ts`.
7. **Tests** `src/test/webview/components/external-change.test.ts` (mocha + jsdom + css-import-hook): render parity (ids/classes/text/entity icons), dismiss wiring (conflict/reload remove+callback; error callback-only), show-replaces-same-kind, clearAll, lock disable/enable round-trip.
8. **Validate**
   - `npm run lint`, `npm run check-types`, `npm run compile-tests`.
   - `npx mocha --ui tdd out/test/webview/components/external-change.test.js` + component batch + `webview.test.ts`.
   - `npm test` (full).
   - Fallow all-axes green.

## Review gates
- `webview.test.ts` external-change assertions pass unchanged (parity).
- `rg "externalChangeUi" src/` — none (deleted).
- `rg "S\.|saveEdits|reload|repair" src/webview/components/ExternalChange/` — only callback params, no logic.
- toolbar.css keeps no `.ext-*`/`.ecb-*`/`.erb-*`/`.eeb-*` rules; ExternalChange.css holds them.

## Rollback
- One commit; `git revert` restores externalChangeUi.ts + toolbar.css banner rules + host wiring.
