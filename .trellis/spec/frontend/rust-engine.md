# Rust Parsing Engine

The extension's document core is the packaged Rust engine. TypeScript owns VS Code integration
and the webview UI; it does not parse firmware files and has no fallback parser.

## Ownership

| Path | Owns |
|---|---|
| `rust/hex-core` | Intel HEX / SREC / raw-binary parsing, compact metadata pages, segment assembly, checksum repair |
| `rust/hex-engine` | Framed stdio protocol, request dispatch, progress frames |
| `rust/parser-rs` | `rust-anything` parity crate for primitive helpers; not shipped |
| `src/host/engine/engineClient.ts` | Spawn, framing, correlation, response mapping |
| `src/host/engine/engineLoader.ts` | Required session process, restart-on-crash, wire projection |
| `src/core/parser/*`, `src/core/document.ts` | Reference parsers (tests only); text serializers/splice planning for saving edits |

## Contract

- One required `hex-engine` process per extension host session. Activation starts it; a start
  failure aborts activation with an actionable message.
- Frame: `[u32 LE payload_len][u16 LE header_len][header JSON][body]`.
- Request ops:
  - `ping` (handshake, `protocol: 1`)
  - `parse` (`format: ihex | srec | bin`, `baseAddress` required for `bin`)
  - `records` (parse record-page lines; text formats)
  - `repair` (rewrite wrong checksum fields; text formats)
- Progress frames use `id: 0` and `event: "progress"` before the final parse response.
- The final `parse` body is, per page, `sourceStart`, `sourceEnd`, `lineNumber`, `address`,
  `resolvedAddress` (u32 LE each), then `byteCount`, `recordType`, `checksum`, `flags` (u8 each),
  followed by every segment's bytes. Header metadata carries lengths/offsets only.
- `sourceStart` / `sourceEnd` are **UTF-16 code-unit offsets**, matching JavaScript string
  slicing.
- A request failure restarts the engine once and retries; a second failure propagates to the
  caller. Nothing is parsed in TypeScript.

## Runtime call sites

- Editor open / external reload: `parseTextWithEngine`.
- Compare sides: `parseTextWithEngine` / `parseBinaryWithEngine`.
- Record table pages: `parseLinesWithEngine`.
- Quick repair and compare-side repair: `repairWithEngine`.
- Extension compare validation: `readParseResult` → engine `parse` counts.

## Parity bar

Changing a parser means changing both implementations:

1. `rust/hex-core` unit tests for the branch.
2. `src/test/core/parser/engineParity.test.ts` fixtures (IHEX/SREC/BIN, malformed lines,
   checksum failures, extended/segment addressing, multi-page metadata, repair, record lines).
3. `rust-anything build/diff/gate rust/parser-rs` for the bridged helpers.

Engine protocol changes bump `ENGINE_PROTOCOL` and `docs/engine-protocol.md` is updated in the
same change.

## Build and packaging

- `npm run engine:build` → `dist/engine/<platform>-<arch>/hex-engine[.exe]`.
- `HEXSCOPE_SKIP_RUST_BUILD=1` skips the cargo build when CI already downloaded the artifact.
- One universal VSIX carries `linux-x64`, `win32-x64`, `darwin-x64`, `darwin-arm64`.
- Rust sources are excluded from the VSIX (`.vscodeignore`).

## Pitfalls recorded during the port

- `rust-anything`'s binary wire cannot round-trip `Uint8Array` nested inside a result object; the
  bridge turns `{"$bytes": ...}` into a plain object. The record-producing parser exports
  therefore stay in TypeScript as test-only references; only primitive helpers are bridged
  (`rust/parser-rs`), and the engine parity test is the runtime parser's proof.
- JavaScript semantics are not Rust semantics: use `src/core`-matching `\s` trimming, UTF-16
  offsets for source ranges, `ToUint32`/`ToInt32`, and `Number::toString` (see `hex-core`'s
  `text.rs` and `jsnum.rs`). Do not replace them with `char::is_whitespace`, byte offsets or
  `as u32` casts.
- Node 26's built-in TypeScript stripping rejects parameter properties; `rust-anything record`
  needs a compiled module or `tsx`. Use the `out/` build plus a temporary barrel when recording.
- The engine sends one `build` progress event before its response, not per-chunk `parse` events;
  the host keeps its monotonic percent gate, so the bar may jump but never regresses.
