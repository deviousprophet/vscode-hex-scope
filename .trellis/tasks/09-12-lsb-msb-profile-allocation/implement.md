# Implementation — Persist LSB/MSB bit-field allocation in profiles.json

Branch: `feat/lsb-msb-profile-persistence` (base `main`).

## Steps

1. **Protocol** — `src/webviewProtocol.ts`
   - Add `bitAllocationOrDefault` beside `endianOrDefault`.
   - `init` + `perFileDataChange` add `bitAllocation: BitFieldAllocation` (import type from core/types).
   - `WebviewToProviderMessage` add `{ type: 'saveBitAllocation'; bitAllocation: BitFieldAllocation }`.

2. **Storage** — `src/hexScopeStorage.ts`
   - `ProfileRecord` add `bitAllocation`.
   - `emptyProfileRecord` add `bitAllocation: 'msb'`.
   - `normalizeProfileRecord` add `bitAllocation: bitAllocationOrDefault(candidate.bitAllocation)`.

3. **Host session** — `src/hexEditorSession.ts`
   - `postInit` msg: `bitAllocation: profileData.bitAllocation`.
   - `broadcastPerFileData`: `bitAllocation: p.bitAllocation`.
   - messageHandlers: `saveBitAllocation` (validate `'lsb'|'msb'`, guard, `withBoundProfile({ ...current, bitAllocation: msg.bitAllocation })`) — copy `saveEndian`.

4. **Webview model** — `src/webview/appModel.ts`, `src/webview/webviewMessageModel.ts`
   - `applyInitialState`: `S.bitFieldAllocation = bitAllocationOrDefault(msg.bitAllocation)`.
   - `applyPerFileDataChangeMessage`: same + invalidation `bitFieldAllocationChanged: true`.
   - `WebviewInvalidations` type: add `bitFieldAllocationChanged`.

5. **Webview consumers** — `src/webview/hexViewer.ts`
   - `writeBitAllocationToConsumers(bitAllocation)` → `structPanel.setBitFieldAllocation(bitAllocation)`.
   - `applyScopedInvalidations`: add `['bitFieldAllocationChanged', applyBitFieldAllocationChanged]`.
   - Wire StructPanel callback `onBitAllocationChange`: set `S.bitFieldAllocation` +
     `postProviderMessage({ type: 'saveBitAllocation', bitAllocation })`.

6. **Struct panel** — `src/webview/components/sidebar/structPanel/structPanel.ts`
   - `StructCallbacks` add `onBitAllocationChange`.
   - `wireBitLayoutTabs` clicks call `this.cb.onBitAllocationChange?.(this._bitFieldAllocation)`.

7. **Schema** — `schemas/profiles.schema.json`
   - `profileRecord`: add `"bitAllocation"` to `required` + properties enum `["lsb","msb"]`.

8. **Tests**
   - `src/test/schemas/schemaValidation.test.ts`: profiles accepts `'lsb'`/`'msb'`,
     rejects invalid enum; struct fixtures keep their own `allocation` override key.
   - `src/test/extension/hexScopeStorage.test.ts`: default `'msb'` on empty/legacy record;
     round-trip persist/read.
   - Webview tests: init/perFileData change drives `S.bitFieldAllocation`; toggle fires
     `onBitAllocationChange` (extend existing struct panel toggle test).

## Validation

- `npm run check-types`, `npm run lint`, `npm test`
- Manual: open editor → toggle LSB/MSB in bit-layout detail → confirm `bitAllocation`
  appears in `.hexscope/profiles.json`; switch profile → allocation restored; delete key
  → defaults back to `'msb'`.

## Rollback

- Single commit revert; additive schema/field is forward/backward compatible (no
  migration needed).