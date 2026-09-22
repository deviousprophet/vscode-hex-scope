# Design — Hex diff external-change reload

## Boundaries

- **Extension host:** `src/diff/diffEditorPanel.ts` (watcher registration + reload orchestration),
  `src/diffProtocol.ts` (new messages), `src/extension.ts` (text-editor open + repair wiring, if not
  already exposed).
- **Webview diff surface:** `src/webview/diff/diffMessages.ts` (dispatch), `src/webview/diffViewer.ts`
  (banner wiring), `src/webview/diff/diffGrid.ts` (reload apply that preserves view state).
- **Reused shared component:** `src/webview/components/externalChange/externalChange.ts` — relax its
  `IncomingFile` dependency so the isolated diff bundle can import it.
- **Single-file parity:** the component change must not alter the hex view's behavior or tests.

## Data flow (chosen: banner-and-click)

```
fsWatcher(change/create) → 200ms debounce → read+parse changed side
   ├─ parse errors → post `diffExternalChangeError` { generation, a?, b?, checksumErrors, malformedLines, canQuickRepair }
   └─ ok           → recompute diff, post `diffExternalChange` { generation, a, b, diff }
webview: show `ExternalChange.showReload(pending, onReload)`
   on click → post `reloadAccepted` → apply pending locally (preserve view state)
webview error banner → post `repairAndReload` | `viewInNormalEditor`
```

Eager parse on change is deliberate (parity with `hexEditorSession.ts:818-860`) — it is what lets the
host classify the change as reload-vs-error before the user clicks, and mirrors the hex view's
`externalChange` / `externalChangeError` split.

## Protocol (extends `src/diffProtocol.ts`)

Add to `DiffProviderToWebview`:
```ts
| { type: 'diffExternalChange'; generation: number; a: DiffSide; b: DiffSide; diff: DiffModel }
| { type: 'diffExternalChangeError'; generation: number; side: 'a' | 'b'; checksumErrors: number; malformedLines: number; canQuickRepair: boolean }
```
Add to `DiffWebviewToProvider`:
```ts
| { type: 'reloadAccepted' }
| { type: 'repairAndReload' }
| { type: 'viewInNormalEditor' }
```
`diffExternalChange` reuses the `diffInit` payload shape, so no new `DiffSide`/`DiffModel` types. The
host carries the payload (not just a flag) so the click is instant and the webview never re-parses.

## Host — watcher + reload

- In `DiffEditorPanel.open`, after the panel/cleanup registration (before the first await), create one
  watcher per compared URI: `vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(dir, base))`,
  add both to the `resources` `DisposableStore` (so dispose cancels them).
- `onDidChange`/`onDidCreate` → `debounce(200ms)` → `reloadSide(side)`:
  - `readDiffSource(uri)` + `parseSideInWorker` (reuse the existing per-side path).
  - On checksum/malformed → post `diffExternalChangeError` with `side`, counts, `canQuickRepair =
    malformedLines === 0`; do not touch the current view.
  - Else recompute `computeByteDiff` over both current sides (the other side is unchanged) and post
    `diffExternalChange` with a bumped `generation`.
  - Guard stale reloads with the existing `generation`/`isStale` idiom.
- `repairAndReload` → run the same repair path the hex view uses (`repairTargetChecksums` /
  `quickRepair` on the affected URI), then re-post `diffExternalChange` on success or
  `diffExternalChangeError` on failure.
- `viewInNormalEditor` → `vscode.window.showTextDocument(uri)`.
- No self-write horizon is needed (the diff host never writes the compared files); if a repair writes
  via the host, reuse the hex view's own-write suppression so the follow-up watcher event is ignored.
- Deletion: a read failure is caught and surfaced as `diffExternalChangeError`-style "unreadable"
  (or ignored) — decide in implementation; do not crash the panel.

## Webview — banner wiring + apply

- `diffMessages.ts`: add structural guards for `diffExternalChange` / `diffExternalChangeError`
  (reuse `isDiffSide`/`isDiffModel` from the correctness child); unknown/malformed → `false`.
- `diffViewer.ts`: build a pending payload; on `diffExternalChange` show
  `ExternalChange.showReload(pending, onReload)`; on `diffExternalChangeError` show
  `ExternalChange.showError(checksumErrors, malformedLines, canQuickRepair, onRepair, onViewText)`.
  `onReload` applies the pending payload **and** posts `reloadAccepted`.
- `diffGrid.ts`: add `applyReload(a, b, diff)` that **preserves `viewMode` and the current scroll
  position** and **resets selection + search matches** (addresses may have changed), unlike
  `setDiffData` which resets everything. This is the R5 contract.

## Component decoupling (reuse, do not fork)

`ExternalChange.showConflict`/`showReload` currently take `IncomingFile` from `appModel.ts` (which
imports `state.ts`). The component only forwards `incoming` to its `onReload` callback and never
inspects it. Change the two methods to be generic:

```ts
showConflict<T>(incoming: T, unsavedEditCount: number, onReload: (incoming: T) => void): void;
showReload<T>(incoming: T, onReload: (incoming: T) => void): void;
```

and drop the `appModel` import. The single-file host call sites keep working unchanged (type
inference), and the isolated diff bundle can import the component without pulling in `state.ts`. The
component stays markup/behavior-identical — `externalChange.test.ts` is the parity gate.

## View-state preservation (R5)

| State | On reload |
|---|---|
| `viewMode` (`Show all`/`Show diff`) | preserved |
| scroll position (per pane) | preserved when the logical address still exists, else clamped to the nearest row |
| selection | reset (addresses may have shifted) |
| search matches / active index | reset (stale against new bytes) |
| `Sync scroll` flag | preserved |

## Compatibility / rollback

- Additive protocol variants; the webview only acts on messages it knows. No storage/migration change.
- Rollback = remove the watchers + the new message variants; the diff returns to load-once.
- Risk: re-parsing on every save of a large pair. Mitigate with the 200 ms debounce and by re-parsing
  only the changed side (the other side is reused); document that a reload does not show a loading card
  (parity with the hex view's silent external reload).

## Validation

- `npm run check-types`, `npm run lint`, `npm test`;
  `npx -y fallow audit --base origin/main --gate all`.
- New tests: extension-level watcher/reload test (simulate a file write → assert `diffExternalChange`
  posted; broken write → `diffExternalChangeError`), webview `diffViewer.test.ts` (dispatch of the new
  messages, reload banner shown, accept applies + posts `reloadAccepted`, view mode/scroll preserved,
  selection/search reset), and `externalChange.test.ts` parity for the generic signature.
