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
}

// API injected into script vm context
interface HexScopeAPI {
    hex: { read(a, l): Uint8Array; write(a, d: Uint8Array): Promise<boolean>; size: number };
    crc: { crc8(d: number[]): number; crc16(d: number[]): number; crc32(d: number[]): number };
    hash: { sha1(d: Uint8Array): Promise<Uint8Array>; sha256(d): Promise<Uint8Array>; sha512(d): Promise<Uint8Array> };
    exec(cmd: string, args?: string[]): Promise<ExecResult | null>;
    fetch(url: string, opts?: RequestInit): Promise<FetchResult | null>;
    output(text: string): void;
    setResult(label: string, value: string): void;
}

// Runner
function scanScripts(workspaceRoot: string): ScriptInfo[];
function execute(filePath: string, host: ScriptHost, timeoutMs?: number): Promise<ScriptOutput>;
```

### 3. Contracts

- Scripts live in `.hexscope/scripts/` relative to workspace root
- Scripts export a `run(api: HexScopeAPI)` function — anything else is ignored
- Scripts execute in `vm.Script.runInNewContext` sandbox — no `require`, `process`, `fs`
- `.ts` files compiled with dynamic `import('esbuild')` — fallback to `.js` only if unavailable
- Timeout kills script after 30s (configurable per call)
- VS Code `VSCodeScriptHost` confirms `write`/`exec`/`fetch` via `vscode.window.showWarningMessage` modal
- Script results sent back via `scriptResult` provider→webview message

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Script file not found | Return `ScriptOutput` with `error` field |
| .ts but esbuild unavailable | Return error: "Use .js or install esbuild" |
| Script exports no `run` function | Return error: "Script must export a 'run' function" |
| Script times out | Return error with timeout message |
| Script throws | Error caught, message in `ScriptOutput.error` |
| User denies confirm dialog | Method returns `null` or `false`, no action taken |
| Address out of range | `readBytes` returns empty `Uint8Array` |

### 5. Good/Base/Bad Cases

- Base: user writes CRC verify script in `.hexscope/scripts/`, clicks Run in sidebar, sees result
- Good: script uses `exec()` to call external tool, user clicks Allow in dialog
- Good: script writes hex bytes, user confirms, edits staged for save
- Bad: script attempts `require('fs')` — sandbox throws, error displayed
- Bad: TypeScript syntax error — compile failure, error shown in sidebar

### 6. Tests Required

- `src/test/core/scripting/` — core runner with mock ScriptHost, compile + execute round-trip
- Protocol tests: new message types tested in `webview-message-model.test.ts`
- Integration: manual test with sample .ts/.js scripts run from sidebar

### 7. Wrong vs Correct

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
    const hash = api.crc.crc32([...data]);
    api.setResult('CRC32', `0x${hash.toString(16)}`);
}
```
