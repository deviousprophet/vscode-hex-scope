# Scripting Support Code-Spec

## Scenario: Run user-authored TS/JS scripts against hex data

### 1. Scope / Trigger

Applies to `src/core/scripting/` (pure core), `src/scriptHost.ts` (VS Code host adapter), `src/hexEditorSession.ts` (provider-side orchestration), `src/webview/components/sidebar/scriptsPanel/` (sidebar UI), `src/core/scripting/scriptWorker.ts` (Worker entry point), and protocol messages in `src/webviewProtocol.ts`.

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
    assert(condition: boolean, label: string): void;
    collectOutput(): { results: Array<{ label: string; value: string }>; log: string[] };
    stale?: boolean;
    selectionRange?: { start: number; end: number };
    workspaceRoot?: string;
}

interface ScriptInfo {
    name: string;
    filePath: string;
    capabilities: string[];
}

interface FetchOptions extends RequestInit {
    maxSize?: number;
    allowLoopback?: boolean;
}

// API injected into script Worker
interface HexScopeAPI {
    hex: { read(a: number, l: number): Uint8Array; readSelected(): Uint8Array; write(a: number, d: Uint8Array): Promise<boolean>; size: number };
    crc: { crc8(d: Uint8Array | number[]): number; crc16(d: Uint8Array | number[]): number; crc32(d: Uint8Array | number[]): number };
    // crc8 = CRC-8 (poly 0x07, init 0x00); crc16 = real CRC-16/Modbus (poly 0xA001, init 0xFFFF, check vector "123456789" → 0x4B37);
    // crc32 = CRC-32/ISO-HDLC (check vector "123456789" → 0xCBF43926). Same functions back Analyze context menu.
    hash: { sha1(d: Uint8Array): Promise<Uint8Array>; sha256(d: Uint8Array): Promise<Uint8Array>; sha512(d: Uint8Array): Promise<Uint8Array> };
    exec(cmd: string, args?: string[]): Promise<ExecResult | null>;
    fetch(url: string, opts?: FetchOptions): Promise<FetchResult | null>;
    output(text: string): void;
    setResult(label: string, value: string): void;
    assert(condition: boolean, label: string): void;
}

interface ScriptOutput {
    results: Array<{ label: string; value: string }>;
    log: string[];
    error?: string;
    errorType?: ScriptErrorType;
}

type ScriptErrorType = 'compile' | 'runtime' | 'timeout' | 'cancel';

// Runner
function scanScripts(workspaceRoot: string, trusted?: boolean): ScriptInfo[];
function execute(filePath: string, host: ScriptHost, timeoutMs?: number, signal?: AbortSignal): Promise<ScriptOutput>;
```

### 3. Contracts

- Both VS Code extension and future CLI tool use the same `ScriptHost` adapter interface
- Scripts live in `.hexscope/scripts/` relative to workspace root (falls back to document directory if no workspace folder)
- Scripts export a `run(api: HexScopeAPI)` function — anything else is ignored
- Scripts execute in a `worker_threads.Worker` — each Worker has its own V8 isolate (separate heap from extension host). Inside the Worker, `vm.createContext` provides the sandbox, but any escape is contained within the Worker's heap
- `scriptWorker.ts` is the Worker entry point. It creates a `vm.createContext` sandbox, injects globals (`console`, `setTimeout`, `Buffer`, `URL`, `Uint8Array`), and runs the user script's `run()` function
- API calls from user scripts use synchronous RPC via `Atomics.wait`+`SharedArrayBuffer` — the Worker posts a `{ type: 'api', id, method, args }` message, blocks with `Atomics.wait`, and the main thread responds via `Atomics.notify`
- Cross-realm Promise check: sandbox-created Promises are not `instanceof` the host's `Promise`. Use duck-type check (`typeof result.then === 'function'`) instead
- `.ts` files compiled with dynamic `import('esbuild')` — no mtime caching, compile every run
- `.ts` shown in UI with disabled Run button + "requires esbuild" tooltip when compiler unavailable
- Timeout kills Worker via `worker.terminate()` after 30s (configurable per call). Also uses `setTimeout` directly (not Promise-based) to avoid Electron microtask edge cases
- VS Code `VSCodeScriptHost` confirms `write`/`exec`/`fetch` via `vscode.window.showWarningMessage` modal
- Script results collected by the Worker and sent back in the `result` message. The main thread replays results through `host.setResult()` and `host.output()` to maintain compatibility with existing consumers
- Results embedded inside the corresponding script card (not a separate output section)
- Re-running a script replaces its previous result
- Cancel via `AbortController` kill-switch — `finish()` calls `worker.terminate()` and resolves with `cancel` error type
- On cancel: keep previous results visible; show partial output with "Cancelled" banner if no prior run
- Errors stringified before crossing Worker boundary (no stack traces to user)
- **Capability manifest**: scripts declare required capabilities via JSDoc `@requires exec` / `@requires network` tags. `scanScripts()` parses these from the first 2048 bytes of each file. `ScriptInfo` carries `capabilities: string[]` for sidebar display
- **Workspace Trust**: `scanScripts()` and `execute()` accept a `trusted` boolean. When `false`, `execute()` returns an error immediately, and the sidebar disables the Run button with a "Workspace not trusted" tooltip
- **`fetch` hardening**: default 1 MiB response size cap, loopback (127.0.0.1, ::1) and link-local (169.254.x.x, fe80::) blocked by default. Override via `fetch(url, { allowLoopback: true, maxSize: n })`
- **`exec` hardening**: runs with minimal `env` (only `PATH` + `SHELL`) and pinned `cwd` from `host.workspaceRoot ?? process.cwd()`, instead of inheriting the extension host's full environment

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Script file not found | `ScriptOutput.error` set, logs the error |
| .ts but esbuild unavailable | Error: "Use .js or install esbuild" |
| Script exports no `run` function | Error: "Script must export a 'run' function" |
| Script times out | Error with timeout message, `errorType: 'timeout'` |
| Script throws | Error caught, message in `ScriptOutput.error`, `errorType: 'runtime'` |
| User denies confirm dialog | Method returns `null` or `false`, no action |
| Address out of range | `readBytes` returns empty `Uint8Array` |
| `host.stale` is true after confirm | `hex.write` returns `false` without writing |
| Missing `.hexscope/scripts/` dir | `scanScripts` returns `[]` (no error) |
| Untrusted workspace | `execute()` returns `error: "Workspace not trusted"`, `errorType: 'cancel'` |
| Fetch to loopback/link-local host | Returns `FetchResult { ok: false, status: 0, body: "SSRF blocked" }` (unless `allowLoopback: true`) |
| Fetch response > maxSize | Rejects with `FetchResult { ok: false, status: 0, body: "Response too large" }` |
| Run in untrusted workspace | Sidebar shows scripts but Run button disabled with "Workspace not trusted" tooltip |
| Worker exits with code != 0 | `finish()` resolves with `error: "Worker exited with code N"` |

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
| { type: 'runScript'; scriptPath: string; generation: number; selectionRange?: { start: number; end: number } }

// Provider → Webview
| { type: 'scriptInfo'; scripts: Array<{ name: string; filePath: string; capabilities: string[] }>; trusted: boolean }
| { type: 'scriptResult'; scriptPath: string; result: ScriptOutput | null; error: string; errorType?: ScriptErrorType; pendingWriteCount: number }
| { type: 'scriptOutput'; scriptPath: string; text: string }
| { type: 'activateScriptsTab' }
```

### 7. UI Component States

#### Script card layout

```
┌──────────────────────────────────────┐
│ filename.ts        .ts   ●  [▶]     │  ← card-info row
│──────────────────────────────────────│
│  ▶ Result — filename.ts              │  ← result header (collapsible)
│  ┌──────────────────────────────────┐│
│  │ CRC32:       0x9BE3E0A3        ││  ← key-value results
│  │ Done                            ││  ← output log
│  └──────────────────────────────────┘│
└──────────────────────────────────────┘
```

| Element | Details |
|---------|---------|
| Filename | Left-aligned, truncated with ellipsis, file path in tooltip |
| Extension badge | `.js` or `.ts`, small pill, uppercase |
| Status dot | ● green (last run succeeded), ● red (last run errored), ● gray (never run) |
| Run/Cancel button | Right-aligned, fixed-width slot (no layout shift) |
| Result area | Embedded below card-info, separated by a border line |

#### Button state machine

| State | Icon | Behavior |
|-------|------|----------|
| Idle / Done | ▶ Play (green) | Click to run |
| Pending (0–200ms after click) | ⟳ Spinner (CSS animation) | Instant feedback, click ignored |
| Running (after 200ms) | ⏹ Stop (red) | Click to cancel via `AbortController` |
| Done (any terminal state) | ▶ Play (green) | Click to run again |

- First 200ms after click shows spinner to confirm click registered
- After 200ms, Stop icon appears — user can cancel
- On completion/error/timeout/cancel, reverts to Play
- No text labels — icons only, fixed min-width button

#### Result block behavior

- Auto-expands when new result arrives (overrides previous collapsed state)
- Header clickable to collapse/expand (`›` chevron indicator, rotates when open)
- Different headers for each terminal state:
  - **Success**: "▶ Result — filename" (default style)
  - **Runtime error**: "🔴 Script Error — filename" (red header)
  - **Timeout**: "⏱️ Timeout — filename" (orange header)
  - **Compile error**: "⚠️ Compile Error — filename" (yellow header)
  - **Cancelled**: "⏹ Cancelled — filename" (dimmed header, partial output preserved)
- Collapsed state persists across tab switches but not across re-runs

#### Toolbar header

```
Scripts (3)  [↻]
```

- Replaces the `sb-section` collapsible pattern inherited from Inspector
- Shows script count badge
- Refresh ↻ button re-scans `.hexscope/scripts/` directory
- Single section pane (fills the panel, no sash) — the section header toggles the whole pane like every other sidebar section

#### Empty state

```
No scripts found in .hexscope/scripts/
```

Plain text with the path shown so the user knows where to create files.

#### Output streaming

- First 100 `api.output()` calls: posted immediately as individual `scriptOutput` messages
- After 100 calls: batched via `setTimeout(flush, 0)` debounce — rapid calls coalesce into one flush per micro-task tick
- Lines appended to the running script's result log
- Alternating row backgrounds for readability

#### Write pending notification

```
💾 3 byte(s) written (not yet saved)
```

Shown inside the result block when `pendingWriteCount > 0`. Informational only — the user saves edits through the normal Save flow.

### 8. Design decisions

| # | Decision | Choice |
|---|----------|--------|
| D1 | Runtime targets | VS Code + future CLI via `ScriptHost` adapter |
| D2 | Error propagation | Stringify Worker errors, lose stack trace |
| D3 | TS compilation cache | No mtime cache — compile every run |
| D4 | Output streaming | Real-time first 100 calls, then debounced batch |
| D5 | Batch flush method | `setTimeout(flush, 0)` debounce |
| D6 | TS file when esbuild missing | Show with disabled Run button + tooltip |
| D7 | Cancellation mechanism | `worker.terminate()` via `AbortController` |
| D8 | Cancel result behavior | Keep previous results; partial + banner if no prior run |
| D9 | Script ordering | Alphabetical by filename |
| D10 | List refresh | On tab activation + manual Refresh button |
| D11 | Result persistence | In-memory (DOM), survives tab switches, not page reload |
| D12 | Run history | One result per card, replaced on re-run |
| D13 | Result collapse | Auto-expand on new result, then collapsible via header click |
| D14 | Isolation mechanism | `worker_threads.Worker` + `Atomics.wait` RPC (not `isolated-vm` — native addon incompatible with Electron 43 V8 API) |
| D15 | Capability manifest | JSDoc `@requires` tags parsed from first 2048 bytes of script file |
| D16 | Workspace Trust | `trusted` boolean passed to `scanScripts()`/`execute()`, sidebar disables Run button + tooltip |
| D17 | Cross-realm Promise detection | Duck-type check (`typeof result.then === 'function'`) — sandbox's Promise constructor differs from host's |
| D18 | Microtask flush | `await Promise.resolve()` before sending `result` message to flush `.then()` callbacks not returned from `run()` |
| D19 | Timeout mechanism | `setTimeout` directly (not Promise-based timeout) to avoid Electron microtask ordering edge cases |
| D20 | fetch size cap | Hard default 1 MiB, `options.maxSize` override |
| D21 | SSRF block | Loopback (127/8, ::1) + link-local (169.254/16, fe80::) blocked by default, `allowLoopback` override |
| D22 | exec env | `{ PATH, SHELL }` only — no `NODE_*`, `VSCODE_*`, `HOME` leakage |
| D23 | exec cwd | Pinned to `host.workspaceRoot ?? process.cwd()`, not inherited from extension host |

### 9. Gotchas

#### 9.1 Windows backslash paths in CSS selectors

When using `querySelector` with `data-path` attributes on Windows, file paths like `D:\sample\file.js` must have backslashes escaped in the CSS selector string. `document.querySelector` treats `\` as an escape character.

```typescript
// Wrong — breaks on Windows
document.querySelector(`.card[data-path="${filePath}"]`);

// Correct — escape backslashes
function cssEscape(path: string): string {
    return path.replace(/\\/g, '\\\\');
}
document.querySelector(`.card[data-path="${cssEscape(filePath)}"]`);
```

#### 9.2 `collectOutput()` timing

`host.collectOutput()` must be called **after** `runWithTimeout()` completes, not before. The host accumulates results and log during script execution via `output()`, `setResult()`, and `assert()` calls. Calling it before execution returns empty arrays.

```typescript
// Wrong — collected before script runs
const collected = host.collectOutput();
await runWithTimeout(() => run(api), timeoutMs);
return { results: collected.results, log: collected.log }; // always empty

// Correct — collected after script runs
await runWithTimeout(() => run(api), timeoutMs);
const collected = host.collectOutput();
return { results: collected.results, log: collected.log };
```

#### 9.3 Cross-realm Promise detection

The sandbox created by `vm.createContext()` has its own `Promise` constructor, distinct from the Worker thread's `Promise`. Checking `result instanceof Promise` (host's Promise) returns `false` for a sandbox-created Promise, causing `await` to be skipped. Always use a duck-type check:

```typescript
// Wrong — fails for sandbox Promises
if (result instanceof Promise) { await result; }

// Correct — duck-type thenable check
const runResult = result as unknown;
if (runResult && typeof (runResult as Record<string, unknown>).then === 'function') {
    await (runResult as Promise<void>);
}
```

#### 9.4 Microtask flush for non-returned thenable callbacks

User scripts may use `.then()` without returning the resulting Promise from `run()`. The `.then()` callback fires as a microtask, but if no await is present, the Worker sends the `result` message before the callback runs, producing `ScriptOutput` with empty results/log. Flush microtasks before sending the result:

```typescript
if (runResult && typeof runResult.then === 'function') {
    await runResult;
} else {
    // Flush pending microtasks from non-returned .then() callbacks
    await Promise.resolve();
}
```

#### 9.5 Streaming output after `clearRunning()`

`appendOutput()` finds the target card by looking for `.script-run-btn.running`. After `showResult()` calls `clearRunning()` (which removes the `.running` class), subsequent `appendOutput()` calls silently fail because no `running` class exists. Always render the complete result (including log) inside `showResult()` rather than calling `appendOutput()` afterward.

#### 9.6 CSS specificity for toolbar overrides

`.sb-section` headers are rendered by `SidebarSections` (`.sb-section-head`/`.sb-section-title`/`.sb-section-actions`); `.sb-hdr` no longer exists. Section header actions ride `.sb-section-actions`/`.sb-section-action`, so no specificity override is needed.

### 10. Patterns

#### 10.1 Result block embedded in card

Each script card contains its own result area (`.script-result-area`). Results are rendered inside the card, not in a separate output section. Re-running a script replaces the card's result via `data-path` matching.

#### 10.2 Icon-only button state machine

The Run/Cancel button uses three icon states to avoid text width changes:
- ▶ Play (idle/done) — green
- ⟳ Spinner (pending, 200ms after click) — CSS animation
- ⏹ Stop (running) — red, click to cancel

The button has a fixed `width: 28px; height: 22px` to prevent layout shift on state change.

#### 10.3 Error type visual differentiation

| Error type | Header icon | Header color | CSS class |
|-----------|------------|--------------|-----------|
| Compile | ⚠️ | Yellow (#cca700) | `script-output-hdr-err-compile` |
| Runtime | 🔴 | Red (#e57373) | `script-output-hdr-err` |
| Timeout | ⏱️ | Orange (#e67e22) | `script-output-hdr-err-timeout` |
| Cancel | ⏹ | Dimmed (opacity .6) | `script-output-hdr-err-cancel` |

### 11. Tests Required

- `src/test/core/scripting-runner.test.ts` — core runner with mock ScriptHost, compile + execute round-trip
- Protocol tests: new message types tested in `webviewMessageModel.test.ts`
- Integration: manual test with sample .js/.ts scripts run from sidebar
- `VSCodeScriptHost` tests: edit passthrough, unmapped address, totalSize

### 12. Wrong vs Correct

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
