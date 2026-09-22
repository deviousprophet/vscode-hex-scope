# Implementation plan — shared parse worker + shared loading card

## 0. Preconditions

- Branch `feat/shared-parse-worker` (set on the task).
- Read before coding: `.trellis/spec/frontend/directory-structure.md`,
  `editor-lifecycle.md`, `document-formats.md`, `css-guidelines.md`,
  `quality-guidelines.md`; guides `code-reuse-thinking-guide.md`,
  `cross-layer-thinking-guide.md`.

## 1. Shared worker module (diff stays green)

- [ ] Move `src/diff/diffParseWorker.ts` → `src/parse/parseWorker.ts`; keep the
      import-safe `kind` sentinel and the pure fraction helpers
      (`BUILD_FLOOR`, `LoadFraction`, `INITIAL_LOAD_FRACTION`, `stageFraction`,
      `nextLoadFraction`) exported.
- [ ] Introduce the `ParseJob` / `WorkerOut` unions (§3 of `design.md`); keep the
      `diffParse` path and messages identical.
- [ ] Add the `hexParse` branch: parse via `parseIntelHexCompact`/`parseSRecCompact`,
      thin progress to integer percent per stage, post the serialized compact
      result with segment + page buffers transferred.
- [ ] Update `esbuild.js` entry/outfile: `src/parse/parseWorker.ts` →
      `dist/parseWorker.js`.
- [ ] Validation: `npm run check-types`, `npm run lint`.

## 2. Shared host client

- [ ] Add `src/parse/parseWorkerClient.ts` with `runParseJob<T>(...)` (spawn,
      `settle`-once, abort→terminate, error→reject, transferList relay).
- [ ] Rewrite `src/diff/diffEditorPanel.ts` `parseSideInWorker` +
      `WORKER_MESSAGE_HANDLERS` + `handleWorkerMessage` to use `runParseJob`;
      keep `acceptParsedSide`, `assertNoParseDefects`, and the error strings.
- [ ] Update `src/test/core/diffParseWorker.test.ts` → `parseWorker.test.ts`:
      new `WORKER_PATH`, keep all diff assertions, add the `hexParse` cases.
- [ ] Validation: `npm run compile-tests` then `npm test` (diff suites green).

## 3. Compact serialize / hydrate

- [ ] Add `serializePages()` + `static fromSerialized()` to `CompactRecordStore`
      and the exported `serializeCompactParseResult` / `hydrateCompactParseResult`
      in `src/core/parser/compact.ts`.
- [ ] Extend `src/test/core/parser/compactParser.test.ts`: serialize → hydrate →
      `materialize()` round-trips record metadata against the source (IHEX + SREC),
      and segment bytes survive the `ArrayBuffer` transfer shape.
- [ ] Validation: `npm test` (compact suite green).

## 4. Hex offload (`src/hexEditorSession.ts`)

- [ ] Change `readDocumentSource` to also return the raw bytes/buffer while
      preserving `loadError` handling.
- [ ] Replace `parseCompactByFormat` / `parseCompactSafely` with
      `parseHexInWorker(raw, extension, signal, onProgress)`; hydrate the result
      and adopt the worker-reported `format`.
- [ ] Route `loadInitialDocument` and `parseCompactSource` through it; keep the
      `activeLoad.abort()` + generation semantics (abort now terminates the worker).
- [ ] Leave `materializeParseResult`, `materializeRecordPage`, `repairChecksums`,
      and splice/save paths untouched.
- [ ] Validation: `npm run check-types`, `npm run lint`, `npm test`
      (`extension.test.ts` + provider/parser suites).

## 5. Loading card dedup (webview-only)

- [ ] Delete `src/core/loadingCard.ts` (UI does not belong in core) and
      `src/test/core/loadingCard.test.ts`.
- [ ] Move `loadingProgressLabel(stage, completed, total?)` into
      `src/webview/utils.ts` (unchanged behavior); add its cases to
      `src/test/webview/utils.test.ts`.
- [ ] `src/webview/hexViewer.ts`: revert `renderLoadError` to its inline card
      markup; `loadProgressLabel` delegates to `loadingProgressLabel` from
      `./utils`.
- [ ] `src/webview/diff/diffGrid.ts`: import `loadingProgressLabel` from
      `../utils`.
- [ ] `src/diff/diffEditorPanel.ts#diffHtml` and
      `src/hexEditorSession.ts#_getHtml`: revert to their own static card markup
      and drop the core import. Keep the hex inline `<style>` **deleted**
      (`base.css` is the single CSS owner).
- [ ] Keep the `.loading-shell[hidden]` stylesheet guard in
      `src/test/webview/diffViewer.test.ts` passing.
- [ ] Visual check: diff card and hex card render identically (classes,
      eyebrow/title/text, indeterminate bar).

## 5b. Core test decoupling

- [ ] `src/test/shared/structTestHelpers.ts`: drop the
      `src/webview/state` + `src/webview/memory/memoryData` imports; hold a local
      byte map and export `setBytesInSegment` + `getByte` (see design §11).
- [ ] `src/test/core/struct.test.ts`: import the harness from
      `../shared/structTestHelpers`; replace `S.structs` defs arguments with a
      local `structs` array; drop the `S`-writing `resetStructState`.
- [ ] Validation: `npm run check-types`, `npm run lint`, `npm test` (struct
      suites green, same assertions).

## 6. Specs

- [ ] Update `directory-structure.md` module map (`src/parse/`, `src/core/loadingCard.ts`).
- [ ] Update `document-formats.md` with the serialize/hydrate contract.
- [ ] Update `editor-lifecycle.md`: shared worker kinds, `hexParse` offload,
      hex worker result, shared host client.
- [ ] Update `css-guidelines.md`: loading card CSS owned by `base.css`.
- [ ] Update `.trellis/spec/frontend/index.md` if any spec row/path changes.

## 7. Quality gate (required)

- [ ] `npm run check-types`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npx -y fallow --format json --quiet --explain` — zero dead code / clones /
      health findings.
- [ ] `npx -y fallow audit --base origin/main --gate all --format json --quiet --explain`
- [ ] `/fallow-fix` if any finding remains.

## 8. Rollback points

| After step | Rollback |
|---|---|
| 1-2 | revert branch; diff unaffected (module move only) |
| 3 | drop serialize/hydrate + its test; hex unchanged |
| 4 | revert `hexEditorSession.ts` to host parse; loading card still valid |
| 5 | revert loading-card dedup; hex/diff offload still valid |
| 5b | revert test-harness decoupling; worker + card changes still valid |

Steps 1-4, step 5, and step 5b are independently revertible; land them as
separate commits.

## 9. Follow-ups

- Confirm no host-thread `parseIntelHexCompact` / `parseSRecCompact` call remains
  in `HexEditorSession` (grep the file).
- Confirm the worker is terminated on abort/dispose (no orphaned threads) via a
  focused test or by reusing the existing disposal assertions.
