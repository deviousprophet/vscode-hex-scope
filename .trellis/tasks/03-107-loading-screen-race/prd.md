# PRD: Loading screen blank on large files due to webviewReady race

## Problem

Opening large `.hex` files shows a static animated loading shell for 0.5–2+ seconds with no real progress indication. All progress messages emitted before the webview JS sends `ready` are silently dropped by `LoadProgressReporter`'s `webviewReady` gate.

v2.12.0's faster compact parser shortens the parse window, making the race more likely.

## Requirements

1. **Progress before `ready`**: progress messages emitted before the webview connects must be queued and flushed on connection, not dropped
2. **Styled persistence**: progress updates must keep the `.loading-shell` UI intact — update the progress bar/text in-place instead of replacing `#app`
3. **No silent gaps**: emit `'transfer'` stage progress during `serializeParseResult`
4. **No regression**: existing behavior for small files, record view, and error states must be unchanged

## Acceptance criteria

- [ ] 24MB `.hex` file shows real progress (parse %, transfer %) during load
- [ ] Styled loading card remains visible throughout — not replaced by plain text
- [ ] `serializeParseResult` reports `'transfer'` progress
- [ ] All existing tests pass
- [ ] Manual test: small file loads normally, loading shell not shown (instant render)
- [ ] Manual test: error file still redirects to text editor
