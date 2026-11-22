# Hex Scope engine protocol

The extension host owns one required `hex-engine` process per session. It owns Intel HEX,
Motorola SREC and raw binary parsing, record-page line parsing and checksum repair. The extension
host and webview are clients: they never parse firmware text themselves.

- Binary: `dist/engine/<platform>-<arch>/hex-engine[.exe]`
- Transport: stdin/stdout, little-endian framing
- Version: `ENGINE_PROTOCOL = 1` (`src/host/engine/engineClient.ts`)

## Frame

```
[u32 LE payload_len][u16 LE header_len][header JSON (header_len bytes)][body]
```

`payload_len = header_len + body length`. Frames are capped at 64 MiB. The header is compact
JSON; the body holds source text or record/segment bytes and is never JSON-escaped.

## Handshake

Request:

```json
{"id":1,"op":"ping"}
```

Response:

```json
{"id":1,"ok":true,"protocol":1,"engine":"hex-engine","version":"0.1.0"}
```

The client refuses an engine whose `protocol` differs.

## Parse

Request header:

```json
{"id":2,"op":"parse","format":"ihex"}
{"id":3,"op":"parse","format":"srec"}
{"id":4,"op":"parse","format":"bin","baseAddress":4096}
```

- Text formats: body is the UTF-8 source file.
- Raw binary: body is the image bytes; `baseAddress` is required and must be a 32-bit unsigned
  integer.

Progress frame (sent before the response, `id` is 0):

```json
{"id":0,"event":"progress","stage":"build","completed":17,"total":17}
```

Response header:

```json
{"id":2,"ok":true,"recordCount":17,"totalDataBytes":4096,"checksumErrors":0,
 "malformedLines":0,"startAddress":134217728,"pageLengths":[17],
 "segments":[{"startAddress":134217728,"offset":0,"length":4096}]}
```

Response body layout, in order:

1. For each page in `pageLengths`: `sourceStart` (u32 LE × length), `sourceEnd` (u32 LE),
   `lineNumber` (u32 LE), `address` (u32 LE), `resolvedAddress` (u32 LE), `byteCount` (u8),
   `recordType` (u8), `checksum` (u8), `flags` (u8).
2. Every segment's data bytes, concatenated in `segments` order; `offset` is relative to the
   start of this segment area.

`sourceStart` / `sourceEnd` are UTF-16 code-unit offsets into the source, so the host can slice
the original JavaScript string for record materialisation. `flags` bit 0 = checksum valid, bit 1
= malformed line. `startAddress` is omitted when absent, and may be negative for an Intel HEX
start-linear record (it is a signed 32-bit value). `baseAddress` is omitted for text formats.

## Record lines

The record table asks the engine to parse the exact lines of a page instead of reparsing the
file. Request header `{"id":5,"op":"records","format":"ihex"}`; body is a JSON array:

```json
[{"lineNumber":1,"raw":":0400100001020304E2"}]
```

Response body is a JSON array of record objects
(`lineNumber`, `raw`, `byteCount`, `address`, `recordType`, `data` as numbers, `checksum`,
`checksumValid`, `resolvedAddress`, optional `error`). The host overlays page metadata
(`address`, `recordType`, `checksum`, `flags`) after the call.

## Repair

Request header `{"id":6,"op":"repair","format":"srec"}`; body is the UTF-8 source. The engine
rewrites the last two characters of every valid record whose checksum is wrong, preserving the
line-ending style, and returns `{"id":6,"ok":true,"repaired":N}` with the repaired source as the
response body.

## Errors

```json
{"id":2,"ok":false,"error":"source is not valid UTF-8"}
```

Errors are per request. An unknown `op`, an invalid `format`, a missing base address or invalid
UTF-8 produce an error frame and the process stays alive. A frame that cannot be read (oversized,
header longer than payload, truncated stream) is fatal: the engine exits and the host restarts it
on the next request. Closing stdin ends the process.

## Failure policy

The engine is required. Activation starts it and aborts with an actionable error when it cannot
start. At runtime a failed request restarts the process once and retries; a second failure is
reported to the user. There is no TypeScript parser to fall back to.
