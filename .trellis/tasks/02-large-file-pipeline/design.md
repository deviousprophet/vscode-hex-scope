# Large-file pipeline design

## Architecture

- Add an async compact parser beside the existing public synchronous parser APIs. Both reuse the same IHEX/SREC line decoders and address-state rules; parity tests prevent drift.
- `CompactParseResult` owns source-offset record metadata, canonical `MemorySegment` buffers, counts, and optional start address. `CompactRecordStore` uses fixed-size typed-array pages and materializes a `HexRecord` only for a requested page or an edit/repair operation.
- The session owns one disposable panel context: source text, current/pending compact result, generation, abort controller, watcher, timers, and message subscriptions.

## Data flow and protocol

1. Install webview HTML before file I/O; send indeterminate read progress.
2. Decode `workspace.fs.readFile`, drop the byte reference, then parse source-offset lines in 24 ms slices.
3. Build exact canonical segments without boxed arrays; emit throttled parse/build progress.
4. Send a generation-bearing summary and `ArrayBuffer` segment payloads. Browser hydration wraps each buffer in `Uint8Array`.
5. Record virtualization requests aligned 512-record pages. Host validates generation and count; browser caches eight pages and prefetches one adjacent page.
6. Replacement loads increment generation and abort prior work. Stale progress/pages are ignored on both sides.

## Compatibility and failure handling

- Full reads remain the cross-scheme compatibility boundary.
- Existing malformed/checksum flows, edit conflict handling, serialization, and repair output remain unchanged.
- Invalid or cancelled loads never replace the last accepted document. Disposal aborts all work, clears retained values, and prevents later posts.
- Wire types and hydrated browser types are distinct so `ArrayBuffer` never leaks into memory/search APIs expecting `Uint8Array`.

## Performance policy

- Hard retained-memory target: 384 MB per 64 MiB mapped-flash document after GC; two documents: 768 MB.
- Scheduler default budget: 24 ms; progress throttle: 100 ms.
- Wall-clock duration is reported but not used as a hardware-sensitive failure gate.
