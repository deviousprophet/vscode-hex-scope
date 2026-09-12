# Persist LSB/MSB bit-field allocation in profiles.json

## Goal

The per-file global bit-field allocation (LSB-first / MSB-first) must be a per-profile
setting persisted in `.hexscope/profiles.json`, exactly mirroring how the global byte
`endian` already works. Changing the MSB/LSB toggle in the struct bit-layout detail
persists to the bound profile; selecting/switching a profile restores it; external edits
to the profile re-broadcast it to the webview. `profiles.schema.json` must be updated.

## Background

Today `S.bitFieldAllocation` (webview state, default `'msb'`) is session-local. The
host never sends it; the toggle in the struct panel's bit-layout detail only mutates a
panel-local copy. By analogy to `endian`, it should live on `ProfileRecord` as
`bitAllocation`, flow through `init` / `perFileDataChange`, be saved via a new
`saveBitAllocation` message, and be normalized on read for robustness (legacy records
absent the key → default `'msb'`).

## Constraints

- Mirror the existing `endian` data path end-to-end (schema → storage normalizer →
  host push → webview model → consumers → save message). Do not invent a parallel design.
- `profiles.schema.json` schema version envelope stays `1`; `bitAllocation` is additive
  and normalized (old files without it remain valid).
- Default bit allocation for profiles without an explicit value: `'msb'` (matches current
  `S.bitFieldAllocation` default and struct-decoder default).
- Only `'lsb'`/`'msb'` accepted; anything else normalizes to `'msb'`.
- Per-field / per-struct `allocation` overrides in `structs.json` are untouched
  (kept distinct from the profile-level `bitAllocation` key on purpose).

## Acceptance Criteria

- [x] `ProfileRecord` in `src/hexScopeStorage.ts` gains `bitAllocation: BitFieldAllocation`;
      `emptyProfileRecord` defaults it to `'msb'`; `normalizeProfileRecord` normalizes it
      (`bitAllocationOrDefault`).
- [x] `bitAllocationOrDefault` added next to `endianOrDefault` in `src/webviewProtocol.ts`.
- [x] `init` and `perFileDataChange` provider messages carry `bitAllocation`;
      `WebviewToProviderMessage` gains `{ type: 'saveBitAllocation'; bitAllocation }`.
- [x] Host `postInit` and `broadcastPerFileData` in `src/hexEditorSession.ts` include
      `bitAllocation` from the bound profile record; `saveBitAllocation` persists into the
      bound profile exactly like `saveEndian`.
- [x] Webview model (`applyInitialState`, `applyPerFileDataChangeMessage`) sets
      `S.bitFieldAllocation`; new invalidation `bitFieldAllocationChanged` re-drives
      `structPanel.setBitFieldAllocation`.
- [x] Struct panel MSB/LSB toggle reports changes to host via a new callback
      (`onBitAllocationChange`); hexViewer sets `S.bitFieldAllocation` and posts
      `saveBitAllocation`. Host push still wins on re-render (setBitFieldAllocation parity).
- [x] `profiles.schema.json`: `bitAllocation` enum `["lsb","msb"]` added to
      `profileRecord` properties and `required`.
- [x] Existing tests green; schema-validation test covers `bitAllocation` acceptance +
      rejection on profiles; a storage test covers default + round-trip persistence.
- [x] `npm run build` / `npm test` pass.