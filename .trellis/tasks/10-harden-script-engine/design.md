# Hardening Design

## Layer diagram

```
┌─────────────────────────────────────────────────────┐
│  Sidebar (webview)  ←── scriptInfo / scriptResult    │
│  [Run btn disabled]   → requestScriptList / runScript │
└───────────┬─────────────────────────────────────────┘
            │ webviewProtocol.ts messages
┌───────────▼─────────────────────────────────────────┐
│  Extension Host                                      │
│  ┌─────────────────────────────────────────────────┐│
│  │ scriptRunner.ts                                  ││
│  │  scanScripts() — reads .hexscope/scripts/        ││
│  │  execute() — parse manifest → run in isolate     ││
│  │  checkWorkspaceTrust() — gate for untrusted      ││
│  └───────────┬─────────────────────────────────────┘│
│              │ isolates                             │
│  ┌───────────▼─────────────────────────────────────┐│
│  │ isolate-vm (or quickjs-emscripten)               ││
│  │  own heap, no require, no process, no fs         ││
│  │  timeout via isolate.createScript timeout param  ││
│  └───┬───────────────────┬─────────────────────────┘│
│      │                   │                           │
│  ┌───▼───────────┐ ┌───▼───────────┐                │
│  │ execAPI       │ │ fetchAPI      │                │
│  │ minimal env   │ │ size cap      │                │
│  │ pinned cwd    │ │ SSRF block    │                │
│  └───────────────┘ └───────────────┘                │
└─────────────────────────────────────────────────────┘
```

## Key design decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Isolate mechanism | `worker_threads` + `Atomics` RPC | Node.js built-in, no native addon. Each Worker gets its own V8 isolate. `node:vm` used inside worker but any escape is contained within the worker's heap. `isolated-vm` rejected because it couldn't rebuild for VS Code's Electron 43 runtime (V8 API mismatch). |
| D2 | Manifest format | JSDoc `@requires` tag parsed from script header | Zero new syntax; inline in existing file. Parsed by `scanScripts()` without running. Schema: `@requires exec`, `@requires network`. |
| D3 | Workspace Trust check | Single import from `vscode.workspace.isTrusted` | Already available in VS Code API. Checked in `execute()` fast-fail and in sidebar `scriptCardHtml()` for disable+tooltip. |
| D4 | fetch size cap | Hard default 1 MiB, `options.maxSize` override | Prevents OOM from large responses. Override per-request so power users can fetch firmware blobs. |
| D5 | SSRF blocklist | Loopback CIDRs + link-local, match on `url.hostname` | Simple pre-flight check in `httpFetch`. Override via `options.allowLoopback: true`. |
| D6 | exec env | `{ PATH: process.env.PATH, SHELL: process.env.SHELL }` | Minimal discovery env. No `NODE_*`, `VSCODE_*`, `HOME`-leaking variables. |

## Manifest parsing

```
/**
 * My firmware analysis script
 * @requires exec   ← declares need for child_process access
 * @requires network ← declares need for fetch
 */
export function run(api: HexScopeAPI) { ... }
```

`scanScripts()` reads first ~2 KiB, regex-extracts `@requires (\w+)` lines. Result attached to `ScriptInfo` as `capabilities: string[]`. Sent to webview via `scriptInfo` message.

## Capability→confirm mapping

| Manifest `@requires` | Confirm trigger | API affected |
|---------------------|----------------|--------------|
| `exec` | Before `exec()` call | `exec` |
| `network` | Before `fetch()` call | `fetch` |
| (absent) | Nothing | Only hex/crc/hash/output/setResult/assert |
| `write` (implicit hex.write) | Before `hex.write()` | `hex.write` |

## Webview changes

- `ProviderToWebviewMessage.scriptInfo` extended: `capabilities: string[]` per script
- `scriptCardHtml()` renders capability badges (`⚡ exec` / `🌐 net`) in the card-info row
- `scriptCardHtml()` checks `trusted: boolean` in message, disables button + adds tooltip when false
- `WebviewToProviderMessage.runScript` unchanged — trust verified server-side

## `fetchAPI` changes

```typescript
interface FetchOptions extends RequestInit {
    maxSize?: number;        // default 1_048_576
    allowLoopback?: boolean; // default false
}
function isPrivateHost(hostname: string): boolean {
    // matches 127.x.x.x, ::1, 169.254.x.x, fe80::
}
```

## `execAPI` changes

```typescript
const MINIMAL_ENV = {
    PATH: process.env.PATH ?? '',
    SHELL: process.env.SHELL ?? (process.platform === 'win32' ? 'cmd.exe' : '/bin/sh'),
};
const PINNED_CWD = host.workspaceRoot ?? process.cwd();
// passed to execFile options: { env: MINIMAL_ENV, cwd: PINNED_CWD, timeout }
```
