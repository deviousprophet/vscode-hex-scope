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
    assert(condition: boolean, label: string): void;
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

- Both VS Code extension and future CLI tool use the same `ScriptHost` adapter interface
- Scripts live in `.hexscope/scripts/` relative to workspace root (falls back to document directory if no workspace folder)
- Scripts export a `run(api: HexScopeAPI)` function — anything else is ignored
- Scripts execute in `vm.Script.runInNewContext` sandbox — no `require`, `process`, `fs`
- `.ts` files compiled with dynamic `import('esbuild')` — no mtime caching, compile every run
- `.ts` shown in UI with disabled Run button + "requires esbuild" tooltip when compiler unavailable
- Timeout kills script after 30s (configurable per call)
- VS Code `VSCodeScriptHost` confirms `write`/`exec`/`fetch` via `vscode.window.showWarningMessage` modal
- Script results collected via `host.collectOutput()` after execution
- Results embedded inside the corresponding script card (not a separate output section)
- Re-running a script replaces its previous result
- Cancel via `AbortController` kill-switch — cancel button shown during execution
- On cancel: keep previous results visible; show partial output with "Cancelled" banner if no prior run
- Errors stringified before crossing sandbox boundary (no stack traces to user)

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
- Header clickable to collapse/expand (▶/▼ indicator)
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
- No collapse toggle — the scripts tab has only one section

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
| D2 | Error propagation | Stringify sandbox errors, lose stack trace |
| D3 | TS compilation cache | No mtime cache — compile every run |
| D4 | Output streaming | Real-time first 100 calls, then debounced batch |
| D5 | Batch flush method | `setTimeout(flush, 0)` debounce |
| D6 | TS file when esbuild missing | Show with disabled Run button + tooltip |
| D7 | Cancellation mechanism | `AbortController` kill-switch |
| D8 | Cancel result behavior | Keep previous results; partial + banner if no prior run |
| D9 | Script ordering | Alphabetical by filename |
| D10 | List refresh | On tab activation + manual Refresh button |
| D11 | Result persistence | In-memory (DOM), survives tab switches, not page reload |
| D12 | Run history | One result per card, replaced on re-run |
| D13 | Result collapse | Auto-expand on new result, then collapsible via header click |

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
