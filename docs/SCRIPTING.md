# Scripting Guide

Write TypeScript or JavaScript scripts to automate custom HEX file operations inside Hex Scope. Scripts can read and modify hex data, compute checksums and hashes, call external tools, and fetch web services — all with an inline per-command approval for dangerous operations. Approved writes are saved when the script finishes successfully.

## Directory structure

```
your-workspace/
├── firmware.hex
├── firmware.srec
└── .hexscope/
    └── scripts/
        ├── types/
        │   └── hexscope.d.ts
        ├── hello.js
        ├── verify-crc.js
        ├── verify-signature.ts
        ├── pattern-scan.js
        └── update-checksums.ts
```

All scripts live under `.hexscope/scripts/` relative to the workspace root. Both `.ts` and `.js` files are supported. Scripts in subdirectories are not scanned, and `.d.ts` files are never treated as runnable — `types/hexscope.d.ts` holds shared declarations.

## Getting started

1. Create `.hexscope/scripts/` in your workspace root, or run **HexScope: Manage Scripts** (works without an open hex file) to create one from a template or copy the bundled examples — see [Create a script](#create-a-script) and [Start from an example](#start-from-an-example)
2. Add a `.ts` or `.js` file with a `run` function (an action) or a `@script` role export (a provider)
3. Open a HEX file in Hex Scope (the editor must have an active document)
4. Click the **Scripts** tab in the sidebar, or press `Ctrl+Shift+P` and run the `HexScope: Run Script` command
5. The sidebar groups scripts into **Actions** and **Providers**. Action cards have **Run**; provider cards have **Open** and a job chip (`Instance address`, `Array size`, `Integrity check`)
6. Click **Run** — output and results appear below the script list

The script list refreshes when you switch to the Scripts tab. If no scripts appear, verify the `.hexscope/scripts/` path is correct and your workspace root is set in VS Code.

## Create a script

**HexScope: Manage Scripts** works with no hex document open. It lists the scanned Actions
and Providers (picking one opens the file) and offers:

- **New action script** — a `run(api)` starter that reports a result and a log line,
- **New integrity check** — `@script integrity` with `verifyIntegrity` / `getIntegrityValue`,
- **New instance address script** — `@script address` with `getAddress`,
- **New array size script** — `@script size` with `getSize`,
- **Browse examples…** — a multi-select picker over the bundled catalog,
- **Add all examples** — the bulk copy (see [Start from an example](#start-from-an-example)),
- **Manage permissions…** — lists the stored script grants and revokes the one you pick,
- **Open scripts folder**,
- **Reveal a script in Explorer…** — shows a script picker and reveals the chosen file in the Explorer view (only offered when scripts exist).

The Scripts panel has the same creation path: the **＋ New** split button opens the template
picker, its caret lists the four templates directly, and the empty state has a **Create
script** button. Empty provider pickers in the Overlay and Integrity panels offer **Create …
script** and **Open scripts folder** next to their disabled placeholder.

Creation asks for a file name (prefilled by the template), refuses names that are not a
plain `.js`/`.ts` file, never overwrites an existing file (a clear message names the
duplicate instead), requires a trusted workspace, and opens the new file with the correct
`// @ts-check`, type reference, and role/`@requires` header. The new script appears in the
matching group without a manual refresh.

## Start from an example

**HexScope: Add Example Scripts** copies a working catalog into `.hexscope/scripts/`
(also reachable from the Scripts panel: the **+** header action and the empty-state
**Add example scripts** button, and from **HexScope: Manage Scripts** as **Add all
examples**). The command:

- refuses to run in an untrusted workspace,
- creates `.hexscope/scripts/` and `.hexscope/scripts/types/` as needed,
- never overwrites or deletes — existing files are reported as skipped,
- reports `Added N example files, skipped M existing files.` with **Open scripts folder**
  and **Open scripting guide** actions.

Running it twice installs nothing and changes nothing. Removing an installed example
leaves the bundled catalog untouched.

**Browse examples…** opens a multi-select QuickPick with one row per catalog file, its
target path, and its installed state; only the checked rows are copied, and existing
targets are still skipped without being read or replaced.

| File | Kind | Demonstrates | Adapt |
|------|------|--------------|-------|
| `hello.js` | Action (`run`) | The minimal manual script: `run(api)`, `setResult`, `output` | none |
| `verify-crc.js` | Action (`run`) | Reading a range, `crc32`, `setResult`, `output` | `START`, `LENGTH` |
| `write-pattern.js` | Action (`run`, `@requires write`) | One inline approval, staged writes, auto-save, undo | `START`, `PATTERN` |
| `follow-pointer.js` | Provider (`@script address` → `getAddress`) | Reading a little-endian pointer as an instance address | `POINTER_AT` |
| `array-size-from-header.js` | Provider (`@script size` → `getSize`) | Reading a count for one templated parameter | `PARAM_NAME`, `COUNT_AT` |
| `verify-integrity.js` | Provider (`@script integrity` → `verifyIntegrity`, `getIntegrityValue`) | Checksum over the check range, excluding the stored field | `DEFAULT_START`, `DEFAULT_END` |

Every example starts with `/// <reference path="./types/hexscope.d.ts" />`, so
editor IntelliSense works in the repository and in an installed workspace. The catalog
is type-checked in CI (`npm run check-examples`), so it cannot drift from the API.

## Script structure

```javascript
// .hexscope/scripts/verify-crc.js
function run(api) {
    const data = api.hex.read(0, 256);
    const hash = api.crc.crc32([...data]);
    api.setResult('CRC32', `0x${hash.toString(16).toUpperCase()}`);
    api.output('Done');
}

module.exports = { run };
```

A script you run manually exports a `run` function and is shown as an **Action** in the
Scripts panel. It receives a single `api` argument - the `HexScopeAPI` object. The function
can be synchronous or asynchronous (return a `Promise`). A role script (`@script address`,
`@script size`, or `@script integrity`) exports its role entry instead and may omit `run`;
it is shown as a **Provider** with no Run button.

The panel classifies every scanned script without executing it:

| Kind | Detected by | Card actions |
|------|-------------|--------------|
| **Action** | a `run` export | Run / Open |
| **Provider** | one or more `@script` roles, no `run` export | Open + job chip |
| **Both** | a `run` export and at least one role | Run / Open + job chip |
| **Unknown** | neither a recognised `run` export nor a role | Open + **Inspect exports** hint |

Actions are listed first, then Providers; each group is alphabetical and collapsible. A known
provider never shows a Run button, so it cannot fail with "Script must export a 'run' function".

`.ts` scripts are compiled to CommonJS before they run, so `export function run(...)` works.
`.js` scripts run as CommonJS in the sandbox and must export explicitly:

```javascript
// .hexscope/scripts/pattern-scan.js
async function run(api) {
    api.setResult('Size', `${api.hex.size} bytes`);
}

module.exports = { run };
```

### Named entries and roles

A script may also act as a typed value source for the editor. Declare the role in the header
and export the matching function instead of, or in addition to, `run`:

```typescript
/** @script integrity */

export function verifyIntegrity(api: HexScopeAPI): boolean {
    return api.hex.read(0, 4).every((b, i) => b === [0xDE, 0xAD, 0xBE, 0xEF][i]);
}

export function getIntegrityValue(api: HexScopeAPI): Uint8Array {
    return new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF]);
}
```

| Role tag | Panel chip | Exports | Return |
|----------|------------|---------|--------|
| `@script integrity` | `Integrity check` | `verifyIntegrity` and/or `getIntegrityValue` | `boolean` / `Uint8Array` or `number[]` |
| `@script address` | `Instance address` | `getAddress` | unsigned 32-bit integer |
| `@script size` | `Array size` | `getSize` | positive integer |

- Role tags are parsed from the first 2 KB and shown as job chips in the Scripts panel. They are
  discovery metadata; the exported function name is the call contract.
- A missing or mistyped export is reported as a **Contract Error**, separate from compile,
  runtime, timeout, and cancel errors.
- `run` is optional for a role-only script. A script may declare more than one role and export
  several entries. Declaring a role and `run` makes the card a **Both** script: it stays
  runnable and still shows its provider chips.
- Role entries receive the same `api` plus `api.context` describing the request (instance,
  parameter, resolved sibling values, document size, selection, and stored range where
  relevant). `run` scripts see an empty context.
- Role scripts are read-only: `api.hex.write()` is denied without a prompt. Use a `run`
  script when a write is intentional.
- `.d.ts` files and files in subdirectories are not scanned; use
  `.hexscope/scripts/types/hexscope.d.ts` for shared types.

#### `run` detection and `@entry run`

The scan looks for the common export forms without executing the script: `export function run`,
`export async function run`, `export const|let|var run =`, `module.exports = { ... run ... }`,
and `exports.run =`. Comments are stripped first, so a commented-out example never makes a
script look runnable.

If your script exposes `run` through unusual syntax (for example a factory), add an explicit
header override so the card gets a Run button:

```javascript
/** @entry run */
module.exports = buildEntries();
```

Without a detected `run` export and without a role, the card is **Unknown**: it offers Open and
an **Inspect exports** hint instead of a Run button that would fail.

### Script integrity checks

The Integrity panel can use a `@script integrity` script as a check. Configure the range, an
optional stored-value address, and the script path (relative to the workspace root). A check
may omit the stored address and be display-only.

| Exports | Behavior |
|---------|----------|
| `verifyIntegrity` only | Pass/fail from the boolean. No auto-fix. |
| `getIntegrityValue` only | The returned bytes are compared with the stored field; a mismatch offers Auto fix / Fix all. |
| Both | `verifyIntegrity` decides pass/fail; `getIntegrityValue` supplies the fix bytes when the check fails. A verified check never contributes a fix. |

- The two entries run as two sequenced script runs (value first, then verify), so a failing
  entry does not erase a valid result from the other.
- Returned bytes are written **verbatim**: no endian conversion is applied. The stored pane
  shows `Stored` without an endian tag.
- The script reads the current document bytes, including pending webview edits. It receives
  the check range and stored range in `api.context` (`selection`, `storedStart`, `storedEnd`).
  Script checks see the **full document**, so a script whose range overlaps its stored field
  must exclude those bytes itself (built-in checks exclude the stored field automatically).
- Script checks are read-only: `hex.write` is denied without a prompt. `exec` / `fetch` still
  require the normal approvals, and editing the script revokes them until re-approved.
- Results refresh when the Integrity tab first opens, on document open, after a save, and via
  the card's refresh action. Editing a byte marks a script result **Stale — refresh** instead
  of silently recalculating.
- A missing, untrusted, or contract-violating script shows a row-level error; other checks and
  Fix all keep working. Fix all stays atomic and refuses conflicting writes.

### Script-resolved instance addresses

A Type Overlay instance can take its base address from a `@script address` script instead of
a fixed number. This keeps one type + instance configuration usable across files whose
pointers move.

```typescript
/** @script address */

export function getAddress(api: HexScopeAPI): number {
    // Follow a pointer stored at the start of the document.
    const stored = api.hex.read(0x08000000, 4);
    const target = stored[0] | (stored[1] << 8) | (stored[2] << 16) | (stored[3] << 24);
    return target >>> 0;
}
```

- The export must return an unsigned 32-bit integer (or a Promise resolving to one).
  Fractional, negative, `NaN`, and out-of-range values are contract errors.
- `api.context` carries the instance identity and request data:

  | Field | Meaning |
  |-------|---------|
  | `instance` | `{ id, name, typeId, typeName }` of the instance being resolved |
  | `paramValues` | Resolved size-parameter values for the instance's type |
  | `documentSize` | Total mapped bytes in the document |
  | `selection` | Current hex selection (`{ start, end }`) when one exists |

- The script reads the current document bytes, including pending webview edits. Address
  scripts are read-only: `hex.write` is denied without a prompt; `exec` / `fetch` still
  require the normal approvals.
- Resolution runs on document open, profile switch, manual refresh (the Instances header
  **Refresh addresses** action or a card's ↻), after a save, and 400 ms after the document
  changes. It never runs on every keystroke.
- The resolved address is **transient**: it is never written into the profile. `addr` stays
  the authored fixed address used by older builds and as the numeric fallback.
- A failing script affects only its own instance. The card shows `resolving…`, the resolved
  address, `stale`, or the row-level error. On error (or while stale) no decoded rows are
  shown and the authored `addr` is never presented as current.
- Editing the script revokes its approvals and requires re-approval for the next
  `exec`/`fetch`. A missing or untrusted script shows `Script not found` / `Workspace not
  trusted` on the card.
- Address sources cannot be combined with pointer-created instance metadata; the editor
  keeps those instances on a fixed address.

### Script-resolved array sizes

A templated Type Overlay field can take its array count from a `@script size` script. The
script is attached per instance parameter, so one type follows the count stored in each file.

```typescript
/** @script size */

export function getSize(api: HexScopeAPI): number {
    const ctx = api.context;
    if (ctx.param !== 'ITEM_COUNT') { return 1; }
    // Read the count stored in the current document (pending edits included).
    return api.hex.read(0x08000010, 2)[0] | (api.hex.read(0x08000010, 2)[1] << 8);
}
```

The context is:

| Field | Meaning |
|-------|---------|
| `instance` | `{ id, name, typeId, typeName }` of the instance |
| `param` | The parameter this run resolves |
| `paramValues` | Already-resolved sibling values + authored values + type defaults (read-only) |
| `documentSize` | Total mapped bytes in the current document |
| `selection` | Current hex selection (`{ start, end }`) when one exists |

- Each parameter can be **Manual** (an entered value) or **From script**. A manual value
  wins; the card labels it Manual. A parameter with neither a value, a source, nor a
  default blocks decode.
- The returned value must be a positive safe integer. A script-produced count above
  1,000,000 is rejected (`Size is too large`); manual counts keep the editor's no-cap rule.
- Parameter scripts run before address scripts, so an address script's `paramValues`
  already contains the resolved counts.
- Resolution runs on the same schedule as address resolution (open, profile switch,
  refresh, save, and 400 ms after a document change). A stale, missing, or failing
  parameter blocks **only that instance's** decode and shows its error on the card.
- Resolved values are **transient**: only `paramSources` is saved in the profile; the
  values themselves are never written.
- Parameter scripts are read-only for `hex.write`; `exec` / `fetch` still ask through the
  normal inline approvals, and editing the script revokes its approvals.

### Getting type definitions

The bundled declaration file ships with the examples. **HexScope: Add Example Scripts**
installs it at `.hexscope/scripts/types/hexscope.d.ts`; copy it manually from the
extension's `examples/scripts/types/` folder if you prefer. A typed script references it
with:

```typescript
/// <reference path="./types/hexscope.d.ts" />
```

The declaration is ambient (no imports/exports), so `HexScopeAPI`, `ScriptContext`,
`FetchOptions`, `ExecResult`, and `FetchResult` are available after the reference.

### Execution model

| Aspect | Behavior |
|--------|----------|
| Entry point | `run(api)` for side-effecting scripts; role exports for value sources |
| Classification | Action (`run`), Provider (`@script` role), Both, or Unknown; scanned without executing |
| Panel grouping | Actions first, then Providers; alphabetical, collapsible, counts per group |
| Role discovery | `@script integrity\|address\|size` header tag; `@entry run` overrides the run scan |
| Contract errors | Wrong or missing role exports report `Contract Error` |
| Sync vs async | Both work. Return a `Promise` for async operations |
| Timeout | 30 seconds by default. Configurable |
| Error handling | Uncaught exceptions are caught and displayed in the output panel |
| Console | `console.log/warn/error` routes to the script output panel |

## API reference

### `api.hex` — reading and writing hex data

```typescript
api.hex.read(address: number, length: number): Uint8Array
api.hex.readSelected(): Uint8Array
api.hex.write(address: number, data: Uint8Array): Promise<boolean>
api.hex.size: number
```

| Method | Description |
|--------|-------------|
| `read(address, length)` | Returns bytes from the currently open document at the given firmware address. Stops reading at the first unmapped byte |
| `readSelected()` | Returns the bytes in the current editor selection. Captured at script-run time. Returns 1 byte when cursor sits on a single byte; empty `Uint8Array` when no selection |
| `write(address, data)` | Writes bytes. **Asks for approval inline in the Scripts panel.** Returns `true` if the call was approved; approved bytes are saved when the script finishes |
| `size` | Total number of mapped bytes in the document (sum of all segment lengths) |

Addresses are absolute firmware addresses from the parsed segments. If the address falls in a gap (unmapped region), `read` stops early and returns a shorter array.

**Example — reading a known region:**

```typescript
const vectorTable = api.hex.read(0x08000000, 128);  // first 128 bytes at 0x08000000
const stackPtr = new DataView(vectorTable.buffer).getUint32(0, true);  // first 4 bytes LE
api.output(`Stack pointer: 0x${stackPtr.toString(16).toUpperCase()}`);
```

**Example — reading the current selection:**

```typescript
const selected = api.hex.readSelected();
const hex = [...selected].map(b => b.toString(16).padStart(2, '0')).join(' ');
api.setResult('Selected bytes', hex.toUpperCase());
api.output(`Read ${selected.length} bytes from selection`);
```

**Example — patching bytes:**

```typescript
export async function run(api) {
    const addr = 0x08000000;
    const before = api.hex.read(addr, 1);
    api.output(`Current: 0x${before[0].toString(16).toUpperCase()}`);

    const ok = await api.hex.write(addr, new Uint8Array([0xFF]));
    api.setResult('Write accepted', ok ? 'Yes' : 'No');
}
```

The first dangerous call in a run opens one inline prompt inside the script's card. Approved
bytes are staged during the run and saved once, as a single undoable transaction, when the
script finishes without error. See [Permissions](#permissions--approving-dangerous-calls).

**Example — total size:**

```typescript
api.setResult('Total size', `${api.hex.size} bytes`);
const data = api.hex.read(0, api.hex.size);  // read everything
api.output(`Read ${data.length} bytes`);
```

### `api.context` — role-run context

```typescript
api.context: {
    instance?: { id: string; name: string; typeId: string; typeName: string };
    param?: string;
    paramValues?: Record<string, number>;
    documentSize?: number;
    selection?: { start: number; end: number };
    storedStart?: number;
    storedEnd?: number;
}
```

Populated only for role entries invoked by the overlay or integrity panel. `run` scripts get
an empty object. Use it to identify which instance or parameter the call is for:

```typescript
export function getSize(api: HexScopeAPI): number {
    if (api.context.param !== 'itemCount') { return 1; }
    return api.hex.read(0x08000010, 4)[0] ?? 1;
}
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

`api.exec(command, args?)` returns `Promise<ExecResult | null>`.

The first call in a run asks for approval inline in the Scripts panel (see
[Permissions](#permissions--approving-dangerous-calls)). Returns `null` if the call is denied.

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
- The full command string is shown in the inline approval prompt
- `exec` approvals are never persisted to the workspace: "workspace" scope is not offered

### `api.fetch` — HTTP/HTTPS requests

```typescript
api.fetch(url: string, options?: RequestInit): Promise<FetchResult | null>
```

`api.fetch(url, options?)` returns `Promise<FetchResult | null>`.

The first call in a run asks for approval inline in the Scripts panel, naming the host. Returns
`null` if the call is denied.

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

## Permissions — approving dangerous calls

`write`, `exec`, and `fetch` are dangerous: the first call in a run opens **one inline prompt**
inside that script's card. Nothing is asked before the run starts, and the prompt names the
script, the capability, and the concrete target (address + byte count, command, or host).

| Choice | Effect |
|--------|--------|
| **Allow once** | Approves this call only. The next dangerous call asks again |
| **Allow `<capability>` for this script, until VS Code restarts** | Any later call of that capability in the same unchanged file, until the extension host exits |
| **Allow all capabilities for this script, until VS Code restarts** | Same, for every dangerous capability of that file |
| **Allow `<capability>` for every script, until VS Code restarts** | Every script may use that capability until the extension host exits |
| **Allow all capabilities for every script, until VS Code restarts** | Same, for every dangerous capability |
| **Always allow `<capability>` for this script in this workspace, across restarts** | Persisted in workspace state; survives restarts; listed in the panel's **Permissions** section |
| **Always allow all non-exec capabilities in this workspace, across restarts** | Same, for `write` and `fetch` only |
| **Deny** (or <kbd>Esc</kbd>) | The call returns `false` / `null` and performs no write |

Rules:

- The prompt is keyboard accessible: focus starts on **Allow once**, **More options** lists the
  broader scopes, Escape denies, and focus returns to the card's Run button.
- There is no pre-run capability gate; dangerous calls are approved where they happen.
- Script- and workspace-scoped approvals are tied to the script file's fingerprint (mtime).
  Editing or deleting the script revokes them; the next run prompts again.
- Script- and session-scoped approvals live in memory, keyed by workspace root: closing and
  reopening an editor keeps them, and only the extension host exiting drops them. Session-wide
  approvals are intentionally broader (every script) and also survive per-script edits.
- `exec` is never persisted to the workspace — the workspace options are not offered for it.
- Unanswered prompts deny after 120 seconds, as do prompts whose panel is closed.
- The panel's **Permissions** section lists every grant — scope chip (`This script`,
  `This session`, `Workspace`), script (`All scripts` for a session-wide grant), and capability —
  with a **Revoke** per row. **Manage** reveals bulk revokes (per script, per scope); every bulk
  action needs a second confirming click.

### Saving approved writes

- Approved `write` bytes are staged during the run and committed **once** when the script
  finishes without error: the viewer stages one edit transaction and saves immediately.
- A run that errors, times out, or is cancelled discards its staged writes and reports
  "nothing was saved".
- <kbd>Ctrl</kbd>+<kbd>Z</kbd> after a script run restores the pre-run bytes (dirty), and
  <kbd>Ctrl</kbd>+<kbd>S</kbd> saves them again.
- The result card shows an informational byte count ("written and saved" or "discarded").
  There is no Apply/Discard control.

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

### Byte patching with approval

```typescript
export async function run(api) {
    const addr = 0x08000000;
    const before = api.hex.read(addr, 1);
    api.output(`Current byte at 0x${addr.toString(16).toUpperCase()}: 0x${before[0].toString(16).toUpperCase()}`);

    // write() asks for approval once, then the approved byte is saved on success
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
| Inline approval for `write`, `exec`, `fetch` | No silent data corruption, hidden shell commands, or data exfiltration |
| Fingerprint-scoped grants | An approval cannot be reused after the script changes |
| `exec` never persisted | Shell access is never a standing workspace permission |
| 30-second timeout | Prevents runaway CPU from infinite loops |
| Try-catch wrapper | Errors are caught and displayed, the extension host stays alive |

For future CLI usage, the same scripts run unmodified — only the host adapter changes (stdin approval prompts instead of the inline panel, stdout output instead of the sidebar). The `ScriptHost.confirm(type, detail)` contract is unchanged, so a CLI host can keep whatever approval UI it prefers.
