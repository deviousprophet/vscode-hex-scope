# Scripting Support Code-Spec

## Scenario: Run user-authored TS/JS scripts against hex data

### 1. Scope / Trigger

Applies to `src/core/scripting/` (pure core), `src/scriptHost.ts` (VS Code host adapter), `src/webview/sidebar/scripts/` (sidebar UI), and protocol messages in `src/webviewProtocol.ts`.

### 2. Signatures

```typescript
// Core types (no VS Code imports)
interface ScriptHost {
    readBytes(address: number, length: number): Uint8Array;
    writeBytes(address: number, data: Uint8Array): boolean;
    totalSize: number;
    confirm(type: 'write' | 'exec' | 'fetch', detail: string): Promise<boolean>;
    output(text: string): void;
    setResult(label: string, value: string): void;
    collectOutput(): { results: Array<{ label: string; value: string }>; log: string[] };
    stale?: boolean;
}

// API injected into script vm context
interface HexScopeAPI {
    hex: { read(a: number, l: number): Uint8Array; write(a: number, d: Uint8Array): Promise<boolean>; size: number };
    crc: { crc8(d: Uint8Array | number[]): number; crc16(d: Uint8Array | number[]): number; crc32(d: Uint8Array | number[]): number };
    hash: { sha1(d: Uint8Array): Promise<Uint8Array>; sha256(d: Uint8Array): Promise<Uint8Array>; sha512(d: Uint8Array): Promise<Uint8Array> };
    exec(cmd: string, args?: string[]): Promise<ExecResult | null>;
    fetch(url: string, opts?: RequestInit): Promise<FetchResult | null>;
    output(text: string): void;
    setResult(label: string, value: string): void;
}

interface ScriptOutput {
    results: Array<{ label: string; value: string }>;
    log: string[];
    error?: string;
}

// Runner
function scanScripts(workspaceRoot: string): ScriptInfo[];
function execute(filePath: string, host: ScriptHost, timeoutMs?: number): Promise<ScriptOutput>;
```

### 3. Contracts

- Scripts live in `.hexscope/scripts/` relative to workspace root (falls back to document directory if no workspace folder)
- Scripts export a `run(api: HexScopeAPI)` function — anything else is ignored
- Scripts execute in `vm.Script.runInNewContext` sandbox — no `require`, `process`, `fs`
- `.ts` files compiled with dynamic `import('esbuild')` — fallback to `.js` only if unavailable
- Timeout kills script after 30s (configurable per call)
- VS Code `VSCodeScriptHost` confirms `write`/`exec`/`fetch` via `vscode.window.showWarningMessage` modal
- Script results collected via `host.collectOutput()` after execution
- Results displayed inside the corresponding script card in the sidebar
- Re-running a script replaces its previous result card
- Running state: button text changes to "Running…", button dims

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Script file not found | `ScriptOutput.error` set, logs the error |
| .ts but esbuild unavailable | Error: "Use .js or install esbuild" |
| Script exports no `run` function | Error: "Script must export a 'run' function" |
| Script times out | Error with timeout message |
| Script throws | Error caught, message in `ScriptOutput.error` |
| User denies confirm dialog | Method returns `null` or `false`, no action |
| Address out of range | `readBytes` returns empty `Uint8Array` |
| `host.stale` is true after confirm | `hex.write` returns `false` without writing |
| Missing `.hexscope/scripts/` dir | `scanScripts` returns `[]` (no error) |

### 5. Good/Base/Bad Cases

- Base: user writes CRC verify script, clicks Run in sidebar, sees CRC32 result under the card
- Good: script uses `exec()` to call external tool, user clicks Allow in dialog
- Good: script writes hex bytes, user confirms, edits staged for save
- Bad: script attempts `require('fs')` — sandbox throws, error displayed under card
- Bad: TypeScript syntax error — compile failure, error shown under card
- Bad: Windows file path with backslashes — `querySelector` CSS selector must escape them

### 6. Protocol Messages

```typescript
// Webview → Provider
| { type: 'requestScriptList' }
| { type: 'runScript'; scriptPath: string; generation: number }

// Provider → Webview
| { type: 'scriptInfo'; scripts: Array<{ name: string; filePath: string }> }
| { type: 'scriptResult'; scriptPath: string; result: ScriptOutput | null; error: string; pendingWriteCount: number }
| { type: 'scriptOutput'; scriptPath: string; text: string }
| { type: 'activateScriptsTab' }
```

### 7. UI Component States

| State | Rendering |
|---|---|
| Empty (no scripts) | "No scripts found in .hexscope/scripts/" |
| Script list | Card per script: name, extension badge, Run button |
| Running | Button shows "Running…", dimmed, disabled |
| Result (success) | Card shows result block with ▶ header, key-value rows, log lines |
| Result (error) | Card shows result block with ⚠ red header, error message |
| Streaming output | Lines appended to running script's output log |
| Write pending | Shows "N byte(s) written (not yet saved)" in result block |

### 8. Tests Required

- `src/test/core/scripting-runner.test.ts` — core runner with mock ScriptHost, compile + execute round-trip
- Protocol tests: new message types tested in `webview-message-model.test.ts`
- Integration: manual test with sample .js/.ts scripts run from sidebar
- `VSCodeScriptHost` tests: edit passthrough, unmapped address, totalSize

### 9. Wrong vs Correct

#### Wrong
```typescript
// script imports vscode directly
import * as vscode from 'vscode';
export function run(api) { vscode.window.showInformationMessage('hi'); }
```

#### Correct
```typescript
export function run(api: HexScopeAPI) {
    const data = api.hex.read(0, 256);
    const hash = api.crc.crc32(data);
    api.setResult('CRC32', `0x${hash.toString(16).toUpperCase()}`);
}
```
