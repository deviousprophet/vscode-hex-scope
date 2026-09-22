# Design — Hex diff R7 per-side label context

## Boundaries

- **Extension host:** label sourcing and `diffSide` — `src/diff/diffEditorPanel.ts`,
  `src/hexEditorSession.ts` (new resolver export).
- **Webview diff surface:** banner construction — `src/webview/diff/diffGrid.ts` (+ `diffModel.ts`
  import only). Render path unchanged (`hexViewRender.ts`).
- **No protocol change:** `DiffSide.labels` already exists; the host just stops sending `[]`.

## Data flow (target)

`DiffEditorPanel.open` → per side: resolve bound-profile labels `boundFileLabels(root, relPath)` →
`diffSide(uri, parsed, labels)` → `diffInit { a, b, diff }` → `hydrateDiffSide` (copies `labels`) →
`setDiffData` → `buildDiffRows`/`toHexRow` attaches `banners` → `renderBanner` → `.seg-banner`.

## Host — source labels

Add an exported resolver in `src/hexEditorSession.ts` (compose existing exports; no new storage):

```ts
export async function boundFileLabels(root: string, relPath: string): Promise<SegmentLabel[]> {
    const id = await boundProfileId(root, relPath);          // hexEditorSession.ts:1338
    if (!id) { return []; }
    const records = await collectProfileRecords(root);       // hexScopeStorage.ts:209
    return records.find(r => r.id === id)?.labels ?? [];
}
```

- In `diffEditorPanel`, resolve each side's labels concurrently with its parse (keeps the read/parse
  latency unchanged):
  - `root = vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath`; if absent → `[]`.
  - `relPath = path.relative(root, uri.fsPath)`; `labels = await boundFileLabels(root, relPath)`.
  - Wrap in `try { … } catch { return []; }` so label problems never fail the compare (AC3).
- Inject the resolver as a dependency for testability: `DiffEditorPanel.open(context, base, other,
  deps: { labelsFor(uri): Promise<SegmentLabel[]> } = { labelsFor: defaultLabelsFor })`. Change
  `diffSide(uri, parsed)` → `diffSide(uri, parsed, labels)`.
- Do **not** change `loadBothSides`' progress accounting (`FILE_TOTAL`, `READ_SHARE`) — labels are a
  metadata read, not part of the read/parse progress.

## Webview — build banners

- `diffGrid` already receives per-side data; add a per-side label map keyed by row base, mirroring
  `memoryGrid.buildLabelMap` (`:339-344`): skip `hidden`, key `startAddress - (startAddress % BYTES_PER_ROW)`.
  Reuse the sibling child's shared seam if it extracted a label-map/row builder (S9); otherwise a small
  local `buildLabelMap(labels)`.
- `toHexRow(row, side, sideData)` data branch sets `banners: (labelMap.get(row.address) ?? []).map(l => ({
  name, start: l.startAddress, length: l.length, color: l.color }))` — the same shape memoryGrid emits
  (`:290-295`). Gap rows carry no banners.
- Build the maps once in `setDiffData`/`swapSides` (per-side), not per render, so scroll re-render
  cost is unchanged. On `swapSides`, `data.a`/`data.b` swap and the maps are rebuilt for the new sides.
- No new CSS: reuse `.seg-banner` (`hexView.css:177-185`).

Trade-off: storing label maps on `DiffGridData` (per side) is simpler than recomputing from
`sideData.labels` each render and avoids per-frame `Map` churn in compressed large-file mode.

## Testability

- Host: extract a pure `labelsFor`/`boundFileLabels` so a unit test can drive bound profile / no
  profile / throw cases without a webview. The extension test asserts `diffSide`/`loadBothSides`-level
  label threading (or the resolver directly).
- Webview: `diffViewer.test.ts` mounts with fixture sides carrying `labels` and asserts `.seg-banner`
  presence per pane + hidden-label omission + swap behavior.

## Compatibility / rollback

- No wire, storage, or migration change. Labels are read-only; removing the feature = restore
  `labels: []` and drop the banner mapping. Isolated to the label path.

## Validation

- `npm run check-types`, `npm run lint`, `npm test`;
  `npx -y fallow audit --base origin/main --gate all`.
- New tests: `src/test/webview/diffViewer.test.ts` (per-side banners, hidden skipped, swap);
  `src/test/extension/` for label sourcing (bound / none / failure).
