# Implement — Hex diff R7 per-side label context

**Precondition:** `hex-diff-surface-correctness` is merged and reviewed. Confirm `diffGrid.ts`,
`diffModel.ts`, `diffEditorPanel.ts` no longer have in-flight changes (shared files).

## 0. Baseline

- [ ] `npm run check-types`; `npm run lint`; `npm test`.
- [ ] Confirm the sibling child's shared row/cell + label seam (S9): decide whether to reuse it or add
  a local `buildLabelMap`.

## 1. Host label sourcing

- [ ] Add `boundFileLabels(root, relPath)` in `src/hexEditorSession.ts` (uses `boundProfileId` +
  `collectProfileRecords`).
- [ ] `src/diff/diffEditorPanel.ts`: add a `labelsFor(uri)` dependency (default = workspace-folder +
  `boundFileLabels`, defensive `try/catch → []`); thread labels into `diffSide(uri, parsed, labels)`.
- [ ] Do not touch `FILE_TOTAL`/`READ_SHARE`/progress.

## 2. Webview banners

- [ ] `src/webview/diff/diffGrid.ts`: build per-side label maps in `setDiffData`/`swapSides`; set
  `banners` in `toHexRow`'s data branch (skip `hidden`), mirroring `memoryGrid`.
- [ ] No new CSS/render path; reuse `.seg-banner`.

## 3. Tests

- [ ] Webview: fixture sides with labels → assert `.seg-banner` per pane at the right row; hidden label
  omitted; swap moves banners.
- [ ] Host: `boundFileLabels`/resolver — bound profile returns labels, none returns `[]`, a throw
  returns `[]` and does not block the compare.

## 4. Final check

- [ ] `npm run check-types`; `npm run lint`; `npm test`;
  `npx -y fallow audit --base origin/main --gate all`.
- [ ] Confirm AC1–AC6; cite R7/A1/B4 in the commit message.

## Risky files / rollback

- `src/diff/diffEditorPanel.ts` — threading a new dependency through `open` (test seams may need
  updating); keep the default path behavior-identical when no labels exist.
- `src/webview/diff/diffGrid.ts` — banner mapping must not change scroll-render cost; build maps once
  per `setDiffData`/`swapSides`.

## Follow-up checks before start

- [ ] Sibling child merged (dependency satisfied) — recorded here, not implied by tree order.
- [ ] Curate `implement.jsonl` / `check.jsonl` before dispatch.
