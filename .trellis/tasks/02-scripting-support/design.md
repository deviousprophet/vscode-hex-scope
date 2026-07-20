# Design: Scripting Support

## Architecture

```
                    ┌─ src/core/scripting/ ─────────────────────┐
                    │                                            │
.hexscope/scripts/   │  scriptCompiler.ts  ← esbuild .ts → .js   │
└── verify-crc.ts   │  scriptRunner.ts    ← vm.runInNewContext   │
└── sign.ts         │  types.ts           ← HexScopeAPI, ScriptHost, ScriptOutput
                    │  api/                                      │
                    │   ├── hexAPI.ts     ← read/write/size      │
                    │   ├── crcAPI.ts     ← crc8/16/32           │
                    │   ├── hashAPI.ts    ← sha1/256/512         │
                    │   ├── execAPI.ts    ← child_process        │
                    │   ├── fetchAPI.ts   ← http/https           │
                    │   └── ioAPI.ts      ← output/setResult     │
                    │  apiFactory.ts      ← build API from host   │
                    └────────────────────────────────────────────┘
                             │                          ▲
                    injects  │  ScriptHost               │  calls
                    ScriptHost│  (interface)               │  host methods
                             ▼                          │
                    ┌──────────────────────────────────┘
                    │
         ┌──────────┴──────────────┐
         ▼                         ▼
  src/scriptHost.ts          cli/scriptHost.ts
  (VS Code host)             (future CLI host)
  - confirm via dialogs       - confirm via stdin
  - read/write via session    - read/write via file I/O
  - output to webview          - output to stdout
```

## Data Flow

1. User clicks "Run" in sidebar (or picks from command palette)
2. Webview sends `runScript { scriptPath }` message
3. `hexViewer.ts` creates VSCodeScriptHost, passes to `scriptRunner.execute(path, host, session)`
4. `scriptRunner` loads file, compiles .ts → .js via esbuild (cached by mtime)
5. Wraps compiled code, runs in `vm.Script.runInNewContext` with sandbox containing only `api` object
6. Script calls API methods → API methods either:
   - Compute directly (crc, hash)
   - Delegate to ScriptHost with confirmation (hex.read/write, exec, fetch)
   - Route output (output, setResult)
7. After completion/timeout/error → result sent back via webview message
8. Sidebar displays result

## ScriptHost Interface

```typescript
interface ScriptHost {
    // Hex document access
    readBytes(address: number, length: number): Uint8Array;
    writeBytes(address: number, data: Uint8Array): boolean;
    totalSize: number;

    // Confirmation gates (host shows platform-appropriate prompt)
    confirm(type: 'write' | 'exec' | 'fetch', detail: string): Promise<boolean>;

    // Output callbacks
    output(text: string): void;
    setResult(label: string, value: string): void;
}
```

## API Contract (HexScopeAPI)

```typescript
interface HexScopeAPI {
    hex: {
        read(address: number, length: number): Uint8Array;
        write(address: number, data: Uint8Array): Promise<boolean>;
        size: number;
    };
    crc: {
        crc8(data: number[]): number;
        crc16(data: number[]): number;
        crc32(data: number[]): number;
    };
    hash: {
        sha1(data: Uint8Array): Promise<Uint8Array>;
        sha256(data: Uint8Array): Promise<Uint8Array>;
        sha512(data: Uint8Array): Promise<Uint8Array>;
    };
    exec(command: string, args?: string[]): Promise<ExecResult | null>;
    fetch(url: string, options?: RequestInit): Promise<FetchResult | null>;
    output(text: string): void;
    setResult(label: string, value: string): void;
}
```

Script entry point:

```typescript
// .hexscope/scripts/verify-crc.ts
export function run(api: HexScopeAPI) {
    const data = api.hex.read(0, 1024);
    const hash = api.crc.crc32([...data]);
    api.setResult('CRC32', `0x${hash.toString(16)}`);
}
```

## Security Model

| Mechanism | What it prevents |
|-----------|-----------------|
| `vm.createContext` without `require/process/fs` | Script cannot access host internals |
| API-only bridge | Script can only interact via explicit `api.*` methods |
| `confirm('write', ...)` dialog | Prevents silent data corruption |
| `confirm('exec', ...)` dialog with full command | Prevents hidden shell execution |
| `confirm('fetch', ...)` dialog with URL | Prevents silent data exfiltration |
| 30s timeout | Prevents runaway CPU |
| Try-catch wrapper | Errors caught and displayed |

## Message Protocol

```typescript
// Webview → Provider
| { type: 'runScript'; scriptPath: string; generation: number }

// Provider → Webview
| { type: 'scriptResult'; scriptPath: string; result: ScriptOutput | null; error: string }
| { type: 'scriptOutput'; scriptPath: string; text: string }
| { type: 'scriptProgress'; scriptPath: string; done: number; total: number }
```

## Files

### Core (zero VS Code imports)

| File | Purpose |
|------|---------|
| `src/core/scripting/types.ts` | `HexScopeAPI`, `ScriptHost`, `ScriptOutput` type defs |
| `src/core/scripting/scriptCompiler.ts` | esbuild .ts → .js compilation, mtime cache |
| `src/core/scripting/scriptRunner.ts` | Scan dirs, vm execution, timeout, try-catch |
| `src/core/scripting/api/hexAPI.ts` | `hex.read/write/size` → delegates to ScriptHost |
| `src/core/scripting/api/crcAPI.ts` | `crc8/16/32` — pure compute |
| `src/core/scripting/api/hashAPI.ts` | `sha1/256/512` — delegates to existing integrity |
| `src/core/scripting/api/execAPI.ts` | `exec()` → child_process + confirm gate |
| `src/core/scripting/api/fetchAPI.ts` | `fetch()` → http/https + confirm gate |
| `src/core/scripting/api/ioAPI.ts` | `output()`, `setResult()` → delegates to ScriptHost |
| `src/core/scripting/apiFactory.ts` | Build HexScopeAPI from ScriptHost + session |

### Extension host (VS Code)

| File | Purpose |
|------|---------|
| `src/scriptHost.ts` | `ScriptHost` impl for VS Code (dialogs, session read/write, webview output) |
| `src/webview/sidebar/scripts/index.ts` | Sidebar panel wiring |
| `src/webview/sidebar/scripts/scriptList.ts` | Script list rendering |
| `src/webview/sidebar/scripts/resultDisplay.ts` | Script output/result display |
| `src/webviewProtocol.ts` | Add script message types |
| `src/extension.ts` | Register command, activate scripts |
| `src/webview/hexViewer.ts` | Handle runScript / scriptResult |
| `src/webview/sidebar/sidebar.ts` | Add scripts tab |

## Compatibility

- `.hexscope/scripts/` is per-workspace. No migration needed.
- Core modules are pure Node.js — same code runs in VS Code extension and CLI.
- Scripts authored for VS Code work unmodified in CLI (only host adapter differs).
