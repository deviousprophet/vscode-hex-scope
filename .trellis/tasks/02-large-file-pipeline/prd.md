# Large-file pipeline MVP

## Goal

Open and retain Intel HEX and Motorola SREC documents representing up to 64 MiB of mapped flash without blocking the extension host or duplicating record payloads across millions of JavaScript objects. Two maximum-size documents must remain usable concurrently.

## Background

- Current parsing is synchronous, splits the complete source, stores one object and payload array per record, rebuilds boxed segment arrays, and sends every record to the webview.
- A synthetic 64 MB source took about 4.2 seconds in one uninterrupted parse and retained about 614 MB for 1.5 million records. A 64 MiB flash image commonly produces 150-180 MB of source text, so the existing representation does not meet the target.
- VS Code efficiently preserves `ArrayBuffer` values across `Webview.postMessage`; direct `Uint8Array` messaging is inefficient.

## Requirements

- Parse IHEX and SREC incrementally with cancellation, monotonic progress, and cooperative work slices capped at 24 ms.
- Scan lines by source offsets without `String.split`; preserve all existing format, error, checksum, address, segment, save, repair, and external-change semantics.
- Store record metadata in paged typed arrays. Do not retain raw substrings, per-record payload arrays, or one JavaScript object per record.
- Store mapped bytes once in canonical segment buffers. Avoid boxed `number[]` segment assembly.
- Keep `workspace.fs.readFile` for URI compatibility and release its byte buffer after text decoding.
- Send segment bytes as exact `ArrayBuffer` values. Keep records host-side and fetch 512-record pages into an eight-page webview LRU cache.
- Version all document/page messages with a generation and discard stale responses after replacement, save, repair, reload, or disposal.
- Show read/parse/build/transfer progress immediately. Abort superseded or disposed work and release per-panel state.
- Support two concurrent documents, each representing 64 MiB mapped flash.

## Acceptance Criteria

- [ ] Existing parser fixtures and save/repair tests remain behaviorally equivalent.
- [ ] Async parser tests cover cancellation, progress, time slicing, CRLF, blanks, malformed input, gaps, and final chunks.
- [ ] Protocol/UI tests cover progress, page boundaries, caching, stale generations, rapid/compressed scrolling, and reload invalidation.
- [ ] Lifecycle tests prove disposal/supersession stops responses and releases document ownership.
- [ ] A dedicated performance command asserts at most 384 MB retained host heap plus ArrayBuffers per initialized 64 MiB-flash document after GC, and at most twice that for two documents.
- [ ] `npm run check-types`, `npm run lint`, `npm test`, and `npm run test:performance` pass.

## Out of Scope

- Full `innerHTML` security audit or custom lint rule.
- On-demand mapped-byte fetching, local-file random access, or streaming decode.
- Broader chunking of save serialization and integrity algorithms beyond replacing synchronous reparses.
- User-visible changes to formats, persistence, editing, repair, or navigation.
