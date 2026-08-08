# Extract Integrity panel into self-contained component

## Goal

Extract the Integrity sidebar panel from `src/webview/sidebar/integrity/` into a self-contained component at `src/webview/components/IntegrityPanel/{IntegrityPanel.ts,IntegrityPanel.css,integrityCheckModel.ts}`. Pure behavior-preserving refactor; no functional or visual change.

## Requirements

- Component owns all Integrity panel logic + styles, colocated in `src/webview/components/IntegrityPanel/`.
- Component owns the check list (add/edit/delete, algorithm selection, address/stored-value inputs, auto-fix toggle), per-check result display (calculated/stored comparison, copy), and the profile library (select/create/rename/update/delete, save-as, fix-all).
- Pure model `integrityCheckModel.ts` moves under the component directory unchanged (importers + tests updated).
- All rules from `styles/integrity.css` move verbatim to `IntegrityPanel.css`, imported by the component; shared styles stay global, per-component rules colocate.
- Component never imports the `S` state global, `state.ts`, `postProviderMessage`, `memory/memoryData`, or `rerender`. Cross-boundary effects (selection, highlight, edit staging, persistence, profile sync) exit via callbacks.
- Host (`hexViewer.ts`) owns `S.*` mutation, persistence messages, byte reads, edit staging, and rerender. Host wiring reuses the established panel-shell contract (`SidebarPanel` descriptor `{ id, label, mount }`).

## Acceptance Criteria

- [ ] `src/webview/components/IntegrityPanel/IntegrityPanel.ts` + `IntegrityPanel.css` + `integrityCheckModel.ts` exist; component class exposes mount/render/data/notify setters per design.
- [ ] `sidebar/integrity/index.ts`, `integrityPersistence.ts` deleted (or emptied) after host rewire; `styles/integrity.css` rules moved, file deleted/emptied.
- [ ] No functional or visual change: existing `integrity-check-model.test.ts` + `webview.test.ts` integrity suites pass unchanged.
- [ ] New component test file `src/test/webview/components/integrity.test.ts` covers render, check add/edit/delete, auto-fix toggle, result display, profile library actions, and parity via existing suites.
- [ ] `rg` gates from implement.md pass (no `S.` / `postProviderMessage` / `rerender` in component; no stale `renderIntegrity`/`activateIntegrity`/`setIntegrity*`/`notifyIntegrity*` calls in host).
- [ ] `npm run lint`, `npm run check-types`, `npm run compile-tests`, webview mocha suite, `npm test` all green. Fallow 0 findings.

## Notes

- Mirror the archived Struct panel task (`archive/2026-08/08-04-webview-struct-panel-component/`) — same seam, same artifact set, same review gates. Design decisions documented in `design.md`.
