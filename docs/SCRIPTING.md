# Scripting Guide

Write TypeScript or JavaScript scripts to automate custom HEX file operations inside Hex Scope. Scripts can read and modify hex data, compute checksums and hashes, call external tools, and fetch web services — all with explicit user confirmation for dangerous operations.

## Directory structure

```
your-workspace/
├── firmware.hex
├── firmware.srec
└── .hexscope/
    └── scripts/
        ├── verify-crc.ts
        ├── verify-signature.ts
        ├── pattern-scan.js
        └── update-checksums.ts
```

All scripts live under `.hexscope/scripts/` relative to the workspace root. Both `.ts` and `.js` files are supported. Scripts in subdirectories are not scanned.

## Getting started

1. Create `.hexscope/scripts/` in your workspace root
2. Add a `.ts` or `.js` file that exports a `run` function
3. Open a HEX file in Hex Scope (the editor must have an active document)
4. Click the **Scripts** tab in the sidebar, or press `Ctrl+Shift+P` and run the `HexScope: Run Script` command
5. The sidebar shows all discovered scripts with a **Run** button next to each
6. Click **Run** — output and results appear below the script list

The script list refreshes when you switch to the Scripts tab. If no scripts appear, verify the `.hexscope/scripts/` path is correct and your workspace root is set in VS Code.

## Script structure

```typescript
// .hexscope/scripts/verify-crc.ts
export function run(api: HexScopeAPI) {
    const data = api.hex.read(0, 256);
    const hash = api.crc.crc32([...data]);
    api.setResult('CRC32', `0x${hash.toString(16).toUpperCase()}`);
    api.output('Done');
}
```

Every script must export a `run` function. It receives a single `api` argument — the `HexScopeAPI` object. The function can be synchronous or asynchronous (return a `Promise`).

### Getting type definitions

For editor IntelliSense, create a `.d.ts` file or use JSDoc:

```typescript
/**
 * @param {import('hexscope').HexScopeAPI} api
 */
export function run(api) {
    api.hex.read(0, 16);  // full IntelliSense
}
```

If using TypeScript, install the types from the extension's source or copy the `HexScopeAPI` interface from the extension's source code.

### Execution model

| Aspect | Behavior |
|--------|----------|
| Entry point | `run(api)` must be exported |
| Sync vs async | Both work. Return a `Promise` for async operations |
| Timeout | 30 seconds by default. Configurable |
| Error handling | Uncaught exceptions are caught and displayed in the output panel |
| Console | `console.log/warn/error` routes to the script output panel |

## API reference

### `api.hex` — reading and writing hex data

```typescript
api.hex.read(address: number, length: number): Uint8Array
api.hex.write(address: number, data: Uint8Array): Promise<boolean>
api.hex.size: number
```

| Method | Description |
|--------|-------------|
| `read(address, length)` | Returns bytes from the currently open document at the given firmware address. Stops reading at the first unmapped byte |
| `write(address, data)` | Writes bytes. **Shows a confirmation dialog.** Returns `true` if the user accepted |
| `size` | Total number of mapped bytes in the document (sum of all segment lengths) |

Addresses are absolute firmware addresses from the parsed segments. If the address falls in a gap (unmapped region), `read` stops early and returns a shorter array.

**Example — reading a known region:**

```typescript
const vectorTable = api.hex.read(0x08000000, 128);  // first 128 bytes at 0x08000000
const stackPtr = new DataView(vectorTable.buffer).getUint32(0, true);  // first 4 bytes LE
api.output(`Stack pointer: 0x${stackPtr.toString(16).toUpperCase()}`);
```

### `api.crc` — CRC algorithms

```typescript
api.crc.crc8(data: Uint8Array | number[]): number
api.crc.crc16(data: Uint8Array | number[]): number
api.crc.crc32(data: Uint8Array | number[]): number
```

| Method | Algorithm | Returns |
|--------|-----------|---------|
| `crc8` | CRC-8 (x⁸ + x² + x + 1) | `number` |
| `crc16` | CRC-16 (Modbus) | `number` |
| `crc32` | CRC-32 (ISO/HDLC) | `number` (unsigned) |

Accepts `Uint8Array` or `number[]`. Use `[...data]` to convert a `Uint8Array` to `number[]`.

### `api.hash` — cryptographic hashes

```typescript
api.hash.sha1(data: Uint8Array): Promise<Uint8Array>
api.hash.sha256(data: Uint8Array): Promise<Uint8Array>
api.hash.sha512(data: Uint8Array): Promise<Uint8Array>
```

All return `Promise<Uint8Array>`. Powered by the Web Crypto API (available in VS Code's Node.js runtime).

**Example — comparing against a known digest:**

```typescript
export async function run(api) {
    const data = api.hex.read(0x08002000, 1024);
    const digest = await api.hash.sha256(data);
    const hex = [...digest].map(b => b.toString(16).padStart(2, '0')).join('');
    const expected = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    api.setResult('Match', hex === expected ? 'Yes' : 'No');
}
```

### `api.exec` — running external processes

```typescript
api.exec(command: string, args?: string[]): Promise<ExecResult | null>
```

**Shows a confirmation dialog** with the full command string. Returns `null` if the user denies.

```typescript
interface ExecResult {
    stdout: string;
    stderr: string;
    code: number;
}
```

**Example — calling an external signing tool:**

```typescript
export async function run(api) {
    const result = await api.exec('openssl', ['dgst', '-sha256', '/path/to/firmware.bin']);
    if (result === null) { api.output('Denied by user'); return; }
    api.setResult('Exit code', result.code.toString());
    api.output(result.stdout);
}
```

**Security notes:**
- Uses `execFile` — no shell expansion (safer than `exec`)
- 30-second inner timeout for the process itself
- Full command string visible in the confirmation dialog
- VS Code shows the dialog modally — the script pauses until the user responds

### `api.fetch` — HTTP/HTTPS requests

```typescript
api.fetch(url: string, options?: RequestInit): Promise<FetchResult | null>
```

**Shows a confirmation dialog** with the URL. Returns `null` if the user denies.

```typescript
interface FetchResult {
    ok: boolean;
    status: number;
    body: string;
}
```

**Example — fetching a firmware manifest:**

```typescript
export async function run(api) {
    const resp = await api.fetch('https://example.com/firmware/manifest.json');
    if (resp === null) { api.output('Denied'); return; }
    if (!resp.ok) { api.output(`HTTP ${resp.status}`); return; }
    const manifest = JSON.parse(resp.body);
    api.setResult('Version', manifest.version);
}
```

### `api.assert` — validation checks

```typescript
api.assert(condition: boolean, label: string): void
```

Records a pass/fail result as a result row without stopping the script. Multiple `assert` calls accumulate all results — none aborts on the first failure.

| Call | Result row |
|------|-----------|
| `api.assert(true, 'CRC matches')` | `✅ PASS — CRC matches` |
| `api.assert(false, 'Signature valid')` | `❌ FAIL — Signature valid` |

**Example — firmware validation:**

```typescript
export function run(api) {
    const data = api.hex.read(0, 128);
    const hash = api.crc.crc32([...data]);
    api.assert(hash === 0x12345678, 'CRC32 matches expected');
    api.assert(data.length === 128, 'Read full range');
    api.assert(data[0] === 0xAA, 'First byte is start marker');
    api.setResult('Checks', '3 assertions run');
}
```

### `api.output` and `api.setResult` — displaying results

```typescript
api.output(text: string): void
api.setResult(label: string, value: string): void
```

| Method | Where it appears |
|--------|-----------------|
| `output(text)` | Appends a line to the output log in the scripts sidebar |
| `setResult(label, value)` | Adds a key-value pair to the results section at the top of the output area |

Use `output` for progress messages and diagnostic logging. Use `setResult` for the final computed values you want the user to see prominently.

## Examples

### CRC verification over a range

```typescript
export function run(api) {
    const data = api.hex.read(0x08000000, 1024);
    const hash = api.crc.crc32([...data]);
    api.setResult('CRC32', `0x${hash.toString(16).toUpperCase().padStart(8, '0')}`);
    api.output(`Computed CRC32 over ${data.length} bytes at 0x08000000`);
}
```

### SHA-256 with hex output

```typescript
export async function run(api) {
    const data = api.hex.read(0x08000000, 4096);
    const digest = await api.hash.sha256(data);
    const hex = [...digest].map(b => b.toString(16).padStart(2, '0')).join('');
    api.setResult('SHA-256', hex);
    api.output(`Computed SHA-256 over ${data.length} bytes`);
}
```

### Pattern scanner

```typescript
export function run(api) {
    const data = api.hex.read(0, api.hex.size);
    const needle = [0xDE, 0xAD, 0xBE, 0xEF];
    const matches: number[] = [];
    for (let i = 0; i <= data.length - needle.length; i++) {
        if (needle.every((b, j) => data[i + j] === b)) {
            matches.push(i);
        }
    }
    api.setResult('Occurrences', matches.length.toString());
    for (const addr of matches) {
        api.output(`  0x${addr.toString(16).toUpperCase()}`);
    }
}
```

### Byte patching with confirmation

```typescript
export async function run(api) {
    const addr = 0x08000000;
    const before = api.hex.read(addr, 1);
    api.output(`Current byte at 0x${addr.toString(16).toUpperCase()}: 0x${before[0].toString(16).toUpperCase()}`);

    // write() shows a confirmation dialog
    const ok = await api.hex.write(addr, new Uint8Array([0xFF]));
    api.setResult('Write accepted', ok ? 'Yes' : 'No');
}
```

### Firmware info dump

```typescript
export function run(api) {
    api.setResult('Total size', `${api.hex.size} bytes`);

    // Read and decode the first 16 bytes as a hex dump
    const data = api.hex.read(0, 16);
    const hex = [...data].map(b => b.toString(16).padStart(2, '0')).join(' ');
    api.setResult('First 16 bytes', hex.toUpperCase());
}
```

### Call an external hash tool

```typescript
export async function run(api) {
    const data = api.hex.read(0, 256);
    api.output('Read 256 bytes');

    const result = await api.exec('sha256sum', []);
    if (result === null) { api.output('Command denied'); return; }
    api.output(`stdout: ${result.stdout}`);
    api.output(`stderr: ${result.stderr}`);
    api.setResult('Exit code', result.code.toString());
}
```

### Fetch release info

```typescript
export async function run(api) {
    const resp = await api.fetch('https://api.github.com/repos/deviousprophet/vscode-hex-scope/releases/latest');
    if (resp === null) { return; }
    const data = JSON.parse(resp.body);
    api.setResult('Latest release', data.tag_name);
    api.output(data.body.slice(0, 500));
}
```

## TypeScript support

If esbuild is available (installed in the extension's `node_modules`), `.ts` files are compiled automatically at runtime. If esbuild is not available, an error is shown suggesting you save as `.js` instead.

For the VS Code extension installed from the marketplace, esbuild may not be bundled. In that case, write scripts in plain JavaScript (`.js`). TypeScript can be used when developing the extension locally, or by configuring your own build step.

## Security model

| Mechanism | What it prevents |
|-----------|-----------------|
| `vm` sandbox without `require`/`process`/`fs` | Script cannot access the file system or extension host internals |
| API-only bridge | The only way to interact with the host is through the `api` object |
| Confirmation dialogs for `write`, `exec`, `fetch` | No silent data corruption, hidden shell commands, or data exfiltration |
| 30-second timeout | Prevents runaway CPU from infinite loops |
| Try-catch wrapper | Errors are caught and displayed, the extension host stays alive |

For future CLI usage, the same scripts run unmodified — only the host adapter changes (stdin confirmation prompts instead of VS Code dialogs, stdout output instead of sidebar panels).
