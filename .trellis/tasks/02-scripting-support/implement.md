# Implement: Scripting Support

## Checklist

### Step 1: Core — Types

- [ ] 1.1 Create `src/core/scripting/types.ts` — `HexScopeAPI`, `ScriptHost`, `ScriptOutput`, `ExecResult`, `FetchResult`
- [ ] 1.2 Create `src/core/scripting/apiFactory.ts` — `buildAPI(host, session) => HexScopeAPI`

### Step 2: Core — API Implementations

- [ ] 2.1 Create `src/core/scripting/api/hexAPI.ts` — read/write delegates to `ScriptHost.readBytes/writeBytes`, size from `ScriptHost.totalSize`
- [ ] 2.2 Create `src/core/scripting/api/crcAPI.ts` — wraps existing `src/core/byte-tools/crc.ts`
- [ ] 2.3 Create `src/core/scripting/api/hashAPI.ts` — wraps existing `src/core/integrity.ts` hash functions
- [ ] 2.4 Create `src/core/scripting/api/execAPI.ts` — `child_process.execFile`, gates on `ScriptHost.confirm('exec', cmd)`
- [ ] 2.5 Create `src/core/scripting/api/fetchAPI.ts` — `http/https.request`, gates on `ScriptHost.confirm('fetch', url)`
- [ ] 2.6 Create `src/core/scripting/api/ioAPI.ts` — output/setResult delegates to `ScriptHost.output/setResult`

### Step 3: Core — Runner

- [ ] 3.1 Create `src/core/scripting/scriptCompiler.ts` — esbuild compile .ts → .js string, cache keyed by mtime
- [ ] 3.2 Create `src/core/scripting/scriptRunner.ts` — scan `.hexscope/scripts/`, compile, `vm.runInNewContext`, 30s timeout, try-catch, return ScriptOutput

### Step 4: Platform — VS Code Host Adapter

- [ ] 4.1 Create `src/scriptHost.ts` — `ScriptHost` impl: `readBytes/writeBytes` delegates to `HexDocumentSession`, `confirm` shows `vscode.window.showWarningMessage`, `output`/`setResult` sends webview messages

### Step 5: Protocol

- [ ] 5.1 Add to `src/webviewProtocol.ts`: `runScript`, `scriptResult`, `scriptOutput`, `scriptProgress`
- [ ] 5.2 Handle `runScript` in `src/webview/hexViewer.ts`: instantiate VSCodeScriptHost, call scriptRunner, forward results as webview messages

### Step 6: Sidebar UI

- [ ] 6.1 Create `src/webview/sidebar/scripts/scriptList.ts` — fetch script list, render "Run" buttons
- [ ] 6.2 Create `src/webview/sidebar/scripts/resultDisplay.ts` — output log + key-value results
- [ ] 6.3 Create `src/webview/sidebar/scripts/index.ts` — `activateScripts()`, wire list + display
- [ ] 6.4 Add scripts tab to `src/webview/sidebar/sidebar.ts` — add `'scripts'` to `SidebarTab`

### Step 7: Command Palette

- [ ] 7.1 Register `hexScope.runScript` in `src/extension.ts` — quick pick of available scripts

### Step 8: Quality

- [ ] 8.1 `npm run check-types`
- [ ] 8.2 `npm run lint`
- [ ] 8.3 `npm test`
- [ ] 8.4 Manual: write test script, run from sidebar, verify read/crc/output
- [ ] 8.5 Manual: test exec() shows confirmation dialog
- [ ] 8.6 Manual: test fetch() shows confirmation dialog
- [ ] 8.7 Manual: test hex.write() shows confirmation dialog
- [ ] 8.8 Verify `src/core/scripting/` has zero `import ... from 'vscode'`

## Validation

```bash
npm run check-types
npm run lint
npm test
```

## Rollback

Revert:
- `src/webviewProtocol.ts`
- `src/webview/sidebar/sidebar.ts`
- Delete `src/scriptHost.ts`, `src/core/scripting/`, `src/webview/sidebar/scripts/`
- Revert `src/extension.ts`, `src/webview/hexViewer.ts`
