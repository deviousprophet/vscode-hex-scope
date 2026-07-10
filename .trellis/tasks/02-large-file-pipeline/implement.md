# Large-file pipeline implementation

## Checklist

- [x] Add compact record-store, bounded segment builder, async scheduler/progress/cancellation, and shared format adapters.
- [x] Add parity, async parser, and compact-store tests.
- [x] Split host wire summary from hydrated webview state; move segment transfer to exact `ArrayBuffer` payloads.
- [x] Add generation-bearing progress and record-page protocol plus dispatcher/model tests.
- [x] Add loader UI and paged Record view with aligned requests, adjacent prefetch, eight-page LRU, placeholders, and compressed-scroll coverage.
- [x] Refactor `HexEditorSession` into disposable per-panel state and route open/save/repair/external reload through async loading.
- [x] Cover parser cancellation plus page supersession/stale-generation behavior; disposal cancellation is wired to both initial and active load controllers.
- [x] Add `test:performance`, 64 MiB mapped IHEX/SREC generators, retained-memory assertions, two-document assertion, and CI job.
- [x] Update lifecycle, type, navigation, and document-format Trellis specs.
- [x] Run `npm run check-types`, `npm run lint`, `npm test`, and `npm run test:performance`; fix all failures.

## Risk and rollback points

- Keep synchronous parser APIs until compact parity and all existing suites pass.
- Land core representation before protocol/UI changes so failures remain attributable.
- Generation checks must ship with paging; never expose unversioned page responses.
- If hard memory target fails, inspect source retention, metadata page width, and segment-builder capacity before changing the agreed ceiling.
