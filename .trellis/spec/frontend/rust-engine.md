# Rust Parsing Engine

The extension's record parsers run in a packaged Rust binary. TypeScript keeps the same
parsers as the reference implementation and as the fallback path.

## Ownership

| Path | Owns |
|---|---|
| `rust/hex-core` | Intel HEX / SREC / raw-binary parsing, compact metadata pages, segment assembly |
| `rust/hex-engine` | Framed stdio protocol, request dispatch, progress frames |
| `rust/parser-rs` | `rust-anything` parity crate for primitive helpers; not shipped |
| `src/host/engine/engineClient.ts` | Spawn, framing, correlation, response mapping |
| `src/host/engine/engineLoader.ts` | Session process, root resolution, fallback policy, wire projection |
| `src/parse/parseWorker.ts` | TypeScript compact parser used when the engine is unavailable |

## Contract

- One `hex-engine` process per extension host session, started lazily on the first parse.
- Frame: `[u32 LE payload_len][u16 LE header_len][header JSON][body]`.
- Request ops: `ping` (handshake, `protocol: 1`) and `parse`
  (`format: ihex | srec | bin`, `baseAddress` required for `bin`).
- Progress frames use `id: 0` and `event: "progress"` before the final response.
- The final `parse` body is, per page, `sourceStart`, `sourceEnd`, `lineNumber`, `address`,
  `resolvedAddress` (u32 LE each), then `byteCount`, `recordType`, `checksum`, `flags` (u8 each),
  followed by every segment's bytes. Header metadata carries lengths/offsets only.
- `sourceStart` / `sourceEnd` are **UTF-16 code-unit offsets**, matching JavaScript string
  slicing.
- A missing binary, a start failure or a request failure never breaks loading: the host
  remembers the reason and uses the TypeScript compact parser.

## Parity bar

Changing a parser means changing both implementations:

1. `rust/hex-core` unit tests for the branch.
2. `src/test/core/parser/engineParity.test.ts` fixtures (IHEX/SREC/BIN, malformed lines,
   checksum failures, extended/segment addressing, multi-page metadata).
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
  therefore stay in TypeScript; the engine parity test is their proof. Only primitive helpers are
  bridged (`rust/parser-rs`).
- JavaScript semantics are not Rust semantics: use `src/core`-matching `\s` trimming, UTF-16
  offsets for source ranges, `ToUint32`/`ToInt32`, and `Number::toString` (see `hex-core`'s
  `text.rs` and `jsnum.rs`). Do not replace them with `char::is_whitespace`, byte offsets or
  `as u32` casts.
- Node 26's built-in TypeScript stripping rejects parameter properties; `rust-anything record`
  needs a compiled module or `tsx`. Use the `out/` build plus a temporary barrel when recording.
- The engine sends one `build` progress event before its response, not per-chunk `parse` events;
  the host keeps its monotonic percent gate, so the bar may jump but never regresses.
