# Reuse the parse worker for the hex editor and extract a shared loading card

## Goal

Make one parse worker module serve both editor surfaces — the diff panel (already
offloaded) and the single-file hex editor (currently parsed on the extension-host
thread) — and collapse the duplicated loading card (markup, CSS, progress-label
formatting) into a single reuse seam consumed by both surfaces.

Value: the hex editor stops doing CPU-heavy compact parsing on the extension-host
main thread, and the loading card stops existing as three divergent copies.

## Background (confirmed facts)

- Diff parses each side in its own Node `worker_threads` worker:
  `src/diff/diffParseWorker.ts` → `dist/diffParseWorker.js`, job
  `{ kind: 'diffParse'; bytes: ArrayBuffer; extension: string }`, progress
  `{ type: 'progress'; fraction }`, result `{ type: 'result'; format; wire }`
  (segment buffers transferred). Spawned by `parseSideInWorker`
  (`src/diff/diffEditorPanel.ts:302`); the module is import-safe behind the
  `kind` sentinel because the extension host can itself be a worker thread.
- The hex editor parses **on the extension-host thread** at two sites, both
  returning `CompactParseResult`:
  `loadInitialDocument` → `parseCompactSafely` → `parseCompactByFormat`
  (`src/hexEditorSession.ts:238`, `:165`), and `onExternalChange` →
  `parseCompactSource` (`src/hexEditorSession.ts:782`). Both decode the file to a
  source string first and keep it as `raw` for splicing, record pages, and repair.
- `CompactParseResult.records` is a `CompactRecordStore`
  (`src/core/parser/compact.ts:118`): a class with a private constructor and
  private typed-array metadata pages; `materialize(index, source, parseLine)`
  re-slices the host-held source. It is **not** structured-clone-safe as-is.
- Diff's `WireParseResult` (`src/core/wire.ts`) carries segment buffers but no
  per-record source ranges, so it cannot drive the hex record view, line
  splicing, or checksum repair.
- Loading card duplication:
  markup in three places (`src/diff/diffEditorPanel.ts:409`,
  `src/hexEditorSession.ts:1236`, `src/webview/hexViewer.ts:1341`); CSS in two
  (`src/webview/styles/base.css:79-145` and the inline `<style>` at
  `src/hexEditorSession.ts:1221-1228`, a full duplicate); label formatting in
  two (`src/webview/hexViewer.ts:940` and `src/webview/diff/diffGrid.ts:686`).
- `base.css` already contains the complete card + indeterminate bar + keyframes
  and is linked by **both** host shells (`diffHtml` links it directly; the hex
  shell lists `base` in `cssFiles`), so it is the natural single CSS owner.
- Build: esbuild bundles the diff worker separately (`esbuild.js:67-83`,
  outfile `dist/diffParseWorker.js`); `npm test` compiles the tree to `out/`, and
  `src/test/core/diffParseWorker.test.ts` spawns the compiled worker from
  `out/diff/diffParseWorker.js`.
- Layer convention: extension-host files never import from `src/webview/`
  (`src/diff/diffEditorPanel.ts` keeps a private `escapeHtml` instead of reusing
  `src/webview/utils.ts#esc`). Runtime-neutral *logic* lives in `src/core/`; UI
  markup does not (the audit found `src/core/` otherwise free of any HTML/DOM).
- Pre-existing violation: `src/test/core/struct.test.ts` and
  `src/test/shared/structTestHelpers.ts` import `src/webview/state` and
  `src/webview/memory/memoryData`; `decodeStruct` already takes a `getByte`
  callback, so the coupling is only in the test harness.

## Requirements

- **R1 — One worker, two job kinds.** A single worker module dispatches on the
  job `kind` sentinel: the existing `diffParse` and a new `hexParse`. The diff
  job and its wire result stay behaviorally identical.
- **R2 — Hex parses off the host thread.** Both hex host parse sites (initial
  load and external-change reload) run through the worker. No host-thread
  `parseIntelHexCompact` / `parseSRecCompact` call remains in `HexEditorSession`.
- **R3 — Cloneable hex result.** Worker → host hex result is a plain, cloneable
  serialized compact parse result (record-metadata pages + segment buffers +
  counts + start address + format) that the host hydrates back into a
  `CompactParseResult`. The raw source string stays host-side.
- **R4 — Transfer + lifecycle.** Segment and metadata buffers are transferred
  zero-copy. A superseding load, an aborted `AbortController`, or panel disposal
  terminates the worker, and a stale generation posts nothing.
- **R5 — Progress parity.** Hex load progress keeps its current stage names
  (`parse`, `build`) and integer-percent rendering, but is throttled inside the
  worker so one post per source line never crosses the thread boundary.
- **R6 — One loading card, UI-side.** The card is a webview-layer UI concern and
  does not live in `src/core/`: the single progress-label formatter lives in the
  webview (`src/webview/utils.ts`) and `base.css` is the single CSS source. The
  host boot shells keep their own small static card markup (they differ in title
  and text and must exist before webview JS runs); the hex webview error card
  keeps its inline markup. The rendered card and the `Loading <stage> <pct>%…`
  text stay visually identical.
- **R7 — One host worker client.** The spawn / abort / settle-once / terminate /
  message-relay logic is one shared host module used by both `diffEditorPanel`
  and `hexEditorSession`.
- **R8 — Core tests stay core.** `src/test/core/struct.test.ts` and
  `src/test/shared/structTestHelpers.ts` must not import `src/webview/`; the
  struct decode tests build their own byte harness instead of borrowing webview
  `S`/`getByte`.

## Acceptance Criteria

- [ ] **AC1** `npm run check-types`, `npm run lint`, and `npm test` all pass.
- [ ] **AC2** Diff behavior is unchanged: existing diff suites
  (`diffViewer.test.ts`, `diffLoadProgress.test.ts`, `diffReload.test.ts`,
  `extension.test.ts`) pass with only the worker module/import path updated.
- [ ] **AC3** A worker test proves `hexParse`: IHEX and SREC fixtures produce the
  expected transferred segment bytes and record metadata, metadata hydrates and
  `materialize()` round-trips against the source, progress is monotonic and
  throttled, and an invalid job posts `{ type: 'error' }`.
- [ ] **AC4** Hex editor initial load, external-change reload, and quick repair
  behave as today: record pages materialize, checksum repair works, and saves
  splice correctly — with no host-thread compact parse.
- [ ] **AC5** Disposing the panel or superseding a load terminates the worker,
  aborts the controller, and posts nothing for the stale generation.
- [ ] **AC6** The loading card renders identically on both surfaces (same
  classes, same structure, same percentage text), and the hex error card still
  renders its card.
- [ ] **AC7** No duplicated loading-card CSS remains (the hex inline `<style>`
  is gone; `base.css` is the sole owner) and no duplicated progress-label
  formatter remains (one webview `loadingProgressLabel`). No UI/card code lives
  in `src/core/`.
- [ ] **AC8** `src/test/core/struct.test.ts` and
  `src/test/shared/structTestHelpers.ts` import nothing from `src/webview/`; the
  struct suites still pass with the same assertions.

## Out of Scope

- The in-editor toolbar progress indicator (`#search-progress`, `#load-progress`)
  — a separate post-load surface.
- Any change to diff's visible behavior, progress fractions, or wire shape.
- Changing parser semantics, format detection rules, or the `CompactParseResult`
  data model beyond adding serialize/hydrate.
- Renaming `.loading-*` classes or restyling the card.

## Technical Notes

- Implementation design, module layout, worker protocol, and trade-offs:
  `design.md`.
- Execution order, validation commands, and rollback points: `implement.md`.

## Open Questions

None blocking.
