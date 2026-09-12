# Design — Persist LSB/MSB bit-field allocation in profiles.json

## Data model

`ProfileRecord` gains one field named `bitAllocation`, mirroring `endian`:

```ts
// src/hexScopeStorage.ts
export interface ProfileRecord {
    id: string;
    name: string;
    structPins: StructPin[];
    activeChecks: IntegrityCheckSet;
    endian: HexScopeEndian;
    bitAllocation: BitFieldAllocation;   // NEW — global bit-field allocation
    segmentNames: SegmentNameOverrides;
    labels: SegmentLabel[];
}
```

- `emptyProfileRecord` → `bitAllocation: 'msb'`.
- `normalizeProfileRecord` → `bitAllocation: bitAllocationOrDefault(candidate.bitAllocation)`.

`bitAllocationOrDefault` lives beside `endianOrDefault` in `src/webviewProtocol.ts`:

```ts
export function bitAllocationOrDefault(value: unknown): BitFieldAllocation {
    return value === 'lsb' ? 'lsb' : 'msb';
}
```

Schema: additive `bitAllocation` member on `profileRecord` (enum `["lsb","msb"]`), added to
`required`. Version envelope stays `const: 1`. Naming is deliberately distinct from the
per-field/per-struct `allocation` override keys in `structs.json` — profile-level wire
payloads and the schema use `bitAllocation` for clarity.

## Message flow (mirror of endian)

| Endian path | Bit-allocation path |
| --- | --- |
| `init.endian` | `init.bitAllocation` (new) |
| `perFileDataChange.endian` | `perFileDataChange.bitAllocation` (new) |
| `WebviewToProviderMessage.saveEndian` | `saveBitAllocation` (new) |
| host `postInit` / `broadcastPerFileData` read `p.endian` | read `p.bitAllocation` |
| handler `saveEndian` → `withBoundProfile({ ...current, endian })` | `saveBitAllocation` → `withBoundProfile({ ...current, bitAllocation })` |
| webview `applyInitialState` / `applyPerFileDataChangeMessage` set `S.endian` | set `S.bitFieldAllocation` |
| invalidation `endianChanged` → `writeEndianToConsumers` | invalidation `bitFieldAllocationChanged` → `writeBitAllocationToConsumers` |

No changes needed on the decode side: `decodeStructRecursive` already accepts a
`bitFieldAllocation` argument; the struct panel seeds `_bitFieldAllocation` from the host
push via `setBitFieldAllocation`. Struct panel is the only consumer of the global
allocation (`hexViewer.ts:194`), so `writeBitAllocationToConsumers` calls
`structPanel.setBitFieldAllocation(bitAllocation)`.

## User toggle persistence

Struct panel `wireBitLayoutTabs` (structPanel.ts:2051) currently mutates only
`this._bitFieldAllocation`. Add a callback to `StructCallbacks`:

```ts
onBitAllocationChange?: (bitAllocation: BitFieldAllocation) => void;
```

Called on LSB/MSB click. hexViewer wires it to:
`S.bitFieldAllocation = bitAllocation; postProviderMessage({ type: 'saveBitAllocation', bitAllocation });`

Host persists via `withBoundProfile` (debounced registry write). Local preview stays;
host push (e.g. profile switch via `broadcastPerFileData`) is authoritative on refresh.

## Compatibility / rollback

- Additive + normalized: files created with the new key still pass old-schema readers
  (extra key tolerated by envelope + old runtime normalizer drops it). No data migration.
- Round-trip: save → normalize → read preserves `'lsb'`/`'msb'`.
- Default for legacy records = `'msb'`, identical to today's hardcoded default → no
  behavior change for existing profiles.