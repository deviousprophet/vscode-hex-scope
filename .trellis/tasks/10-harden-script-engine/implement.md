# Execution plan

## Ordered implementation steps

### Step 1: Swap `node:vm` for `isolated-vm`
- **Files**: `src/core/scripting/scriptRunner.ts`, `package.json`
- **Actions**:
  - `npm install isolated-vm`
  - Replace `vm.createContext(...)` with `new ivm.Isolate({ memoryLimit: 16 })` + `isolate.createContextSync()`
  - Replace `new vm.Script(jsCode).runInContext(sandbox)` with `isolate.compileScriptSync(jsCode).runSync(context, { timeout })`
  - Keep host-object injection (Buffer, URL, console shim, etc.) but pass via `context.setSync()` instead of `vm.createContext` dict
  - Remove `import * as vm from 'node:vm'`
- **Validation**: `npm test` passes; manual run of a `.js` script works

### Step 2: Capability manifest
- **Files**: `src/core/scripting/scriptRunner.ts`, `src/core/scripting/types.ts`, `src/webviewProtocol.ts`, `src/webview/sidebar/scripts/scriptList.ts`
- **Actions**:
  - Add `capabilities: string[]` field to `ScriptInfo` in `scriptRunner.ts`
  - Add `parseManifest(source: string): string[]` function that regex-extracts `@requires (\w+)` from first 2 KiB
  - Call `parseManifest` inside `scanScripts()` (read first 2 KiB of each file)
  - Extend `ProviderToWebviewMessage.scriptInfo` items with `capabilities`
  - In `scriptCardHtml()` render badges: `⚡ exec`, `🌐 net`
- **Validation**: sidebar shows capability badges; script with no `@requires` shows none

### Step 3: Workspace Trust
- **Files**: `src/core/scripting/scriptRunner.ts`, `src/webview/sidebar/scripts/scriptList.ts`, `src/webviewProtocol.ts`
- **Actions**:
  - Add `trusted: boolean` field to `ProviderToWebviewMessage.scriptInfo` (global, not per-script)
  - `scanScripts()` accepts optional `trusted` param; `execute()` checks trust before running
  - In `scriptCardHtml()`: when `!trusted`, disable Run button, add "Workspace not trusted" tooltip
- **Validation**: untrusted workspace shows disabled buttons with tooltip

### Step 4: `fetch` hardening
- **Files**: `src/core/scripting/api/fetchAPI.ts`, `src/core/scripting/types.ts`
- **Actions**:
  - Add `maxSize` default 1 MiB check — abort response if `content-length > maxSize` or accumulated chunks exceed limit
  - Add `isPrivateHost(url.hostname)` — blocks 127.x.x.x, ::1, 169.254.x.x, fe80::
  - Add `FetchOptions` (extends `RequestInit`) with `allowLoopback?: boolean`
  - Pass options through from `fetchAPI`
- **Validation**: fetch to `http://127.0.0.1/` returns error; fetch with `allowLoopback: true` works

### Step 5: `exec` hardening
- **Files**: `src/core/scripting/api/execAPI.ts`, `src/core/scripting/types.ts`
- **Actions**:
  - Add `ScriptHost.workspaceRoot` to interface (or thread `cwd` through `buildAPI`)
  - Use minimal env: `{ PATH, SHELL }`
  - Pass pinned `cwd` from `host.workspaceRoot ?? process.cwd()`
- **Validation**: `exec('echo $NODE_ENV')` returns empty (not inherited); `exec('pwd')` shows pinned dir

### Step 6: Spec update
- **File**: `.trellis/spec/frontend/scripting.md`
- **Actions**:
  - Update `createSandbox` → `isolated-vm` contract
  - Add capability manifest section
  - Add Workspace Trust section
  - Update `fetchAPI` / `execAPI` contract points

## Review gates
- After step 1: confirm `npm test` passes
- After step 4 + 5: manual security test with sample malicious script
- Final: `npm run check-types && npm run lint && npm test`

## Rollback
- `git checkout main -- .` to restore originals
- `npm uninstall isolated-vm` if native addon causes build issues
