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
    roles: ScriptRole[];
    fingerprint: string;
    hasRun?: boolean;       // scan-time `run` export detection; absent = legacy payload
    runExplicit?: boolean;  // explicit `@entry run` header override
    relativePath?: string;
}

type ScriptRole = 'integrity' | 'address' | 'size';
type ScriptEntry = 'run' | 'verifyIntegrity' | 'getIntegrityValue' | 'getAddress' | 'getSize';
type ScriptValue = number | boolean | number[];

interface ScriptContext {
    instance?: { id: string; name: string; typeId: string; typeName: string };
    param?: string;
    paramValues?: Record<string, number>;
    documentSize?: number;
    selection?: { start: number; end: number };
    storedStart?: number;
    storedEnd?: number;
}

type ScriptCapability = 'write' | 'exec' | 'fetch';
type ScriptCapabilityGrant = ScriptCapability | '*';
type ScriptPermissionScope = 'once' | 'script' | 'session' | 'workspace';
type ScriptGrantScope = 'script' | 'session' | 'workspace';   // stored grant lifetime (no `once`)
interface ScriptGrantView { scriptPath: string; capability: ScriptCapabilityGrant; scope: ScriptGrantScope }

// Grant store (src/scriptPermissions.ts, host-owned)
class ScriptGrantStore {
    constructor(state: GrantMemento);                      // workspaceState subset
    check(scriptPath: string, fingerprint: string, capability: ScriptCapability): boolean;
    grant(scope: ScriptPermissionScope, scriptPath: string, fingerprint: string, capability: ScriptCapabilityGrant): void;
    revokeAllForScript(scriptPath: string): void;          // session + workspace, keeps session-wide
    revokeMissing(activePaths: readonly string[]): boolean; // scripts deleted since the last scan
    revokeStaleFingerprint(scriptPath: string, fingerprint: string): boolean;
    listGrants(): ScriptGrantView[];                       // workspace → session → script, then path
    revokeGrant(scope: ScriptGrantScope, scriptPath: string, capability: ScriptCapabilityGrant): void;
    revokeAll(scope?: ScriptGrantScope): void;             // no scope = everything
}
// One store per workspace root, host lifetime; editor close/reopen keeps grants.
function scriptGrantStoreFor(root: string, state: GrantMemento): ScriptGrantStore;
function resetScriptGrantStores(): void;                   // test seam: simulate an extension-host restart
function offeredScopes(capability: ScriptCapability): ScriptPermissionScope[];
function acceptedGrant(
    capability: ScriptCapability,
    scopes: readonly ScriptPermissionScope[],
    response: { decision: 'allow' | 'deny'; scope: ScriptPermissionScope; capability?: ScriptCapabilityGrant },
): ScriptCapabilityGrant | null;

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

type ScriptErrorType = 'compile' | 'runtime' | 'timeout' | 'cancel' | 'contract';

// Runner
function scanScripts(workspaceRoot: string, trusted?: boolean): ScriptInfo[];
function execute(filePath: string, host: ScriptHost, timeoutMs?: number, signal?: AbortSignal): Promise<ScriptOutput>;
function executeEntry(
    filePath: string,
    entry: ScriptEntry,
    host: ScriptHost,
    options?: { timeoutMs?: number; signal?: AbortSignal; trusted?: boolean; context?: ScriptContext },
): Promise<ScriptOutput>;
```

### 2b. Script-resolved instance addresses and parameter sizes

`@script address` / `getAddress(api): number | Promise<number>` is consumed by the Type
Overlay, not the Scripts panel. The host batches `resolveInstanceAddresses`
(`requestId`, `generation`, `edits`, `entries[{ pinId, scriptPath, context }]`) through
`runInstanceAddresses` (`src/instanceAddressRunner.ts`): one `executeEntry(..., 'getAddress')`
run per entry, sequential, with the `VSCodeScriptHost` edits overlay, a per-entry
`documentSize` added to `api.context`, path resolution/search-root clamping reused from
`integrityScriptRunner`, read-only semantics (`write` denied without a prompt, `exec`/`fetch`
prompt and revoke stale fingerprints), a `MAX_INSTANCE_ADDRESS_ENTRIES` bound, and partial
results. Contract failures are surfaced as `Invalid address from script`; missing scripts as
`Script not found: <path>`. The response `instanceAddressesResolved` carries the same
`requestId`/`generation` plus `results`; the webview discards stale ids, marks the last
address stale, and schedules one 400 ms debounced retry. Resolved addresses are transient:
never persisted in `profiles.json` and never sent back as authored data. Concurrent worker
use is serialized behind the session's script queue (a user run aborts an in-flight batch).

`@script size` / `getSize(api): number | Promise<number>` follows the same pattern through
`resolveInstanceParams` / `instanceParamsResolved` and `runInstanceParams` (`getSize` entry,
`MAX_INSTANCE_PARAM_ENTRIES`, partial results). `api.context` adds `param` and the already
resolved/effective sibling `paramValues`; the value must be a positive safe integer.
`MAX_SCRIPT_PARAM_SIZE` (1,000,000) bounds script-produced counts. The webview resolves one
parameter round per instance (so later parameters see earlier resolved siblings), then
requests addresses with the effective parameter map; a failed parameter blocks only its
instance. Resolved values are transient; only `paramSources` is persisted.

### 3. Contracts

- Both VS Code extension and future CLI tool use the same `ScriptHost` adapter interface
- Scripts live in `.hexscope/scripts/` relative to workspace root (falls back to document directory if no workspace folder)
- Scripts export a `run(api: HexScopeAPI)` function for side effects, and/or a role entry
  (`verifyIntegrity`, `getIntegrityValue`, `getAddress`, `getSize`) for typed values
- Role discovery uses `@script integrity|address|size` header tags parsed from the first
  2048 bytes. Discovery never compiles or executes user code; the exported function name is
  the call contract
- **Run discovery** uses the same 2 KB header with comments stripped first:
  `export function run`, `export async function run`, `export const|let|var run =`,
  `module.exports = { … run … }`, `exports.run =`. `@entry run` is an explicit override for
  unusual export syntax. `ScriptInfo.hasRun` carries the result; `runExplicit` marks the
  override. A commented-out export must never classify a script as runnable
- **Kinds** (webview): `action` = `hasRun` only, `provider` = roles without `hasRun`, `both` =
  both, `unknown` = neither. Legacy payloads without `hasRun` fall back to
  `roles.length === 0` (role-less scripts stay runnable)
- **Panel layout**: `Actions` group first, then `Providers`; alphabetical inside each group,
  collapsible buttons with counts and `aria-expanded`, session-local collapse state. Grouping
  and sorting are presentation-only and never duplicate a card (`both` stays in Actions)
- Provider-only and unknown cards render no `.script-run-btn` at all (not disabled, not
  hidden), so no code path can trigger the "must export run" error. Providers offer Open +
  job-language role chips (`Instance address`, `Array size`, `Integrity check`; raw role stays
  in `data-role`). Unknown cards offer Open + an `Inspect exports` hint
- `executeEntry()` shares compile, Worker, timeout, cancellation, output, and trust with
  `execute()`; there is no second runner. `run` has no value contract; role entries return a
  structured-clone-safe value normalized by `normalizeScriptValue`
- Contract failures (missing export, non-function, wrong value type/range) report
  `errorType: 'contract'` and never reach a model
- Role runs receive `api.context`; `run` scripts receive an empty context
- `scanScripts` reads only direct child files (never recurses) and skips `.d.ts`, so
  `scripts/types/` support files cannot appear as runnable scripts
- Scripts execute in a `worker_threads.Worker` — each Worker has its own V8 isolate (separate heap from extension host). Inside the Worker, `vm.createContext` provides the sandbox, but any escape is contained within the Worker's heap
- `scriptWorker.ts` is the Worker entry point. It creates a `vm.createContext` sandbox, injects globals (`console`, `setTimeout`, `Buffer`, `URL`, `Uint8Array`), and runs the user script's `run()` function
- API calls from user scripts use synchronous RPC via `Atomics.wait`+`SharedArrayBuffer` — the Worker posts a `{ type: 'api', id, method, args }` message, blocks with `Atomics.wait`, and the main thread responds via `Atomics.notify`
- Cross-realm Promise check: sandbox-created Promises are not `instanceof` the host's `Promise`. Use duck-type check (`typeof result.then === 'function'`) instead
- `.ts` files compiled with dynamic `import('esbuild')` — no mtime caching, compile every run
- `.ts` shown in UI with disabled Run button + "requires esbuild" tooltip when compiler unavailable
- Timeout kills Worker via `worker.terminate()` after 30s (configurable per call). Also uses `setTimeout` directly (not Promise-based) to avoid Electron microtask edge cases
- **Inline approval, no modal**: `VSCodeScriptHost.confirm(type, detail)` is unchanged, but the session implementation checks the grant store first and otherwise posts `scriptPermissionRequest` to the webview. There is no `vscode.window.showWarningMessage` for script permissions
- **Grant key**: absolute script path + the script file's fingerprint (mtime from `scriptFingerprint()` / `scanScripts`) + capability. `check` matches an exact entry or a same-fingerprint `*`
- **Grant lifetimes**: `once` is never stored; `script` and `session` are in-memory on a workspace-root-keyed registry store with host lifetime (`scriptGrantStoreFor`), so closing/reopening an editor keeps them and only the extension host exiting resets them; `workspace` persists in `context.workspaceState` under one versioned key. A `session` grant is a wildcard across scripts/fingerprints; a `script` grant is path+fingerprint scoped
- **`exec` never persists**: `grant('workspace', …, 'exec')` downgrades to `session`, and `offeredScopes('exec')` omits `workspace`. A workspace `*` grant covers `write`/`fetch` only
- **Fingerprint revocation**: `runScript` and `requestScriptList` call `revokeStaleFingerprint()`; `revokeAllForScript()` removes every path-scoped entry (not the session wildcard)
- **Approval timeout / denial**: an unanswered prompt denies after 120 s; panel disposal, cancel, and a replacement prompt deny the stale request; unknown `requestId` responses are ignored
- **Commit on success**: on a clean run the session posts `scriptWritesCommit` with the staged `[address, value]` pairs. On error/timeout/cancel it posts nothing and reports `discardedWriteCount`
- **Auto-save**: the webview stages the commit through `stageIntegrityEditTransaction()` (one undoable transaction) and calls `saveEdits()`; a failed save keeps the staged edits and uses the normal save-error path
- **Revocable permission list**: `scriptPermissions` carries every stored grant `{ scriptPath, capability, scope }` (workspace → session → script, then path; `*` = session-wide) to the Scripts panel; `revokeScriptPermission` removes one entry by scope; `revokeAllScriptPermissions` bulk-revokes one scope class, or, with `scriptPath`, every revocable grant of that script. The panel's expanded **Manage** footer and per-row bulk actions both require a second confirming click
- Script results collected by the Worker and sent back in the `result` message. The main thread replays results through `host.setResult()` and `host.output()` to maintain compatibility with existing consumers
- **Integrity checks**: `src/integrityScriptRunner.ts` runs `getIntegrityValue` then `verifyIntegrity` (two sequenced `executeEntry` calls) over a `VSCodeScriptHost` seeded with the webview's pending edits. A missing export is treated as absent, not an error; `verifyIntegrity` is authoritative, `getIntegrityValue` supplies verbatim fix bytes. The run is read-only (`write` is denied without a prompt), refuses >`MAX_INTEGRITY_EDIT_ENTRIES` pending edits, resolves workspace-relative paths ("Script not found" otherwise), and returns a structured outcome consumed by the webview Integrity panel (`integrityScriptResult`)
- Results embedded inside the corresponding script card (not a separate output section)
- Re-running a script replaces its previous result
- Cancel via `AbortController` kill-switch — `finish()` calls `worker.terminate()` and resolves with `cancel` error type
- On cancel: keep previous results visible; show partial output with "Cancelled" banner if no prior run
- Errors stringified before crossing Worker boundary (no stack traces to user)
- **Capability manifest**: scripts declare required capabilities via JSDoc `@requires exec` / `@requires network` tags. `scanScripts()` parses these from the first 2048 bytes of each file. `ScriptInfo` carries `capabilities: string[]`, shown as `.script-cap` badges on the card. There is no pre-run gate — the per-command prompt is the only approval
- **Workspace Trust**: `scanScripts()` and `execute()` accept a `trusted` boolean. When `false`, `execute()` returns an error immediately, and the sidebar disables the Run button with a "Workspace not trusted" tooltip
- **`fetch` hardening**: default 1 MiB response size cap, loopback (127.0.0.1, ::1) and link-local (169.254.x.x, fe80::) blocked by default. Override via `fetch(url, { allowLoopback: true, maxSize: n })`
- **`exec` hardening**: runs with minimal `env` (only `PATH` + `SHELL`) and pinned `cwd` from `host.workspaceRoot ?? process.cwd()`, instead of inheriting the extension host's full environment

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Script file not found | `ScriptOutput.error` set, logs the error |
| .ts but esbuild unavailable | Error: "Use .js or install esbuild" |
| Script exports no `run` function | Error: "Script must export a 'run' function" (host/command path only; the panel never offers Run for a known provider) |
| Role-only script in the panel | Provider card: Open + job chip, no Run control |
| Script with role + `run` | Both card: Run/Cancel + job chip, listed under Actions |
| Script with neither role nor detected `run` | Unknown card: Open + `Inspect exports`, no Run |
| `@entry run` header present | Treated as runnable even when the export scan cannot see the entry |
| `run` export appears only in comments | Not runnable (comment-stripped scan) |
| Script times out | Error with timeout message, `errorType: 'timeout'` |
| Script throws | Error caught, message in `ScriptOutput.error`, `errorType: 'runtime'` |
| Role export missing or not a function | `errorType: 'contract'`, message names the entry |
| Role value has the wrong type or range | `errorType: 'contract'`, `value` is absent |
| `.d.ts` or subdirectory file in scripts | Ignored by `scanScripts` |
| User denies a prompt | `write` returns `false`, `exec`/`fetch` return `null`; no write, no save |
| Prompt unanswered for 120 s / panel disposed / run cancelled | Denies; the call returns `false`/`null` |
| Response for an unknown or replaced `requestId` | Ignored by the host |
| `revokeScriptPermission` without `scope` (pre-scope payload) | Treated as `workspace` — the only scope that message could revoke before scopes existed |
| Response scope not offered, or capability mismatch | Denied (`acceptedGrant` → null) |
| `workspace` scope requested for `exec` | Not offered; a granted request is downgraded to `session` |
| Grant exists for path + fingerprint + capability | `confirm` resolves `true` without prompting |
| Script file edited (fingerprint changed) | `revokeStaleFingerprint` drops its grants; next call prompts |
| Approved writes + clean run | `scriptWritesCommit` posted; webview stages one transaction + saves |
| Approved writes + error/timeout/cancel | No commit; staged bytes discarded; `discardedWriteCount` > 0 |
| Script save fails | Staged edits stay; the normal save-error path reports it |
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
- Good: script calls `api.hex.write`, one inline prompt names the address/byte count, the user picks "Allow once", bytes save when the run ends, Ctrl+Z restores them
- Good: script uses `exec()` to call external tool, user clicks Allow once in the prompt
- Good: user chooses "Always allow write for this script in this workspace, across restarts", the entry appears under Permissions with a `Workspace` chip and can be revoked (per row or in bulk)
- Bad: script attempts `require('fs')` — sandbox throws, error displayed under card
- Bad: TypeScript syntax error — compile failure, error shown under card
- Bad: Windows file path with backslashes — `querySelector` CSS selector must escape them (the prompt component matches cards by `data-path`, avoiding selectors)

### 6. Protocol Messages

```typescript
// Webview → Provider
| { type: 'requestScriptList' }
| { type: 'runScript'; scriptPath: string; generation: number; selectionRange?: { start: number; end: number } }
| { type: 'resolveInstanceParams'; requestId: number; generation: number; edits: Array<[number, number]>; entries: InstanceParamRequestEntry[] }
| { type: 'resolveInstanceAddresses'; requestId: number; generation: number; edits: Array<[number, number]>; entries: InstanceAddressRequestEntry[] }
| { type: 'scriptPermissionResponse'; requestId: number; decision: 'allow' | 'deny'; scope: ScriptPermissionScope; capability?: ScriptCapabilityGrant }
| { type: 'revokeScriptPermission'; scope: ScriptGrantScope; scriptPath: string; capability: ScriptCapabilityGrant }
| { type: 'revokeAllScriptPermissions'; scope?: ScriptGrantScope; scriptPath?: string }
| { type: 'addExampleScripts' }

// Provider → Webview
| { type: 'scriptInfo'; scripts: Array<{ name: string; filePath: string; capabilities: string[]; roles: string[]; fingerprint: string; hasRun?: boolean; runExplicit?: boolean; relativePath?: string }>; trusted: boolean }
| { type: 'scriptResult'; scriptPath: string; result: ScriptOutput | null; error: string; errorType?: ScriptErrorType; pendingWriteCount: number; discardedWriteCount?: number }
| { type: 'instanceParamsResolved'; requestId: number; generation: number; stale?: boolean; results: InstanceParamResult[] }
| { type: 'instanceAddressesResolved'; requestId: number; generation: number; stale?: boolean; results: InstanceAddressResult[] }
| { type: 'scriptOutput'; scriptPath: string; text: string }
| { type: 'scriptPermissionRequest'; requestId: number; capability: ScriptCapability; detail: string; scriptPath: string; scriptName: string; fingerprint: string; scopes: ScriptPermissionScope[] }
| { type: 'scriptPermissions'; grants: ScriptGrantView[] }
| { type: 'scriptWritesCommit'; scriptPath: string; writes: Array<[number, number]> }
| { type: 'activateScriptsTab' }
```

### 7. UI Component States

#### Script card layout

```
┌──────────────────────────────────────┐
│ filename.ts        .ts   ●  [▶]     │  ← action card-info row
│──────────────────────────────────────│
│  ▶ Result — filename.ts              │  ← result header (collapsible)
│  ┌──────────────────────────────────┐│
│  │ CRC32:       0x9BE3E0A3        ││  ← key-value results
│  │ Done                            ││  ← output log
│  └──────────────────────────────────┘│
└──────────────────────────────────────┘

ACTIONS (3)                         ← group button, count, aria-expanded
  hello.js                .js  [▶] [✎]
PROVIDERS (3)                       ← group button, count, aria-expanded
  follow-pointer.js  Instance address  .js  [✎]
```

| Element | Details |
|---------|---------|
| Group header | Native button, label + count, caret rotates when open, `aria-expanded`; collapse is CSS-only so result areas survive |
| Filename | Left-aligned, truncated with ellipsis, file path in tooltip |
| Extension badge | `.js` or `.ts`, small pill, uppercase |
| Status dot | Actions/both only: ● green (last run succeeded), ● red (last run errored), ● gray (never run). Providers/unknown have no run status |
| Role chip | Job language (`Instance address`, `Array size`, `Integrity check`), raw role in `data-role`; also shown on a both-kind card |
| Unknown marker | Warning glyph + `Inspect exports` hint; Open is the only action |
| Run/Cancel button | `.script-run-btn` exists only on action/both cards, right-aligned, fixed-width slot |
| Result area | Embedded below card-info on runnable cards only |

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

#### Card actions by kind

| Kind | Primary | Secondary | Forbidden |
|------|---------|-----------|-----------|
| Action | Run / Cancel | Open, result collapse | — |
| Provider | Open | Role chip (job language) | Run |
| Both | Run / Cancel | Open, role chips | — |
| Unknown | Open | `Inspect exports` hint | Run |

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

#### Write notice

```
💾 3 byte(s) written and saved
💾 3 byte(s) written, discarded — nothing was saved
```

Shown inside the result block when `pendingWriteCount > 0` (clean run, auto-saved) or
`discardedWriteCount > 0` (error/timeout/cancel). Informational only — there is no
Apply & Save / Discard control.

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
| D9 | Script ordering | Actions group first (alphabetical), then Providers (alphabetical); collapsible groups |
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
| D24 | Named entries | One entry per Worker run; `run` delegates to `executeEntry('run')` |
| D25 | Role discovery | `@script` header tags; no evaluation during scan |
| D26 | Contract values | Plain numbers/booleans/byte arrays; normalized at the boundary |
| D27 | Support files | `.d.ts` skipped and scanning never descends into subdirectories |
| D28 | Dangerous-call approval | One inline prompt owned by the Scripts panel; no modal `showWarningMessage` |
| D29 | Grant identity | scriptPath + fingerprint + capability (plus `*` breadth); edit revokes |
| D30 | Grant lifetimes | `script`/`session` in memory on a workspace-root-keyed registry (host lifetime, survives editor close/reopen), `workspace` in `workspaceState`, `once` not stored |
| D31 | `exec` persistence | Never workspace-scoped; downgraded to `session`, workspace options not offered |
| D32 | Approval timeout | 120 s, then deny; dispose/cancel/replacement also deny |
| D33 | Write commit | Staged during the run, committed on clean completion via `scriptWritesCommit` |
| D34 | Write undo | Commit is one `stageIntegrityEditTransaction`; Ctrl+Z restores pre-run bytes |
| D35 | Pre-run gate | Removed — capabilities stay as card badges; per-command prompt is the only ask |
| D36 | Script classification | Scan-time `hasRun` + roles → action/provider/both/unknown; no execution during scan |
| D37 | Provider Run control | Structurally absent from provider/unknown cards — never disabled or hidden |
| D38 | `@entry run` | Explicit override for run entries the source scan cannot recognise |
| D39 | Permission center | Lists every stored grant with scope chip (`This script`/`This session`/`Workspace`), per-row Revoke, and bulk revoke (per script, per scope) behind Manage with two-step confirm |

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

#### 9.7 Approval bridge must cross the event loop

`host.confirm` is awaited while the script Worker is blocked in `Atomics.wait`, so the main
thread must return to the event loop for the `scriptPermissionResponse` message to arrive.
Never resolve a permission from a modal (`showWarningMessage` blocks the same loop) and always
settle the previous pending request before posting a new one — an unresolved promise would keep
the script alive until the 120 s timeout.

```typescript
// Wrong — modal on the same loop the webview response needs
confirm: async (type, detail) => (await vscode.window.showWarningMessage(detail, { modal: true }, 'Allow')) === 'Allow';

// Correct — check grants, then bridge request/response through the webview
confirm: async (type, detail) =>
    grants.check(scriptPath, fingerprint, type)
        ? true
        : requestPermission({ capability: type, detail, scriptPath, scriptName, fingerprint, scopes: offeredScopes(type) });
```

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

- `src/test/core/scriptingRunner.test.ts` - core runner with mock ScriptHost, compile + execute round-trip
- Named entries: sync/async contract exports, missing export, invalid value, byte transport, context
- Scanning: role tags, `.d.ts` exclusion, non-recursive subdirectory handling, `hasRun`
  detection for every accepted export form, comment-stripped false positives, `@entry run`
- `src/test/extension/instanceAddressRunner.test.ts`: batched `getAddress` / `getSize` context/document size, edits overlay, invalid/oversized values, partial failure isolation, missing script/export, untrusted block, batch bound, workspace-relative address and parameter sources
- `src/test/core/scriptPermissions.test.ts` - scope matrix, `*` breadth, fingerprint invalidation,
  all-scope listing + ordering, single/bulk revocation, workspace persistence, registry reuse across
  editor sessions + root isolation + host-restart simulation, `exec` workspace downgrade, response validation
- `src/test/webview/components/sidebar/scriptsPanel/scriptsPanel.test.ts` - prompt DOM (scope
  options and lifetime labels, Escape, focus return, one-at-a-time, result/cancel close), Permissions
  list (scope chips, session-wide `All scripts`, per-row revoke, Manage/bulk two-step confirm), writes
  notice, action/provider/both/unknown cards, no `.script-run-btn` on providers/unknown,
  group order/counts/collapse, result-area preservation across regrouping
- Protocol tests: new message types tested in `webviewMessageModel.test.ts`
- Integration: manual test with sample .js/.ts scripts run from sidebar
- `src/test/core/scriptingExamples.test.ts` - catalog shape, install manifest ↔ catalog parity,
  role tags/capabilities via `scanScripts`, mock-host runs for every example (including the
  minimal `hello.js`, approval, denial, unmapped ranges, boundary-valid role values), and
  `hexscope.d.ts` coverage. `npm run check-examples` (`tsc -p examples/tsconfig.json`)
  type-checks the JavaScript examples against the shipped declaration.
- `src/test/extension/addExampleScripts.test.ts` - fresh install, second-run skip, partial
  install, untrusted/no-workspace refusal, result-message actions, missing catalog file, VSIX
  packaging rules, command contribution + registration
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
