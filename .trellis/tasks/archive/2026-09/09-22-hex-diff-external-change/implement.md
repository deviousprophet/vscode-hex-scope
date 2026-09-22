# Implement — Hex diff external-change reload

Precondition: `hex-diff-surface-correctness` is archived (done 2026-09-22). Confirm
`hex-diff-r7-label-context` has not started — both touch `src/diff/diffEditorPanel.ts`; sequence them.

Ordered checklist. One commit per numbered group; keep `check-types`, `lint`, `test` green after each.

## 0. Baseline

- [ ] `npm run check-types`; `npm run lint`; `npm test`.
- [ ] Re-read the hex-view reference: `src/hexEditorSession.ts:802-866` (watcher + classification),
  `src/webview/hexViewer.ts:1168-1177` (apply-on-click), `src/webview/components/externalChange/`.

## 1. Component decoupling (reuse, not fork)

- [ ] `src/webview/components/externalChange/externalChange.ts`: make `showConflict`/`showReload`
  generic over the incoming payload and remove the `appModel` `IncomingFile` import.
- [ ] Verify `externalChange.test.ts` green; single-file call sites (`hexViewer.ts:1098,1100`)
  unchanged.

## 2. Protocol

- [ ] `src/diffProtocol.ts`: add `diffExternalChange`, `diffExternalChangeError` (provider) and
  `reloadAccepted`, `repairAndReload`, `viewInNormalEditor` (webview).
- [ ] `src/webview/diff/diffMessages.ts`: add structural guards; dispatch the two new provider
  messages; malformed → `false`.

## 3. Host watcher + reload

- [ ] `src/diff/diffEditorPanel.ts`: register one `FileSystemWatcher` per compared URI into the
  `DisposableStore`; 200 ms debounce; re-read + parse only the changed side; on success recompute the
  diff and post `diffExternalChange` (bumped generation); on checksum/malformed post
  `diffExternalChangeError` with `side` + `canQuickRepair`. Ignore stale generations.
- [ ] Handle `repairAndReload` (repair the URI, then re-post) and `viewInNormalEditor`
  (`showTextDocument`); suppress the self-write echo.
- [ ] Read failure → surface as an unreadable/error state; never crash the panel.

## 4. Webview banner + apply

- [ ] `src/webview/diffViewer.ts`: on `diffExternalChange` show
  `ExternalChange.showReload(pending, onReload)`; on `diffExternalChangeError` show
  `ExternalChange.showError(...)`; `onReload` applies the pending payload and posts `reloadAccepted`.
- [ ] `src/webview/diff/diffGrid.ts`: add `applyReload(a, b, diff)` preserving `viewMode` + per-pane
  scroll and resetting selection/search (R5 table in `design.md`).

## 5. Tests

- [ ] Extension: simulate an external write while the panel is open → assert a `diffExternalChange`
  post with the new bytes; a broken write → `diffExternalChangeError` with the right `side`/flags.
- [ ] Webview: dispatch the new provider messages; assert the reload banner appears, accept applies the
  new rows and posts `reloadAccepted`, view mode + scroll survive, selection/search reset; error banner
  actions post `repairAndReload`/`viewInNormalEditor`.
- [ ] `externalChange.test.ts`: generic-signature parity.

## 6. Final check

- [ ] `npm run check-types`; `npm run lint`; `npm test`;
  `npx -y fallow audit --base origin/main --gate all`.
- [ ] Confirm AC1–AC7; cite C6/R8 in the commit message.

## Risky files / rollback

- `src/diff/diffEditorPanel.ts` — watcher lifecycle/dispose must ride the existing `DisposableStore`;
  the panel must not leak a watcher if disposed mid-load.
- `src/webview/components/externalChange/externalChange.ts` — shared with the hex view; parity test is
  the guard.
- `src/webview/diff/diffGrid.ts` — reload apply must not regress the per-pane scroll state from the
  correctness child.

## Follow-up checks before start

- [ ] `hex-diff-r7-label-context` not in flight.
- [ ] Curate `implement.jsonl` / `check.jsonl` before dispatch (already seeded).
