# Integrity Checks and Profiles Code-Spec

## Scenario: Calculate, compare, persist, and fix firmware integrity values

### 1. Scope / Trigger

Applies to `src/core/integrity.ts`, integrity model/sidebar/persistence, protocol check messages, Memory highlights, and edit transactions.

### 2. Signatures

```typescript
type IntegrityAlgorithm =
    | 'crc16-ccitt-false' | 'crc32-iso-hdlc'
    | 'md5' | 'sha-1' | 'sha-256' | 'sha-512';

interface IntegrityCheckConfig {
    algorithm: IntegrityAlgorithm;
    startAddress: number;
    endAddress: number;
    storedAddress?: number;
    autoFixStoredValue: boolean;
}

// Retained only for legacy-migration normalization (hexScopeMigration.ts);
// the webview Integrity panel shows checks, never IntegrityProfile templates.
interface IntegrityProfile { schemaVersion: 1; id: string; name: string; checks: IntegrityCheckConfig[]; }
interface IntegrityCheckSet { schemaVersion: 1; checks: IntegrityCheckConfig[]; }

function validateIntegrityRange(...): IntegrityValidation<IntegrityRequest>;
function collectIntegrityBytes(...): IntegrityValidation<Uint8Array>;
function collectIntegrityBytesAsync(..., options?: WorkBudgetOptions): Promise<IntegrityValidation<Uint8Array>>;
function calculateIntegrity(algorithm, bytes, options?: WorkBudgetOptions): Promise<IntegrityResult>;
function mergeIntegrityEdits(groups): IntegrityValidation<IntegrityEdit[]>;
```

### 3. Contracts

- Start/end addresses are hexadecimal unsigned 32-bit and inclusive.
- Every address in a range must be mapped unless it belongs to an explicitly excluded stored field.
- Large byte collection and software integrity algorithms use the shared 24 ms work budget and yield cooperatively; SHA algorithms remain delegated to Web Crypto.
- Every integrity algorithm may compare against stored bytes. Selected stored byte order (LE/BE) applies to checksums (CRC16/CRC32) only; MD5/SHA-1/SHA-256/SHA-512 are fixed byte sequences with no integer endianness and always use natural byte order (`isChecksumAlgorithm()` in `src/core/integrity.ts` is the single gate — see Wrong vs Correct).
- If stored field overlaps calculated range, exclude its bytes from calculation.
- Calculated value text is uppercase; conversion to stored bytes honors selected LE/BE for checksums and is always natural order for hashes. The stored pane shows an endian tag only for checksums (`Stored (LE)`/`Stored (BE)`); hash panes read plain `Stored`.
- Checks use pending edited bytes through the shared reader.
- Auto fix stages expected stored bytes through the edit transaction seam; suppression prevents an immediate recalculation loop from reapplying the same mismatch.
- Fix all merges edits first and fails atomically on conflicting overlapping byte values.
- Per-file active checks persist as `IntegrityCheckSet` inside the bound file profile (`activeChecks` in `.hexscope/profiles.json`); the standalone `IntegrityProfile[]` template registry is retired from the UI — legacy templates still migrate into registry profiles (see hexscope-storage.md).
- Profile normalization (legacy templates only) drops malformed entries and case-insensitive duplicate names.
- Selected/hovered check highlights calculation range plus optional stored range with match/mismatch/unverified status.

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Missing/malformed/overflow address | Labeled validation error. |
| End before start | `End address must be greater than or equal to start address.` |
| First unmapped range byte | `No mapped byte at 0x........`. |
| Stored bytes unmapped | Stored-address error; no comparison/fix. |
| Stored field configured for any algorithm | Retain its address and Auto fix setting; validate against the algorithm output length. |
| Malformed persisted profile/check set | Drop/reject during normalization; never trust cast. |
| Duplicate profile name ignoring case | Keep one valid unique name; reject/drop duplicate. |
| Fix groups write different values to same address | `Fix all conflict at 0x........`; apply none. |
| Check result token becomes stale | Ignore stale async result. |

### 5. Good/Base/Bad Cases

- Base: SHA-256 over one mapped inclusive range shows digest and byte count; an optional full-digest stored field compares, highlights, and fixes.
- Good: an integrity stored field overlaps range; bytes are excluded, expected value converted to selected byte order for checksums (natural order for hashes), mismatch is highlighted, fix is undoable.
- Good: profile round-trip preserves `activeChecks` as normalized schema-v1 config inside the bound profile.
- Bad: calculate across a gap by skipping missing bytes.
- Bad: partially apply Fix all before discovering an overlap conflict.

### 6. Tests Required

- `src/test/core/integrity.test.ts`: canonical `123456789` vectors, range parsing, missing bytes, overlap exclusion, byte order, stored reads, normalization, merge conflicts.
- `src/test/webview/integrityCheckModel.test.ts`: draft/config round-trip including hash stored fields, indexed validation errors, result/suppression reset.
- `src/test/webview/webview.test.ts`: cards, shared byte order, forms, highlights/actions.
- Add async token/stale-result and end-to-end edit-transaction assertions for calculation changes.

### 7. Wrong vs Correct

#### Wrong

```typescript
for (const fix of fixes) applyEdits(fix); // partial mutation before conflict found
```

#### Correct

```typescript
const merged = mergeIntegrityEdits(fixes);
if (!merged.ok) return showError(merged.error);
stageIntegrityEditTransaction(merged.value);
```

#### Wrong (byte order applied to every algorithm)

```typescript
check.expectedBytes = integrityValueToBytes(result.value, hooks.endian());
```

#### Correct

```typescript
const byteOrder = isChecksumAlgorithm(check.algorithm) ? hooks.endian() : 'be';
check.expectedBytes = integrityValueToBytes(result.value, byteOrder);
```

Reversing a hash digest under LE makes byte-perfect matches report Mismatch and writes the reversed digest back through Auto fix / Fix all. `expectedBytes` feeds compare, highlight, and writeback, so the gate belongs exactly once at this seam. The same gate (and the checksum-only stored label) applies in `integrityResultRender.ts` for the stored pane.

Core integrity module owns validation/algorithms; sidebar owns presentation and async scheduling.
