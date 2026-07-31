# Fix context-menu copy across unmapped gap emits 0x00

## Goal

Issue #142: `selectedBytes()` in `src/webview/memory/selection.ts` substitutes `0` for unmapped gap addresses (`getByte(a) ?? 0`), so right-click Copy / Analyze on a selection spanning an unmapped gap emits phantom `0x00` bytes. Keyboard copy path (`collectSelectedBytes()` in `src/webview/hexViewer.ts`) already skips unmapped addresses — context menu must behave identically.

## Requirements

- `selectedBytes()` skips unmapped addresses instead of substituting `0` (matches keyboard-copy behavior).
- Selection fully inside an unmapped gap yields zero bytes → no copy emitted (no phantom text, no silent CRC/sum on empty data).
- Applies to all context-menu consumers: Copy (hex, hex-raw, binary, ASCII, dec-array, hex-array, base64, dec, c-array) and Analyze (sum, XOR, CRC-8/16/32).
- `contextCommandResult()` / `copyCommandResult()` already guard `bytes.length === 0` → `{ type: 'none' }`; fix at `selectedBytes()` source so all callers benefit, no per-command changes.
- Context menu header/len still reflect address-range selection length (unchanged behavior), only byte payload is gap-filtered.

## Acceptance Criteria

- [ ] `selectedBytes()` over selection spanning two segments + gap returns only mapped bytes (no `0x00` from gap).
- [ ] `selectedBytes()` over selection fully inside gap returns `[]`.
- [ ] Context-menu Copy hex of gap-spanning selection yields only mapped bytes (matches keyboard `collectSelectedBytes()`).
- [ ] Analyze (sum/XOR/CRC) over gap-spanning selection computed on mapped bytes only.
- [ ] All-unmapped selection: `contextCommandResult` returns `{ type: 'none' }` — nothing copied.
- [ ] New unit tests in `src/test/webview/` covering gap-skipping; existing suite green.
- [ ] `npm test` passes; `npm run lint` (or repo lint script) passes.

## Notes

- Lightweight, single-source fix. No design.md needed (one-line change + tests). implement.md optional — small enough for direct execution.
- Branch `fix/gap-copy-zero` (main protected; PR targets main).
- Do not touch inspector `selectedBytes(len)` (`src/webview/sidebar/inspector/index.ts`) — that's display of selection values, out of scope per issue.
