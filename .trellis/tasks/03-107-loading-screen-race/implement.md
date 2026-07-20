# Implement: Loading screen race condition fix

## Order

1. **LoadProgressReporter store-latest** (`src/hexEditorSession.ts`)
   - Remove `canPost` gate entirely (drop `webviewReady` check)
   - Add `pending: ProviderToWebviewMessage | null` — stores last throttled message
   - `post()` always throttles and posts to webview; stores latest in `pending`
   - `flush()` resends `pending` (one message, no queue)
   - Add `let flushProgress` before initial handler
   - Set `flushProgress` after reporter creation
   - Both ready handlers call `flushProgress?.()` before `webviewReady = true`
   - Remove synthetic progress from initial handler

2. **Transfer stage** (`src/hexEditorSession.ts`)
   - `postProgress('transfer', 0)` before `serializeParseResult`
   - `postProgress('transfer', 1, 1)` after

3. **Shell in-place updates** (`src/webview/hexViewer.ts`)
   - `renderInitialLoadProgress` updates `.loading-text` textContent and leaves `.loading-bar-fill` animated
   - No `#app` innerHTML replacement

## Validation

```bash
npm run compile
npm run lint
npm test
```

## Review gates

- [ ] 24MB .hex file shows progress before editor appears
- [ ] Small files load instantly (shell → editor, no intermediate flash)
- [ ] Error files still redirect to text editor
- [ ] Existing tests pass
- [ ] No TypeScript errors
