# Script hex.write: stage writes into viewer + Apply/Discard control

## Goal
Script `hex.write` bytes no longer vanish. The run result carries the actual
writes; the Scripts panel lets the user apply them as staged edits (visible,
savable) or discard per run.

## Requirements

### Transport
- `scriptResult` message gains `pendingWrites` (address/value pairs), not just
  a count. Provider already has them (`host.pendingWrites`).
- Backward compatible: webview falls back to count-only (no controls) when the
  list is absent.

### Panel
- Writes line in the result card is actionable:
  `Writes: N → [Apply & Save] [Discard]`.
  - **Apply & Save**: stage the writes into the viewer's edit overlay (only
    mapped addresses), enter edit mode (dirty chrome), then save immediately
    (existing `saveEdits` path → file written).
  - **Discard**: drop the run's pending writes; grid untouched, nothing dirty,
    file untouched.
- Writes persist in the card until Apply/Save or the next run; new run replaces
  them. Per-run decision — no global config.

### Filtering
- Only addresses inside a mapped segment are staged. Unmapped writes are
  dropped; if none survive filtering the Apply&Save button shows a note and
  does nothing.
  (Matches `writeBytes` behavior of not validating mapping — now surfaced.)

## Acceptance Criteria

- [ ] Running `write-patch.js` shows `Writes: 3 → [Apply & Save] [Discard]`.
- [ ] Apply & Save: bytes shown tinted in the grid, dirty indicator on, saved
  file contains the bytes after save.
- [ ] Discard: grid unchanged, no dirty, file unchanged.
- [ ] Unmapped writes are filtered out and reported (0-survivors → disabled
  control with note).
- [ ] Old provider payload (count only) still renders the plain count row.
- [ ] `npm run check-types`, `npm run lint` pass; webview suites pass
  (scriptsPanel writes-line tests added).
- [ ] Capability confirm modal unchanged; non-write scripts unaffected.