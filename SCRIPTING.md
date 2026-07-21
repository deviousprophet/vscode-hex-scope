# Scripting Guide

Write TypeScript or JavaScript scripts in your workspace's `.hexscope/scripts/` directory to automate custom HEX operations.

## Getting started

1. Create `.hexscope/scripts/` in your workspace root
2. Add a `.ts` or `.js` file that exports a `run` function
3. Open a HEX file in Hex Scope
4. Click the **Scripts** tab in the sidebar (or run the `HexScope: Run Script` command)
5. Click **Run** on your script

## Script structure

```typescript
// .hexscope/scripts/verify-crc.ts
export function run(api: HexScopeAPI) {
    const data = api.hex.read(0, 256);
    const hash = api.crc.crc32([...data]);
    api.setResult('CRC32', `0x${hash.toString(16).toUpperCase()}`);
}
```

Every script must export a `run` function that receives the `HexScopeAPI` as its only argument.

## API reference

### `api.hex`

| Method | Description |
|--------|-------------|
| `read(address, length)` | Returns `Uint8Array` of bytes from the open document |
| `write(address, data)` | Writes bytes after user confirmation. Returns `Promise<boolean>` — `true` if accepted |
| `size` | Total mapped byte count in the document |

Addresses are absolute firmware addresses (mapped segments). Reads stop at the first unmapped byte.

### `api.crc`

| Method | Description |
|--------|-------------|
| `crc8(data)` | CRC-8 (x⁸ + x² + x + 1) |
| `crc16(data)` | CRC-16 (modbus) |
| `crc32(data)` | CRC-32 (ISO/HDLC) |

Accepts `Uint8Array` or `number[]`. Returns `number`.

### `api.hash`

| Method | Description |
|--------|-------------|
| `sha1(data)` | SHA-1 digest as `Uint8Array` |
| `sha256(data)` | SHA-256 digest as `Uint8Array` |
| `sha512(data)` | SHA-512 digest as `Uint8Array` |

All return `Promise<Uint8Array>`. Backed by the Web Crypto API.

### `api.exec`

```typescript
exec(command: string, args?: string[]): Promise<ExecResult | null>
```

Runs an external process. Shows a confirmation dialog with the full command. Returns `null` if the user denies.

### `api.fetch`

```typescript
fetch(url: string, options?: RequestInit): Promise<FetchResult | null>
```

Makes an HTTP/HTTPS request. Shows a confirmation dialog with the URL. Returns `null` if the user denies.

### `api.output` and `api.setResult`

| Method | Description |
|--------|-------------|
| `output(text)` | Appends a line to the script output log |
| `setResult(label, value)` | Adds a key-value result displayed in the results panel |

## Examples

### CRC verification

```typescript
export function run(api: HexScopeAPI) {
    const data = api.hex.read(0x08000000, 1024);
    const hash = api.crc.crc32([...data]);
    api.setResult('CRC32', `0x${hash.toString(16).toUpperCase().padStart(8, '0')}`);
    api.output(`Computed CRC32 over ${data.length} bytes`);
}
```

### SHA-256 hash

```typescript
export async function run(api: HexScopeAPI) {
    const data = api.hex.read(0, 256);
    const digest = await api.hash.sha256(data);
    const hex = [...digest].map(b => b.toString(16).padStart(2, '0')).join('');
    api.setResult('SHA-256', hex);
}
```

### Pattern search

```typescript
export function run(api: HexScopeAPI) {
    const data = api.hex.read(0, api.hex.size);
    const needle = [0xDE, 0xAD, 0xBE, 0xEF];
    const matches = [];
    for (let i = 0; i <= data.length - needle.length; i++) {
        if (needle.every((b, j) => data[i + j] === b)) {
            matches.push(i);
        }
    }
    api.setResult('Pattern found at', `${matches.length} offset(s)`);
    matches.forEach(addr => api.output(`  0x${addr.toString(16).toUpperCase()}`));
}
```

### Fix a byte

```typescript
export async function run(api: HexScopeAPI) {
    const before = api.hex.read(0x08000000, 1);
    api.output(`Current value: 0x${before[0].toString(16).toUpperCase()}`);
    const ok = await api.hex.write(0x08000000, new Uint8Array([0xFF]));
    api.setResult('Write', ok ? 'Accepted' : 'Denied');
}
```

## Security

- Scripts run in a `vm` sandbox without access to `require`, `process`, or `fs`
- The only way to interact with the host is through the `api` object
- `hex.write()`, `exec()`, and `fetch()` each display a confirmation dialog before proceeding
- A 30-second timeout prevents runaway scripts
- Runtime errors are caught and displayed in the output panel
