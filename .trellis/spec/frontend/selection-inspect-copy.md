# Selection, Inspector, and Byte Tools Code-Spec

## Scenario: Select, decode, analyze, and copy bytes

### 1. Scope / Trigger

Applies to memory selection/drag behavior, Inspector, context commands/menu, and `core/byte-tools/`. Search engine behavior is owned by [Search Engine Code-Spec](./search-engine.md); search bar UI by [SearchBar Component Code-Spec](./components/component-search-bar.md).

### 2. Signatures

```typescript
type SelectionRange = { start: number; end: number };
function selectedBytes(): number[];
function formatCopyCommand(cmd: CopyCommand, bytes: number[]): string;
function formatAnalyzeCommand(cmd: AnalyzeCommand, bytes: number[]): AnalyzeResult;
```

### 3. Contracts

- Selection ranges are inclusive and normalized. Shift-click/drag expands selection; context commands read bytes through the edit-aware byte accessor. `selectedBytes()` skips unmapped addresses inside a spanning selection (parity with the keyboard copy path; no zero-fill).
- Copy/analyze byte payloads are gap-filtered: `selectedBytes()` and `collectSelectedBytes()` (keyboard path) both skip unmapped addresses; selection fully inside an unmapped gap yields `[]` and emits no copy.
- Inspector decodes selected bytes using shared per-file endian and updates when selection, endian, or pending edits change.
- Copy commands are closed unions (`hex`, raw hex, binary, ASCII, decimal/hex arrays, Base64, decimal, C array). Analyze commands are validated before dispatch.
- Copy output is deterministic and context menu actions operate on the explicit current selection/target.
- CRC algorithms: `crc8` = CRC-8 (poly 0x07, init 0x00), `crc16` = real CRC-16/Modbus (poly 0xA001, init 0xFFFF, check vector "123456789" → 0x4B37), `crc32` = CRC-32/ISO-HDLC (check vector "123456789" → 0xCBF43926). Same functions back the scripting API.

### 4. Validation & Error Matrix

| Condition | Behavior |
|---|---|
| Selection spans an unmapped byte | `selectedBytes()` skips the address; all-unmapped selection yields `[]` and copies nothing. Keep this parity with the keyboard copy path explicit in copy/analyze tests. |
| Unknown copy/analyze command | Type guard rejects it. |
| 64-bit Inspector value | Preserve precision with `bigint` formatting. |

### 5. Good/Base/Bad Cases

- Base: selected edited byte copies/decodes the edited value.
- Good: copying a selection that spans an unmapped gap yields only mapped bytes, identical to the keyboard copy path.
- Bad: zero-fill unmapped addresses when copying — phantom `0x00` bytes corrupt hex dumps and CRC/sum analysis.

### 6. Tests Required

- Selection: click, shift, drag, context target, inclusive range, edited/unmapped reads.
- Gap-filtered copy/analyze: selection spanning a gap copies mapped bytes only (assert exact array, no `0x00`); all-unmapped selection yields `[]` (Copy/Analyze no-op); edited byte in range copied as edited value. Assert parity with keyboard copy path.
- Byte tools: every command format, ASCII substitutions, Base64, arrays, CRC/analyze outputs, invalid command guards.
- Inspector/UI assertions live in `src/test/webview/webview.test.ts`; formatting in `utils.test.ts`.

### 7. Wrong vs Correct

#### Wrong

```typescript
// Zero-fills unmapped gap addresses — copies phantom 0x00, corrupts hex/ASCII/base64 and CRC/sum analysis
for (let a = range.start; a <= range.end; a++) {
    out.push(getByte(a) ?? 0);
}
```

#### Correct

```typescript
// Skip unmapped addresses; selection fully inside an unmapped gap yields [] and copies nothing
for (let a = range.start; a <= range.end; a++) {
    const b = getByte(a);
    if (b !== undefined) { out.push(b); }
}
```
